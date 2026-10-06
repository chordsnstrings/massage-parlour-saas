'use server'
import { withTenant } from '@spa/db'
import {
  DomainError,
  getEditablePage,
  getSite,
  publishAll,
  publishPage,
  saveDraft,
  setPageVisible,
  switchTemplate,
  updateTheme,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { designSignature, isPageData } from '@/components/site/content'
import { isTemplateKey, TEMPLATES } from '@/components/site/templates'
import { normalizeTheme } from '@/components/site/theme'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { can, guard, type MemberContext } from '@/server/access'
import { audit } from '@/server/audit'

const MAX_PAGE_BYTES = 512 * 1024
const uuid = z.string().uuid()

const auditAs = (ctx: MemberContext, action: string, entity: string, entityId?: string, data?: unknown) =>
  audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action,
    entity,
    entityId,
    data,
  })

const revalidate = (slug: string) => revalidatePath(`/dashboard/${slug}/website`, 'layout')

function domainFail(e: unknown): ActionResult {
  if (e instanceof DomainError) return fail(e.message)
  throw e
}

/* ------------------------------------------------------------------ Template */

const templateSchema = z.object({
  template: z.string().refine(isTemplateKey, 'Choose a template'),
  replaceContent: z.string().optional(),
})

/** Creates the site from a template on first use; afterwards swaps theme tokens (optionally starter content). */
export async function applyTemplateAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'site.design')
  if (error) return fail(error)
  const parsed = templateSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const template = TEMPLATES[parsed.data.template as keyof typeof TEMPLATES]
  const replaceContent = parsed.data.replaceContent === 'on'
  try {
    await withTenant(ctx.tenant.id, (tx) =>
      switchTemplate(tx, ctx.tenant.id, template, { replaceContent, userId: ctx.user.id }),
    )
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.template_applied', 'site', undefined, { template: template.key, replaceContent })
  revalidate(slug)
  return ok(`${template.name} applied`)
}

/* ------------------------------------------------------------------ Theme */

const hex = z.string().regex(/^#[0-9a-f]{6}$/i, 'Use a colour like #5e7d6b')
const themeSchema = z.object({
  accent: hex,
  accentFg: hex,
  headingFont: z.enum(['serif', 'sans']),
  radius: z.enum(['none', 'soft', 'round']),
  buttonShape: z.enum(['square', 'rounded', 'pill']),
  density: z.enum(['compact', 'comfortable', 'airy']),
  motion: z.enum(['none', 'subtle', 'expressive']),
})

/** Theme layer (PLAN §11.3 layer 1): accent, fonts, shape, spacing density and motion intensity. */
export async function saveThemeAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'site.design')
  if (error) return fail(error)
  const parsed = themeSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  try {
    await withTenant(ctx.tenant.id, async (tx) => {
      const site = await getSite(tx, ctx.tenant.id)
      if (!site) throw new DomainError('Choose a template first', 'not_found')
      const current = normalizeTheme(site.theme)
      // The accent tint follows the accent so tinted bands stay in harmony with the page background.
      await updateTheme(tx, ctx.tenant.id, {
        ...current,
        ...d,
        accentSoft: mixHex(d.accent, current.bg, 0.14),
      })
    })
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.theme_updated', 'site', undefined, d)
  revalidate(slug)
  return ok('Theme saved — it is live on your site')
}

function mixHex(a: string, b: string, weight: number) {
  const full = (h: string) =>
    h.length === 4 ? `#${[...h.slice(1)].map((c) => c + c).join('')}` : h.slice(0, 7)
  const p = (h: string) =>
    [1, 3, 5].map((i) => {
      const n = Number.parseInt(full(h).slice(i, i + 2), 16)
      return Number.isNaN(n) ? 255 : n
    })
  const [x, y] = [p(a), p(b)]
  return `#${x
    .map((v, i) => Math.round(v * weight + y[i]! * (1 - weight)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`
}

/* ------------------------------------------------------------------ Pages */

function checkData(pageId: string, data: unknown) {
  if (!uuid.safeParse(pageId).success) return { error: 'Page not found' }
  if (!isPageData(data)) return { error: 'This page could not be read. Reload the editor and try again.' }
  if (JSON.stringify(data).length > MAX_PAGE_BYTES) return { error: 'This page is too large to save.' }
  return { error: null }
}

/**
 * Saves editor JSON as the page draft. Members with only `site.content` may change text and images but not
 * the layout: the design signature must match what's stored.
 */
async function storeDraft(ctx: MemberContext, pageId: string, data: Record<string, unknown>) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const current = await getEditablePage(tx, ctx.tenant.id, pageId)
    if (!current) throw new DomainError('Page not found', 'not_found')
    if (!can(ctx, 'site.design') && designSignature(current.data) !== designSignature(data)) {
      throw new DomainError(
        "You can edit text and images, but layout changes need the 'Edit design' permission.",
      )
    }
    return saveDraft(tx, { tenantId: ctx.tenant.id, pageId, data, userId: ctx.user.id })
  })
}

export async function saveDraftAction(slug: string, pageId: string, data: unknown): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'site.content')
  if (error) return fail(error)
  const check = checkData(pageId, data)
  if (check.error) return fail(check.error)
  try {
    const version = await storeDraft(ctx, pageId, data as Record<string, unknown>)
    await auditAs(ctx, 'site.page.draft_saved', 'site_page', pageId, { versionId: version.id })
  } catch (e) {
    return domainFail(e)
  }
  revalidate(slug)
  return ok('Draft saved')
}

/** Publishes the editor state for one page (saving it first when the member may edit content). */
export async function publishPageAction(slug: string, pageId: string, data: unknown): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'site.publish')
  if (error) return fail(error)
  const check = checkData(pageId, data)
  if (check.error) return fail(check.error)
  try {
    if (can(ctx, 'site.content')) await storeDraft(ctx, pageId, data as Record<string, unknown>)
    const version = await withTenant(ctx.tenant.id, (tx) =>
      publishPage(tx, { tenantId: ctx.tenant.id, pageId, userId: ctx.user.id }),
    )
    await auditAs(ctx, 'site.page.published', 'site_page', pageId, { versionId: version.id })
  } catch (e) {
    return domainFail(e)
  }
  revalidate(slug)
  return ok('Published — your page is live')
}

export async function publishSiteAction(
  slug: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'site.publish')
  if (error) return fail(error)
  let count = 0
  try {
    count = await withTenant(ctx.tenant.id, (tx) => publishAll(tx, ctx.tenant.id, ctx.user.id))
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.published', 'site', undefined, { pages: count })
  revalidate(slug)
  return ok(count ? `Published ${count} ${count === 1 ? 'page' : 'pages'}` : 'Everything is already live')
}

export async function setPageVisibleAction(
  slug: string,
  pageId: string,
  visible: boolean,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'site.design')
  if (error) return fail(error)
  const parsed = z.object({ pageId: uuid, visible: z.boolean() }).safeParse({ pageId, visible })
  if (!parsed.success) return fromZod(parsed.error)
  try {
    await withTenant(ctx.tenant.id, (tx) => setPageVisible(tx, ctx.tenant.id, pageId, visible))
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, visible ? 'site.page.shown' : 'site.page.hidden', 'site_page', pageId)
  revalidate(slug)
  return ok(visible ? 'Page is visible' : 'Page hidden from your site')
}

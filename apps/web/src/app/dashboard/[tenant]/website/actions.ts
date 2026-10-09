'use server'
import { withTenant } from '@spa/db'
import {
  addPage,
  applySiteCopy,
  applySiteCopyToPages,
  DomainError,
  extractSiteCopy,
  getEditablePage,
  getSite,
  hasCopySlots,
  listPages,
  type PageData,
  publishAll,
  publishPage,
  type SiteCopy,
  saveDraft,
  setPageVisible,
  switchTemplate,
  undoTemplateSwitch,
  updateDraftTheme,
  updateTheme,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { designSignature, isPageData } from '@/components/site/content'
import { PAGE_TEMPLATES, pageTemplateData } from '@/components/site/presets'
import { BACKDROPS, EMBLEMS, normalizeTheme } from '@/components/site/theme'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { can, type MemberContext, studioGuard } from '@/server/access'
import { audit } from '@/server/audit'
import { publishAllErrors } from '@/server/site-preflight'
import { resolveTemplate } from '@/server/site-templates'
import { SiteCopySchema, siteWriterReady, writerError, writeSiteCopy } from '@/server/site-writer'

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
  if (e instanceof DomainError) return failDomain(e)
  throw e
}

/* ------------------------------------------------------------------ Template */

const templateSchema = z.object({
  template: z.string().trim().min(1, 'Choose a template').max(60),
  replaceContent: z.string().optional(),
})

/**
 * Creates the site from a template on first use; afterwards swaps theme tokens (optionally starter content as
 * drafts). The previous template is kept on the site so the switch can be undone in one click.
 */
export async function applyTemplateAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.design')
  if (error) return fail(error)
  const parsed = templateSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const template = await resolveTemplate(parsed.data.template)
  if (!template) return fail('Choose a template', { template: 'Choose a template' })
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

/** One-click undo of the last template switch (template, theme and replaced drafts). */
export async function undoTemplateAction(
  slug: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.design')
  if (error) return fail(error)
  let key = ''
  try {
    key = (await withTenant(ctx.tenant.id, (tx) => undoTemplateSwitch(tx, ctx.tenant.id, ctx.user.id)))
      .templateKey
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.template_undone', 'site', undefined, { template: key })
  revalidate(slug)
  const template = await resolveTemplate(key)
  return ok(`Back to ${template?.name ?? key}`)
}

/** Adds a page from a page template (e.g. "Ramadan offers") as a draft. */
export async function addPageFromTemplateAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.design')
  if (error) return fail(error)
  const parsed = z
    .object({ template: z.string().refine((k) => PAGE_TEMPLATES.some((t) => t.key === k), 'Choose a page') })
    .safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const t = PAGE_TEMPLATES.find((x) => x.key === parsed.data.template)!
  let page: { id: string; slug: string }
  try {
    page = await withTenant(ctx.tenant.id, (tx) =>
      addPage(tx, {
        tenantId: ctx.tenant.id,
        slug: t.slug,
        title: t.title,
        data: pageTemplateData(t, t.key),
        userId: ctx.user.id,
      }),
    )
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.page.created', 'site_page', page.id, { template: t.key, slug: page.slug })
  revalidate(slug)
  return ok(`${t.name} added as a draft`, { pageId: page.id })
}

/* ------------------------------------------------------------------ AI site writer */

/**
 * What applying will do: `new` creates the site from the template; `in-place` writes the copy into the spa's
 * own pages (layout, images and theme stay); `starter` keeps the theme but replaces drafts with the template's
 * starter pages (the spa's pages have no copy areas yet); `switch` changes template — the theme is live at once.
 */
export type SiteCopyMode = 'new' | 'in-place' | 'starter' | 'switch'

export type SiteCopyPreview = {
  template: string
  templateName: string
  mode: SiteCopyMode
  /** The spa's own copy, or null when its pages have no copy areas to compare against. */
  current: SiteCopy | null
  proposed: SiteCopy
}

/**
 * Writes hero, about, USPs, FAQs and CTA (EN + AR) from the spa's facts. Nothing is saved: the member reviews
 * the before/after first and applies it with `applySiteCopyAction`.
 */
export async function generateSiteCopyAction(
  slug: string,
  input: { template: string; notes?: string },
): Promise<{ ok: true; preview: SiteCopyPreview } | { ok: false; error: string }> {
  const { ctx, error } = await studioGuard(slug, 'site.design')
  if (error) return { ok: false, error }
  const parsed = z
    .object({ template: z.string().trim().min(1).max(60), notes: z.string().trim().max(400).optional() })
    .safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Choose a template' }
  const template = await resolveTemplate(parsed.data.template)
  if (!template) return { ok: false, error: 'Choose a template' }
  if (!(await siteWriterReady())) return { ok: false, error: writerError(new Error('disabled')) }
  let proposed: SiteCopy
  try {
    proposed = await writeSiteCopy({
      tenantId: ctx.tenant.id,
      template: { name: template.name, feel: template.feel },
      notes: parsed.data.notes || undefined,
    })
  } catch (e) {
    console.error('site writer failed', e)
    return { ok: false, error: writerError(e) }
  }
  // "Before": what the spa's own pages say now (never the template's sample copy).
  const { site, drafts } = await withTenant(ctx.tenant.id, async (tx) => {
    const pages = await listPages(tx, ctx.tenant.id)
    const out: { data: PageData }[] = []
    for (const p of pages) {
      const page = await getEditablePage(tx, ctx.tenant.id, p.id)
      if (page) out.push({ data: page.data })
    }
    return { site: await getSite(tx, ctx.tenant.id), drafts: out }
  })
  const slotted = hasCopySlots(drafts)
  const mode: SiteCopyMode = !site
    ? 'new'
    : site.templateKey !== template.key
      ? 'switch'
      : slotted
        ? 'in-place'
        : 'starter'
  await auditAs(ctx, 'site.ai_copy_generated', 'site', undefined, { template: template.key })
  return {
    ok: true,
    preview: {
      template: template.key,
      templateName: template.name,
      mode,
      current: slotted ? extractSiteCopy(drafts) : null,
      proposed,
    },
  }
}

/**
 * Applies reviewed AI copy as drafts (never publishes). For the current template it is written into the spa's
 * own pages, keeping layout, images and theme; only pages without copy areas fall back to the template's
 * starter pages (theme kept). Choosing another template switches to it (undoable).
 */
export async function applySiteCopyAction(
  slug: string,
  input: { template: string; copy: SiteCopy },
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.design')
  if (error) return fail(error)
  const parsed = z
    .object({ template: z.string().trim().min(1).max(60), copy: SiteCopySchema })
    .safeParse(input)
  if (!parsed.success) return fail('This suggestion could not be read. Generate it again.')
  const template = await resolveTemplate(parsed.data.template)
  if (!template) return fail('Choose a template')
  const copy = parsed.data.copy
  let mode: SiteCopyMode
  let count = 0
  try {
    mode = await withTenant(ctx.tenant.id, async (tx): Promise<SiteCopyMode> => {
      const site = await getSite(tx, ctx.tenant.id)
      if (site?.templateKey === template.key) {
        const written = await applySiteCopyToPages(tx, ctx.tenant.id, copy, ctx.user.id)
        count = written.filled
        if (written.filled) return 'in-place'
      }
      const { template: filled, filled: n } = applySiteCopy(template, copy)
      count = n
      await switchTemplate(tx, ctx.tenant.id, filled, {
        replaceContent: true,
        keepTheme: site?.templateKey === template.key,
        userId: ctx.user.id,
      })
      return !site ? 'new' : site.templateKey === template.key ? 'starter' : 'switch'
    })
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.ai_copy_applied', 'site', undefined, {
    template: template.key,
    fields: count,
    mode,
  })
  revalidate(slug)
  return ok(
    mode === 'switch'
      ? `Switched to ${template.name} — your new copy is saved as drafts; publish when you are happy`
      : 'Your new copy is saved as drafts — review and publish when you are happy',
  )
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
  backdrop: z.enum(BACKDROPS).optional(),
  emblem: z.enum(EMBLEMS).optional(),
})

/** Theme layer (PLAN §11.3 layer 1): accent, fonts, shape, spacing density and motion intensity. */
export async function saveThemeAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.design')
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
      // An unpublished AI theme draft keeps its other changes but takes these values too (else it would hide them).
      if (site.themeDraft) {
        const draft = normalizeTheme(site.themeDraft)
        await updateDraftTheme(tx, ctx.tenant.id, {
          ...draft,
          ...d,
          accentSoft: mixHex(d.accent, draft.bg, 0.14),
        })
      }
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
  const { ctx, error } = await studioGuard(slug, 'site.content')
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
  const { ctx, error } = await studioGuard(slug, 'site.publish')
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
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  let count = 0
  try {
    const blocked = await withTenant(ctx.tenant.id, (tx) => publishAllErrors(tx, ctx.tenant.id))
    if (blocked) return fail(blocked)
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
  const { ctx, error } = await studioGuard(slug, 'site.design')
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

'use server'
import { type Tx, withTenant } from '@spa/db'
import {
  addPage,
  assertEditStamp,
  assertPagesUnlocked,
  DomainError,
  designSeedPages,
  editStamp,
  getEditablePage,
  getSite,
  htmlDesignContentErrors,
  lockSite,
  markSitemapDue,
  pageDesignReports,
  publishAll,
  publishPage,
  queueSiteTexts,
  saveDraft,
  setPageVisible,
  skipSiteTexts,
  switchTemplate,
  undoTemplateSwitch,
  updateDraftTheme,
  updateTheme,
} from '@spa/services'
import { z } from 'zod'
import { designSignature, isPageData } from '@/components/site/content'
import { PAGE_TEMPLATES, pageTemplateData } from '@/components/site/presets'
import { BACKDROPS, EMBLEMS, normalizeTheme } from '@/components/site/theme'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { can, type MemberContext, studioGuard } from '@/server/access'
import { audit } from '@/server/audit'
import { templateIntoSpa } from '@/server/html-design-files'
import { editStampSchema, publishAllErrors } from '@/server/site-preflight'
import { resolveTemplate } from '@/server/site-templates'
import { runQueuedTextsAfter, siteTextsGate } from '@/server/site-texts-queue'
import { revalidateStudio } from '@/server/studio'

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
  // An HTML design's look is its page (its theme is empty): switching to it always writes its pages as drafts and
  // keeps the spa's theme (switchTemplate), so the live site doesn't change before Publish (as the connector does).
  const replaceContent = parsed.data.replaceContent === 'on' || template.htmlDesign
  // R28 P3: a design with window.CRM_DATA → the page offers "Fill the CRM from the design" next (`?seed=`).
  const seedable = template.htmlDesign && can(ctx, 'services.manage') && can(ctx, 'staff.manage')
  try {
    await withTenant(ctx.tenant.id, (tx) =>
      switchTemplate(tx, ctx.tenant.id, template, {
        replaceContent,
        draftTheme: template.htmlDesign,
        userId: ctx.user.id,
        // R24: an HTML design template's files are copied into the spa (its site never depends on the template).
        prepare: templateIntoSpa(tx, ctx.tenant.id, ctx.user.id),
      }),
    )
  } catch (e) {
    return domainFail(e)
  }
  // After the switch has committed (its own read): a failure here only loses the offer, never the applied template.
  let seedPage: string | undefined
  if (seedable) {
    try {
      const seeds = await withTenant(ctx.tenant.id, (tx) => designSeedPages(tx, ctx.tenant.id))
      seedPage = (seeds.find((p) => p.slug === '') ?? seeds[0])?.id
    } catch (e) {
      console.error('[site.template_applied] seed offer', e)
    }
  }
  // R28 P5 (owner D5): the contract v2 HTML pages the switch wrote get Write texts (EN + AR drafts) right away.
  let texts = ''
  if (template.htmlDesign) {
    try {
      const written = new Set(template.pages.map((p) => p.slug))
      const gate = await siteTextsGate(ctx.user.id)
      const queued = await withTenant(ctx.tenant.id, async (tx) => {
        const v2 = (await pageDesignReports(tx, ctx.tenant.id)).filter(
          (r) => r.report.contract === 'v2' && written.has(r.slug),
        )
        if (!v2.length) return null
        const run = {
          via: 'template_apply' as const,
          actorUserId: ctx.user.id,
          pageIds: v2.map((r) => r.pageId),
          ...(v2.length === 1 && v2[0]!.sha256 ? { designSha: v2[0]!.sha256 } : {}),
        }
        if (gate.ok) await queueSiteTexts(tx, ctx.tenant.id, run)
        else await skipSiteTexts(tx, ctx.tenant.id, { ...run, summary: gate.reason })
        return gate
      })
      if (queued?.ok) {
        runQueuedTextsAfter([{ tenantId: ctx.tenant.id, slug }])
        texts = ' Write texts is drafting its texts.'
      } else if (queued) texts = ` Write texts skipped: ${queued.reason}.`
    } catch (e) {
      console.error('[site.template_applied] write texts', e)
    }
  }
  await auditAs(ctx, 'site.template_applied', 'site', undefined, { template: template.key, replaceContent })
  revalidateStudio(slug)
  return ok(`${template.name} applied${texts ? `.${texts}` : ''}`, seedPage ? { seedPage } : undefined)
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
  let live: { version: number; fromSha: string; toSha: string } | undefined
  try {
    key = (
      await withTenant(ctx.tenant.id, async (tx) => {
        live = (await getSite(tx, ctx.tenant.id))?.templateUndo?.live
        return undoTemplateSwitch(tx, ctx.tenant.id, ctx.user.id)
      })
    ).templateKey
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.template_undone', 'site', undefined, {
    template: key,
    ...(live ? { live: true, version: live.version } : {}),
  })
  revalidateStudio(slug)
  // R28 P5: a live upgrade's undo re-published the previous version.
  if (live) return ok(`Back to version ${Math.max(1, live.version - 1)} (re-published)`)
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
  revalidateStudio(slug)
  return ok(`${t.name} added as a draft`, { pageId: page.id })
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
  let changed: string[] = []
  let hasDraft = false
  try {
    await withTenant(ctx.tenant.id, async (tx) => {
      await lockSite(tx, ctx.tenant.id)
      const site = await getSite(tx, ctx.tenant.id)
      if (!site) throw new DomainError('Choose a template first', 'not_found')
      const current = normalizeTheme(site.theme)
      // The panel shows the LIVE theme; only the fields the owner changed are written — live, and into an unpublished
      // AI theme draft (else the draft would hide them) — so saving never takes the rest of a draft live.
      const same = (a: unknown, b: unknown) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase()
      const live = current as unknown as Record<string, unknown>
      changed = Object.entries(d)
        .filter(([k, v]) => v !== undefined && !same(v, live[k]))
        .map(([k]) => k)
      hasDraft = site.themeDraft !== null
      if (!changed.length) return
      const picked = Object.fromEntries(changed.map((k) => [k, d[k as keyof typeof d]]))
      const tint = (bg: string) =>
        changed.includes('accent') ? { accentSoft: mixHex(d.accent, bg, 0.14) } : {}
      await updateTheme(tx, ctx.tenant.id, { ...current, ...picked, ...tint(current.bg) })
      if (site.themeDraft) {
        const draft = normalizeTheme(site.themeDraft)
        await updateDraftTheme(tx, ctx.tenant.id, { ...draft, ...picked, ...tint(draft.bg) })
      }
    })
  } catch (e) {
    return domainFail(e)
  }
  if (!changed.length) return ok('Nothing changed')
  await auditAs(ctx, 'site.theme_updated', 'site', undefined, { ...d, changed })
  revalidateStudio(slug)
  return ok(
    hasDraft
      ? 'Theme saved — your changes are live; the unpublished theme draft goes live when you publish'
      : 'Theme saved — it is live on your site',
  )
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
 * the layout: the design signature must match what's stored. With the editor's `stamp`, refuses when the draft
 * changed since the editor loaded it (Claude MCP, Ask AI, another tab) instead of overwriting that work.
 */
async function storeDraft(
  tx: Tx,
  ctx: MemberContext,
  pageId: string,
  data: Record<string, unknown>,
  stamp: EditStampInput,
) {
  await lockSite(tx, ctx.tenant.id)
  // F29: refused while another super-admin holds the page's editor lock (they took over, or it was theirs). Checked
  // before the stamp: a taken-over editor must hear "X took over" (→ view only), not "changed elsewhere — keep mine".
  await assertPagesUnlocked(tx, { tenantId: ctx.tenant.id, pageIds: [pageId], userId: ctx.user.id })
  await assertEditStamp(tx, ctx.tenant.id, pageId, stamp)
  const current = await getEditablePage(tx, ctx.tenant.id, pageId)
  if (!current) throw new DomainError('Page not found', 'not_found')
  if (!can(ctx, 'site.design') && designSignature(current.data) !== designSignature(data)) {
    throw new DomainError(
      "You can edit text and images, but layout changes need the 'Edit design' permission.",
    )
  }
  // R28 P4: HTML-design website content (shape + this spa's own public files; stale entries are fine).
  const problems = await htmlDesignContentErrors(tx, ctx.tenant.id, data)
  if (problems.length) throw new DomainError(`Website content: ${problems[0]}`)
  return saveDraft(tx, { tenantId: ctx.tenant.id, pageId, data, userId: ctx.user.id })
}

const AUTOSAVE_AUDIT_MS = 10 * 60_000
const autosaveAudited = new Map<string, number>()
/** True when this page + editor had no audited autosave in the last 10 minutes (in-process; one web instance). */
function autosaveAuditDue(key: string, now = Date.now()) {
  const last = autosaveAudited.get(key)
  if (last !== undefined && now - last < AUTOSAVE_AUDIT_MS) return false
  if (autosaveAudited.size > 5000) autosaveAudited.clear()
  autosaveAudited.set(key, now)
  return true
}

type EditStampInput = { page: string; site: string } | undefined
const parseStamp = (stamp: unknown): EditStampInput | null => {
  if (stamp === undefined || stamp === null) return undefined
  const parsed = editStampSchema.safeParse(stamp)
  return parsed.success ? parsed.data : null
}

export async function saveDraftAction(
  slug: string,
  pageId: string,
  data: unknown,
  stamp?: unknown,
  opts?: { overwrite?: boolean; autosave?: boolean },
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  const check = checkData(pageId, data)
  if (check.error) return fail(check.error)
  const expected = parseStamp(stamp)
  if (expected === null) return fail('This page could not be read. Reload the editor and try again.')
  // F29 "Keep mine" after a conflict: the editor's version replaces what changed elsewhere (audited as such).
  const overwrite = opts?.overwrite === true
  let saved: { versionId: string; stamp: Awaited<ReturnType<typeof editStamp>> }
  try {
    saved = await withTenant(ctx.tenant.id, async (tx) => {
      const version = await storeDraft(
        tx,
        ctx,
        pageId,
        data as Record<string, unknown>,
        overwrite ? undefined : expected,
      )
      return { versionId: version.id, stamp: await editStamp(tx, ctx.tenant.id, pageId) }
    })
  } catch (e) {
    return domainFail(e)
  }
  // Autosaves land after every pause in typing: one audit row per page + editor per 10 minutes is enough (the version
  // row itself records who saved and when); manual saves and overwrites are always audited.
  if (!opts?.autosave || overwrite || autosaveAuditDue(`${ctx.tenant.id}:${pageId}:${ctx.user.id}`))
    await auditAs(ctx, 'site.page.draft_saved', 'site_page', pageId, {
      versionId: saved.versionId,
      ...(overwrite ? { overwroteChangesElsewhere: true } : {}),
    })
  revalidateStudio(slug)
  return ok('Draft saved', { stamp: saved.stamp, savedAt: new Date().toISOString() })
}

/**
 * Publishes the editor state for one page (saving it first when the member may edit content), in one transaction.
 * The publish also takes the draft theme and this page's pending rename live, so with a stamp it is refused when
 * either changed since the editor loaded.
 */
/** F17b: a publish queues a Search Console sitemap submission (the worker sends it; no-op without Google). */
async function queueSitemap(tenantId: string) {
  try {
    await withTenant(tenantId, (tx) => markSitemapDue(tx, tenantId))
  } catch (e) {
    console.error('sitemap queue failed', e instanceof Error ? e.message : e)
  }
}

export async function publishPageAction(
  slug: string,
  pageId: string,
  data: unknown,
  stamp?: unknown,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  const check = checkData(pageId, data)
  if (check.error) return fail(check.error)
  const expected = parseStamp(stamp)
  if (expected === null) return fail('This page could not be read. Reload the editor and try again.')
  let published: { versionId: string; stamp: Awaited<ReturnType<typeof editStamp>> }
  try {
    published = await withTenant(ctx.tenant.id, async (tx) => {
      await lockSite(tx, ctx.tenant.id)
      await assertPagesUnlocked(tx, { tenantId: ctx.tenant.id, pageIds: [pageId], userId: ctx.user.id })
      await assertEditStamp(tx, ctx.tenant.id, pageId, expected, { site: true })
      if (can(ctx, 'site.content'))
        await storeDraft(tx, ctx, pageId, data as Record<string, unknown>, undefined)
      const version = await publishPage(tx, { tenantId: ctx.tenant.id, pageId, userId: ctx.user.id })
      return { versionId: version.id, stamp: await editStamp(tx, ctx.tenant.id, pageId) }
    })
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.page.published', 'site_page', pageId, { versionId: published.versionId })
  await queueSitemap(ctx.tenant.id)
  revalidateStudio(slug)
  return ok('Published — your page is live', { stamp: published.stamp })
}

export async function publishSiteAction(
  slug: string,
  _prev: ActionResult,
  _formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  let result: Awaited<ReturnType<typeof publishAll>>
  try {
    result = await withTenant(ctx.tenant.id, async (tx) => {
      await lockSite(tx, ctx.tenant.id)
      const blocked = await publishAllErrors(tx, ctx.tenant.id)
      if (blocked) throw new DomainError(blocked)
      return publishAll(tx, ctx.tenant.id, ctx.user.id)
    })
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.published', 'site', undefined, result)
  if (result.pages) await queueSitemap(ctx.tenant.id)
  revalidateStudio(slug)
  const pages = result.pages ? `${result.pages} ${result.pages === 1 ? 'page' : 'pages'}` : ''
  return ok(
    pages && result.theme
      ? `Published ${pages} and the site theme`
      : pages
        ? `Published ${pages}`
        : result.theme
          ? 'Published the site theme'
          : 'Everything is already live',
  )
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
  revalidateStudio(slug)
  return ok(visible ? 'Page is visible' : 'Page hidden from your site')
}

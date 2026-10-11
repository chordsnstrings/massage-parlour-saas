'use server'
import { AiBudgetExceededError, AiDisabledError, AiOutputError, loadSpaContext, planSiteEdit } from '@spa/ai'
import { type ThemeTokens, withTenant } from '@spa/db'
import {
  assertEditStamp,
  DomainError,
  editStamp,
  getEditablePage,
  getSite,
  lockSite,
  restoreSiteEdit,
  runSiteEdit,
  type SiteEditDeps,
  type SiteEditResult,
  siteEditAuditData,
} from '@spa/services'
import { z } from 'zod'
import { siteEditSchema } from '@/components/site/ai-schema'
import { designSignature, isPageData } from '@/components/site/content'
import { normalizeTheme } from '@/components/site/theme'
import { type ActionResult, fail, failDomain, fromZod, ok } from '@/lib/action'
import { can, type MemberContext } from '@/server/access'
import { fixtureClient } from '@/server/ai-fixture'
import { audit } from '@/server/audit'
import { aiEditReady, siteAiGuard } from '@/server/site-ai-gate'
import { editStampSchema } from '@/server/site-preflight'
import { revalidateStudio } from '@/server/studio'

/*
 * Studio "Ask AI" (R16 + PLAN §14.4 prompt box; super-admin tooling, EN UI): instruction → planned ops (site_editor
 * agent) → dry run through the shared site-edit ops layer (@spa/services site-edit.ts) → preview on the canvas →
 * Apply = the same ops saved to the DRAFT (page draft + draft theme) → Undo restores the previous draft. Never
 * publishes. Only SITE_AI_EDITOR_EMAILS super-admins with 2FA (re-checked on every action).
 */

const MAX_PAGE_BYTES = 512 * 1024
const uuid = z.string().uuid()
const DESIGN_NEEDED = "Layout and theme changes need the 'Edit design' permission."

function pageError(pageId: string, data: unknown) {
  if (!uuid.safeParse(pageId).success) return 'Page not found'
  if (!isPageData(data)) return 'This page could not be read. Reload the editor and try again.'
  if (JSON.stringify(data).length > MAX_PAGE_BYTES) return 'This page is too large to save.'
  return null
}

const auditAs = (ctx: MemberContext, action: string, entityId: string, data: unknown) =>
  audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action,
    entity: 'site_page',
    entityId,
    data,
  })

/** Ops-layer deps: the Puck block schema, theme normalising and the design-permission rule of the editor. */
const deps = (ctx: MemberContext): SiteEditDeps => ({
  schema: siteEditSchema(),
  normalizeTheme: (t) => normalizeTheme(t) as unknown as ThemeTokens,
  check: (changes, themeChanged) =>
    !can(ctx, 'site.design') &&
    (themeChanged || changes.some((c) => designSignature(c.before) !== designSignature(c.after)))
      ? DESIGN_NEEDED
      : null,
})

/** The panel only edits the open page (+ the site theme): every op is pinned to it. */
const pageOps = (pageId: string, ops: { op: string }[]) =>
  ops.map((op) => (op.op === 'theme' ? op : { ...op, page: pageId }))

const errorText = (r: Extract<SiteEditResult, { ok: false }>) => r.errors.slice(0, 3).join(' · ')

const planSchema = z.object({
  instruction: z.string().trim().min(3, 'Describe the change').max(1500),
  data: z.unknown(),
})

/**
 * Asks the site editor agent for typed ops and dry-runs them on the editor's page (and the draft theme). Nothing is
 * stored: the editor previews the result first. Returns the ops too, so Apply saves exactly what was previewed.
 */
export async function aiEditPlanAction(slug: string, pageId: string, input: unknown): Promise<ActionResult> {
  const { ctx, error } = await siteAiGuard(slug)
  if (error) return fail(error)
  const parsed = planSchema.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const { instruction, data } = parsed.data
  const bad = pageError(pageId, data)
  if (bad) return fail(bad)
  if (!aiEditReady()) return fail('AI editing isn’t set up yet.')
  const loaded = await withTenant(ctx.tenant.id, async (tx) => ({
    page: await getEditablePage(tx, ctx.tenant.id, pageId),
    site: await getSite(tx, ctx.tenant.id),
    spa: await loadSpaContext(tx, ctx.tenant.id, 'content_agent'),
  }))
  if (!loaded.page || !loaded.site) return fail('Page not found')
  const theme = normalizeTheme(loaded.site.themeDraft ?? loaded.site.theme) as unknown as Record<
    string,
    unknown
  >
  const schema = siteEditSchema()
  let plan: Awaited<ReturnType<typeof planSiteEdit>>
  try {
    plan = await planSiteEdit({
      tenantId: ctx.tenant.id,
      instruction,
      about: `${loaded.spa.name}, a massage & wellness spa in the UAE. Brand voice: ${loaded.spa.voice}.`,
      page: { slug: loaded.page.page.slug, title: loaded.page.page.title.en, data },
      theme,
      schema,
      client: fixtureClient(slug),
    })
  } catch (e) {
    if (e instanceof AiBudgetExceededError) return fail('The monthly AI budget for this spa is used up.')
    if (e instanceof AiDisabledError) return fail('AI site editing is switched off in the AI model settings.')
    if (e instanceof AiOutputError)
      return fail('The AI reply could not be read. Try rephrasing the instruction.')
    return fail('The AI service is busy — please try again in a moment.')
  }
  if (!plan.ops.length)
    return fail(plan.note || 'The AI found nothing to change. Try a more specific instruction.')
  const ops = pageOps(pageId, plan.ops)
  const result = await withTenant(ctx.tenant.id, (tx) =>
    runSiteEdit(
      tx,
      {
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        ops,
        dryRun: true,
        base: Object.fromEntries([[pageId, data]]),
      },
      deps(ctx),
    ),
  )
  if (!result.ok) return fail(`The AI suggested changes that don't fit this page: ${errorText(result)}`)
  const { page } = loaded.page
  const label = page.slug === '' ? 'Home' : page.title.en || `/${page.slug}`
  return ok(undefined, {
    data: result.pages.find((p) => p.id === pageId)?.data ?? data,
    theme: result.theme ? normalizeTheme(result.theme) : null,
    // The panel is about this page: drop the ops layer's "<page>: " prefix.
    summary: result.summary.map((s) => s.replace(`${label}: `, '')),
    note: plan.note,
    ops: plan.ops,
  })
}

const applySchema = z.object({
  instruction: z.string().trim().max(1500).default(''),
  ops: z
    .array(z.object({ op: z.string() }).passthrough())
    .min(1)
    .max(40),
  data: z.unknown(),
  /** What the editor loaded: refused when the page draft changed elsewhere since (Claude MCP, another tab). */
  stamp: editStampSchema.optional(),
})

/** Saves a previewed plan: the same ops on the same starting page, through the ops layer → DRAFT only. */
export async function aiEditApplyAction(slug: string, pageId: string, input: unknown): Promise<ActionResult> {
  const { ctx, error } = await siteAiGuard(slug)
  if (error) return fail(error)
  const parsed = applySchema.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const bad = pageError(pageId, parsed.data.data)
  if (bad) return fail(bad)
  const ops = pageOps(pageId, parsed.data.ops)
  if (ops.some((o) => !['add', 'preset', 'move', 'remove', 'update', 'theme'].includes(o.op)))
    return fail('Only changes to this page and the theme can be applied here.')
  let result: SiteEditResult
  let stamp: Awaited<ReturnType<typeof editStamp>> = null
  try {
    result = await withTenant(ctx.tenant.id, async (tx) => {
      await lockSite(tx, ctx.tenant.id)
      await assertEditStamp(tx, ctx.tenant.id, pageId, parsed.data.stamp)
      const r = await runSiteEdit(
        tx,
        {
          tenantId: ctx.tenant.id,
          userId: ctx.user.id,
          ops,
          dryRun: false,
          base: Object.fromEntries([[pageId, parsed.data.data]]),
        },
        deps(ctx),
      )
      stamp = await editStamp(tx, ctx.tenant.id, pageId)
      return r
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  if (!result.ok) return fail(errorText(result))
  await auditAs(ctx, 'site.page.ai_edit', pageId, {
    ...siteEditAuditData({ via: 'studio_ai', ops, summary: result.summary }),
    instruction: parsed.data.instruction || undefined,
    theme: result.theme !== null,
  })
  revalidateStudio(slug)
  const before = result.previous.pages.find((p) => p.id === pageId)
  const { theme } = result.previous
  return ok('AI changes saved as a draft', {
    stamp,
    previous: {
      data: before?.data ?? parsed.data.data,
      // Shown on the canvas after an undo; `restore` comes back with the undo (the exact state to put back).
      theme: theme ? normalizeTheme(theme.shown) : null,
      restore: {
        theme: theme ? { draft: theme.draft } : null,
        addedVersionId: before?.addedVersionId ?? null,
      },
    },
  })
}

const undoSchema = z.object({
  summary: z.array(z.string().max(300)).max(60).default([]),
  data: z.unknown(),
  restore: z
    .object({
      /** null = the edit left the theme alone; draft null = there was no draft theme (cleared again). */
      theme: z.object({ draft: z.record(z.string(), z.unknown()).nullable() }).nullable(),
      addedVersionId: z.string().uuid().nullable(),
    })
    .default({ theme: null, addedVersionId: null }),
  stamp: editStampSchema.optional(),
})

/** Undo of an applied AI change: restores the page draft (and draft theme) from before it. Never publishes. */
export async function aiEditUndoAction(slug: string, pageId: string, input: unknown): Promise<ActionResult> {
  const { ctx, error } = await siteAiGuard(slug)
  if (error) return fail(error)
  const parsed = undoSchema.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const bad = pageError(pageId, parsed.data.data)
  if (bad) return fail(bad)
  const { restore } = parsed.data
  const theme = restore.theme
    ? {
        draft: restore.theme.draft ? (normalizeTheme(restore.theme.draft) as unknown as ThemeTokens) : null,
      }
    : null
  let stamp: Awaited<ReturnType<typeof editStamp>> = null
  try {
    await withTenant(ctx.tenant.id, async (tx) => {
      await lockSite(tx, ctx.tenant.id)
      // A theme undo would overwrite a draft theme changed since (e.g. by Claude): checked with the site stamp too.
      await assertEditStamp(tx, ctx.tenant.id, pageId, parsed.data.stamp, { site: theme !== null })
      const current = await getEditablePage(tx, ctx.tenant.id, pageId)
      if (!current) throw new DomainError('Page not found', 'not_found')
      const designChanged =
        theme !== null || designSignature(current.data) !== designSignature(parsed.data.data)
      if (designChanged && !can(ctx, 'site.design')) throw new DomainError(DESIGN_NEEDED)
      await restoreSiteEdit(tx, {
        tenantId: ctx.tenant.id,
        userId: ctx.user.id,
        pages: [{ id: pageId, data: parsed.data.data, addedVersionId: restore.addedVersionId }],
        theme,
      })
      stamp = await editStamp(tx, ctx.tenant.id, pageId)
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await auditAs(ctx, 'site.page.ai_edit_undone', pageId, {
    via: 'via Studio Ask AI',
    summary: parsed.data.summary,
    theme: theme !== null,
  })
  revalidateStudio(slug)
  return ok('AI change undone', { stamp })
}

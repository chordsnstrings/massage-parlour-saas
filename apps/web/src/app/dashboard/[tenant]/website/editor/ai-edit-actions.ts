'use server'
import { AiBudgetExceededError, AiDisabledError, AiOutputError, loadSpaContext, planSiteEdit } from '@spa/ai'
import { withTenant } from '@spa/db'
import { DomainError, getEditablePage, getSite, type PageData, saveDraft, updateTheme } from '@spa/services'
import { applySiteEditOps } from '@spa/services/site-kit'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { siteEditSchema } from '@/components/site/ai-schema'
import { designSignature, isPageData } from '@/components/site/content'
import { normalizeTheme } from '@/components/site/theme'
import { type ActionResult, fail, failDomain, fromZod, ok } from '@/lib/action'
import { can, type MemberContext, studioGuard } from '@/server/access'
import { aiFixturesOn, fixtureClient } from '@/server/ai-fixture'
import { audit } from '@/server/audit'

/* R16: "Ask AI" in the Website Studio editor (super-admin tooling, EN only). Plan → preview → Apply → Undo. */

const MAX_PAGE_BYTES = 512 * 1024
const uuid = z.string().uuid()
const DESIGN_NEEDED = "Layout and theme changes need the 'Edit design' permission."

const aiEditReady = () => Boolean(process.env.ARK_API_KEY) || aiFixturesOn()

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

const planSchema = z.object({
  instruction: z.string().trim().min(3, 'Describe the change').max(1500),
  data: z.unknown(),
})

/**
 * Asks the site editor agent for typed ops, validates them against the real block schema and applies them to
 * a copy of the editor's page (and theme). Nothing is stored: the editor previews the result first.
 */
export async function aiEditPlanAction(slug: string, pageId: string, input: unknown): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
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
  const theme = normalizeTheme(loaded.site.theme) as unknown as Record<string, unknown>
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
  const result = applySiteEditOps({ data, theme, ops: plan.ops }, schema)
  if (!result.ok)
    return fail(`The AI suggested changes that don't fit this page: ${result.errors.slice(0, 3).join(' · ')}`)
  const designChanged = result.theme !== null || designSignature(data) !== designSignature(result.data)
  if (designChanged && !can(ctx, 'site.design')) return fail(DESIGN_NEEDED)
  if (JSON.stringify(result.data).length > MAX_PAGE_BYTES)
    return fail('The edited page would be too large to save.')
  return ok(undefined, {
    data: result.data,
    theme: result.theme ? normalizeTheme(result.theme) : null,
    summary: result.summary,
    note: plan.note,
  })
}

const applySchema = z.object({
  instruction: z.string().trim().max(1500).default(''),
  summary: z.array(z.string().max(300)).max(60).default([]),
  data: z.unknown(),
  theme: z.record(z.string(), z.unknown()).nullable().default(null),
})

/**
 * Saves a previewed AI edit (or, for undo, the previous state) as the page draft — never publishes. Theme
 * tokens are site-wide (as in the Theme panel). Returns what was there before, for one-click undo.
 */
async function storeEdit(ctx: MemberContext, pageId: string, input: z.infer<typeof applySchema>) {
  return withTenant(ctx.tenant.id, async (tx) => {
    const current = await getEditablePage(tx, ctx.tenant.id, pageId)
    if (!current) throw new DomainError('Page not found', 'not_found')
    const site = await getSite(tx, ctx.tenant.id)
    if (!site) throw new DomainError('Choose a template first', 'not_found')
    const designChanged =
      input.theme !== null || designSignature(current.data) !== designSignature(input.data)
    if (designChanged && !can(ctx, 'site.design')) throw new DomainError(DESIGN_NEEDED)
    const version = await saveDraft(tx, {
      tenantId: ctx.tenant.id,
      pageId,
      data: input.data as PageData,
      userId: ctx.user.id,
    })
    if (input.theme) await updateTheme(tx, ctx.tenant.id, normalizeTheme(input.theme))
    return {
      versionId: version.id,
      previous: { data: current.data, theme: input.theme ? normalizeTheme(site.theme) : null },
    }
  })
}

async function save(slug: string, pageId: string, input: unknown, undo: boolean): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  const parsed = applySchema.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const bad = pageError(pageId, parsed.data.data)
  if (bad) return fail(bad)
  let stored: Awaited<ReturnType<typeof storeEdit>>
  try {
    stored = await storeEdit(ctx, pageId, parsed.data)
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await auditAs(ctx, undo ? 'site.page.ai_edit_undone' : 'site.page.ai_edit', pageId, {
    versionId: stored.versionId,
    instruction: parsed.data.instruction || undefined,
    summary: parsed.data.summary,
    theme: parsed.data.theme !== null,
  })
  revalidatePath(`/dashboard/${slug}/website`, 'layout')
  return ok(undo ? 'AI change undone' : 'AI changes saved as a draft', { previous: stored.previous })
}

export async function aiEditApplyAction(slug: string, pageId: string, input: unknown) {
  return save(slug, pageId, input, false)
}

export async function aiEditUndoAction(slug: string, pageId: string, input: unknown) {
  return save(slug, pageId, input, true)
}

'use server'
import { AiBudgetExceededError, AiDisabledError, loadSpaContext, runChat } from '@spa/ai'
import { platformDb, user, withTenant } from '@spa/db'
import {
  collectGlobalIds,
  createSavedSection,
  DomainError,
  deleteSavedSection,
  GLOBAL_SECTION,
  getEditablePage,
  getPage,
  getVersion,
  globalSectionUsage,
  labelVersion,
  listSavedSections,
  listVersions,
  pageBlockStats,
  pagePaths,
  restoreVersion,
  type SavedSectionRow,
  signPreviewToken,
  updateSavedSection,
} from '@spa/services'
import { inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import QRCode from 'qrcode'
import { z } from 'zod'
import { siteConfig } from '@/components/site/config'
import { designSignature, isPageData } from '@/components/site/content'
import { TRANSLATE_BATCH } from '@/components/site/editor/colors'
import type { SavedSection } from '@/components/site/editor/context'
import type { VersionItem } from '@/components/site/editor/versions'
import { type ActionResult, fail, failDomain, fromZod, ok } from '@/lib/action'
import { can, guard, type MemberContext, studioGuard } from '@/server/access'
import { audit } from '@/server/audit'
import { canonicalUrls } from '@/server/origin'
import { publishErrors } from '@/server/site-preflight'
import { publishPageAction } from '../actions'

const uuid = z.string().uuid()
const MAX_SECTION_BYTES = 200 * 1024

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

/* ------------------------------------------------------------------ AI copy assists */

/** ModelArk is configured for this install (keys never leave the server). */
const aiConfigured = () => Boolean(process.env.ARK_API_KEY)

function aiError(e: unknown) {
  if (e instanceof AiBudgetExceededError)
    return 'Your monthly AI budget is used up. Ask your account manager to raise it.'
  if (e instanceof AiDisabledError) return 'This AI feature is switched off by the platform.'
  return 'The AI service is busy — please try again in a moment.'
}

const LANG = {
  en: 'English',
  ar: 'Arabic (natural, Gulf-friendly Modern Standard Arabic)',
} as const
const OPS = {
  rewrite:
    'Rewrite this website text so it reads fresh and inviting. Keep the meaning and roughly the length.',
  shorten: 'Make this website text clearly shorter (about half) while keeping its key message.',
  warmer: 'Make this website text warmer and more welcoming — still calm, refined and professional.',
} as const

const aiSchema = z.object({
  op: z.enum(['rewrite', 'shorten', 'warmer', 'to-ar', 'to-en']),
  text: z.string().trim().min(1, 'Add some text first').max(2000),
  locale: z.enum(['en', 'ar']),
})
const AiOut = z.object({ text: z.string().min(1).max(4000) })
const BatchOut = z.object({ items: z.array(z.string()) })

async function spaVoice(ctx: MemberContext) {
  const spa = await withTenant(ctx.tenant.id, (tx) => loadSpaContext(tx, ctx.tenant.id, 'content_agent'))
  return `${spa.name}, a massage & wellness spa in the UAE. Brand voice: ${spa.voice}. Tone: ${spa.tone}.${
    spa.rules ? ` House rules: ${spa.rules}` : ''
  }`
}

/** Output budget for `chars` characters of copy (Arabic needs more tokens per character than English). */
const tokenBudget = (chars: number) => Math.min(8000, 400 + Math.ceil(chars * 1.5))

const COMMON = `Keep placeholders such as {name}, prices, numbers and brand names exactly as they are. Never make medical or therapeutic claims. No emojis, hashtags or surrounding quotes.`

/** ✨ menu in bilingual fields: rewrite / shorten / warmer in the same language, or translate EN↔AR. */
export async function aiTextAction(slug: string, input: unknown): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  const parsed = aiSchema.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  if (!aiConfigured()) return fail('AI writing help isn’t set up yet.')
  const { op, text, locale } = parsed.data
  try {
    const about = await spaVoice(ctx)
    const translate = op === 'to-ar' || op === 'to-en'
    const target = op === 'to-ar' ? 'ar' : op === 'to-en' ? 'en' : locale
    const res = await runChat({
      tenantId: ctx.tenant.id,
      agentKey: translate ? 'translator' : 'content_agent',
      schema: AiOut,
      temperature: translate ? 0.2 : 0.7,
      maxTokens: tokenBudget(text.length),
      messages: [
        {
          role: 'system',
          content: translate
            ? `You translate website copy for ${about}\nTranslate from ${LANG[op === 'to-en' ? 'ar' : 'en']} to ${LANG[target]}. Keep it natural and concise, matching the brand voice. ${COMMON} Reply with JSON {"text": "..."}.`
            : `You edit website copy for ${about}\n${OPS[op as keyof typeof OPS]} Write in ${LANG[target]}. ${COMMON} Reply with JSON {"text": "..."}.`,
        },
        { role: 'user', content: text },
      ],
    })
    return ok(undefined, { text: res.output.text.trim() })
  } catch (e) {
    return fail(aiError(e))
  }
}

const batchSchema = z.array(z.string().trim().min(1)).min(1)

/** Preflight "Translate with AI": English → Arabic for several fields in one call. */
export async function translateBatchAction(slug: string, texts: unknown): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  const parsed = batchSchema.safeParse(texts)
  if (!parsed.success) return fail('Nothing to translate.')
  if (parsed.data.some((t) => t.length > 2000))
    return fail('One field is too long to translate with AI (2,000 characters at most).')
  const chars = parsed.data.reduce((n, t) => n + t.length, 0)
  if (parsed.data.length > TRANSLATE_BATCH.items || chars > TRANSLATE_BATCH.chars)
    return fail('Too much text for one translation — translate fewer fields at a time.')
  if (!aiConfigured()) return fail('AI translation isn’t set up yet.')
  try {
    const about = await spaVoice(ctx)
    const res = await runChat({
      tenantId: ctx.tenant.id,
      agentKey: 'translator',
      schema: BatchOut,
      temperature: 0.2,
      maxTokens: tokenBudget(chars + parsed.data.length * 8),
      messages: [
        {
          role: 'system',
          content: `You translate website copy for ${about}\nTranslate each English item to ${LANG.ar}, in the same order. ${COMMON} Reply with JSON {"items": ["...", ...]} with exactly ${parsed.data.length} items.`,
        },
        { role: 'user', content: JSON.stringify(parsed.data) },
      ],
    })
    const items = res.output.items.map((s) => s.trim())
    if (items.length !== parsed.data.length || items.some((s) => !s))
      return fail('The translation came back incomplete — please try again.')
    return ok(undefined, { items })
  } catch (e) {
    return fail(aiError(e))
  }
}

/* ------------------------------------------------------------------ Versions + preview links */

export async function listVersionsAction(slug: string, pageId: string): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  if (!uuid.safeParse(pageId).success) return fail('Page not found')
  const rows = await withTenant(ctx.tenant.id, (tx) => listVersions(tx, ctx.tenant.id, pageId, 30))
  // Author names live in the platform-scoped auth table.
  const authorIds = [...new Set(rows.map((r) => r.createdBy).filter((v): v is string => Boolean(v)))]
  const names = authorIds.length
    ? new Map(
        (
          await platformDb()
            .select({ id: user.id, name: user.name })
            .from(user)
            .where(inArray(user.id, authorIds))
        ).map((u) => [u.id, u.name]),
      )
    : new Map<string, string>()
  const versions: VersionItem[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    label: r.label,
    author: r.createdBy ? (names.get(r.createdBy) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
  }))
  return ok(undefined, { versions })
}

const labelSchema = z.object({
  versionId: uuid,
  label: z.string().trim().max(60, 'Keep it under 60 characters'),
})

export async function labelVersionAction(
  slug: string,
  versionId: string,
  label: string,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  const parsed = labelSchema.safeParse({ versionId, label })
  if (!parsed.success) return fromZod(parsed.error)
  try {
    const row = await withTenant(ctx.tenant.id, (tx) =>
      labelVersion(tx, ctx.tenant.id, parsed.data.versionId, parsed.data.label),
    )
    await auditAs(ctx, 'site.page.version_labeled', 'site_page', row.pageId, {
      versionId: row.id,
      label: row.label,
    })
  } catch (e) {
    return domainFail(e)
  }
  revalidate(slug)
  return ok(parsed.data.label ? 'Version named' : 'Name removed')
}

/** Restores a version as the draft and returns its data so the editor can load it without a reload. */
export async function restoreVersionAction(
  slug: string,
  pageId: string,
  versionId: string,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  const parsed = z.object({ pageId: uuid, versionId: uuid }).safeParse({ pageId, versionId })
  if (!parsed.success) return fail('Version not found')
  let data: Record<string, unknown>
  try {
    data = await withTenant(ctx.tenant.id, async (tx) => {
      const [current, version] = await Promise.all([
        getEditablePage(tx, ctx.tenant.id, pageId),
        getVersion(tx, ctx.tenant.id, versionId),
      ])
      if (!current || !version || version.pageId !== pageId)
        throw new DomainError('Version not found', 'not_found')
      // Content editors may bring back old wording, not a different layout.
      if (!can(ctx, 'site.design') && designSignature(current.data) !== designSignature(version.data))
        throw new DomainError(
          "That version has a different layout — restoring it needs the 'Edit design' permission.",
        )
      const restored = await restoreVersion(tx, {
        tenantId: ctx.tenant.id,
        pageId,
        versionId,
        userId: ctx.user.id,
      })
      return restored.data
    })
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.page.version_restored', 'site_page', pageId, { versionId })
  revalidate(slug)
  return ok('Restored as your draft — publish when you’re ready', { data })
}

const previewSchema = z.object({ pageId: uuid, days: z.union([z.literal(1), z.literal(7), z.literal(30)]) })

/** Shareable draft preview: a signed link (no sign-in needed) that expires, plus its QR code as SVG. */
export async function previewLinkAction(slug: string, pageId: string, days: number): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.content')
  if (error) return fail(error)
  const parsed = previewSchema.safeParse({ pageId, days })
  if (!parsed.success) return fromZod(parsed.error)
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) return fail('Preview links aren’t available on this install yet.')
  const page = await withTenant(ctx.tenant.id, (tx) => getPage(tx, ctx.tenant.id, pageId))
  if (!page) return fail('Page not found')
  const expiresAt = new Date(Date.now() + parsed.data.days * 86_400_000)
  const token = signPreviewToken({ tenantId: ctx.tenant.id, pageId, expiresAt }, secret)
  const url = canonicalUrls().app(`/website/preview?token=${token}`)
  const qr = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })
  await auditAs(ctx, 'site.page.preview_link_created', 'site_page', pageId, { days: parsed.data.days })
  return ok(undefined, { url, qr, expiresAt: expiresAt.toISOString() })
}

/* ------------------------------------------------------------------ Saved & global sections */

const toClient = (r: SavedSectionRow): SavedSection => ({
  id: r.id,
  name: r.name,
  isGlobal: r.isGlobal,
  data: r.data as SavedSection['data'],
  updatedAt: r.updatedAt.toISOString(),
})

const blockTypes = new Set(Object.keys(siteConfig.components).filter((t) => t !== GLOBAL_SECTION))
const nodeSchema = z
  .object({
    type: z.string().refine((t) => blockTypes.has(t), 'This block can’t be saved'),
    props: z.record(z.string(), z.unknown()),
  })
  .refine((n) => JSON.stringify(n).length <= MAX_SECTION_BYTES, 'This section is too large to save')
  .refine(
    (n) => collectGlobalIds({ content: [n] }).length === 0,
    'Global sections can’t contain other global sections',
  )
const nameSchema = z.string().trim().min(1, 'Give it a name').max(60, 'Keep it under 60 characters')

export async function saveSectionAction(slug: string, input: unknown): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.design')
  if (error) return fail(error)
  const parsed = z.object({ name: nameSchema, node: nodeSchema, isGlobal: z.boolean() }).safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const row = await withTenant(ctx.tenant.id, (tx) =>
    createSavedSection(tx, {
      tenantId: ctx.tenant.id,
      name: parsed.data.name,
      data: parsed.data.node,
      isGlobal: parsed.data.isGlobal,
    }),
  )
  await auditAs(ctx, 'site.section.saved', 'saved_section', row.id, {
    name: row.name,
    isGlobal: row.isGlobal,
    type: parsed.data.node.type,
  })
  revalidate(slug)
  return ok(row.isGlobal ? 'Saved as a global section' : 'Saved to your library', { section: toClient(row) })
}

export async function renameSectionAction(slug: string, id: string, name: string): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.design')
  if (error) return fail(error)
  const parsed = z.object({ id: uuid, name: nameSchema }).safeParse({ id, name })
  if (!parsed.success) return fromZod(parsed.error)
  let row: SavedSectionRow
  try {
    row = await withTenant(ctx.tenant.id, (tx) =>
      updateSavedSection(tx, ctx.tenant.id, parsed.data.id, { name: parsed.data.name }),
    )
  } catch (e) {
    return domainFail(e)
  }
  await auditAs(ctx, 'site.section.renamed', 'saved_section', row.id, { name: row.name })
  revalidate(slug)
  return ok('Renamed', { section: toClient(row) })
}

export async function deleteSectionAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.design')
  if (error) return fail(error)
  if (!uuid.safeParse(id).success) return fail('Saved section not found')
  try {
    const row = await withTenant(ctx.tenant.id, (tx) => deleteSavedSection(tx, ctx.tenant.id, id))
    await auditAs(ctx, 'site.section.deleted', 'saved_section', row.id, { name: row.name })
  } catch (e) {
    return domainFail(e)
  }
  revalidate(slug)
  return ok('Removed from your library')
}

/**
 * Saves the modal editor's block into a global section: every page showing it updates at once — so on a
 * live page this is publishing, and needs 'Publish' as well as 'Edit design' and a clean preflight.
 */
export async function updateGlobalSectionAction(
  slug: string,
  id: string,
  node: unknown,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.design')
  if (error) return fail(error)
  const parsed = z.object({ id: uuid, node: nodeSchema }).safeParse({ id, node })
  if (!parsed.success) return fromZod(parsed.error)
  let result: { row: SavedSectionRow; live: string[] }
  try {
    result = await withTenant(ctx.tenant.id, async (tx) => {
      const existing = (await listSavedSections(tx, ctx.tenant.id)).find((s) => s.id === parsed.data.id)
      if (!existing?.isGlobal) throw new DomainError('Global section not found', 'not_found')
      const pages = await globalSectionUsage(tx, ctx.tenant.id, parsed.data.id, { live: true })
      if (pages.length && !can(ctx, 'site.publish'))
        throw new DomainError(
          "This global section is on your live site — saving it needs the 'Publish' permission.",
        )
      const errors = await publishErrors(
        tx,
        ctx.tenant.id,
        { root: { props: {} }, content: [parsed.data.node] },
        { verb: 'saving' },
      )
      if (errors) throw new DomainError(errors)
      const updated = await updateSavedSection(tx, ctx.tenant.id, parsed.data.id, { data: parsed.data.node })
      return { row: updated, live: pages }
    })
  } catch (e) {
    return domainFail(e)
  }
  const { row, live } = result
  await auditAs(ctx, 'site.section.updated', 'saved_section', row.id, {
    name: row.name,
    global: true,
    livePages: live.length,
  })
  revalidate(slug)
  return ok(
    live.length
      ? 'Global section updated — live pages show it straight away'
      : 'Global section updated — it goes live with the next publish of a page that uses it',
    { section: toClient(row) },
  )
}

/* ------------------------------------------------------------------ Analytics overlay */

export async function blockStatsAction(
  slug: string,
  pageId: string,
  blockIds: unknown,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'reports.view')
  if (error) return fail(error)
  const parsed = z
    .object({ pageId: uuid, blockIds: z.array(z.string().max(80)).max(200) })
    .safeParse({ pageId, blockIds })
  if (!parsed.success) return fail('Page not found')
  const stats = await withTenant(ctx.tenant.id, async (tx) => {
    const page = await getPage(tx, ctx.tenant.id, parsed.data.pageId)
    if (!page) return null
    return pageBlockStats(tx, {
      tenantId: ctx.tenant.id,
      paths: pagePaths(ctx.tenant.slug, page.slug),
      blockIds: parsed.data.blockIds,
    })
  })
  if (!stats) return fail('Page not found')
  return ok(undefined, stats)
}

/* ------------------------------------------------------------------ Publish with preflight */

/**
 * Publishes after a server-side preflight: errors (e.g. images not served over https) block, warnings
 * don't. The checks are the same ones the publish dialog shows, plus the page's global sections.
 */
export async function publishCheckedAction(
  slug: string,
  pageId: string,
  data: unknown,
): Promise<ActionResult> {
  const { ctx, error } = await studioGuard(slug, 'site.publish')
  if (error) return fail(error)
  if (!uuid.safeParse(pageId).success || !isPageData(data)) return fail('This page could not be read.')
  const blocked = await withTenant(ctx.tenant.id, async (tx) => {
    const page = await getPage(tx, ctx.tenant.id, pageId)
    if (!page) return 'Page not found'
    return publishErrors(tx, ctx.tenant.id, data, { currentSlug: page.slug })
  })
  if (blocked) return fail(blocked)
  return publishPageAction(slug, pageId, data)
}

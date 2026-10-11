// Prompt-driven site editing — the shared operations layer behind the Studio "Ask AI" panel and the Claude MCP
// connector (/api/mcp). Ops act on a spa's DRAFT only: page drafts (saveDraft), the draft theme (updateDraftTheme),
// new pages (addPage, draft until published) and pending renames (renamePage). Nothing here publishes.
// Block ops are validated by `applySiteEditOps` against the real block schema (built from the Puck config by the
// web app and passed in). Like every service: takes the caller's tx, no permission checks or audit rows inside —
// callers audit with `siteEditAuditData`.
import { fixHtmlDesign } from '@spa/core'
import { pageVersions, sites, type ThemeTokens, type Tx } from '@spa/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { DomainError } from './errors'
import {
  applySiteEditOps,
  type EditPageData,
  MAX_EDIT_OPS,
  type SiteEditOp,
  type SiteEditSchema,
  trimPageForPrompt,
} from './site-kit/edit-ops'
import { isNode } from './site-kit/tree'
import { assertPagesUnlocked, pageLockedMessage, pageLocksHeldByOthers } from './site-locks'
import {
  addPage,
  checkPageRename,
  editingTheme,
  getEditablePage,
  getSite,
  listPages,
  lockSite,
  PAGE_SLUG,
  type PageData,
  type PageSummary,
  renamePage,
  type SiteText,
  saveDraft,
  takenSlugs,
  updateDraftTheme,
} from './sites'

/** Same cap as the editor's draft save. */
export const SITE_EDIT_MAX_PAGE_BYTES = 512 * 1024
/** Same cap as an uploaded HTML design (it travels inside the page JSON). */
export const SITE_EDIT_MAX_HTML_BYTES = 500 * 1024
/** Block type of an uploaded HTML design (components/site/blocks/html-design.tsx). */
export const HTML_DESIGN_BLOCK = 'HtmlDesign'

const id = z.string().min(1).max(200)
const pageRef = z.string().max(200).describe('Page id, or its address slug ("home" or "" for the home page)')
const props = z.record(z.string(), z.unknown())
const place = {
  after: id.nullish(),
  before: id.nullish(),
  into: z.object({ id, slot: z.string().min(1).max(60) }).nullish(),
  index: z.number().int().min(0).max(500).nullish(),
}
const text = z.object({ en: z.string().trim().min(1).max(80), ar: z.string().trim().max(80).nullish() })

/** Shape of one operation; block/prop/option validity is checked against the block schema when applied. */
export const SiteOpSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('update'), page: pageRef, id, props }),
  z.object({
    op: z.literal('add'),
    page: pageRef,
    type: z.string().min(1).max(60),
    props: props.nullish(),
    ...place,
  }),
  z.object({ op: z.literal('preset'), page: pageRef, key: z.string().min(1).max(80), ...place }),
  z.object({ op: z.literal('move'), page: pageRef, id, ...place }),
  z.object({ op: z.literal('remove'), page: pageRef, id }),
  z.object({ op: z.literal('theme'), tokens: props }),
  z.object({
    op: z.literal('add_page'),
    slug: z.string().min(1).max(60),
    title: text,
    copy_from: pageRef.nullish(),
  }),
  z.object({
    op: z.literal('rename_page'),
    page: pageRef,
    title: text.nullish(),
    slug: z.string().max(60).nullish(),
  }),
  z.object({
    op: z.literal('html_design'),
    page: pageRef,
    html: z.string().min(1).max(SITE_EDIT_MAX_HTML_BYTES),
  }),
])
type NoNull<T> = { [K in keyof T]: Exclude<T[K], null> }
/** One operation after parsing (nulls the model may send for unused fields dropped). */
export type SiteOp = NoNull<z.infer<typeof SiteOpSchema>>

export type SiteEditDeps = {
  schema: SiteEditSchema
  /** Fills defaults / drops unknowns before the draft theme is stored (web: normalizeTheme). */
  normalizeTheme?: (theme: Record<string, unknown>) => ThemeTokens
  /** Extra policy before anything is written (web: the design-permission check). Return an error to refuse. */
  check?: (change: { before: EditPageData; after: EditPageData }[], themeChanged: boolean) => string | null
}

export type SiteEditPage = {
  id: string
  slug: string
  title: SiteText
  isNew: boolean
  data: EditPageData
}

export type SiteEditResult =
  | {
      ok: true
      dryRun: boolean
      summary: string[]
      /** Pages whose draft changed (or would change), with the resulting draft. */
      pages: SiteEditPage[]
      /** The resulting draft theme, or null when no theme op ran. */
      theme: ThemeTokens | null
      renamed: { id: string; title?: SiteText; slug?: string; pending: boolean }[]
      /** What was there before, for an exact undo (restoreSiteEdit). */
      previous: SiteEditPrevious
    }
  | { ok: false; errors: string[] }

/**
 * State before an edit. Pages: the data the edit started from, and the draft row the save ADDED (when the page had no
 * unnamed draft — e.g. it was live), so undo can drop it instead of leaving a draft behind. Theme (null = untouched):
 * the raw draft theme before (null = there was none) and the theme the editor showed.
 */
export type SiteEditPrevious = {
  pages: { id: string; data: EditPageData; addedVersionId: string | null }[]
  theme: { draft: ThemeTokens | null; shown: ThemeTokens } | null
}

type Working = {
  id: string
  slug: string
  title: SiteText
  isNew: boolean
  /** Newest version row when loaded (null for new pages / no versions). */
  beforeVersionId: string | null
  before: EditPageData
  data: EditPageData
  changed: boolean
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const asPageData = (data: unknown): EditPageData => {
  const d = data as Partial<EditPageData> | null
  return {
    root: isObj(d?.root) ? (d.root as EditPageData['root']) : { props: {} },
    content: Array.isArray(d?.content) ? d.content.filter(isNode) : [],
  }
}

const pageLabel = (w: { slug: string; title: SiteText }) =>
  w.slug === '' ? 'Home' : w.title.en || `/${w.slug}`
const isHtmlDesign = (data: EditPageData) =>
  data.root.props?.htmlDesign === true || data.content.some((n) => n.type === HTML_DESIGN_BLOCK)

/** One op that doesn't fit (collected into the batch's error list; never thrown out of runSiteEdit). */
class OpFail extends Error {}

/** Drops nulls the model / MCP client may send for unused fields. */
function clean(op: z.infer<typeof SiteOpSchema>): SiteOp {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(op)) if (v !== null && v !== undefined) out[k] = v
  return out as SiteOp
}

/**
 * Applies `ops` to the spa's draft site. All-or-nothing: any invalid op rejects the whole batch with readable errors.
 * `dryRun` returns the resulting drafts without writing. `base` overrides a page's starting data (the Studio editor's
 * unsaved canvas), so the preview and the saved result match what the designer saw.
 */
export async function runSiteEdit(
  tx: Tx,
  input: {
    tenantId: string
    userId?: string
    ops: unknown[]
    dryRun: boolean
    base?: Record<string, unknown>
  },
  deps: SiteEditDeps,
): Promise<SiteEditResult> {
  if (!Array.isArray(input.ops) || !input.ops.length) return { ok: false, errors: ['No changes proposed'] }
  if (input.ops.length > MAX_EDIT_OPS)
    return { ok: false, errors: [`At most ${MAX_EDIT_OPS} changes at once`] }
  const errors: string[] = []
  const ops: SiteOp[] = []
  input.ops.forEach((raw, i) => {
    const parsed = SiteOpSchema.safeParse(raw)
    if (parsed.success) ops.push(clean(parsed.data))
    else
      errors.push(
        `Change ${i + 1}: ${parsed.error.issues
          .slice(0, 2)
          .map((x) => `${x.path.join('.') || 'op'} ${x.message}`)
          .join('; ')}`,
      )
  })
  if (errors.length) return { ok: false, errors }

  // Read-modify-write of the drafts: serialised per spa, so parallel tool calls / editors never drop each other's work.
  if (!input.dryRun) await lockSite(tx, input.tenantId)
  const site = await getSite(tx, input.tenantId)
  if (!site)
    return {
      ok: false,
      errors: ['This spa has no website yet — choose a template in the console (Websites) first'],
    }
  const startTheme = editingTheme(site) as Record<string, unknown>
  let theme: Record<string, unknown> | null = null
  const summaries: PageSummary[] = await listPages(tx, input.tenantId)
  const working = new Map<string, Working>()
  /** Renames of existing pages, merged per page (validated like renamePage, so dry runs report the same errors). */
  const renames = new Map<string, { title?: SiteText; slug?: string }>()
  const summary: string[] = []
  /** Addresses in use besides `exceptId`'s: live + pending slugs, reserved routes, and this batch's new/renamed pages. */
  const slugsInUse = (exceptId?: string) => {
    const taken = takenSlugs(summaries, exceptId)
    for (const w of working.values()) if (w.isNew && w.id !== exceptId) taken.add(w.slug)
    for (const [id, r] of renames) if (id !== exceptId && r.slug !== undefined) taken.add(r.slug)
    return taken
  }

  const resolve = (ref: string): PageSummary | Working | null => {
    const slug = ref === 'home' || ref === '/' ? '' : ref.replace(/^\//, '')
    for (const w of working.values()) if (w.isNew && w.slug === slug) return w
    return summaries.find((p) => p.id === ref) ?? summaries.find((p) => p.slug === slug) ?? null
  }
  const load = async (ref: string, at: string): Promise<Working> => {
    const found = resolve(ref)
    if (!found) throw new OpFail(`${at}: no page "${ref}" on this site`)
    const cached = working.get(found.id)
    if (cached) return cached
    const editable = await getEditablePage(tx, input.tenantId, found.id)
    const start = asPageData(input.base?.[found.id] ?? editable?.data)
    const w: Working = {
      id: found.id,
      slug: found.slug,
      title: found.title,
      isNew: false,
      beforeVersionId: editable?.version?.id ?? null,
      before: structuredClone(start),
      data: start,
      changed: false,
    }
    working.set(found.id, w)
    return w
  }

  for (const [i, op] of ops.entries()) {
    const at = `Change ${i + 1}`
    try {
      switch (op.op) {
        case 'theme': {
          const r = applySiteEditOps(
            { data: { root: { props: {} }, content: [] }, theme: theme ?? startTheme, ops: [op] },
            deps.schema,
          )
          if (!r.ok) throw new OpFail(r.errors.map((e) => e.replace(/^Change 1/, at)).join(' · '))
          theme = r.theme
          summary.push(...r.summary)
          break
        }
        case 'add_page': {
          if (!PAGE_SLUG.test(op.slug) || !op.slug)
            throw new OpFail(`${at}: use lowercase letters, numbers and dashes`)
          if (resolve(op.slug) || slugsInUse().has(op.slug))
            throw new OpFail(`${at}: a page already uses /${op.slug}`)
          const from = op.copy_from !== undefined ? await load(op.copy_from, at) : null
          const data: EditPageData = from
            ? structuredClone(from.data)
            : {
                root: { props: { title: { en: op.title.en, ...(op.title.ar ? { ar: op.title.ar } : {}) } } },
                content: [],
              }
          const title = { en: op.title.en, ...(op.title.ar ? { ar: op.title.ar } : {}) }
          const key = `new:${op.slug}`
          working.set(key, {
            id: key,
            slug: op.slug,
            title,
            isNew: true,
            beforeVersionId: null,
            before: data,
            data,
            changed: true,
          })
          summary.push(`Added the page "${title.en}" (/${op.slug}) as a draft`)
          break
        }
        case 'rename_page': {
          const w = await load(op.page, at)
          if (!op.title && op.slug === undefined) throw new OpFail(`${at}: nothing to rename`)
          const title = op.title
            ? { en: op.title.en, ...(op.title.ar ? { ar: op.title.ar } : {}) }
            : undefined
          const live = summaries.find((p) => p.id === w.id)
          const prior = renames.get(w.id)
          const checked = checkPageRename(
            w.isNew || !live
              ? { slug: w.slug, pending: null }
              : { slug: live.slug, pending: { ...live.pending, ...prior } },
            { title, slug: op.slug },
            slugsInUse(w.id),
          )
          if (!checked.ok) throw new OpFail(`${at}: ${checked.error}`)
          if (w.isNew) {
            if (checked.next.title) w.title = checked.next.title
            if (checked.next.slug) w.slug = checked.next.slug
          } else renames.set(w.id, { ...prior, ...checked.next })
          summary.push(
            `Renamed ${pageLabel(w)}${op.title ? ` to "${op.title.en}"` : ''}${op.slug ? ` (/${op.slug})` : ''}`,
          )
          break
        }
        case 'html_design': {
          const w = await load(op.page, at)
          const block = w.data.content.find((n) => n.type === HTML_DESIGN_BLOCK)
          if (!block) throw new OpFail(`${at}: ${pageLabel(w)} is not an uploaded HTML design page`)
          if (!/<(?:!doctype|html|head|body|div|section|main)\b/i.test(op.html))
            throw new OpFail(`${at}: this does not look like an HTML page`)
          block.props.html = fixHtmlDesign(op.html).html
          w.changed = true
          summary.push(`Replaced the HTML design of ${pageLabel(w)}`)
          break
        }
        default: {
          // Block ops on one page: update / add / preset / move / remove.
          const { page, ...edit } = op
          const w = await load(page, at)
          if (isHtmlDesign(w.data) && edit.op !== 'update')
            throw new OpFail(`${at}: ${pageLabel(w)} is an HTML design — use html_design to change it`)
          const r = applySiteEditOps(
            { data: w.data, theme: theme ?? startTheme, ops: [edit as SiteEditOp] },
            deps.schema,
          )
          if (!r.ok) throw new OpFail(r.errors.map((e) => e.replace(/^Change 1/, at)).join(' · '))
          w.data = r.data
          w.changed = true
          summary.push(...r.summary.map((s) => `${pageLabel(w)}: ${s}`))
        }
      }
    } catch (e) {
      if (e instanceof OpFail) errors.push(e.message)
      else throw e
    }
  }
  if (errors.length) return { ok: false, errors }

  const changed = [...working.values()].filter((w) => w.changed)
  for (const w of changed)
    if (JSON.stringify(w.data).length > SITE_EDIT_MAX_PAGE_BYTES)
      return { ok: false, errors: [`${pageLabel(w)} would be too large to save`] }
  // F29: a page open in someone else's Studio editor is theirs until they close it (or it is taken over).
  const touched = [...new Set([...changed.filter((w) => !w.isNew).map((w) => w.id), ...renames.keys()])]
  const held = await pageLocksHeldByOthers(tx, input.tenantId, input.userId, touched)
  if (held.size)
    return {
      ok: false,
      errors: [...held].map(([id, lock]) => {
        const w = working.get(id)
        return `${w ? pageLabel(w) : 'This page'}: ${pageLockedMessage(lock.holderName)}`
      }),
    }
  const policy = deps.check?.(
    changed.map((w) => ({ before: w.before, after: w.data })),
    theme !== null,
  )
  if (policy) return { ok: false, errors: [policy] }

  const nextTheme = theme ? (deps.normalizeTheme ? deps.normalizeTheme(theme) : (theme as ThemeTokens)) : null
  const previous: SiteEditPrevious = {
    pages: changed.filter((w) => !w.isNew).map((w) => ({ id: w.id, data: w.before, addedVersionId: null })),
    theme: nextTheme ? { draft: site.themeDraft, shown: startTheme as ThemeTokens } : null,
  }
  const renamed = [...renames].map(([id, r]) => ({ id, ...r }))
  const view = (w: Working, idOverride?: string): SiteEditPage => ({
    id: idOverride ?? w.id,
    slug: w.slug,
    title: w.title,
    isNew: w.isNew,
    data: w.data,
  })
  if (input.dryRun)
    return {
      ok: true,
      dryRun: true,
      summary,
      pages: changed.map((w) => view(w)),
      theme: nextTheme,
      renamed: renamed.map((r) => ({
        ...r,
        pending: Boolean(summaries.find((p) => p.id === r.id)?.publishedAt),
      })),
      previous,
    }

  const pages: SiteEditPage[] = []
  for (const w of changed) {
    if (w.isNew) {
      const row = await addPage(tx, {
        tenantId: input.tenantId,
        slug: w.slug,
        title: w.title,
        data: w.data as unknown as PageData,
        userId: input.userId,
      })
      pages.push(view({ ...w, slug: row.slug }, row.id))
    } else {
      const written = await saveDraft(tx, {
        tenantId: input.tenantId,
        pageId: w.id,
        data: w.data as unknown as PageData,
        userId: input.userId,
      })
      const before = previous.pages.find((p) => p.id === w.id)
      if (before && written.id !== w.beforeVersionId) before.addedVersionId = written.id
      pages.push(view(w))
    }
  }
  const renameResults: { id: string; title?: SiteText; slug?: string; pending: boolean }[] = []
  for (const r of renamed) {
    const { pending } = await renamePage(tx, {
      tenantId: input.tenantId,
      pageId: r.id,
      title: r.title,
      slug: r.slug,
    })
    renameResults.push({ ...r, pending })
  }
  if (nextTheme) await updateDraftTheme(tx, input.tenantId, nextTheme)
  return { ok: true, dryRun: false, summary, pages, theme: nextTheme, renamed: renameResults, previous }
}

/**
 * Undo of an AI edit: puts back exactly what `previous` captured. A page whose edit added a draft row (it had none)
 * loses that row again while it is still the newest unnamed draft and the version under it holds the data being
 * restored; otherwise the data is saved as the draft. The draft theme is set back as it was — cleared when there was
 * none. Never publishes.
 */
export async function restoreSiteEdit(
  tx: Tx,
  input: {
    tenantId: string
    userId?: string
    pages: { id: string; data: unknown; addedVersionId?: string | null }[]
    theme: { draft: ThemeTokens | null } | null
  },
) {
  await lockSite(tx, input.tenantId)
  await assertPagesUnlocked(tx, {
    tenantId: input.tenantId,
    pageIds: input.pages.map((p) => p.id),
    userId: input.userId,
  })
  for (const p of input.pages) {
    if (JSON.stringify(p.data).length > SITE_EDIT_MAX_PAGE_BYTES)
      throw new DomainError('This page is too large to save.')
    const data = asPageData(p.data)
    if (p.addedVersionId && (await dropAddedDraft(tx, input.tenantId, p.id, p.addedVersionId, data))) continue
    await saveDraft(tx, {
      tenantId: input.tenantId,
      pageId: p.id,
      data: data as unknown as PageData,
      userId: input.userId,
    })
  }
  if (input.theme)
    await tx.update(sites).set({ themeDraft: input.theme.draft }).where(eq(sites.tenantId, input.tenantId))
}

/** Deletes the draft row an edit added when that restores `data` exactly (see restoreSiteEdit). */
async function dropAddedDraft(
  tx: Tx,
  tenantId: string,
  pageId: string,
  versionId: string,
  data: EditPageData,
) {
  const [newest, under] = await tx
    .select({ id: pageVersions.id, status: pageVersions.status, label: pageVersions.label })
    .from(pageVersions)
    .where(and(eq(pageVersions.tenantId, tenantId), eq(pageVersions.pageId, pageId)))
    .orderBy(desc(pageVersions.createdAt))
    .limit(2)
  if (!newest || !under || newest.id !== versionId || newest.status !== 'draft' || newest.label) return false
  const [same] = await tx
    .select({ ok: sql<boolean>`${pageVersions.data} = ${JSON.stringify(data)}::jsonb` })
    .from(pageVersions)
    .where(eq(pageVersions.id, under.id))
  if (!same?.ok) return false
  await tx
    .delete(pageVersions)
    .where(and(eq(pageVersions.tenantId, tenantId), eq(pageVersions.id, versionId)))
  return true
}

export type SiteEditView = {
  templateKey: string
  /** The theme the drafts are edited with (draft theme when one is pending). */
  theme: ThemeTokens
  themeIsDraft: boolean
  pages: {
    id: string
    slug: string
    title: SiteText
    visible: boolean
    published: boolean
    hasDraft: boolean
    pendingRename: { title?: SiteText; slug?: string } | null
    htmlDesign: boolean
    /** Open in a Studio editor (F29 lock): edits to this page are refused for anyone else until it frees. */
    editing: { by: string; userId: string; until: string } | null
    /** Draft content: block ids, types and props (long text clipped unless `full`). */
    data: unknown
  }[]
}

/** The spa's draft site for an editor (AI or MCP): pages with their draft blocks, and the editing theme. */
export async function getSiteForEdit(
  tx: Tx,
  tenantId: string,
  opts: { full?: boolean; page?: string } = {},
): Promise<SiteEditView | null> {
  const site = await getSite(tx, tenantId)
  if (!site) return null
  const all = await listPages(tx, tenantId)
  const slug = opts.page === 'home' || opts.page === '/' ? '' : opts.page?.replace(/^\//, '')
  const chosen = opts.page === undefined ? all : all.filter((p) => p.id === opts.page || p.slug === slug)
  const pages: SiteEditView['pages'] = []
  const locks = await pageLocksHeldByOthers(
    tx,
    tenantId,
    undefined,
    chosen.map((p) => p.id),
  )
  for (const p of chosen) {
    const lock = locks.get(p.id)
    const editable = await getEditablePage(tx, tenantId, p.id)
    const data = asPageData(editable?.data)
    pages.push({
      id: p.id,
      slug: p.slug,
      title: p.title,
      visible: p.visible,
      published: Boolean(p.publishedAt),
      hasDraft: p.hasDraft,
      pendingRename: p.pending ?? null,
      htmlDesign: isHtmlDesign(data),
      editing: lock
        ? { by: lock.holderName, userId: lock.userId, until: lock.expiresAt.toISOString() }
        : null,
      data: opts.full ? data : trimPageForPrompt(data),
    })
  }
  return {
    templateKey: site.templateKey,
    theme: editingTheme(site),
    themeIsDraft: site.themeDraft !== null,
    pages,
  }
}

/** The block catalogue in a client-friendly shape: block types with prop specs, section presets, theme tokens. */
export function blockCatalogue(schema: SiteEditSchema) {
  return {
    blocks: Object.entries(schema.blocks).map(([type, b]) => ({
      type,
      label: b.label ?? type,
      category: b.category ?? null,
      props: b.props,
    })),
    page_props: schema.root,
    presets: schema.presets.map((p) => ({
      key: p.key,
      name: p.name,
      category: p.category,
      description: p.description,
    })),
    theme_tokens: schema.theme,
  }
}

/** Audit payload for a site edit (callers write the row): who/what via which surface, and a short summary. */
export function siteEditAuditData(input: {
  via: 'studio_ai' | 'mcp'
  ops: { op?: unknown }[]
  summary: string[]
  dryRun?: boolean
  extra?: Record<string, unknown>
}) {
  return {
    via: input.via === 'mcp' ? 'via Claude (MCP)' : 'via Studio Ask AI',
    ops: input.ops.map((o) => String(o.op ?? '?')),
    summary: input.summary.slice(0, 20).map((s) => s.slice(0, 200)),
    ...(input.dryRun ? { dryRun: true } : {}),
    ...input.extra,
  }
}

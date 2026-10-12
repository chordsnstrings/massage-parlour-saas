// Prompt-driven site editing — the shared operations layer behind the Studio "Ask AI" panel and the Claude MCP
// connector (/api/mcp). Ops act on a spa's DRAFT only: page drafts (saveDraft), the draft theme (updateDraftTheme),
// new pages (addPage, draft until published) and pending renames (renamePage). Nothing here publishes.
// Block ops are validated by `applySiteEditOps` against the real block schema (built from the Puck config by the
// web app and passed in). Like every service: takes the caller's tx, no permission checks or audit rows inside —
// callers audit with `siteEditAuditData`.
import {
  dubaiParts,
  HTML_IMAGE_SRC_MAX,
  type HtmlContentValue,
  type HtmlDesignContent,
  htmlContentErrors,
  htmlContentFileIds,
  htmlContentFrom,
  htmlContentParts,
  htmlContentSlots,
  htmlCrmContractOf,
  htmlDesignDocOf,
  htmlDesignEmbedHosts,
  htmlDesignPhoneFixes,
  listHtmlDesignImages,
  listHtmlDesignTexts,
  MAX_HTML_UPLOAD_BYTES,
  patchHtml,
} from '@spa/core'
import { type Db, pageVersions, platformDb, sites, storedFiles, type ThemeTokens, type Tx } from '@spa/db'
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { z } from 'zod'
import { DomainError } from './errors'
import { htmlDesignDocFor, htmlDesignSource, spaHtmlDocReader, storeSpaHtmlDoc } from './site-html-assets'
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
  labelVersion,
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
/** Largest HTML design (UTF-8 bytes) an op may write: the upload limit (stored byte for byte as a file). */
export const SITE_EDIT_MAX_HTML_BYTES = MAX_HTML_UPLOAD_BYTES
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
// No en (null / left out): Arabic only — the stored English stays, else the design's; '' = the design's English.
const contentText = z.object({ en: z.string().max(2000).nullish(), ar: z.string().max(2000).nullish() })
// A page text may carry Arabic only (no en: the spa's English override stays, else the design's English).
const pageText = z.object({ en: z.string().max(2000).nullish(), ar: z.string().max(2000).nullish() })
const contentTags = z.array(z.string().max(200)).max(20)
/** R28: one website-content value of an HTML design (@spa/core html-content.ts). */
export const HtmlContentValueSchema = z.union([
  z.object({ t: contentText }),
  z.object({ tags: z.object({ en: contentTags, ar: contentTags.nullish() }) }),
  z.object({ img: z.string().max(2000) }),
  z.object({ video: z.string().max(2000) }),
  z.object({ on: z.boolean() }),
  z.object({ hide: z.literal(true) }),
])

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
  // R24: the whole document (≤ 5 MB as UTF-8), stored byte for byte as one of the spa's own files and rendered exactly
  // as written unless phone_fixes (default false). convert: a block page becomes an HTML design page.
  z.object({
    op: z.literal('html_design'),
    page: pageRef,
    html: z.string().min(1).max(MAX_HTML_UPLOAD_BYTES),
    phone_fixes: z.boolean().nullish(),
    convert: z.boolean().nullish(),
  }),
  // R28: the page's website content, never the file — values over the design's own data (its window.CRM_DATA) by
  // slot path, page texts and pictures by id (P4; get_html_content lists them; the server fills their src guards).
  z.object({
    op: z.literal('html_content'),
    page: pageRef,
    set: z.record(z.string().max(400), HtmlContentValueSchema).nullish(),
    // values paths, 'text:<id>', 'picture:<id>'; 'all' = every value, page text and picture
    reset: z.union([z.literal('all'), z.array(z.string().max(400)).max(500)]).nullish(),
    texts: z
      .array(z.object({ id: z.string().max(40), t: pageText }))
      .max(2000)
      .nullish(),
    pictures: z
      .array(z.object({ id: z.string().max(12), img: z.string().max(2000) }))
      .max(200)
      .nullish(),
  }),
  // R24: exact find/replace edits of the stored design (each `find` must occur exactly once), applied in order.
  z.object({
    op: z.literal('html_patch'),
    page: pageRef,
    edits: z
      .array(z.object({ find: z.string().min(1).max(100_000), replace: z.string().max(1024 * 1024) }))
      .min(1)
      .max(50),
    phone_fixes: z.boolean().nullish(),
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
      /**
       * R24: HTML-design pages changed by html_design / html_patch (size, patch positions, and the hosts of embedded
       * frames / players that run inside the design's sandbox on spa sites — @spa/core htmlDesignEmbedHosts).
       */
      html: {
        page: string
        chars: number
        bytes: number
        phoneFixes: boolean
        embeds: string[]
        /** R26: the design's CRM data contract (`window.CRM_DATA` literal / crm-endpoint meta), or null. */
        crm: 'literal' | 'endpoint' | null
        at?: number[]
      }[]
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
  /** R24: the design as it will be stored — its file is written only when the batch is (never on a dry run). */
  pendingHtml?: { raw: string; at?: number[] }
  /** R24 convert: the working draft before (unnamed) gets a label so it stays in version history. */
  labelBefore?: boolean
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
const looksLikeHtml = (html: string) => /<(?:!doctype|html|head|body|div|section|main)\b/i.test(html)
const dubaiStamp = (now = new Date()) => {
  const p = dubaiParts(now)
  return `${p.date} ${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`
}

/**
 * A content value as stored: nulls the client sent for unused fields dropped. A text without en keeps the stored
 * English (`prev`), else the design's (`design`): Arabic only. en '' = the design's English; with no Arabic either,
 * 'reset' (back to the design's own value). null = a text with neither.
 */
function contentValue(
  v: z.infer<typeof HtmlContentValueSchema>,
  prev: HtmlContentValue | undefined,
  design: unknown,
): HtmlContentValue | 'reset' | null {
  if ('t' in v) {
    const ar = v.t.ar?.trim() ? v.t.ar : null
    const own = typeof design === 'string' ? design : ''
    if (v.t.en == null)
      return ar
        ? { t: { en: prev && 't' in prev && typeof prev.t.en === 'string' ? prev.t.en : own, ar } }
        : null
    if (v.t.en === '' && !ar) return 'reset'
    const en = v.t.en || own
    return { t: v.t.ar == null ? { en } : { en, ar: v.t.ar } }
  }
  if ('tags' in v) return { tags: v.tags.ar == null ? { en: v.tags.en } : { en: v.tags.en, ar: v.tags.ar } }
  return v
}

/** One op that doesn't fit (collected into the batch's error list; never thrown out of runSiteEdit). */
class OpFail extends Error {}

/**
 * Ask AI and the connector see long design texts cut short (core `htmlContentView`: the first n characters + '…'): an
 * English value copied from there would cut the English page short. At least 100 characters before the '…' (the
 * views cut at 160 / 400), so a short teaser written on purpose still passes. Compared with HTML whitespace collapsed
 * (as the page-text listing does; U+00A0 kept).
 */
const collapse = (s: string) => s.replace(/[ \t\n\f\r]+/g, ' ').trim()
const clippedCopy = (en: string | null | undefined, full: unknown) => {
  if (typeof full !== 'string') return false
  const s = collapse(en ?? '')
  const f = collapse(full)
  // The whole design text echoed back (one that itself ends with "…") is no cut copy.
  if (!s.endsWith('…') || s === f) return false
  const head = s.slice(0, -1).trimEnd()
  return head.length >= 100 && head.length < f.length && f.startsWith(head)
}
const CUT_SHORT = `the English is the design's text cut short (it ends with "…")`
/**
 * Ask AI saw only the first `clip` characters of a cut design text: an English built from that fragment (echoed, or
 * edited in place) would shorten the page. A whole new text shares neither the first 40 characters nor most of the
 * fragment's words.
 */
const fromFragment = (en: string, full: string, clip: number) => {
  const s = collapse(en).replace(/…$/, '').trimEnd()
  const f = collapse(full)
  if (!s || s === f) return false
  let k = 0
  while (k < s.length && k < f.length && s[k] === f[k]) k++
  if (k >= 40 || f.startsWith(s)) return true
  const words = (x: string) => new Set(x.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])
  const mine = words(s)
  const seen = words(f.slice(0, clip))
  if (mine.size < 5) return false
  let shared = 0
  for (const w of mine) if (seen.has(w)) shared++
  return shared / mine.size >= 0.6
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Of these `/files` ids, the ones that are not this spa's public files. */
async function missingContentFiles(tx: Tx, tenantId: string, ids: string[]): Promise<string[]> {
  const valid = ids.filter((x) => UUID.test(x))
  const own = valid.length
    ? await tx
        .select({ id: storedFiles.id })
        .from(storedFiles)
        .where(
          and(
            eq(storedFiles.tenantId, tenantId),
            eq(storedFiles.isPublic, true),
            inArray(storedFiles.id, valid),
          ),
        )
    : []
  const mine = new Set(own.map((r) => r.id))
  return ids.filter((x) => !mine.has(x))
}

/**
 * Of these `/files` ids, the ones a draft save refuses: not a file id, this spa's private files and other spas' files
 * (platform-role read: the tenant transaction can't see them). This spa's files that no longer exist pass (deleted from
 * the media library since; the site just misses that picture, as a block page would).
 */
async function foreignContentFiles(
  tx: Tx,
  tenantId: string,
  ids: string[],
  platform?: Db,
): Promise<string[]> {
  const valid = ids.filter((x) => UUID.test(x))
  const own = valid.length
    ? await tx
        .select({ id: storedFiles.id, isPublic: storedFiles.isPublic })
        .from(storedFiles)
        .where(and(eq(storedFiles.tenantId, tenantId), inArray(storedFiles.id, valid)))
    : []
  const mine = new Map(own.map((r) => [r.id, r.isPublic]))
  const unknown = valid.filter((x) => !mine.has(x))
  const others = unknown.length
    ? await (platform ?? platformDb())
        .select({ id: storedFiles.id })
        .from(storedFiles)
        .where(and(inArray(storedFiles.id, unknown), ne(storedFiles.tenantId, tenantId)))
    : []
  const theirs = new Set(others.map((r) => r.id))
  return ids.filter((x) => !UUID.test(x) || mine.get(x) === false || theirs.has(x))
}

/**
 * Every HtmlDesign block's content on a draft save: shape (no slot check — stale entries are fine, the render skips
 * them) and its /files (`foreignContentFiles`; the html_content op is stricter: only this spa's public files).
 */
export async function htmlDesignContentErrors(
  tx: Tx,
  tenantId: string,
  data: unknown,
  opts: { platform?: Db } = {},
): Promise<string[]> {
  const content = isObj(data) && Array.isArray(data.content) ? data.content : []
  const errors: string[] = []
  for (const n of content) {
    if (!isObj(n) || n.type !== HTML_DESIGN_BLOCK || !isObj(n.props) || n.props.content === undefined)
      continue
    const problems = htmlContentErrors(n.props.content, null)
    if (problems.length) {
      errors.push(...problems)
      continue
    }
    const foreign = await foreignContentFiles(
      tx,
      tenantId,
      htmlContentFileIds(n.props.content),
      opts.platform,
    )
    errors.push(...foreign.map((x) => `/files/${x} is not one of this spa's pictures`))
  }
  return errors
}

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
    /**
     * Studio Ask AI (R28 P4): its content view cut design texts longer than `clip` characters (core `htmlContentView`
     * `cut`). html_content entries for those that carry no new English (an Arabic translation of a fragment) and entries that don't fit (unknown or
     * bound ids, a cut-short copy, a bad value or file) are dropped with a note in `summary`, not the whole op.
     */
    htmlContent?: { clip: number }
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

  const readDoc = spaHtmlDocReader(tx, input.tenantId)
  /** The design's reference as it will be stored (no file yet), or the size problem as this op's error. */
  const draftDoc = (html: string, at: string) => {
    const bytes = Buffer.byteLength(html, 'utf8')
    if (bytes > SITE_EDIT_MAX_HTML_BYTES)
      throw new OpFail(
        `${at}: the design is ${(bytes / (1024 * 1024)).toFixed(1)} MB; the limit is ${SITE_EDIT_MAX_HTML_BYTES / (1024 * 1024)} MB (UTF-8)`,
      )
    return htmlDesignDocFor(html)
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
          if (!looksLikeHtml(op.html)) throw new OpFail(`${at}: this does not look like an HTML page`)
          const phoneFixes = op.phone_fixes ?? false
          let block = w.data.content.find((n) => n.type === HTML_DESIGN_BLOCK)
          if (!block) {
            const blocks = w.data.content.length
            if (blocks && !op.convert)
              throw new OpFail(
                `${at}: ${pageLabel(w)} is not an uploaded HTML design page — it has ${blocks} block${blocks === 1 ? '' : 's'}; pass convert: true to replace them with the HTML design (the current draft is kept in version history)`,
              )
            const keep = w.data.root.props ?? {}
            block = {
              type: HTML_DESIGN_BLOCK,
              props: { id: `${w.slug || 'home'}-html-design`, html: '', images: [], phoneFixes },
            }
            w.data = {
              root: {
                props: {
                  ...('title' in keep ? { title: keep.title } : {}),
                  ...('description' in keep ? { description: keep.description } : {}),
                  htmlDesign: true,
                },
              },
              content: [block],
            }
            w.labelBefore = !w.isNew
          }
          block.props.html = ''
          block.props.doc = draftDoc(op.html, at)
          block.props.phoneFixes = phoneFixes
          w.pendingHtml = { raw: op.html }
          w.changed = true
          summary.push(
            `${w.labelBefore ? 'Turned' : 'Replaced the HTML design of'} ${pageLabel(w)}${w.labelBefore ? ' into an HTML design page' : ''} (stored exactly as sent)`,
          )
          break
        }
        case 'html_patch': {
          const w = await load(op.page, at)
          const block = w.data.content.find((n) => n.type === HTML_DESIGN_BLOCK)
          if (!block || (typeof block.props.html !== 'string' && !htmlDesignDocOf(block.props)))
            throw new OpFail(`${at}: ${pageLabel(w)} is not an uploaded HTML design page`)
          const source = w.pendingHtml?.raw ?? (await htmlDesignSource(block.props, readDoc))
          if (source === null)
            throw new OpFail(
              `${at}: the design file of ${pageLabel(w)} is missing — send the whole design again`,
            )
          const patched = patchHtml(source, op.edits)
          if (!patched.ok) throw new OpFail(`${at}: ${patched.error}`)
          if (!looksLikeHtml(patched.html))
            throw new OpFail(`${at}: the result does not look like an HTML page`)
          block.props.html = ''
          block.props.doc = draftDoc(patched.html, at)
          if (op.phone_fixes !== undefined) block.props.phoneFixes = op.phone_fixes
          w.pendingHtml = { raw: patched.html, at: patched.at }
          w.changed = true
          summary.push(
            `Edited the HTML design of ${pageLabel(w)} (${op.edits.length} edit${op.edits.length === 1 ? '' : 's'})`,
          )
          break
        }
        case 'html_content': {
          const w = await load(op.page, at)
          const block = w.data.content.find((n) => n.type === HTML_DESIGN_BLOCK)
          if (!block || (typeof block.props.html !== 'string' && !htmlDesignDocOf(block.props)))
            throw new OpFail(`${at}: ${pageLabel(w)} is not an uploaded HTML design page`)
          const source = w.pendingHtml?.raw ?? (await htmlDesignSource(block.props, readDoc))
          if (source === null)
            throw new OpFail(
              `${at}: the design file of ${pageLabel(w)} is missing — send the whole design again`,
            )
          const literal = htmlCrmContractOf(source)?.literal
          const setCount = Object.keys(op.set ?? {}).length
          const resets = op.reset === 'all' ? null : (op.reset ?? [])
          if (
            !literal &&
            !setCount &&
            !op.texts?.length &&
            !op.pictures?.length &&
            !(resets === null || resets.length)
          )
            throw new OpFail(
              `${at}: the design of ${pageLabel(w)} has no window.CRM_DATA, so its words and pictures live in the file — use html_patch`,
            )
          if (!literal && setCount)
            throw new OpFail(
              `${at}: the design of ${pageLabel(w)} has no window.CRM_DATA: change its page texts and pictures with texts / pictures, or the file with html_patch`,
            )
          const parts = htmlContentParts(block.props.content)
          let reset = resets?.length ?? 0
          if (resets === null) {
            reset = Object.values(parts).reduce((sum, p) => sum + Object.keys(p).length, 0)
            parts.values = {}
            parts.texts = {}
            parts.pictures = {}
          } else
            for (const k of resets) {
              if (k.startsWith('text:')) delete parts.texts[k.slice(5)]
              else if (k.startsWith('picture:')) delete parts.pictures[k.slice(8)]
              else delete parts.values[k]
            }
          const slots = literal ? htmlContentSlots(literal.data) : []
          // Ask AI: an entry that doesn't fit is dropped with a note (`skipped`); elsewhere it fails the op.
          const lenient = input.htmlContent
          const skipped: string[] = []
          const refuse = (msg: string) => {
            if (!lenient) throw new OpFail(`${at}: ${msg}`)
            skipped.push(msg)
          }
          // Ask AI: the op's /files that are not this spa's public files (one read).
          const gone = lenient
            ? new Set(
                await missingContentFiles(
                  tx,
                  input.tenantId,
                  htmlContentFileIds({
                    v: 1,
                    values: Object.entries(op.set ?? {}).map(([path, value]) => ({ path, value })),
                    pictures: (op.pictures ?? []).map((p) => ({ id: p.id, src: '', img: p.img })),
                  }),
                ),
              )
            : null
          /** Ask AI: one entry's own problem (checked alone; the whole content is checked below) or foreign file. */
          const entryProblem = (c: HtmlDesignContent) => {
            if (!gone) return null
            const own = htmlContentErrors(c, c.values ? slots : null)[0]
            if (own) return own
            const file = htmlContentFileIds(c).find((x) => gone.has(x))
            return file ? `/files/${file} is not one of this spa's pictures` : null
          }
          const cut = (full: unknown) =>
            lenient && typeof full === 'string' && !full.startsWith('data:') && full.length > lenient.clip
          const CUT_VIEW = `the AI saw only the first ${lenient?.clip} characters of the design's text — change it in Website content`
          let n = 0
          if (setCount) {
            const design = new Map(slots.map((x) => [x.path, x.value]))
            for (const [k, v] of Object.entries(op.set ?? {})) {
              // A cut text: a whole new English (with its Arabic) is fine; Arabic alone would translate a fragment.
              if (
                't' in v &&
                cut(design.get(k)) &&
                (!v.t.en?.trim() || fromFragment(v.t.en, String(design.get(k)), lenient!.clip))
              ) {
                refuse(`${k}: ${CUT_VIEW}`)
                continue
              }
              if ('t' in v && clippedCopy(v.t.en, design.get(k))) {
                refuse(`${k}: ${CUT_SHORT} — to add Arabic send only ar, or send the whole English text`)
                continue
              }
              const value = contentValue(v, parts.values[k], design.get(k))
              if (!value) {
                refuse(`${k}: send en or ar`)
                continue
              }
              if (value === 'reset') {
                delete parts.values[k]
                reset++
                continue
              }
              const problem = entryProblem({ v: 1, values: [{ path: k, value }] })
              if (problem) {
                refuse(problem)
                continue
              }
              parts.values[k] = value
              n++
            }
          }
          let texts = 0
          if (op.texts?.length) {
            const listed = new Map(listHtmlDesignTexts(source).map((x) => [x.id, x]))
            for (const e of op.texts) {
              const x = listed.get(e.id)
              if (!x) {
                refuse(`no page text "${e.id}" in this design — get_html_content lists them`)
                continue
              }
              if (x.bound) {
                refuse(
                  x.boundBy === 'script'
                    ? `${e.id} is filled by the design's script — change it in the design file (patch_html_design)`
                    : `${e.id} is filled from the CRM — change it in the CRM`,
                )
                continue
              }
              if (cut(x.text) && (!e.t.en?.trim() || fromFragment(e.t.en, x.text, lenient!.clip))) {
                refuse(`${e.id}: ${CUT_VIEW}`)
                continue
              }
              if (clippedCopy(e.t.en, x.text)) {
                refuse(
                  `${e.id}: ${CUT_SHORT} — to add Arabic send only ar (the design's English stays), or send the whole English text`,
                )
                continue
              }
              // No en (null / left out): the current English override stays; '' = the design's English.
              const prev = parts.texts[e.id]?.src === x.src ? parts.texts[e.id]?.t.en : undefined
              const en = e.t.en ?? prev
              const entry = {
                id: e.id,
                src: x.src,
                t: { ...(en?.trim() ? { en } : {}), ...(e.t.ar?.trim() ? { ar: e.t.ar } : {}) },
              }
              const problem = entryProblem({ v: 1, texts: [entry] })
              if (problem) {
                refuse(problem)
                continue
              }
              parts.texts[e.id] = entry
              texts++
            }
          }
          let pictures = 0
          if (op.pictures?.length) {
            const listed = new Map(listHtmlDesignImages(source).map((x) => [x.id, x]))
            for (const p of op.pictures) {
              const x = listed.get(p.id)
              if (!x) {
                refuse(`no picture "${p.id}" in this design — get_html_content lists them`)
                continue
              }
              const entry = { id: p.id, src: x.src.slice(0, HTML_IMAGE_SRC_MAX), img: p.img }
              const problem = entryProblem({ v: 1, pictures: [entry] })
              if (problem) {
                refuse(problem)
                continue
              }
              parts.pictures[p.id] = entry
              pictures++
            }
          }
          const notes = skipped.slice(0, 5).map((s) => `${pageLabel(w)}: not changed — ${s}`.slice(0, 280))
          if (skipped.length > 5) notes.push(`${pageLabel(w)}: ${skipped.length - 5} more not changed`)
          if (skipped.length && !n && !texts && !pictures && !reset) {
            // Ask AI: every entry dropped — nothing to write, only the notes.
            summary.push(...notes)
            break
          }
          const next = htmlContentFrom(parts)
          const problems = htmlContentErrors(next ?? { v: 1 }, slots)
          if (problems.length) throw new OpFail(`${at}: ${problems.slice(0, 6).join(' · ')}`)
          const missing = await missingContentFiles(tx, input.tenantId, htmlContentFileIds(next))
          if (missing.length)
            throw new OpFail(
              `${at}: /files/${missing[0]} is not one of this spa's pictures — add it with add_image first`,
            )
          if (next) block.props.content = next
          else delete block.props.content
          w.changed = true
          const pageParts = texts || pictures || resets?.some((k) => /^(?:text|picture):/.test(k))
          const plural = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`
          summary.push(
            pageParts
              ? `Website content of ${pageLabel(w)}: ${[
                  n ? `${plural(n, 'value')} set` : '',
                  texts ? plural(texts, 'page text') : '',
                  pictures ? plural(pictures, 'picture') : '',
                  reset ? `${reset} back to the design's` : '',
                ]
                  .filter(Boolean)
                  .join(', ')} (the design file is unchanged)`
              : `Website content of ${pageLabel(w)}: ${plural(n, 'value')} set${reset ? `, ${reset} back to the design's` : ''} (the design file is unchanged)`,
            ...notes,
          )
          break
        }
        default: {
          // Block ops on one page: update / add / preset / move / remove.
          const { page, ...edit } = op
          const w = await load(page, at)
          if (isHtmlDesign(w.data) && edit.op !== 'update')
            throw new OpFail(
              `${at}: ${pageLabel(w)} is an HTML design — use html_design or html_patch to change it`,
            )
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
  const htmlInfo = () =>
    changed.flatMap((w) => {
      if (!w.pendingHtml) return []
      const block = w.data.content.find((n) => n.type === HTML_DESIGN_BLOCK)
      return [
        {
          page: w.slug,
          chars: w.pendingHtml.raw.length,
          bytes: Buffer.byteLength(w.pendingHtml.raw, 'utf8'),
          phoneFixes: htmlDesignPhoneFixes(block?.props),
          embeds: htmlDesignEmbedHosts(w.pendingHtml.raw),
          crm: htmlCrmContractOf(w.pendingHtml.raw)?.mode ?? null,
          ...(w.pendingHtml.at ? { at: w.pendingHtml.at } : {}),
        },
      ]
    })
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
      html: htmlInfo(),
    }

  // R24: now the batch is accepted, store each design for real (the spa's own private file, byte for byte).
  for (const w of changed) {
    if (!w.pendingHtml) continue
    const block = w.data.content.find((n) => n.type === HTML_DESIGN_BLOCK)
    if (!block) continue
    try {
      block.props.doc = await storeSpaHtmlDoc(tx, {
        tenantId: input.tenantId,
        html: w.pendingHtml.raw,
        userId: input.userId,
      })
    } catch (e) {
      if (e instanceof DomainError) return { ok: false, errors: [`${pageLabel(w)}: ${e.message}`] }
      throw e
    }
  }
  const pages: SiteEditPage[] = []
  for (const w of changed) {
    if (w.labelBefore && w.beforeVersionId) {
      const [v] = await tx
        .select({ status: pageVersions.status, label: pageVersions.label })
        .from(pageVersions)
        .where(and(eq(pageVersions.tenantId, input.tenantId), eq(pageVersions.id, w.beforeVersionId)))
      if (v?.status === 'draft' && !v.label)
        await labelVersion(
          tx,
          input.tenantId,
          w.beforeVersionId,
          `Before AI assistant HTML design ${dubaiStamp()}`,
        )
    }
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
  return {
    ok: true,
    dryRun: false,
    summary,
    pages,
    theme: nextTheme,
    renamed: renameResults,
    previous,
    html: htmlInfo(),
  }
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
    /** R24: an HTML design page's stored size and "Phone fixes" switch (resolved), else null. */
    html: { chars: number; phoneFixes: boolean } | null
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
    const htmlBlock = data.content.find((n) => n.type === HTML_DESIGN_BLOCK)
    pages.push({
      id: p.id,
      slug: p.slug,
      title: p.title,
      visible: p.visible,
      published: Boolean(p.publishedAt),
      hasDraft: p.hasDraft,
      pendingRename: p.pending ?? null,
      htmlDesign: isHtmlDesign(data),
      html: htmlBlock
        ? (() => {
            const doc = htmlDesignDocOf(htmlBlock.props)
            const chars =
              doc?.chars ?? (typeof htmlBlock.props.html === 'string' ? htmlBlock.props.html.length : null)
            return chars === null ? null : { chars, phoneFixes: htmlDesignPhoneFixes(htmlBlock.props) }
          })()
        : null,
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

export type HtmlDesignView = {
  page: { id: string; slug: string; title: SiteText }
  /** The stored design, exactly as uploaded / sent. */
  html: string
  /** Its "Phone fixes" switch (resolved: absent = on, see @spa/core htmlDesignPhoneFixes). */
  phoneFixes: boolean
  /** Image adjustments saved with it. */
  images: number
  /** R26: CRM data contract (operational values come live from the CRM; don't edit them in the design), or null. */
  crm: 'literal' | 'endpoint' | null
  /** R28: the page's website content (values, page texts, pictures), or null. */
  content: HtmlDesignContent | null
  editing: { by: string; userId: string; until: string } | null
}

/** R24: the draft HTML design of one page (for reading / patching it), or null without such a page. */
export async function getHtmlDesign(
  tx: Tx,
  tenantId: string,
  pageRef: string,
  userId?: string,
): Promise<HtmlDesignView | null> {
  const all = await listPages(tx, tenantId)
  const slug = pageRef === 'home' || pageRef === '/' ? '' : pageRef.replace(/^\//, '')
  const p = all.find((x) => x.id === pageRef) ?? all.find((x) => x.slug === slug)
  if (!p) return null
  const data = asPageData((await getEditablePage(tx, tenantId, p.id))?.data)
  const block = data.content.find((n) => n.type === HTML_DESIGN_BLOCK)
  if (!block || (typeof block.props.html !== 'string' && !htmlDesignDocOf(block.props)))
    throw new DomainError(`${pageLabel(p)} is not an HTML design page`, 'invalid', {
      key: 'errors.domain.notHtmlDesignPage',
      params: { page: pageLabel(p) },
    })
  const html = await htmlDesignSource(block.props, spaHtmlDocReader(tx, tenantId))
  if (html === null) throw new DomainError(`The design file of ${pageLabel(p)} is missing`)
  const lock = (await pageLocksHeldByOthers(tx, tenantId, userId, [p.id])).get(p.id)
  return {
    page: { id: p.id, slug: p.slug, title: p.title },
    html,
    phoneFixes: htmlDesignPhoneFixes(block.props),
    images: Array.isArray(block.props.images) ? block.props.images.length : 0,
    crm: htmlCrmContractOf(html)?.mode ?? null,
    content: isObj(block.props.content) ? (block.props.content as HtmlDesignContent) : null,
    editing: lock ? { by: lock.holderName, userId: lock.userId, until: lock.expiresAt.toISOString() } : null,
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
    via: input.via === 'mcp' ? 'via AI assistant (MCP)' : 'via Studio Ask AI',
    ops: input.ops.map((o) => String(o.op ?? '?')),
    summary: input.summary.slice(0, 20).map((s) => s.slice(0, 200)),
    ...(input.dryRun ? { dryRun: true } : {}),
    ...input.extra,
  }
}

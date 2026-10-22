// R24: uploaded HTML designs are stored BYTE FOR BYTE as files (R24 review: the owner's rule "it should apply as it
// is without missing anything" — nothing in a design is rewritten, moved out or size-capped below the 5 MB upload
// limit). Where the document lives:
//  - a template's design: `site_template_files` (platform level, content-addressed, text/html);
//  - a spa's design (template applied, connector edits): one of its own PRIVATE stored files (purpose
//    `html_design_doc`, deduplicated by content; never served by /files to visitors — the platform renders it).
// The HtmlDesign block holds the reference (`props.doc`, @spa/core HtmlDesignDoc) with `props.html` = ''; renderers
// fill the html right before rendering (`resolveHtmlDesignDocs`), writers never store it inline again. Designs stored
// before keep their inline html (read as is). Applying a template copies its document into the spa, and any /files URL
// it, an image replacement or its website content uses that belongs to a template or another spa
// (`localiseHtmlDesignAssets`): a spa's site never depends on a template row or on another spa. Like every service:
// takes the caller's tx; no permission checks.
import { createHash } from 'node:crypto'
import {
  businessDateOf,
  businessDayWindow,
  type HtmlContentValue,
  type HtmlDesignDoc,
  type HtmlImageAdjust,
  htmlContentFrom,
  htmlContentParts,
  htmlDesignAssetRefs,
  htmlDesignBakedFixes,
  htmlDesignDocOf,
  isHtmlDesignDocFile,
  MAX_HTML_UPLOAD_BYTES,
  remapHtmlImageAdjustments,
  rewriteHtmlDesignAssets,
} from '@spa/core'
import { type Db, pageVersions, platformDb, savedSections, sites, storedFiles, type Tx } from '@spa/db'
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { FONT_TYPES, fileIdFromUrl, VIDEO_TYPES } from './media'
import { lockSite } from './sites'
import {
  deleteFile,
  getFile,
  getTemplateFile,
  IMAGE_TYPES,
  MAX_FILE_BYTES,
  putFile,
  putTemplateFile,
} from './storage'

/** stored_files.purpose of a spa's design documents (private: the platform renders them, /files never serves them). */
export const HTML_DESIGN_DOC_PURPOSE = 'html_design_doc'
/** stored_files.purpose of images / fonts / videos copied into a spa for its design (public, like media). */
export const HTML_DESIGN_FILE_PURPOSE = 'html_design'
/** Content type of stored design documents (always UTF-8: uploads are decoded with the file's own encoding first). */
export const HTML_DESIGN_DOC_TYPE = 'text/html; charset=utf-8'
/**
 * Per spa and Dubai business day (05:00 cutoff): bytes of NEW design documents (deduplicated ones are free). Every
 * changed design is a new file, so a looping assistant (`patch_html_design`) could otherwise fill the disk.
 */
export const HTML_DESIGN_DOC_BYTES_PER_DAY = 200 * 1024 * 1024
/**
 * Unreferenced design documents are kept this long (the Studio editor's local copy and an Ask AI undo live in the
 * browser and may still point at one), then `pruneUnusedHtmlDesignDocs` deletes them.
 */
export const HTML_DESIGN_DOC_KEEP_MS = 7 * 86_400_000
/** Block type of an uploaded HTML design (web: components/site/blocks/html-design.tsx). */
const HTML_DESIGN = 'HtmlDesign'

/** Absolute public URL of a stored / template file (web: canonicalUrls().api(`/files/${id}/${name}`)). */
export type FileUrl = (id: string, name: string) => string

const EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'font/woff2': 'woff2',
  'font/woff': 'woff',
  'font/ttf': 'ttf',
  'font/otf': 'otf',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}
const MOVABLE = new Set<string>([...IMAGE_TYPES, ...FONT_TYPES, ...VIDEO_TYPES])

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')

/* ------------------------------------------------------------------ Design documents */

/** The reference a design gets once stored (`file` = '' for a dry run: nothing stored yet). */
export function htmlDesignDocFor(html: string, file = ''): HtmlDesignDoc {
  const bytes = Buffer.from(html, 'utf8')
  return { file, sha256: sha256(bytes), bytes: bytes.length, chars: html.length }
}

const docBytes = (html: string) => {
  const bytes = Buffer.from(html, 'utf8')
  if (!bytes.length) throw new DomainError('The HTML design is empty')
  if (bytes.length > MAX_FILE_BYTES)
    throw new DomainError(
      `The design is ${(bytes.length / (1024 * 1024)).toFixed(1)} MB as UTF-8 text; the limit is ${MAX_FILE_BYTES / (1024 * 1024)} MB.`,
    )
  return bytes
}

/**
 * Stores a spa's design document (its own private file, deduplicated by content) and returns the reference. A new
 * file counts against the spa's daily budget (`HTML_DESIGN_DOC_BYTES_PER_DAY`; `dailyLimit` overrides it in tests).
 */
export async function storeSpaHtmlDoc(
  tx: Tx,
  input: { tenantId: string; html: string; userId?: string | null; dailyLimit?: number; now?: Date },
): Promise<HtmlDesignDoc> {
  const bytes = docBytes(input.html)
  const doc = htmlDesignDocFor(input.html)
  const filename = `${doc.sha256}.html`
  const [found] = await tx
    .select({ id: storedFiles.id })
    .from(storedFiles)
    .where(
      and(
        eq(storedFiles.tenantId, input.tenantId),
        eq(storedFiles.purpose, HTML_DESIGN_DOC_PURPOSE),
        eq(storedFiles.filename, filename),
      ),
    )
    .limit(1)
  if (found) return { ...doc, file: found.id }
  const limit = input.dailyLimit ?? HTML_DESIGN_DOC_BYTES_PER_DAY
  const day = businessDayWindow(businessDateOf(input.now ?? new Date()))
  const [today] = await tx
    .select({ bytes: sql<number>`coalesce(sum(${storedFiles.size}), 0)::float8` })
    .from(storedFiles)
    .where(
      and(
        eq(storedFiles.tenantId, input.tenantId),
        eq(storedFiles.purpose, HTML_DESIGN_DOC_PURPOSE),
        gte(storedFiles.createdAt, day.start),
      ),
    )
  if ((today?.bytes ?? 0) + bytes.length > limit) {
    const mb = String(Math.round(limit / (1024 * 1024)))
    throw new DomainError(
      `This spa reached its daily limit of ${mb} MB for new HTML designs — try again tomorrow`,
      'invalid',
      { key: 'errors.domain.htmlDesignDailyLimit', params: { limit: mb } },
    )
  }
  const row = await putFile(tx, {
    tenantId: input.tenantId,
    bytes,
    contentType: HTML_DESIGN_DOC_TYPE,
    filename,
    isPublic: false,
    purpose: HTML_DESIGN_DOC_PURPOSE,
    createdBy: input.userId ?? null,
  })
  return { ...doc, file: row.id }
}

/** Stores a template's design document (`site_template_files`, platform role, content-addressed). */
export async function storeTemplateHtmlDoc(
  db: Db | Tx,
  input: { html: string; userId?: string | null },
): Promise<HtmlDesignDoc> {
  const bytes = docBytes(input.html)
  const doc = htmlDesignDocFor(input.html)
  const row = await putTemplateFile(db, {
    bytes,
    contentType: HTML_DESIGN_DOC_TYPE,
    sha256: doc.sha256,
    createdBy: input.userId,
  })
  return { ...doc, file: row.id }
}

/** Reads one design document; null when it is missing (or not a design document). */
export type HtmlDocReader = (doc: HtmlDesignDoc) => Promise<string | null>

/** A spa's own design documents (inside its tenant transaction; another spa's file id reads nothing). */
export const spaHtmlDocReader =
  (tx: Pick<Tx, 'select'>, tenantId: string): HtmlDocReader =>
  async (doc) => {
    if (!isHtmlDesignDocFile(doc.file)) return null
    const row = await getFile(tx, doc.file)
    if (!row || row.tenantId !== tenantId || row.purpose !== HTML_DESIGN_DOC_PURPOSE) return null
    return row.bytes.toString('utf8')
  }

/** Template design documents (platform role). */
export const templateHtmlDocReader =
  (db: Pick<Db, 'select'> = platformDb()): HtmlDocReader =>
  async (doc) => {
    if (!isHtmlDesignDocFile(doc.file)) return null
    const row = await getTemplateFile(db, doc.file)
    if (!row?.contentType.startsWith('text/html')) return null
    return row.bytes.toString('utf8')
  }

/**
 * Deletes the spa's design documents that nothing references any more: no page version (draft, published or
 * history), no template-switch undo (`sites.template_undo`) and no saved section names the file, and it is older than
 * `HTML_DESIGN_DOC_KEEP_MS`. Holds the site lock, so a write that reuses a document (same content) can't race it.
 * Inside the spa's tenant transaction; returns how many were deleted (worker: daily `html-design-docs-prune`).
 */
export async function pruneUnusedHtmlDesignDocs(tx: Tx, tenantId: string, now = new Date()): Promise<number> {
  await lockSite(tx, tenantId)
  const mentions = (json: unknown) => sql`strpos(${json}::text, ${storedFiles.id}::text) > 0`
  const unused = await tx
    .select({ id: storedFiles.id })
    .from(storedFiles)
    .where(
      and(
        eq(storedFiles.tenantId, tenantId),
        eq(storedFiles.purpose, HTML_DESIGN_DOC_PURPOSE),
        lt(storedFiles.createdAt, new Date(now.getTime() - HTML_DESIGN_DOC_KEEP_MS)),
        sql`not exists (select 1 from ${pageVersions} where ${pageVersions.tenantId} = ${tenantId} and ${mentions(pageVersions.data)})`,
        sql`not exists (select 1 from ${sites} where ${sites.tenantId} = ${tenantId} and ${sites.templateUndo} is not null and ${mentions(sites.templateUndo)})`,
        sql`not exists (select 1 from ${savedSections} where ${savedSections.tenantId} = ${tenantId} and ${mentions(savedSections.data)})`,
      ),
    )
  for (const f of unused) await deleteFile(tx, f.id)
  return unused.length
}

type Node = { type?: unknown; props?: Record<string, unknown> }
type WithContent = { content?: unknown }

/** The design source of an HtmlDesign block: its document file, else its inline (legacy) html; null if missing. */
export async function htmlDesignSource(
  props: Record<string, unknown> | undefined,
  read: HtmlDocReader,
): Promise<string | null> {
  const doc = htmlDesignDocOf(props)
  if (doc) return read(doc)
  return typeof props?.html === 'string' ? props.html : null
}

/** The page's HtmlDesign blocks, each changed by `fn` (other blocks untouched; same object when there are none). */
export async function mapHtmlDesignNodes<T>(
  data: T,
  fn: (props: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<T> {
  const content = (data as WithContent | null)?.content
  if (!Array.isArray(content) || !content.some((n: Node) => n?.type === HTML_DESIGN)) return data
  const next: Node[] = []
  for (const n of content as Node[])
    next.push(n?.type === HTML_DESIGN ? { ...n, props: await fn({ ...(n.props ?? {}) }) } : n)
  return { ...data, content: next } as T
}

/**
 * Right before rendering: fills `props.html` of every HtmlDesign block that references a document (left '' when the
 * file is missing). The result is for rendering only — never save it (writers keep the reference).
 */
export const resolveHtmlDesignDocs = <T>(data: T, read: HtmlDocReader): Promise<T> =>
  mapHtmlDesignNodes(data, async (props) => {
    const doc = htmlDesignDocOf(props)
    return doc ? { ...props, html: (await read(doc)) ?? '' } : props
  })

/**
 * Template import (JSON file): each inline design (an export inlines them) stored as a template document, checked like
 * an upload (≤ MAX_HTML_UPLOAD_BYTES as UTF-8); a reference without its html (not from an export) is refused. A design
 * stored before R24 (no Phone fixes switch: fixes baked into its html) keeps reading as one (`bakedFixes`).
 */
export const templateDesignsIntoFiles = <T>(
  data: T,
  input: { db: Db | Tx; userId?: string | null },
): Promise<T> =>
  mapHtmlDesignNodes(data, async (props) => {
    const html = typeof props.html === 'string' ? props.html : ''
    if (!html)
      throw new DomainError('An HTML design in this file has no design text — export the template again')
    const size = Buffer.byteLength(html, 'utf8')
    if (size > MAX_HTML_UPLOAD_BYTES)
      throw new DomainError(
        `The design is ${(size / (1024 * 1024)).toFixed(1)} MB as UTF-8 text; the limit is ${MAX_HTML_UPLOAD_BYTES / (1024 * 1024)} MB.`,
      )
    const doc = await storeTemplateHtmlDoc(input.db, { html, userId: input.userId })
    return { ...props, html: '', doc, ...(htmlDesignBakedFixes(props) ? { bakedFixes: true } : {}) }
  })

/** Template export (JSON file): every design inline again (`doc` dropped), so the file works on any install. */
export const inlineHtmlDesignDocs = <T>(data: T, read: HtmlDocReader): Promise<T> =>
  mapHtmlDesignNodes(data, async (props) => {
    const doc = htmlDesignDocOf(props)
    if (!doc) return props
    const html = await read(doc)
    if (html === null) throw new DomainError('An HTML design file of this template is missing')
    const { doc: _drop, ...rest } = props
    return { ...rest, html }
  })

/**
 * Re-homes every design of a page: its source (document or inline html) through `change`, stored with `store`.
 * Used for template → spa (apply) and spa → template (save a site as a template).
 */
async function rehomeHtmlDesigns<T>(
  data: T,
  read: HtmlDocReader,
  store: (html: string) => Promise<HtmlDesignDoc>,
  change?: (
    html: string,
    images: HtmlImageAdjust[],
    content: unknown,
  ) => Promise<{ html: string; images: HtmlImageAdjust[]; content: unknown; copied: number }>,
): Promise<{ data: T; copied: number }> {
  let copied = 0
  const out = await mapHtmlDesignNodes(data, async (props) => {
    const source = await htmlDesignSource(props, read)
    if (source === null)
      throw new DomainError('An HTML design file of this template is missing — upload it again')
    const images = Array.isArray(props.images) ? (props.images as HtmlImageAdjust[]) : []
    const r = change
      ? await change(source, images, props.content)
      : { html: source, images, content: props.content, copied: 0 }
    copied += r.copied
    const { content: _content, ...rest } = props
    return {
      ...rest,
      html: '',
      doc: await store(r.html),
      images: r.images,
      ...(r.content === undefined || r.content === null ? {} : { content: r.content }),
    }
  })
  return { data: out, copied }
}

/** A spa page about to be saved as a template page: its designs copied into template files (platform role). */
export const spaDesignsIntoTemplate = <T>(
  data: T,
  input: { read: HtmlDocReader; db: Db | Tx; userId?: string | null },
): Promise<T> =>
  rehomeHtmlDesigns(data, input.read, (html) =>
    storeTemplateHtmlDoc(input.db, { html, userId: input.userId }),
  ).then((r) => r.data)

/* ------------------------------------------------------------------ Files a design uses */

/** Stores one copied file and returns its id. */
type AssetSink = (a: { sha256: string; bytes: Buffer; contentType: string; name: string }) => Promise<string>

/** A spa's copies of the files its design uses: its own public stored files (purpose html_design), deduplicated. */
export function tenantHtmlAssetSink(tx: Tx, tenantId: string, userId?: string | null): AssetSink {
  return async (a) => {
    const [found] = await tx
      .select({ id: storedFiles.id })
      .from(storedFiles)
      .where(
        and(
          eq(storedFiles.tenantId, tenantId),
          eq(storedFiles.purpose, HTML_DESIGN_FILE_PURPOSE),
          eq(storedFiles.filename, a.name),
        ),
      )
      .limit(1)
    if (found) return found.id
    const row = await putFile(tx, {
      tenantId,
      bytes: a.bytes,
      contentType: a.contentType,
      filename: a.name,
      isPublic: true,
      purpose: HTML_DESIGN_FILE_PURPOSE,
      createdBy: userId ?? null,
    })
    return row.id
  }
}

const assetOf = (bytes: Buffer, contentType: string) => {
  const sha = sha256(bytes)
  return { sha256: sha, bytes, contentType, name: `${sha.slice(0, 16)}.${EXT[contentType] ?? 'bin'}` }
}
/** R28 P5: a file for `tenantHtmlAssetSink` (content-addressed name, as the design copies get). */
export const htmlDesignAsset = assetOf

/** Keeps a URL's query (e.g. `?w=480`) when the file it points at moves. */
const withQuery = (url: string, from: string) => {
  const q = from.indexOf('?')
  if (q < 0) return url
  const hash = from.indexOf('#', q)
  return url + from.slice(q, hash < 0 ? undefined : hash)
}

/** The /files URLs of a design's website content (R28: values img / video, pictures img). */
function contentFileUrls(content: unknown): string[] {
  const parts = htmlContentParts(content)
  const urls: string[] = []
  for (const v of Object.values(parts.values))
    if ('img' in v && typeof v.img === 'string') urls.push(v.img)
    else if ('video' in v && typeof v.video === 'string') urls.push(v.video)
  for (const p of Object.values(parts.pictures)) urls.push(p.img)
  return urls
}

/**
 * Makes a design use only the spa's own files: every /files URL (in the design, in adjustment replacements and in its
 * website content) that points at a template file, or at another spa's public file, is copied into this spa
 * (deduplicated) and rewritten. Its own files and outside URLs stay as they are; another spa's private files are
 * never copied (a content entry using one is dropped: the design's own shows, and the spa's draft saves keep passing).
 */
export async function localiseHtmlDesignAssets(
  tx: Tx,
  input: {
    tenantId: string
    html: string
    images?: HtmlImageAdjust[]
    /** The block's website content (R28); returned with its /files URLs localised. */
    content?: unknown
    fileUrl: FileUrl
    userId?: string | null
    /** Platform-role reads of template / other spas' files (default platformDb()). */
    platform?: Db
  },
): Promise<{ html: string; images: HtmlImageAdjust[]; content: unknown; copied: number }> {
  const images = input.images ?? []
  const refs = htmlDesignAssetRefs(input.html)
  const ids = new Set<string>()
  for (const url of [
    ...refs.map((r) => r.url),
    ...images.map((a) => a.replace),
    ...contentFileUrls(input.content),
  ]) {
    const id = fileIdFromUrl(url)
    if (id) ids.add(id)
  }
  const unchanged = { html: input.html, images, content: input.content, copied: 0 }
  if (!ids.size) return unchanged
  const own = await tx
    .select({ id: storedFiles.id })
    .from(storedFiles)
    .where(and(eq(storedFiles.tenantId, input.tenantId), inArray(storedFiles.id, [...ids])))
  for (const o of own) ids.delete(o.id)
  const db = input.platform ?? platformDb()
  const sink = tenantHtmlAssetSink(tx, input.tenantId, input.userId)
  const moved = new Map<string, { id: string; url: string }>()
  /** Other spas' files left as they were (private, or not a type a design uses). */
  const foreign = new Set<string>()
  for (const id of ids) {
    let file: { bytes: Buffer; contentType: string } | null = await getTemplateFile(db, id)
    if (!file) {
      const [meta] = await db
        .select({ isPublic: storedFiles.isPublic, tenantId: storedFiles.tenantId })
        .from(storedFiles)
        .where(eq(storedFiles.id, id))
      if (meta && meta.tenantId !== input.tenantId) foreign.add(id)
      if (!meta?.isPublic || meta.tenantId === input.tenantId) continue
      file = await getFile(db, id)
    }
    if (!file || !MOVABLE.has(file.contentType) || !file.bytes.length) continue
    const asset = assetOf(file.bytes, file.contentType)
    const copy = await sink(asset)
    moved.set(id, { id: copy, url: input.fileUrl(copy, asset.name) })
    foreign.delete(id)
  }
  if (!moved.size && !foreign.size) return unchanged
  const target = (url: string | undefined) => {
    const id = fileIdFromUrl(url)
    const to = id ? moved.get(id) : undefined
    return to && url ? withQuery(to.url, url) : null
  }
  const html = moved.size ? rewriteHtmlDesignAssets(input.html, refs, (r) => target(r.url)) : input.html
  const remapped = moved.size
    ? remapHtmlImageAdjustments(input.html, html, images).map((a) => {
        const to = target(a.replace)
        return to ? { ...a, replace: to } : a
      })
    : images
  return {
    html,
    images: remapped,
    content: localiseContent(input.content, moved, foreign),
    copied: moved.size,
  }
}

/**
 * Website content with its /files URLs on the spa's copies (`/files/{id}`, the form content stores; an absolute URL
 * keeps its form like adjustments do); entries on another spa's file that wasn't copied are dropped. Same object when
 * nothing changes.
 */
function localiseContent(
  content: unknown,
  moved: Map<string, { id: string; url: string }>,
  foreign: Set<string>,
): unknown {
  const parts = htmlContentParts(content)
  let changed = false
  /** The URL on the spa's copy; null = drop the entry; undefined = keep it as is. */
  const to = (url: string): string | null | undefined => {
    const id = fileIdFromUrl(url)
    if (!id) return undefined
    const m = moved.get(id)
    if (m) return /^\/files\//.test(url) ? `/files/${m.id}` : withQuery(m.url, url)
    return foreign.has(id) ? null : undefined
  }
  for (const [path, v] of Object.entries(parts.values)) {
    const key = 'img' in v ? 'img' : 'video' in v ? 'video' : null
    const url = key ? (v as Record<string, unknown>)[key] : null
    const next = typeof url === 'string' ? to(url) : undefined
    if (next === undefined || !key) continue
    changed = true
    if (next === null) delete parts.values[path]
    else parts.values[path] = { ...v, [key]: next } as HtmlContentValue
  }
  for (const [id, p] of Object.entries(parts.pictures)) {
    const next = to(p.img)
    if (next === undefined) continue
    changed = true
    if (next === null) delete parts.pictures[id]
    else parts.pictures[id] = { ...p, img: next }
  }
  return changed ? (htmlContentFrom(parts) ?? null) : content
}

/**
 * A template page about to be written into a spa: each HTML design copied into the spa's own design document, with
 * the files it uses localised when `fileUrl` is given (see localiseHtmlDesignAssets). Always run it before a
 * template's pages are written into a spa: a spa page never references a template's file.
 */
export async function materializeTemplatePageData<T extends Record<string, unknown>>(
  tx: Tx,
  input: { tenantId: string; data: T; fileUrl?: FileUrl; userId?: string | null; platform?: Db },
): Promise<{ data: T; copied: number }> {
  const platform = input.platform ?? platformDb()
  const fileUrl = input.fileUrl
  return rehomeHtmlDesigns(
    input.data,
    templateHtmlDocReader(platform),
    (html) => storeSpaHtmlDoc(tx, { tenantId: input.tenantId, html, userId: input.userId }),
    fileUrl
      ? (html, images, content) =>
          localiseHtmlDesignAssets(tx, {
            tenantId: input.tenantId,
            html,
            images,
            content,
            fileUrl,
            userId: input.userId,
            platform,
          })
      : undefined,
  )
}

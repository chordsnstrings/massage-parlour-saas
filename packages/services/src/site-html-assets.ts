// R24: embedded files of uploaded HTML designs. A design file may be up to 5 MB, but it is stored inside page JSON
// (≤ ~500 KB): its embedded images, fonts and videos (`data:` URIs) are moved out to stored files — the same bytes,
// served with their real type (+ CORS, so fonts load from the sandboxed design) — and the URLs rewritten to absolute
// /files URLs. Nothing else in the design changes. Where the files live:
//  - template uploads (platform level): `site_template_files` (content-addressed, public, immutable);
//  - a spa's design (template applied, connector edits): the spa's own public stored files (purpose `html_design`).
// Applying a template copies the files its design uses into the spa (`localiseHtmlDesignAssets`): a spa's site never
// depends on a template row or on another spa. Like every service: takes the caller's tx; no permission checks here.
import { createHash } from 'node:crypto'
import {
  type DataUri,
  type HtmlAssetRef,
  type HtmlImageAdjust,
  htmlDesignAssetRefs,
  htmlDesignSizeReport,
  htmlDesignStoredSize,
  MAX_HTML_DESIGN_BYTES,
  parseDataUri,
  remapHtmlImageAdjustments,
  rewriteHtmlDesignAssets,
} from '@spa/core'
import { type Db, platformDb, storedFiles, type Tx } from '@spa/db'
import { and, eq, inArray } from 'drizzle-orm'
import { DomainError } from './errors'
import {
  FONT_TYPES,
  fileIdFromUrl,
  sniffFontType,
  sniffImageType,
  sniffVideoType,
  VIDEO_TYPES,
} from './media'
import { getFile, getTemplateFile, IMAGE_TYPES, MAX_FILE_BYTES, putFile, putTemplateFile } from './storage'

/** Smaller payloads stay inline (not worth a request). */
export const HTML_ASSET_MIN_BYTES = 1024
export const MAX_HTML_ASSETS = 300
/** stored_files.purpose of a spa's moved-out design files (public). */
export const HTML_DESIGN_FILE_PURPOSE = 'html_design'

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

const IMAGE_DECL = /^image\/(?:jpeg|jpg|pjpeg|png|webp|avif|gif)$/
const FONT_DECL = /^(?:font\/[a-z0-9.+-]+|application\/(?:x-)?font-[a-z0-9.+-]+)$/
const VIDEO_DECL = /^video\/(?:mp4|webm)$/

/** Percent-decoded bytes of a data: payload (byte-wise, like the browser; never throws). */
function percentBytes(s: string): Buffer {
  if (!s.includes('%')) return Buffer.from(s, 'latin1')
  const out = Buffer.alloc(s.length)
  let n = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 37 && /^[0-9a-fA-F]{2}$/.test(s.slice(i + 1, i + 3))) {
      out[n++] = Number.parseInt(s.slice(i + 1, i + 3), 16)
      i += 2
    } else out[n++] = c & 0xff
  }
  return out.subarray(0, n)
}

/** The payload's bytes (forgiving base64 as browsers decode it); null when it doesn't decode cleanly. */
export function dataUriBytes(uri: DataUri): Buffer | null {
  const raw = percentBytes(uri.payload)
  if (!uri.base64) return raw
  let d = raw.toString('latin1').replace(/[\t\n\f\r ]+/g, '')
  if (d.length % 4 === 0) d = d.replace(/==?$/, '')
  if (d.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(d)) return null
  return Buffer.from(d, 'base64')
}

/** The stored type of an embedded payload: sniffed, allowed and of the declared family; else null (stays inline). */
function movableType(decl: string, where: HtmlAssetRef['where'], bytes: Buffer): string | null {
  if (IMAGE_DECL.test(decl)) return sniffImageType(bytes)
  if (FONT_DECL.test(decl) || (decl === 'application/octet-stream' && where === 'css'))
    return sniffFontType(bytes)
  if (VIDEO_DECL.test(decl)) return sniffVideoType(bytes)
  return null
}

export type HtmlAsset = {
  sha256: string
  bytes: Buffer
  contentType: string
  ext: string
  /** File name in the URL: `{sha256[0..16]}.{ext}` (the extension keeps font URLs recognisable). */
  name: string
  refs: HtmlAssetRef[]
}

export type HtmlAssetPlan = {
  refs: HtmlAssetRef[]
  assets: HtmlAsset[]
  /** data: payloads that stay inline (SVG, icons, CSS, tiny, malformed, unknown, type mismatch). */
  leftover: { count: number; bytes: number; types: string[] }
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex')
const assetOf = (bytes: Buffer, contentType: string): Omit<HtmlAsset, 'refs'> => {
  const sha = sha256(bytes)
  const ext = EXT[contentType] ?? 'bin'
  return { sha256: sha, bytes, contentType, ext, name: `${sha.slice(0, 16)}.${ext}` }
}

/** Which embedded payloads move out (identical payloads once), and what stays inline. */
export function planHtmlDesignAssets(html: string): HtmlAssetPlan {
  const refs = htmlDesignAssetRefs(html)
  const bySha = new Map<string, HtmlAsset>()
  const leftover = { count: 0, bytes: 0, types: new Set<string>() }
  for (const ref of refs) {
    const uri = parseDataUri(ref.url)
    if (!uri) continue
    const bytes = dataUriBytes(uri)
    const type =
      bytes && bytes.length >= HTML_ASSET_MIN_BYTES && bytes.length <= MAX_FILE_BYTES
        ? movableType(uri.mime, ref.where, bytes)
        : null
    if (!type) {
      leftover.count++
      leftover.bytes += ref.end - ref.start
      leftover.types.add(uri.mime)
      continue
    }
    const a = assetOf(bytes!, type)
    const hit = bySha.get(a.sha256) ?? { ...a, refs: [] }
    hit.refs.push(ref)
    bySha.set(a.sha256, hit)
  }
  return { refs, assets: [...bySha.values()], leftover: { ...leftover, types: [...leftover.types] } }
}

const kb = (n: number) => `${Math.max(1, Math.ceil(n / 1024))} KB`
const sizeText = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(1)} MB` : kb(n))
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** null when the design fits; else what it is still made of and what to do. */
export function htmlDesignSizeProblem(html: string, moved?: { count: number; bytes: number }): string | null {
  const total = htmlDesignStoredSize(html)
  if (total <= MAX_HTML_DESIGN_BYTES) return null
  const r = htmlDesignSizeReport(html)
  const parts = (
    [
      ['scripts', r.scripts],
      ['styles', r.styles],
      ['markup', r.markup],
      ['inline SVG', r.svg],
      [
        `${plural(r.embedded.count, 'other embedded file')} (SVG, icons… can't be moved out)`,
        r.embedded.bytes,
      ],
    ] as [string, number][]
  )
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([label, n]) => `${label} ${kb(n)}`)
  const lead = moved?.count
    ? `After moving ${plural(moved.count, 'embedded image, font or video file')} (${sizeText(moved.bytes)}) out, the design is still`
    : 'The design is'
  return `${lead} ${kb(total)} (${parts.join(', ')}); the limit is about ${MAX_HTML_DESIGN_BYTES / 1024} KB. Load big scripts or styles from a URL, or shrink them.`
}

/** Stores one moved-out file and returns its id. */
export type HtmlAssetSink = (asset: HtmlAsset) => Promise<string>

/** A spa's design files: its own public stored files (purpose html_design), deduplicated by content. */
export function tenantHtmlAssetSink(tx: Tx, tenantId: string, userId?: string | null): HtmlAssetSink {
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

/** A template upload's files: `site_template_files` (platform role), deduplicated by content. */
export function templateHtmlAssetSink(db: Db | Tx, userId?: string | null): HtmlAssetSink {
  return async (a) =>
    (
      await putTemplateFile(db, {
        bytes: a.bytes,
        contentType: a.contentType,
        sha256: a.sha256,
        createdBy: userId,
      })
    ).id
}

/** Same length as a real id, so a dry run's sizes are exact. */
const DRY_ID = '00000000-0000-4000-8000-000000000000'

export type PreparedHtmlDesign = {
  html: string
  images: HtmlImageAdjust[]
  moved: { count: number; bytes: number }
  leftover: HtmlAssetPlan['leftover']
}

/**
 * Moves a design's embedded files out (`sink`) and rewrites their URLs; adjustments keep matching their images.
 * The size is checked first (with placeholder ids of the same length), so nothing is stored for a design that
 * doesn't fit: DomainError with what is still too big. `dryRun`: nothing stored, placeholder URLs.
 */
export async function prepareHtmlDesign(input: {
  html: string
  images?: HtmlImageAdjust[]
  sink: HtmlAssetSink
  fileUrl: FileUrl
  dryRun?: boolean
}): Promise<PreparedHtmlDesign> {
  const plan = planHtmlDesignAssets(input.html)
  if (plan.assets.length > MAX_HTML_ASSETS)
    throw new DomainError(
      `The design embeds ${plan.assets.length} images, fonts and videos; at most ${MAX_HTML_ASSETS} can be moved out. Link some of them by URL instead.`,
    )
  const moved = { count: plan.assets.length, bytes: plan.assets.reduce((n, a) => n + a.bytes.length, 0) }
  const rewrite = (ids: Map<string, string>) => {
    if (!plan.assets.length) return input.html
    const urls = new Map<HtmlAssetRef, string>()
    for (const a of plan.assets)
      for (const r of a.refs) urls.set(r, input.fileUrl(ids.get(a.sha256)!, a.name))
    return rewriteHtmlDesignAssets(input.html, plan.refs, (r) => urls.get(r) ?? null)
  }
  const dry = rewrite(new Map(plan.assets.map((a) => [a.sha256, DRY_ID])))
  const problem = htmlDesignSizeProblem(dry, moved)
  if (problem) throw new DomainError(problem)
  let html = dry
  if (!input.dryRun && plan.assets.length) {
    const ids = new Map<string, string>()
    for (const a of plan.assets) ids.set(a.sha256, await input.sink(a))
    html = rewrite(ids)
  }
  return {
    html,
    images: remapHtmlImageAdjustments(input.html, html, input.images ?? []),
    moved,
    leftover: plan.leftover,
  }
}

/** Keeps a URL's query (e.g. `?w=480`) when the file it points at moves. */
const withQuery = (url: string, from: string) => {
  const q = from.indexOf('?')
  return q < 0 ? url : url + from.slice(q).replace(/#.*$/, '')
}

/**
 * Makes a design use only the spa's own files: every /files URL (in the design and in adjustment replacements) that
 * points at a template file, or at another spa's public file, is copied into this spa (deduplicated) and rewritten.
 * Its own files and outside URLs stay as they are; another spa's private files are never copied.
 */
export async function localiseHtmlDesignAssets(
  tx: Tx,
  input: {
    tenantId: string
    html: string
    images?: HtmlImageAdjust[]
    fileUrl: FileUrl
    userId?: string | null
    /** Platform-role reads of template / other spas' files (default platformDb()). */
    platform?: Db
  },
): Promise<{ html: string; images: HtmlImageAdjust[]; copied: number }> {
  const images = input.images ?? []
  const refs = htmlDesignAssetRefs(input.html)
  const ids = new Set<string>()
  for (const r of refs) {
    const id = fileIdFromUrl(r.url)
    if (id) ids.add(id)
  }
  for (const a of images) {
    const id = fileIdFromUrl(a.replace)
    if (id) ids.add(id)
  }
  if (!ids.size) return { html: input.html, images, copied: 0 }
  const own = await tx
    .select({ id: storedFiles.id })
    .from(storedFiles)
    .where(and(eq(storedFiles.tenantId, input.tenantId), inArray(storedFiles.id, [...ids])))
  for (const o of own) ids.delete(o.id)
  const db = input.platform ?? platformDb()
  const sink = tenantHtmlAssetSink(tx, input.tenantId, input.userId)
  const moved = new Map<string, string>()
  for (const id of ids) {
    let file: { bytes: Buffer; contentType: string } | null = await getTemplateFile(db, id)
    if (!file) {
      const [meta] = await db
        .select({ isPublic: storedFiles.isPublic, tenantId: storedFiles.tenantId })
        .from(storedFiles)
        .where(eq(storedFiles.id, id))
      if (!meta?.isPublic || meta.tenantId === input.tenantId) continue
      file = await getFile(db, id)
    }
    if (!file || !MOVABLE.has(file.contentType) || !file.bytes.length) continue
    const asset = { ...assetOf(file.bytes, file.contentType), refs: [] }
    moved.set(id, input.fileUrl(await sink(asset), asset.name))
  }
  if (!moved.size) return { html: input.html, images, copied: 0 }
  const target = (url: string | undefined) => {
    const id = fileIdFromUrl(url)
    const to = id ? moved.get(id) : undefined
    return to && url ? withQuery(to, url) : null
  }
  const html = rewriteHtmlDesignAssets(input.html, refs, (r) => target(r.url), { crossorigin: false })
  const remapped = remapHtmlImageAdjustments(input.html, html, images).map((a) => {
    const to = target(a.replace)
    return to ? { ...a, replace: to } : a
  })
  return { html, images: remapped, copied: moved.size }
}

type Node = { type?: unknown; props?: Record<string, unknown> }

/** A template page about to be written into a spa: its HTML designs localised (see localiseHtmlDesignAssets). */
export async function materializeTemplatePageData<T extends Record<string, unknown>>(
  tx: Tx,
  input: { tenantId: string; data: T; fileUrl: FileUrl; userId?: string | null; platform?: Db },
): Promise<{ data: T; copied: number }> {
  const content = (input.data as { content?: Node[] }).content
  if (!Array.isArray(content) || !content.some((n) => n?.type === 'HtmlDesign'))
    return { data: input.data, copied: 0 }
  let copied = 0
  const next: Node[] = []
  for (const n of content) {
    if (n?.type !== 'HtmlDesign' || typeof n.props?.html !== 'string') {
      next.push(n)
      continue
    }
    const r = await localiseHtmlDesignAssets(tx, {
      tenantId: input.tenantId,
      html: n.props.html,
      images: Array.isArray(n.props.images) ? (n.props.images as HtmlImageAdjust[]) : [],
      fileUrl: input.fileUrl,
      userId: input.userId,
      platform: input.platform,
    })
    copied += r.copied
    next.push({ ...n, props: { ...n.props, html: r.html, images: r.images } })
  }
  return { data: { ...input.data, content: next }, copied }
}

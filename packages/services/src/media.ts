// Media library (PLAN §11.8, §1.12): every image a spa uses on its site — uploads and persisted AI images — is
// re-encoded once with sharp (auto-rotated, metadata stripped, ≤ 2400 px long edge, WebP q82) and stored as a
// public file served at /files/{id}.
//
// Thumbnails are generated on the fly (/files/{id}?w=480) rather than stored as a second file: no extra rows to
// keep in sync on delete, every public image (old uploads, AI images) gets them for free, widths are whitelisted
// so the variant space is tiny, and the responses are immutable so browsers / Cloudflare cache each one after
// the first request (the route keeps a small in-process LRU as well).
//
// Remote downloads resolve the hostname and refuse private addresses before fetching (and on every redirect).
// The fetch itself resolves again, so a DNS-rebinding host could still race us; the only remote source today
// is ModelArk's own CDN, so this is defence in depth rather than the last line.
import { lookup as dnsLookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import {
  mediaAssets,
  pageVersions,
  savedSections,
  services,
  sitePages,
  socialPosts,
  staff,
  storedFiles,
  type Tx,
} from '@spa/db'
import {
  and,
  arrayContains,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lt,
  ne,
  notLike,
  or,
  sql,
} from 'drizzle-orm'
import { DomainError } from './errors'
import { deleteFile, MAX_FILE_BYTES, putFile } from './storage'

/** Raw upload / download cap before re-encoding (phone photos are often 5–15 MB). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024
export const MAX_EDGE = 2400
export const WEBP_QUALITY = 82
/** Widths the file route renders on request; 480 is the library thumbnail. */
export const VARIANT_WIDTHS = [480, 960] as const
export const THUMB_WIDTH = 480

export type ImageType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/avif' | 'image/gif'

const ascii = (b: Uint8Array, start: number, end: number) => String.fromCharCode(...b.subarray(start, end))

/**
 * The real type of an image from its magic bytes (never trust the extension or the browser's MIME type).
 * Returns null for anything else — including SVG (scriptable) and HEIC (not decodable by our sharp build).
 */
export function sniffImageType(b: Uint8Array): ImageType | null {
  if (b.length < 12) return null
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && ascii(b, 1, 8) === 'PNG\r\n\x1a\n') return 'image/png'
  const six = ascii(b, 0, 6)
  if (six === 'GIF87a' || six === 'GIF89a') return 'image/gif'
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp'
  if (ascii(b, 4, 8) === 'ftyp') {
    // ISO-BMFF: major brand at 8–12, compatible brands from 16 to the end of the ftyp box.
    const boxSize = Math.min(((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0, b.length, 64)
    const brands = [ascii(b, 8, 12)]
    for (let i = 16; i + 4 <= boxSize; i += 4) brands.push(ascii(b, i, i + 4))
    if (brands.includes('avif') || brands.includes('avis')) return 'image/avif'
  }
  return null
}

/** True for content that is SVG/XML (to give a clearer error than "not an image"). */
export const looksLikeSvg = (b: Uint8Array) =>
  /^\s*(<\?xml|<svg|<!doctype svg)/i.test(new TextDecoder().decode(b.subarray(0, 256)).replace(/^﻿/, ''))

export class MediaError extends DomainError {}

function assertImage(input: Uint8Array): ImageType {
  const type = sniffImageType(input)
  if (type) return type
  if (looksLikeSvg(input))
    throw new MediaError('SVG files aren’t supported — please upload a JPG, PNG or WebP.', 'invalid', {
      key: 'errors.file.svg',
    })
  throw new MediaError('That file isn’t an image we can use (JPG, PNG, WebP, AVIF or GIF).', 'invalid', {
    key: 'errors.file.notImage',
  })
}

// Loaded lazily so importing @spa/services never loads the native module (worker bundle, unrelated tests).
const loadSharp = async () => (await import('sharp')).default

export type ProcessedImage = {
  bytes: Buffer
  contentType: 'image/webp'
  width: number
  height: number
  sourceType: ImageType
}

/** Auto-rotate, strip metadata (EXIF/GPS), fit within 2400 px and encode as WebP q82. GIFs keep their first frame. */
export async function processImage(
  input: Buffer,
  opts: { maxEdge?: number; quality?: number } = {},
): Promise<ProcessedImage> {
  if (input.length === 0) throw new MediaError('The file is empty', 'invalid', { key: 'errors.file.empty' })
  if (input.length > MAX_UPLOAD_BYTES)
    throw new MediaError('Images can be up to 20 MB', 'invalid', {
      key: 'errors.file.imageTooLarge',
      params: { size: '20 MB' },
    })
  const sourceType = assertImage(input)
  const sharp = await loadSharp()
  const maxEdge = opts.maxEdge ?? MAX_EDGE
  try {
    // sharp drops all metadata unless .keepMetadata()/.withMetadata() is called.
    const { data, info } = await sharp(input, { failOn: 'error', limitInputPixels: 80_000_000 })
      .autoOrient()
      .resize({ width: maxEdge, height: maxEdge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: opts.quality ?? WEBP_QUALITY, effort: 4 })
      .toBuffer({ resolveWithObject: true })
    if (data.length > MAX_FILE_BYTES)
      throw new MediaError('That image is too large even after compression', 'invalid', {
        key: 'errors.file.compressedTooLarge',
      })
    return { bytes: data, contentType: 'image/webp', width: info.width, height: info.height, sourceType }
  } catch (e) {
    if (e instanceof MediaError) throw e
    throw new MediaError('We couldn’t read that image — it may be damaged.', 'invalid', {
      key: 'errors.file.unreadable',
    })
  }
}

/** A narrower WebP rendition for thumbnails / srcset (never upscales). */
export async function resizeVariant(input: Buffer, width: number) {
  const sharp = await loadSharp()
  return sharp(input, { failOn: 'none' })
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 76, effort: 3 })
    .toBuffer()
}

/** A JPEG rendition (/files/{id}?f=jpg) — Instagram's publishing API only accepts JPEG. Transparency → white. */
export async function jpegVariant(input: Buffer, width?: number) {
  const sharp = await loadSharp()
  const img = sharp(input, { failOn: 'none' })
  if (width) img.resize({ width, withoutEnlargement: true })
  return img.flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
}

// ─── Library rows ───────────────────────────────────────────────────────────

export type MediaSource = 'upload' | 'ai'
export type Alt = { en?: string; ar?: string }

export const fileUrl = (fileId: string) => `/files/${fileId}`

const FILE_ID = /\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?=[/?#]|$)/i
/** The stored-file id inside a /files URL (relative or absolute), if any. */
export const fileIdFromUrl = (url: string | null | undefined) =>
  url?.match(FILE_ID)?.[1]?.toLowerCase() ?? null

/** Absolute URL for a relative /files path (Instagram and other APIs need absolute URLs). */
export const absoluteFileUrl = (url: string, origin: string) =>
  /^https?:\/\//i.test(url) ? url : `${origin.replace(/\/$/, '')}${url.startsWith('/') ? '' : '/'}${url}`

/** The URL a social post stores for a library file: absolute, as a JPEG rendition (Instagram takes JPEG only). */
export const postImageUrl = (url: string, origin: string) => {
  const abs = absoluteFileUrl(url, origin)
  return fileIdFromUrl(abs) && !/[?&]f=jpg\b/.test(abs) ? `${abs}${abs.includes('?') ? '&' : '?'}f=jpg` : abs
}

const cleanTags = (tags: string[] | undefined) =>
  [...new Set((tags ?? []).map((t) => t.trim().toLowerCase().replace(/\s+/g, '-')).filter(Boolean))]
    .map((t) => t.slice(0, 32))
    .slice(0, 12)

const cleanAlt = (alt: Alt | null | undefined): Alt => ({
  en: alt?.en?.trim().slice(0, 300) || undefined,
  ar: alt?.ar?.trim().slice(0, 300) || undefined,
})

/** Stores a processed image as a public file and adds it to the library (inside the caller's tenant tx). */
export async function createAsset(
  tx: Tx,
  a: {
    tenantId: string
    image: Pick<ProcessedImage, 'bytes' | 'width' | 'height'> & { contentType?: string }
    source?: MediaSource
    filename?: string | null
    alt?: Alt | null
    tags?: string[]
    createdBy?: string | null
  },
) {
  const name = a.filename ? `${a.filename.replace(/\.[a-z0-9]{2,5}$/i, '').slice(0, 80)}.webp` : null
  const file = await putFile(tx, {
    tenantId: a.tenantId,
    bytes: a.image.bytes,
    contentType: a.image.contentType ?? 'image/webp',
    filename: name,
    isPublic: true,
    purpose: 'media',
    createdBy: a.createdBy ?? null,
  })
  const [row] = await tx
    .insert(mediaAssets)
    .values({
      tenantId: a.tenantId,
      url: fileUrl(file.id),
      fileId: file.id,
      bytes: file.size,
      kind: 'image',
      width: a.image.width,
      height: a.image.height,
      alt: cleanAlt(a.alt),
      source: a.source ?? 'upload',
      tags: cleanTags(a.tags),
    })
    .returning()
  return { ...row!, filename: name }
}

export type AssetFilter = {
  source?: MediaSource
  tag?: string
  q?: string
  limit?: number
  offset?: number
  /** Leave out AI rows still on their temporary (7-day) generator link — for pickers that embed the URL. */
  storedOnly?: boolean
}

/** Library listing, newest first, with the original filename. */
export async function listAssets(tx: Tx, f: AssetFilter = {}) {
  const where = []
  if (f.source) where.push(eq(mediaAssets.source, f.source))
  if (f.tag) where.push(arrayContains(mediaAssets.tags, [f.tag]))
  if (f.storedOnly)
    where.push(
      or(ne(mediaAssets.source, 'ai'), isNotNull(mediaAssets.fileId), like(mediaAssets.url, '/files/%')),
    )
  const q = f.q?.trim()
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    where.push(
      or(
        ilike(storedFiles.filename, like),
        sql`${mediaAssets.alt}->>'en' ilike ${like}`,
        sql`${mediaAssets.alt}->>'ar' ilike ${like}`,
        sql`array_to_string(${mediaAssets.tags}, ' ') ilike ${like}`,
      ),
    )
  }
  return tx
    .select({
      id: mediaAssets.id,
      url: mediaAssets.url,
      fileId: mediaAssets.fileId,
      width: mediaAssets.width,
      height: mediaAssets.height,
      bytes: mediaAssets.bytes,
      alt: mediaAssets.alt,
      source: mediaAssets.source,
      tags: mediaAssets.tags,
      createdAt: mediaAssets.createdAt,
      filename: storedFiles.filename,
    })
    .from(mediaAssets)
    .leftJoin(storedFiles, eq(storedFiles.id, mediaAssets.fileId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(mediaAssets.createdAt), desc(mediaAssets.id))
    .limit(Math.min(f.limit ?? 60, 1000))
    .offset(f.offset ?? 0)
}

/** Distinct tags in use, for the filter chips. */
export async function listTags(tx: Tx) {
  const rows = await tx.execute<{ tag: string }>(
    sql`select distinct unnest(${mediaAssets.tags}) as tag from ${mediaAssets} order by 1 limit 100`,
  )
  return rows.rows.map((r) => r.tag)
}

export async function updateAlt(tx: Tx, id: string, alt: Alt) {
  const [row] = await tx
    .update(mediaAssets)
    .set({ alt: cleanAlt(alt) })
    .where(eq(mediaAssets.id, id))
    .returning()
  if (!row) throw new DomainError('Image not found', 'not_found')
  return row
}

export async function setTags(tx: Tx, id: string, tags: string[]) {
  const [row] = await tx
    .update(mediaAssets)
    .set({ tags: cleanTags(tags) })
    .where(eq(mediaAssets.id, id))
    .returning()
  if (!row) throw new DomainError('Image not found', 'not_found')
  return row
}

/**
 * Where a library image is in use, so deleting it can warn first: site pages (current draft or published
 * version), service photos, therapist photos and social posts not yet published. Matches `/files/{id}` however
 * it's written (relative, absolute, with ?w= / ?f= variants).
 */
export async function assetUsage(tx: Tx, url: string) {
  const fileId = fileIdFromUrl(url)
  const needle = `%${fileId ? `/files/${fileId}` : url.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const latest = tx
    .selectDistinctOn([pageVersions.pageId, pageVersions.status], { id: pageVersions.id })
    .from(pageVersions)
    .orderBy(pageVersions.pageId, pageVersions.status, desc(pageVersions.createdAt))
  const [pages, serviceRows, staffRows, posts, sections] = await Promise.all([
    tx
      .selectDistinct({ id: sitePages.id, title: sitePages.title, slug: sitePages.slug })
      .from(pageVersions)
      .innerJoin(sitePages, eq(sitePages.id, pageVersions.pageId))
      .where(and(inArray(pageVersions.id, latest), sql`${pageVersions.data}::text ilike ${needle}`)),
    tx
      .select({ id: services.id, name: services.name })
      .from(services)
      .where(ilike(services.imageUrl, needle)),
    tx.select({ id: staff.id, name: staff.displayName }).from(staff).where(ilike(staff.photoUrl, needle)),
    tx
      .select({ id: socialPosts.id })
      .from(socialPosts)
      .where(and(ne(socialPosts.status, 'published'), sql`${socialPosts.media}::text ilike ${needle}`)),
    tx
      .select({ id: savedSections.id, name: savedSections.name, isGlobal: savedSections.isGlobal })
      .from(savedSections)
      .where(sql`${savedSections.data}::text ilike ${needle}`),
  ])
  return { pages, services: serviceRows, staff: staffRows, posts, sections }
}

/** Removes an asset and its stored file. Returns the deleted row (null if it wasn't there). */
export async function deleteAsset(tx: Tx, id: string) {
  const [row] = await tx.delete(mediaAssets).where(eq(mediaAssets.id, id)).returning()
  if (!row) return null
  const fileId = row.fileId ?? fileIdFromUrl(row.url)
  if (fileId) {
    // Another asset row may point at the same file (e.g. an AI image persisted twice); keep it then.
    const [other] = await tx
      .select({ id: mediaAssets.id })
      .from(mediaAssets)
      .where(eq(mediaAssets.fileId, fileId))
      .limit(1)
    if (!other) await deleteFile(tx, fileId)
  }
  return row
}

// ─── Remote images (AI) ─────────────────────────────────────────────────────

const v4ToInt = (ip: string) => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0
const inV4 = (ip: number, cidr: string) => {
  const [base, bits] = cidr.split('/') as [string, string]
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0
  return (ip & mask) === (v4ToInt(base) & mask)
}
const PRIVATE_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.88.99.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
]

/** IPv6 text → 8 hextets (handles ::, and a trailing dotted IPv4). */
function v6Hextets(ip: string): number[] {
  let s = ip.toLowerCase().split('%')[0]!
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const n = v4ToInt(dotted[1]!)
    s = `${s.slice(0, -dotted[1]!.length)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const [head, tail] = s.split('::') as [string, string | undefined]
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const fill = tail === undefined ? [] : Array(8 - h.length - t.length).fill('0')
  return [...h, ...fill, ...t].map((x) => Number.parseInt(x || '0', 16))
}

/** True for loopback, private, link-local, CGNAT, multicast, documentation and other non-public addresses. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip.split('%')[0]!)
  if (kind === 4) {
    const n = v4ToInt(ip)
    return PRIVATE_V4.some((c) => inV4(n, c)) || n === 0xffffffff
  }
  if (kind !== 6) return true // not an IP at all → refuse
  const h = v6Hextets(ip)
  const embeddedV4 = () => `${h[6]! >> 8}.${h[6]! & 255}.${h[7]! >> 8}.${h[7]! & 255}`
  if (h.every((x) => x === 0)) return true // ::
  if (h.slice(0, 7).every((x) => x === 0) && h[7] === 1) return true // ::1
  if (h.slice(0, 5).every((x) => x === 0) && h[5] === 0xffff) return isPrivateAddress(embeddedV4()) // ::ffff:v4
  if (h.slice(0, 6).every((x) => x === 0)) return true // deprecated IPv4-compatible
  if (h[0] === 0x64 && h[1] === 0xff9b && h.slice(2, 6).every((x) => x === 0))
    return isPrivateAddress(embeddedV4()) // NAT64
  if (h[0] === 0x2002) return isPrivateAddress(`${h[1]! >> 8}.${h[1]! & 255}.${h[2]! >> 8}.${h[2]! & 255}`) // 6to4
  if ((h[0]! & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((h[0]! & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((h[0]! & 0xffc0) === 0xfec0) return true // fec0::/10 site-local (deprecated)
  if ((h[0]! & 0xff00) === 0xff00) return true // multicast
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true // documentation
  if (h[0] === 0x0100 && h.slice(1, 4).every((x) => x === 0)) return true // discard
  return false
}

export type RemoteOpts = {
  /** Injected in tests; defaults to the global fetch. */
  fetch?: typeof fetch
  /** Resolves a hostname to its addresses; defaults to the system resolver. */
  lookup?: (hostname: string) => Promise<string[]>
  maxBytes?: number
  timeoutMs?: number
  maxRedirects?: number
}

const systemLookup = async (hostname: string) =>
  (await dnsLookup(hostname, { all: true, verbatim: true })).map((a) => a.address)

/** Refuses anything but https on 443 to a hostname whose every address is public. */
async function assertPublicHttps(raw: string, lookup: (h: string) => Promise<string[]>) {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new MediaError('That image link isn’t a valid URL')
  }
  if (u.protocol !== 'https:') throw new MediaError('Only https image links can be imported')
  if (u.username || u.password) throw new MediaError('Image links with credentials aren’t allowed')
  if (u.port && u.port !== '443') throw new MediaError('That image link uses a non-standard port')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  let addresses: string[]
  if (isIP(host)) addresses = [host]
  else {
    try {
      addresses = await lookup(host)
    } catch {
      throw new MediaError('Couldn’t reach the image host')
    }
  }
  if (addresses.length === 0 || addresses.some(isPrivateAddress))
    throw new MediaError('That image link points to a private network address')
  return u
}

/**
 * Downloads a remote image (e.g. a Seedream URL that expires after 7 days) safely: https only, public
 * addresses only (re-checked on every redirect), 10 s overall timeout, size cap while streaming, and an
 * image content type confirmed by magic bytes. Returns the raw bytes for processImage.
 */
export async function fetchRemoteImage(url: string, opts: RemoteOpts = {}) {
  const doFetch = opts.fetch ?? fetch
  const lookup = opts.lookup ?? systemLookup
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES
  const signal = AbortSignal.timeout(opts.timeoutMs ?? 10_000)
  let current = url
  try {
    for (let hop = 0; ; hop++) {
      const u = await assertPublicHttps(current, lookup)
      const res = await doFetch(u, { redirect: 'manual', signal, headers: { accept: 'image/*' } })
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location')
        await res.body?.cancel()
        if (!location || hop >= (opts.maxRedirects ?? 3)) throw new MediaError('Too many redirects')
        current = new URL(location, u).toString()
        continue
      }
      if (!res.ok) throw new MediaError(`The image host answered ${res.status}`)
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      // Some object stores label images as octet-stream; the magic-byte check below is the real gate.
      const generic = type === 'application/octet-stream' || type === 'binary/octet-stream'
      if ((!type.startsWith('image/') && !generic) || type.includes('svg'))
        throw new MediaError('That link doesn’t point to an image')
      const declared = Number(res.headers.get('content-length') ?? 0)
      if (declared > maxBytes) throw new MediaError('That image is too large')
      const chunks: Uint8Array[] = []
      let total = 0
      if (res.body) {
        const reader = res.body.getReader()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > maxBytes) {
            await reader.cancel()
            throw new MediaError('That image is too large')
          }
          chunks.push(value)
        }
      }
      const bytes = Buffer.concat(chunks)
      const sniffed = assertImage(bytes)
      return { bytes, contentType: sniffed }
    }
  } catch (e) {
    if (e instanceof MediaError) throw e
    if ((e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError')
      throw new MediaError('The image download timed out')
    throw new MediaError('Couldn’t download the image')
  }
}

/** Downloads + re-encodes a remote image, ready for createAsset (do this outside the DB transaction). */
export async function saveRemoteImage(url: string, opts: RemoteOpts = {}) {
  const { bytes } = await fetchRemoteImage(url, opts)
  return processImage(bytes)
}

/** Generator links (Seedream) stop working 7 days after creation. */
export const AI_LINK_TTL_MS = 7 * 24 * 3600_000

/** Drops AI library rows that were never saved to a stored file and whose temporary link has expired. */
export async function pruneExpiredAiLinks(tx: Tx, now = new Date()) {
  const rows = await tx
    .delete(mediaAssets)
    .where(
      and(
        eq(mediaAssets.source, 'ai'),
        isNull(mediaAssets.fileId),
        notLike(mediaAssets.url, '/files/%'),
        lt(mediaAssets.createdAt, new Date(now.getTime() - AI_LINK_TTL_MS)),
      ),
    )
    .returning({ id: mediaAssets.id })
  return rows.length
}

/** Points social posts still using a temporary remote image link at its stored copy. Returns the posts changed. */
export async function repointPostImages(tx: Tx, fromUrl: string, toUrl: string) {
  const posts = await tx
    .select({ id: socialPosts.id, media: socialPosts.media })
    .from(socialPosts)
    .where(sql`${socialPosts.media} @> ${JSON.stringify([{ url: fromUrl }])}::jsonb`)
  for (const p of posts)
    await tx
      .update(socialPosts)
      .set({ media: p.media.map((m) => (m.url === fromUrl ? { ...m, url: toUrl } : m)) })
      .where(eq(socialPosts.id, p.id))
  return posts.length
}

/**
 * Moves a library row that still points at a temporary remote URL (AI images) onto a stored file,
 * or adds a new asset when there is none.
 */
export async function persistRemoteAsset(
  tx: Tx,
  a: {
    tenantId: string
    remoteUrl: string
    image: ProcessedImage
    alt?: Alt | null
    tags?: string[]
    createdBy?: string | null
  },
) {
  const [existing] = await tx.select().from(mediaAssets).where(eq(mediaAssets.url, a.remoteUrl)).limit(1)
  if (!existing)
    return createAsset(tx, {
      tenantId: a.tenantId,
      image: a.image,
      source: 'ai',
      filename: 'ai-image',
      alt: a.alt,
      tags: a.tags ?? ['ai'],
      createdBy: a.createdBy,
    })
  const file = await putFile(tx, {
    tenantId: a.tenantId,
    bytes: a.image.bytes,
    contentType: a.image.contentType,
    filename: 'ai-image.webp',
    isPublic: true,
    purpose: 'media',
    createdBy: a.createdBy ?? null,
  })
  const [row] = await tx
    .update(mediaAssets)
    .set({
      url: fileUrl(file.id),
      fileId: file.id,
      bytes: file.size,
      width: a.image.width,
      height: a.image.height,
      tags: cleanTags([...(existing.tags ?? []), ...(a.tags ?? ['ai'])]),
    })
    .where(eq(mediaAssets.id, existing.id))
    .returning()
  return { ...row!, filename: 'ai-image.webp' }
}

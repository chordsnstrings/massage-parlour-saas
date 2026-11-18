// First-screen pictures delivered inside the page (owner 2026-10-13: "i don't want to see delay when i reload the
// website"; docs/design/html-crm-contract.md "contract.inline"). An exact HTML design's live page runs under a CSP
// sandbox (opaque origin, R24), so the browser keys its cache by a per-document nonce: nothing is reused on a reload
// and every first-screen picture downloads again and pops in after the text. A contract design may therefore declare
// `contract.inline`: CRM_DATA paths whose final picture (after the CRM merge and the spa's content) the platform puts
// into window.CRM_DATA as a data: URI — only the platform's own files (this spa's public /files, the static
// /designs files), read server-side (never fetched from a URL), raster only, small ones only. The design document
// never changes (R24); only values inside CRM_DATA do (R26), plus `inline_originals` {path: original url}.
// Decision B (owner 2026-10-14): `contract.inline_fonts` {locale: [font url]} — the static design woff2 files one
// locale's page needs (BE RELAX's Arabic faces), as the reserved `inline_fonts` {url: data: URI} on that locale only.

/**
 * Caps (raw bytes): each picture ≤ 80 KB, all of one page's ≤ 240 KB (counted per occurrence); ≤ 16 paths. Fonts
 * (a separate budget): ≤ 16 urls a locale, each ≤ 150 KB, all ≤ 400 KB. A render waits ≤ 300 ms for reads, pictures
 * and fonts together (a later one stays a link for that render and fills the cache for the next load).
 */
export const CRM_INLINE_LIMITS = {
  paths: 16,
  pathChars: 200,
  fileBytes: 80 * 1024,
  totalBytes: 240 * 1024,
  fonts: 16,
  fontUrlChars: 2000,
  fontBytes: 150 * 1024,
  fontTotalBytes: 400 * 1024,
  deadlineMs: 300,
} as const

/** Inline plan of one render: declared path → the picture's url there and its data: URI. */
export type CrmInline = Record<string, { url: string; data: string }>
/** Where a picture's bytes come from (both immutable: a file id never changes content, design files are hashed). */
export type CrmInlineSource = { kind: 'file'; id: string } | { kind: 'design'; design: string; name: string }
export type CrmRasterType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/avif' | 'image/gif'
/** Inline fonts of one render (`inline_fonts`): each declared font url, exactly as declared → its data: URI. */
export type CrmInlineFonts = Record<string, string>
/** Where a font's bytes come from: a static design file (hashed names: its content never changes). */
export type CrmInlineFontSource = { kind: 'design'; design: string; name: string }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

// Paths: `spa.logo_on_dark`, `journey[welcome].image` (item id) or `journey[0].image` (index).
const SEGMENT = /^([A-Za-z_][A-Za-z0-9_]{0,63})((?:\[[A-Za-z0-9_-]{1,64}\])*)$/
type Seg = { key: string; items: string[] }
function parsePath(path: string): Seg[] | null {
  if (path.length > CRM_INLINE_LIMITS.pathChars) return null
  const segs: Seg[] = []
  for (const part of path.split('.')) {
    const m = SEGMENT.exec(part)
    if (!m) return null
    segs.push({ key: m[1]!, items: [...(m[2] ?? '').matchAll(/\[([A-Za-z0-9_-]+)\]/g)].map((x) => x[1]!) })
  }
  return segs
}

/** The design data's `contract.inline` (valid, distinct paths, at most 16, in order); [] = none. */
export function crmInlinePaths(data: unknown): string[] {
  const list = isObj(data) && isObj(data.contract) ? data.contract.inline : undefined
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const p of list) {
    if (out.length >= CRM_INLINE_LIMITS.paths) break
    if (typeof p === 'string' && !out.includes(p) && parsePath(p)) out.push(p)
  }
  return out
}

/** A list item by selector: the item whose `id` it is, else (digits) its index; -1 = none. */
function itemAt(list: unknown[], sel: string): number {
  const byId = list.findIndex((x) => isObj(x) && x.id === sel)
  if (byId >= 0) return byId
  return /^\d{1,4}$/.test(sel) && Number(sel) < list.length ? Number(sel) : -1
}

/** The value at a path (undefined = none there). */
export function crmValueAt(data: unknown, path: string): unknown {
  const segs = parsePath(path)
  if (!segs) return undefined
  let node: unknown = data
  for (const seg of segs) {
    if (!isObj(node) || !Object.hasOwn(node, seg.key)) return undefined
    node = node[seg.key]
    for (const sel of seg.items) {
      if (!Array.isArray(node)) return undefined
      const at = itemAt(node, sel)
      if (at < 0) return undefined
      node = node[at]
    }
  }
  return node
}

/** Copy-on-write set of an existing string leaf (the input is never mutated); null = no such leaf. */
function setAt(node: unknown, segs: Seg[], i: number, value: string): unknown | null {
  const seg = segs[i]!
  if (!isObj(node) || !Object.hasOwn(node, seg.key)) return null
  let child: unknown = node[seg.key]
  const trail: { list: unknown[]; at: number }[] = []
  for (const sel of seg.items) {
    if (!Array.isArray(child)) return null
    const at = itemAt(child, sel)
    if (at < 0) return null
    trail.push({ list: child, at })
    child = child[at]
  }
  let next: unknown
  if (i === segs.length - 1) {
    if (typeof child !== 'string') return null
    next = value
  } else {
    next = setAt(child, segs, i + 1, value)
    if (next === null) return null
  }
  for (let j = trail.length - 1; j >= 0; j--) {
    const { list, at } = trail[j]!
    const copy = list.slice()
    copy[at] = next
    next = copy
  }
  return { ...node, [seg.key]: next }
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const FILE_PATH = new RegExp(`^/files/(${UUID})(?:/[A-Za-z0-9._-]{1,120})?$`, 'i')
const DESIGN_PATH = /^\/designs\/([a-z0-9][a-z0-9-]{0,63})\/([A-Za-z0-9_-]{1,64}\.(?:webp|png|jpe?g|avif))$/
const FONT_PATH = /^\/designs\/([a-z0-9][a-z0-9-]{0,63})\/([A-Za-z0-9_-]{1,64}\.woff2)$/

/**
 * The path of a url on our hosts: relative, or absolute (http/https) on a host `ourHost` accepts; null = neither. No
 * query, fragment, credentials, backslashes, spaces or percent-escapes.
 */
function platformPath(url: unknown, ourHost: (host: string) => boolean): string | null {
  if (typeof url !== 'string' || url.length > 2000 || /[\s\\?#%]/.test(url)) return null
  if (url.startsWith('/') && !url.startsWith('//')) return url
  if (!/^https?:\/\/[^/@]+\//i.test(url)) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  return u.username || u.password || !ourHost(u.host.toLowerCase()) ? null : u.pathname
}

/**
 * The platform source of a picture url, or null (left as it is): `/files/{uuid}[/{name}]` or
 * `/designs/{design}/{name}.{webp|png|jpg|jpeg|avif}`, relative or absolute (http/https) on a host `ourHost` accepts
 * (the platform's domains, this spa's own). No query, fragment, credentials, backslashes or spaces; never fetched.
 */
export function crmInlineSource(url: unknown, ourHost: (host: string) => boolean): CrmInlineSource | null {
  const path = platformPath(url, ourHost)
  if (path === null) return null
  const file = FILE_PATH.exec(path)
  if (file) return { kind: 'file', id: file[1]!.toLowerCase() }
  const design = DESIGN_PATH.exec(path)
  return design ? { kind: 'design', design: design[1]!, name: design[2]! } : null
}

const ascii = (b: Uint8Array, at: number, s: string) => {
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false
  return true
}

/** The raster type the bytes are (magic numbers), or null — never SVG or anything else. */
export function sniffRasterType(b: Uint8Array): CrmRasterType | null {
  if (b.length < 12) return null
  if (b[0] === 0x89 && ascii(b, 1, 'PNG\r\n\x1a\n')) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')) return 'image/gif'
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'image/webp'
  if (ascii(b, 4, 'ftyp')) {
    // The ftyp box: major brand at 8, compatible brands from 16 to its end.
    const size = ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0
    const end = Math.min(b.length, size >= 16 ? size : 16, 256)
    for (let at = 8; at + 4 <= end; at += at === 8 ? 8 : 4)
      if (ascii(b, at, 'avif') || ascii(b, at, 'avis')) return 'image/avif'
  }
  return null
}

/** Whether the bytes are a WOFF2 font (its 'wOF2' signature; nothing else is ever inlined as a font). */
export const isWoff2 = (b: Uint8Array): boolean => b.length >= 48 && ascii(b, 0, 'wOF2')

/** One font as a data: URI (null = not WOFF2). */
export function woff2DataUri(bytes: Uint8Array): { uri: string; size: number } | null {
  if (!isWoff2(bytes)) return null
  const b64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  return { uri: `data:font/woff2;base64,${b64}`, size: bytes.byteLength }
}

/**
 * The design data's `contract.inline_fonts[locale]`: distinct strings ≤ 2000 chars, at most 16, in order; [] = none
 * for that locale (a locale that is not a key never gets fonts).
 */
export function crmInlineFontUrls(data: unknown, locale: string): string[] {
  const map = isObj(data) && isObj(data.contract) ? data.contract.inline_fonts : undefined
  const list = isObj(map) && Object.hasOwn(map, locale) ? map[locale] : undefined
  if (!Array.isArray(list)) return []
  const out: string[] = []
  for (const u of list) {
    if (out.length >= CRM_INLINE_LIMITS.fonts) break
    if (typeof u === 'string' && u.length <= CRM_INLINE_LIMITS.fontUrlChars && !out.includes(u)) out.push(u)
  }
  return out
}

/**
 * The static design file a font url names, or null (never read): `/designs/{design}/{name}.woff2`, relative or
 * absolute on a host `ourHost` accepts — the same host and form rules as crmInlineSource.
 */
export function crmInlineFontSource(
  url: unknown,
  ourHost: (host: string) => boolean,
): CrmInlineFontSource | null {
  const path = platformPath(url, ourHost)
  const m = path === null ? null : FONT_PATH.exec(path)
  return m ? { kind: 'design', design: m[1]!, name: m[2]! } : null
}

/** One picture as a data: URI (null = not a raster image). */
export function rasterDataUri(bytes: Uint8Array): { uri: string; size: number } | null {
  const type = sniffRasterType(bytes)
  if (!type) return null
  const b64 = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64')
  return { uri: `data:${type};base64,${b64}`, size: bytes.byteLength }
}

type Loaded = { uri: string; size: number } | null
/** What the loads returned within `deadlineMs` (default 300); unset = not read in time, or failed (a link this render). */
async function withinDeadline(loads: Promise<Loaded>[], deadlineMs?: number): Promise<Loaded[]> {
  const loaded: Loaded[] = []
  let timer: ReturnType<typeof setTimeout> | undefined
  await Promise.race([
    Promise.all(
      loads.map((p, i) =>
        p.then(
          (x) => {
            loaded[i] = x
          },
          () => {},
        ),
      ),
    ),
    new Promise<void>((done) => {
      timer = setTimeout(done, deadlineMs ?? CRM_INLINE_LIMITS.deadlineMs)
    }),
  ])
  clearTimeout(timer)
  return loaded
}

/**
 * The inline plan of a render's final data: for each declared path (order kept) whose value is a platform picture
 * that `load` returns within `deadlineMs` (default 300), while the running total (raw bytes, per occurrence) stays
 * ≤ 240 KB; each ≤ 80 KB. null = nothing to inline. `load` reads the bytes server-side and caches them
 * (createCrmInlineLoader): a read past the deadline keeps running and serves the next load.
 */
export async function planCrmInline(
  data: unknown,
  opts: {
    ourHost: (host: string) => boolean
    load: (src: CrmInlineSource) => Promise<{ uri: string; size: number } | null>
    deadlineMs?: number
  },
): Promise<CrmInline | null> {
  const wanted = crmInlinePaths(data).flatMap((path) => {
    const url = crmValueAt(data, path)
    const src = crmInlineSource(url, opts.ourHost)
    return src ? [{ path, url: url as string, src }] : []
  })
  if (!wanted.length) return null
  const loaded = await withinDeadline(
    wanted.map((w) => opts.load(w.src)),
    opts.deadlineMs,
  )
  const plan: CrmInline = {}
  let total = 0
  wanted.forEach((w, i) => {
    const pic = loaded[i]
    if (!pic || pic.size > CRM_INLINE_LIMITS.fileBytes || total + pic.size > CRM_INLINE_LIMITS.totalBytes)
      return
    total += pic.size
    plan[w.path] = { url: w.url, data: pic.uri }
  })
  return Object.keys(plan).length ? plan : null
}

/**
 * The data with the plan applied (copy-on-write; nothing to apply → the very same object): each declared path whose
 * value is still the plan's url becomes its data: URI, and `inline_originals` {path: url} is written (last key).
 */
export function applyCrmInline(
  data: Record<string, unknown>,
  plan: CrmInline | null | undefined,
): Record<string, unknown> {
  if (!plan) return data
  const declared = crmInlinePaths(data)
  let root = data
  const originals: Record<string, string> = {}
  for (const path of declared) {
    const p = Object.hasOwn(plan, path) ? plan[path] : undefined
    if (!p?.data.startsWith('data:image/') || crmValueAt(root, path) !== p.url) continue
    const next = setAt(root, parsePath(path)!, 0, p.data)
    if (!next) continue
    root = next as Record<string, unknown>
    originals[path] = p.url
  }
  if (root === data) return data
  const { inline_originals: _, ...rest } = root
  return { ...rest, inline_originals: originals }
}

/** A stable key of a plan for output caches (the bytes behind a url never change). */
export const crmInlineKey = (plan: CrmInline | null | undefined): string =>
  plan
    ? Object.entries(plan)
        .map(([p, x]) => `${p}=${x.url}#${x.data.length}`)
        .join('\n')
    : ''

/**
 * Decision B (owner 2026-10-14): the inline fonts of a `locale` render. Each url `contract.inline_fonts[locale]`
 * declares (order kept) that names a static design woff2 file on our hosts and that `load` returns within
 * `deadlineMs` (default 300, the pictures' deadline: run both plans together), each ≤ 150 KB while the running total
 * (raw bytes, per declared url) stays ≤ 400 KB. Keys stay exactly as declared (the design's own @font-face src).
 * null = nothing to inline (a locale that is not a key, nothing declared, or nothing read in time).
 */
export async function planCrmInlineFonts(
  data: unknown,
  locale: string,
  opts: {
    ourHost: (host: string) => boolean
    load: (src: CrmInlineFontSource) => Promise<{ uri: string; size: number } | null>
    deadlineMs?: number
  },
): Promise<CrmInlineFonts | null> {
  const wanted = crmInlineFontUrls(data, locale).flatMap((url) => {
    const src = crmInlineFontSource(url, opts.ourHost)
    return src ? [{ url, src }] : []
  })
  if (!wanted.length) return null
  const loaded = await withinDeadline(
    wanted.map((w) => opts.load(w.src)),
    opts.deadlineMs,
  )
  const fonts: CrmInlineFonts = {}
  let total = 0
  wanted.forEach((w, i) => {
    const font = loaded[i]
    if (
      !font?.uri.startsWith(WOFF2_URI) ||
      font.size > CRM_INLINE_LIMITS.fontBytes ||
      total + font.size > CRM_INLINE_LIMITS.fontTotalBytes
    )
      return
    total += font.size
    fonts[w.url] = font.uri
  })
  return Object.keys(fonts).length ? fonts : null
}

const WOFF2_URI = 'data:font/woff2;base64,'

/**
 * The data with the reserved `inline_fonts` {url: data: URI} set from the plan's woff2 data URIs (last key; a value
 * the data had there is replaced). Nothing to apply → the very same object.
 */
export function applyCrmInlineFonts(
  data: Record<string, unknown>,
  fonts: CrmInlineFonts | null | undefined,
): Record<string, unknown> {
  const ok = Object.entries(fonts ?? {}).filter(([, uri]) => uri.startsWith(WOFF2_URI))
  if (!ok.length) return data
  const { inline_fonts: _, ...rest } = data
  return { ...rest, inline_fonts: Object.fromEntries(ok) }
}

/** A stable key of a font plan for output caches (design font files are hashed: the bytes behind a url never change). */
export const crmInlineFontsKey = (fonts: CrmInlineFonts | null | undefined): string =>
  fonts
    ? Object.entries(fonts)
        .map(([url, uri]) => `${url}#${uri.length}`)
        .join('\n')
    : ''

/**
 * A process-wide, size-bounded (LRU) loader of inline pictures, and fonts (`loadFont`: the same cache and cap). File ids are scoped to the spa that asks
 * (`scope`), so one spa's cached bytes never answer another's; design files are shared. A miss (not found, not
 * public, not raster, too big) is remembered for `missTtlMs` only, a read error for `errorTtlMs`; concurrent loads
 * of one key share one read, and the file loads of one tick for one spa are read together (one `readFiles` call).
 */
export function createCrmInlineLoader(o: {
  /**
   * The spa's own public, raster stored files, each at most `max` bytes: id → bytes (or their pending download;
   * missing / null = none, ideally without downloading).
   */
  readFiles: (
    scope: string,
    ids: string[],
    max: number,
  ) => Promise<Map<string, Uint8Array | null | Promise<Uint8Array | null>>>
  /** A static design file (public/designs/{design}/{name}: a picture or a woff2 font), at most `max` bytes. */
  readDesign: (design: string, name: string, max: number) => Promise<Uint8Array | null>
  maxBytes?: number
  missTtlMs?: number
  errorTtlMs?: number
  now?: () => number
}) {
  const maxBytes = o.maxBytes ?? 32 * 1024 * 1024
  const missTtl = o.missTtlMs ?? 60_000
  const errorTtl = o.errorTtlMs ?? 30_000
  const now = o.now ?? Date.now
  type Entry = { pic: { uri: string; size: number } | null; cost: number; until: number }
  const map = new Map<string, Entry>()
  const flight = new Map<string, Promise<{ uri: string; size: number } | null>>()
  let total = 0
  const drop = (k: string) => {
    const e = map.get(k)
    if (!e) return
    map.delete(k)
    total -= e.cost
  }
  const put = (k: string, pic: Entry['pic'], ttl = missTtl) => {
    drop(k)
    const cost = pic ? pic.uri.length : 64
    if (cost > maxBytes) return
    map.set(k, { pic, cost, until: pic ? Number.POSITIVE_INFINITY : now() + ttl })
    total += cost
    for (const [key, e] of map) {
      if (total <= maxBytes) break
      map.delete(key)
      total -= e.cost
    }
  }
  // One spa's file loads of this tick → one readFiles call (one tenant transaction).
  type Waiter = {
    resolve: (v: Uint8Array | null | Promise<Uint8Array | null>) => void
    reject: (e: unknown) => void
  }
  const batches = new Map<string, Map<string, Waiter>>()
  const readFile = (scope: string, id: string, max: number) =>
    new Promise<Uint8Array | null>((resolve, reject) => {
      let batch = batches.get(scope)
      if (!batch) {
        const mine = new Map<string, Waiter>()
        batch = mine
        batches.set(scope, mine)
        queueMicrotask(() => {
          batches.delete(scope)
          ;(async () => o.readFiles(scope, [...mine.keys()], max))().then(
            (got) => {
              for (const [id, w] of mine) w.resolve(got.get(id) ?? null)
            },
            (e) => {
              for (const w of mine.values()) w.reject(e)
            },
          )
        })
      }
      batch.set(id, { resolve, reject })
    })
  const cached = (
    key: string,
    max: number,
    read: () => Promise<Uint8Array | null>,
    encode: (bytes: Uint8Array) => Entry['pic'],
  ) => {
    const hit = map.get(key)
    if (hit && hit.until > now()) {
      map.delete(key)
      map.set(key, hit)
      return Promise.resolve(hit.pic)
    }
    const running = flight.get(key)
    if (running) return running
    const p = (async () => {
      try {
        const bytes = await read()
        const pic = bytes && bytes.byteLength <= max ? encode(bytes) : null
        put(key, pic)
        return pic
      } catch {
        put(key, null, errorTtl) // a read error (storage down): retried after errorTtl, not on every request
        return null
      } finally {
        flight.delete(key)
      }
    })()
    flight.set(key, p)
    return p
  }
  const load = (scope: string, src: CrmInlineSource) => {
    const max = CRM_INLINE_LIMITS.fileBytes
    return src.kind === 'file'
      ? cached(`f:${scope}:${src.id}`, max, () => readFile(scope, src.id, max), rasterDataUri)
      : cached(
          `d:${src.design}/${src.name}`,
          max,
          () => o.readDesign(src.design, src.name, max),
          rasterDataUri,
        )
  }
  /** A static design font (woff2 only, ≤ 150 KB), shared by every spa like the design pictures. */
  const loadFont = (src: CrmInlineFontSource) => {
    const max = CRM_INLINE_LIMITS.fontBytes
    return cached(
      `w:${src.design}/${src.name}`,
      max,
      () => o.readDesign(src.design, src.name, max),
      woff2DataUri,
    )
  }
  const clear = () => {
    map.clear()
    total = 0
  }
  return { load, loadFont, size: () => total, entries: () => map.size, clear }
}

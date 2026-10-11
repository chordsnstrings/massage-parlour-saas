/**
 * Uploaded HTML designs (R17, R24): pure string transforms run before a design is shown. Nothing here executes the
 * design. R24 owner rule: a design renders EXACTLY as the file opened in a browser — only invisible additions (compat
 * shim, link handling in frames, placeholders where written). The old phone fixes are an explicit per-design opt-in:
 *  - `fixHtmlDesign` + viewport + `HTML_DESIGN_BASE_CSS`: only when the design's "Phone fixes" switch is on
 *    (`phoneFixes`; designs stored before R24 have no flag and keep them, `htmlDesignPhoneFixes`).
 *  - the super-admin's per-image adjustments (focal point, fill/fit, replacement): explicit owner action, always applied.
 */

export type HtmlDesignImage = {
  /** `img-<n>` = n-th `<img>`, `bg-<n>` = n-th CSS background image (style blocks + inline styles). */
  id: string
  kind: 'img' | 'bg'
  src: string
}

export type HtmlImageAdjust = {
  id: string
  /** The image's original src (first 300 chars); an adjustment whose id now points at another image is ignored. */
  src: string
  fit?: 'cover' | 'contain'
  /** Focal point in percent (0–100). */
  x?: number
  y?: number
  /** Replacement image URL (stored file or https URL). */
  replace?: string
  /** `<img>` only: put the image back inside the screen at the left / centre / right (undoes floats, offsets). */
  align?: 'left' | 'center' | 'right'
}

const ALIGN_MARGINS = { left: '0 auto 0 0', center: '0 auto', right: '0 0 0 auto' } as const

export const HTML_IMAGE_ID = /^(?:img|bg)-\d{1,4}$/
/** Safe to put in a CSS `url()` and an attribute: absolute https/http or a site path, no quotes/parens/spaces. */
export const HTML_IMAGE_URL = /^(?:https?:\/\/|\/(?!\/))[^\s"'()<>\\`]{1,2000}$/i
export const MAX_HTML_IMAGES = 200
/** Stored/compared prefix of an image's src (data: URIs can be huge). */
export const HTML_IMAGE_SRC_MAX = 300
const srcKey = (s: string) => s.slice(0, HTML_IMAGE_SRC_MAX)

/** Phone fixes only: responsive defaults, zero specificity (`:where`) so any rule the design sets itself wins. */
export const HTML_DESIGN_BASE_CSS =
  ':where(html,body){max-width:100%;overflow-x:clip}' +
  ':where(img,picture,video,canvas,svg,iframe){max-width:100%}' +
  ':where(img,video){height:auto}' +
  ':where(img){object-fit:cover;object-position:50% 50%}'
/** Only when an `{{address}}` link was spliced in: the link looks like the text it replaces. */
export const HTML_DESIGN_MAP_CSS =
  ':where(a[data-spa-map]){color:inherit;text-decoration:none}' +
  ':where(a[data-spa-map]:hover){text-decoration:underline}'

/** Largest design (UTF-8 bytes) uploaded or sent by the connector; stored byte for byte as a file (R24). */
export const MAX_HTML_UPLOAD_BYTES = 5 * 1024 * 1024

/**
 * R24 (review): where a design document lives. Every design written since is a file — a spa's: its own PRIVATE
 * stored file (purpose `html_design_doc`), a template's: `site_template_files` — and the HtmlDesign block keeps this
 * reference in `props.doc` with `props.html` = '' (renderers fill `html` from the file right before rendering; designs
 * stored before keep their html inline). Content-addressed: a changed design is a new file, so page versions, undo
 * and copies never share bytes that change.
 */
export type HtmlDesignDoc = { file: string; sha256: string; bytes: number; chars: number }

/** The block's design file reference, or null (inline / legacy design). */
export function htmlDesignDocOf(props: Record<string, unknown> | null | undefined): HtmlDesignDoc | null {
  const d = props?.doc as Partial<HtmlDesignDoc> | null | undefined
  return d &&
    typeof d.file === 'string' &&
    typeof d.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(d.sha256) &&
    typeof d.bytes === 'number' &&
    typeof d.chars === 'number'
    ? { file: d.file, sha256: d.sha256, bytes: d.bytes, chars: d.chars }
    : null
}

/** windows-1252 bytes 0x80–0x9F (WHATWG index; the five unassigned ones map to themselves). */
const CP1252 = '€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ'

/**
 * The text of an uploaded .html file as a browser opening it would read it (WHATWG encoding sniffing, simplified):
 * a BOM, else a `<meta charset>` / http-equiv charset in the first 1024 bytes (UTF-16 labels mean UTF-8 there), else
 * UTF-8 when the bytes are valid UTF-8 (browsers detect it for local files), else windows-1252. The result is served
 * as UTF-8 with an explicit charset header, which outranks the design's own <meta>, so it reads exactly as the file.
 */
export function decodeHtmlBytes(bytes: Uint8Array): { html: string; encoding: string } {
  const decode = (label: string, fatal = false) => {
    try {
      const d = new TextDecoder(label, { fatal })
      const html = d.decode(bytes)
      // Some runtimes (Node 22) decode windows-1252 as ISO-8859-1: 0x80–0x9F come out as C1 controls.
      return {
        html:
          d.encoding === 'windows-1252'
            ? html.replace(/[\u0080-\u009f]/g, (c) => CP1252[c.charCodeAt(0) - 0x80]!)
            : html,
        encoding: d.encoding,
      }
    } catch {
      return null
    }
  }
  const [a, b, c] = bytes
  const bom =
    a === 0xef && b === 0xbb && c === 0xbf
      ? 'utf-8'
      : a === 0xfe && b === 0xff
        ? 'utf-16be'
        : a === 0xff && b === 0xfe
          ? 'utf-16le'
          : null
  if (bom) return decode(bom)!
  let head = ''
  for (const x of bytes.subarray(0, 1024)) head += String.fromCharCode(x)
  const meta = /<meta\b[^>]*?\bcharset\s*=\s*["']?\s*([^\s"'>;/]+)/i.exec(
    head.replace(/<!--[\s\S]*?-->/g, ''),
  )
  if (meta) {
    const label = meta[1]!.toLowerCase()
    const declared =
      /^(?:utf-16|utf-16be|utf-16le|unicodefffe|unicodefeff|csunicode|iso-10646-ucs-2|ucs-2|unicode)$/.test(
        label,
      )
        ? 'utf-8'
        : label === 'x-user-defined'
          ? 'windows-1252'
          : label
    const r = decode(declared)
    if (r) return r
  }
  return decode('utf-8', true) ?? decode('windows-1252')!
}

/**
 * R24 review: a design uploaded before R24 had the old phone fixes (viewport meta, fluid image widths) saved INTO its
 * html, so switching Phone fixes off can't show the original file — only uploading it again can. Such a design has no
 * switch value (or `bakedFixes: true`, kept once the switch was used).
 */
export const htmlDesignBakedFixes = (props: Record<string, unknown> | null | undefined) =>
  props?.bakedFixes === true || (props?.phoneFixes === undefined && !htmlDesignDocOf(props))

/** A design's "Phone fixes" switch: absent (stored before R24) = on, as those designs always had them. */
export const htmlDesignPhoneFixes = (props: { phoneFixes?: unknown } | null | undefined) =>
  props?.phoneFixes !== false

/**
 * Compat shim (R24), first in <head>: designs run in an opaque origin (sandbox without allow-same-origin), where
 * `localStorage` / `sessionStorage` / `document.cookie` throw. Only when they throw, they become in-memory versions,
 * so the design's code behaves as when the file is opened directly. Nothing visible is touched.
 */
export const HTML_DESIGN_COMPAT_SHIM =
  '(()=>{const mem=()=>{const m=new Map(),api={getItem:(k)=>{k=String(k);return m.has(k)?m.get(k):null},setItem:(k,v)=>{m.set(String(k),String(v))},removeItem:(k)=>{m.delete(String(k))},clear:()=>{m.clear()},key:(i)=>{const a=[...m.keys()];return a[i]??null}};' +
  "return new Proxy(api,{get:(t,p)=>p==='length'?m.size:typeof p==='symbol'||p in t?t[p]:m.has(p)?m.get(p):undefined,set:(t,p,v)=>{if(typeof p==='string'&&!(p in t)&&p!=='length')m.set(p,String(v));return true},has:(t,p)=>p in t||m.has(p),deleteProperty:(t,p)=>{m.delete(p);return true},ownKeys:()=>[...m.keys()],getOwnPropertyDescriptor:(t,p)=>m.has(p)?{value:m.get(p),writable:true,enumerable:true,configurable:true}:undefined})};" +
  "for(const n of ['localStorage','sessionStorage']){try{window[n].length;continue}catch{}try{Object.defineProperty(window,n,{value:mem(),configurable:true,enumerable:true})}catch{}}" +
  "try{document.cookie}catch{const jar=new Map();try{Object.defineProperty(document,'cookie',{configurable:true,enumerable:true,get:()=>[...jar].map(([k,v])=>k?k+'='+v:v).join('; '),set:(s)=>{const [kv,...attrs]=String(s).split(';');const i=kv.indexOf('=');const k=(i<0?'':kv.slice(0,i)).trim(),v=(i<0?kv:kv.slice(i+1)).trim();" +
  "const gone=attrs.some((a)=>{const [n,...r]=a.split('=');const x=n.trim().toLowerCase(),y=r.join('=').trim();return x==='max-age'?Number(y)<=0:x==='expires'?Date.parse(y)<Date.now():false});if(gone)jar.delete(k);else jar.set(k,v)}})}catch{}}})()"

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">'
/** Narrowest screen the platform supports; a fixed image width above it overflows phones. */
const PHONE_PX = 360

type Range = [number, number]
type Edit = { at: number; end: number; text: string }

/** Script bodies and comments: images "found" there are not part of the page. */
function skipRanges(html: string): Range[] {
  const out: Range[] = []
  const re = /<script\b[\s\S]*?(?:<\/script\s*>|$)|<!--[\s\S]*?(?:-->|$)/gi
  for (const m of html.matchAll(re)) out.push([m.index, m.index + m[0].length])
  return out
}
const inside = (ranges: Range[], i: number) => ranges.some(([a, b]) => i >= a && i < b)

const decode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()

type ImgHit = { id: string; src: string; tagStart: number; tagEnd: number; tag: string }
type BgHit = { id: string; src: string; urlStart: number; urlEnd: number; declEnd: number }

// `&quot;` / `&#39;` need no alternatives of their own (the class already takes them: overlapping alternatives
// backtrack exponentially); the closing `\s*` sits inside each branch so two `\s*` never meet, and an unquoted url
// can't hold `(` (invalid CSS), so `url(url(…` can't rescan (both quadratic).
const URL_RE = /url\(\s*(?:"([^"]*)"\s*|'([^']*)'\s*|([^()'"\s]+)\s*)?\)/gi
const BG_PROP = /(?:^|[;{\s"'])background(?:-image)?\s*:[^;{}]*$/i

/** Background `url()`s inside one CSS text (style block body or style attribute value), absolute offsets. */
function cssBackgrounds(css: string, offset: number, endChars: string, out: Omit<BgHit, 'id'>[]) {
  for (const m of css.matchAll(URL_RE)) {
    const before = css.slice(Math.max(0, m.index - 400), m.index)
    if (!BG_PROP.test(before)) continue
    const raw = m[1] ?? m[2] ?? m[3] ?? ''
    const src = decode(raw.replace(/^(?:&quot;|&#39;)|(?:&quot;|&#39;)$/g, ''))
    if (!src || /(?:^data:font)|(?:\.(?:woff2?|ttf|otf|eot)(?:[?#]|$))/i.test(src)) continue
    let declEnd = m.index + m[0].length
    while (declEnd < css.length && !endChars.includes(css[declEnd]!)) declEnd++
    out.push({
      src,
      urlStart: offset + m.index,
      urlEnd: offset + m.index + m[0].length,
      declEnd: offset + declEnd,
    })
  }
}

function scan(html: string): { imgs: ImgHit[]; bgs: BgHit[] } {
  const skip = skipRanges(html)
  const imgs: ImgHit[] = []
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (inside(skip, m.index)) continue
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[0])
    imgs.push({
      id: `img-${imgs.length}`,
      src: decode(src?.[1] ?? src?.[2] ?? src?.[3] ?? ''),
      tagStart: m.index,
      tagEnd: m.index + m[0].length,
      tag: m[0],
    })
  }
  const found: Omit<BgHit, 'id'>[] = []
  for (const m of html.matchAll(/(<style\b[^>]*>)([\s\S]*?)<\/style\s*>/gi)) {
    if (inside(skip, m.index)) continue
    cssBackgrounds(m[2]!, m.index + m[1]!.length, ';}', found)
  }
  for (const m of html.matchAll(/<[a-z][\w-]*\b[^>]*?\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    if (inside(skip, m.index) || /^<style\b/i.test(m[0])) continue
    const value = m[1] ?? m[2] ?? ''
    const start = m.index + m[0].length - 1 - value.length
    cssBackgrounds(value, start, ';', found)
  }
  found.sort((a, b) => a.urlStart - b.urlStart)
  return { imgs, bgs: found.map((b, i) => ({ ...b, id: `bg-${i}` })) }
}

/** Every image the design shows, in document order (the ids adjustments are keyed by). */
export function listHtmlDesignImages(html: string): HtmlDesignImage[] {
  const { imgs, bgs } = scan(html)
  return [
    ...imgs.map((i) => ({ id: i.id, kind: 'img' as const, src: i.src })),
    ...bgs.map((b) => ({ id: b.id, kind: 'bg' as const, src: b.src })),
  ].slice(0, MAX_HTML_IMAGES)
}

function applyEdits(html: string, edits: Edit[]) {
  let out = ''
  let pos = 0
  for (const e of [...edits].sort((a, b) => a.at - b.at || a.end - b.end)) {
    if (e.at < pos) continue
    out += html.slice(pos, e.at) + e.text
    pos = e.end
  }
  return out + html.slice(pos)
}

/** Index right after the first of <head>, <html>, <!doctype>, or 0. */
function headIndex(html: string) {
  for (const tag of [/<head\b/i, /<html\b/i, /<!doctype/i]) {
    // The tag's first `>` by indexOf, not `[^>]*>` (rescans to the end from every start when a `>` is missing).
    const at = html.search(tag)
    const end = at < 0 ? -1 : html.indexOf('>', at)
    if (end >= 0) return end + 1
  }
  return 0
}

/** Inserts `text` right after the first of <head>, <html>, <!doctype>, or at the start. */
function insertAtHead(html: string, text: string) {
  const at = headIndex(html)
  return html.slice(0, at) + text + html.slice(at)
}

/**
 * F10: designs run in a shell document (`HTML_DESIGN_FRAME_PATH`) instead of `srcdoc`, so relative links would resolve
 * against the shell's URL. A `<base>` with the hosting page's URL keeps them as before (a design's own <base> wins).
 */
export function withBaseHref(html: string, href: string): string {
  if (/<base\b[^>]*\bhref\s*=/i.test(html)) return html
  const safe = href.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return insertAtHead(html, `<base href="${safe}">`)
}

const hasViewport = (html: string) => /<meta\b[^>]*\bname\s*=\s*["']?viewport\b/i.test(html)

export type HtmlDesignFix = 'viewport' | 'wide-image'

/** Phone fix: inline img `width:Npx` (and `min-width`) above the phone width become `width:100%;max-width:Npx`. */
function fluidImages(html: string): { html: string; changed: boolean } {
  const edits: Edit[] = []
  for (const img of scan(html).imgs) {
    const style = /(\sstyle\s*=\s*)(?:"([^"]*)"|'([^']*)')/i.exec(img.tag)
    if (!style) continue
    const value = style[2] ?? style[3] ?? ''
    const fixed = value
      .replace(/(^|;)\s*min-width\s*:\s*(\d+(?:\.\d+)?)px\s*(?=;|$)/gi, (m, p: string, n: string) =>
        Number(n) > PHONE_PX ? p : m,
      )
      .replace(/(^|;)(\s*)width\s*:\s*(\d+(?:\.\d+)?)px/gi, (m, p: string, sp: string, n: string) =>
        Number(n) > PHONE_PX ? `${p}${sp}width:100%;max-width:${n}px` : m,
      )
    if (fixed === value) continue
    const q = style[2] !== undefined ? '"' : "'"
    const at = img.tagStart + style.index
    edits.push({ at, end: at + style[0].length, text: `${style[1]}${q}${fixed}${q}` })
  }
  return { html: applyEdits(html, edits), changed: edits.length > 0 }
}

/** The phone fixes ("Phone fixes" switch): a missing viewport meta, fluid wide images; returns what was changed. */
export function fixHtmlDesign(html: string): { html: string; fixes: HtmlDesignFix[] } {
  const fixes = new Set<HtmlDesignFix>()
  const fluid = fluidImages(html)
  if (fluid.changed) fixes.add('wide-image')
  let out = fluid.html
  if (!hasViewport(out)) {
    out = insertAtHead(out, VIEWPORT)
    fixes.add('viewport')
  }
  return { html: out, fixes: [...fixes] }
}

const pct = (n: number | undefined) => {
  const v = Number.isFinite(n) ? Math.min(100, Math.max(0, Number(n))) : 50
  return `${Math.round(v * 10) / 10}%`
}

/** CSS / attribute edits for the adjustments whose id still points at the same image. */
function adjustmentEdits(html: string, adjust: HtmlImageAdjust[]) {
  const byId = new Map(adjust.filter((a) => HTML_IMAGE_ID.test(a.id)).map((a) => [a.id, a]))
  const { imgs, bgs } = scan(html)
  const edits: Edit[] = []
  const rules: string[] = []
  for (const img of imgs) {
    const a = byId.get(img.id)
    if (!a || a.src !== srcKey(img.src)) continue
    const n = img.id.slice(4)
    let tag = img.tag.replace(/^<img\b/i, `<img data-spa-img="${n}"`)
    if (a.replace && HTML_IMAGE_URL.test(a.replace)) {
      // A replaced image must not come back through srcset.
      tag = tag.replace(/\s(?:srcset|sizes)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      tag = /\ssrc\s*=/i.test(tag)
        ? tag.replace(/(\ssrc\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, `$1"${a.replace}"`)
        : tag.replace(/^<img\b/i, `<img src="${a.replace}"`)
    }
    edits.push({ at: img.tagStart, end: img.tagEnd, text: tag })
    const align = a.align && ALIGN_MARGINS[a.align]
    rules.push(
      `[data-spa-img="${n}"]{object-fit:${a.fit === 'contain' ? 'contain' : 'cover'}!important;object-position:${pct(a.x)} ${pct(a.y)}!important${
        align
          ? `;display:block!important;float:none!important;max-width:100%!important;margin:${align}!important;position:relative!important;inset:auto!important;translate:none!important`
          : ''
      }}`,
    )
  }
  for (const bg of bgs) {
    const a = byId.get(bg.id)
    if (!a || a.src !== srcKey(bg.src)) continue
    if (a.replace && HTML_IMAGE_URL.test(a.replace))
      edits.push({ at: bg.urlStart, end: bg.urlEnd, text: `url(${a.replace})` })
    const contain = a.fit === 'contain'
    edits.push({
      at: bg.declEnd,
      end: bg.declEnd,
      text: `;background-position:${pct(a.x)} ${pct(a.y)} !important;background-size:${contain ? 'contain' : 'cover'} !important${contain ? ';background-repeat:no-repeat !important' : ''}`,
    })
  }
  return { edits, css: rules.join('') }
}

/** Applies adjustments to the file (no base sheet / scripts): what the adjuster previews and tests compare. */
export function applyHtmlImageAdjustments(html: string, adjust: HtmlImageAdjust[] = []) {
  const { edits, css } = adjustmentEdits(html, adjust)
  const out = applyEdits(html, edits)
  if (!css) return out
  const style = `<style data-spa-images>${css}</style>`
  const end = /<\/body\s*>(?![\s\S]*<\/body\s*>)/i.exec(out)
  return end ? out.slice(0, end.index) + style + out.slice(end.index) : out + style
}

// Backslash and backtick too: a value ending in a backslash must not escape a design's closing JS/CSS quote.
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"'\\`]/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '\\': '&#92;', '`': '&#96;' })[
        c
      ]!,
  )

/** A placeholder that renders as a link when it stands in text (e.g. `{{address}}` → its Google Maps pin). */
export type HtmlDesignLink = { href: string | null; label: string }

/** Only plain http(s) links of RFC 3986 characters are spliced in as markup. */
const SAFE_HREF = /^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/
/** Raw-text / RCDATA elements (or content never shown) and elements an `<a>` must not nest in. */
const RAW_TEXT = new Set([
  'script',
  'style',
  'title',
  'textarea',
  'xmp',
  'plaintext',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
])
const NO_LINK = new Set(['a', 'select', 'button'])
const isWs = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r'

/** Index just past the `>` ending a tag whose attributes start at `j`; quoted values may hold `>`. */
export function tagEnd(src: string, j: number) {
  const n = src.length
  while (j < n) {
    const c = src[j]
    if (c === '>') return j + 1
    j++
    if (isWs(c) || c === '/') continue
    // attribute name (its first character may be '=')
    while (j < n && !isWs(src[j]) && src[j] !== '/' && src[j] !== '>' && src[j] !== '=') j++
    while (isWs(src[j])) j++
    if (src[j] !== '=') continue
    j++
    while (isWs(src[j])) j++
    const q = src[j]
    if (q === '"' || q === "'") {
      const close = src.indexOf(q, j + 1)
      if (close === -1) return n
      j = close + 1
    } else while (j < n && !isWs(src[j]) && src[j] !== '>') j++
  }
  return n
}

export type HtmlAttr = { name: string; start: number; end: number }

/**
 * Attributes of a tag whose attributes start at `j` (same tokenizing as `tagEnd`); value ranges exclude the quotes,
 * `start` = -1 for an attribute without a value. The parser keeps the first of duplicate attributes, so do we.
 */
export function attributesOf(src: string, j: number): HtmlAttr[] {
  const out: HtmlAttr[] = []
  const n = src.length
  while (j < n) {
    const c = src[j]
    if (c === '>') break
    if (isWs(c) || c === '/') {
      j++
      continue
    }
    const ns = j
    j++
    while (j < n && !isWs(src[j]) && src[j] !== '/' && src[j] !== '>' && src[j] !== '=') j++
    const name = src.slice(ns, j).toLowerCase()
    let k = j
    while (isWs(src[k])) k++
    if (src[k] !== '=') {
      out.push({ name, start: -1, end: -1 })
      continue
    }
    k++
    while (isWs(src[k])) k++
    const q = src[k]
    if (q === '"' || q === "'") {
      const close = src.indexOf(q, k + 1)
      if (close === -1) break
      out.push({ name, start: k + 1, end: close })
      j = close + 1
    } else {
      const vs = k
      while (k < n && !isWs(src[k]) && src[k] !== '>') k++
      out.push({ name, start: vs, end: k })
      j = k
    }
  }
  const seen = new Set<string>()
  return out.filter((a) => !seen.has(a.name) && seen.add(a.name))
}

/**
 * How a `{{placeholder}}` at a position is filled (R24 review): `link` = plain page text (`{{address}}` may become a
 * maps link), `js` = a JavaScript / JSON script body (the value as JS-string text), `jsattr` = an `on…` handler
 * attribute (JS-string text, then HTML-escaped), `css` = a <style> body (CSS-string text), `skip` = never filled
 * (comments, doctypes, client-side templates in `<script type="text/x-…">` and other non-JS script types). Anything
 * else (attribute values, title/textarea, text inside <a>/<select>/<button>) = the HTML-escaped value.
 */
type FillCtx = 'link' | 'js' | 'jsattr' | 'css' | 'skip'

/** Script types whose body is JavaScript or JSON (JSX / TypeScript for in-browser transpilers too). */
const JS_SCRIPT =
  /^(?:|module|importmap|speculationrules|text\/(?:javascript|ecmascript|jscript|livescript|babel|jsx|typescript)|application\/(?:javascript|ecmascript|x-javascript|x-ecmascript|json|[\w.-]+\+json))$/

const attrValue = (src: string, a: HtmlAttr | undefined) =>
  a && a.start >= 0 ? decode(src.slice(a.start, a.end)) : ''

/**
 * `[start, end, ctx]` spans of the document in order (tokenized quote-aware like the HTML parser: `>` inside an
 * attribute value doesn't end a tag); positions outside every span are the default (HTML-escaped value).
 */
function fillSpans(src: string): Array<[number, number, FillCtx]> {
  const spans: Array<[number, number, FillCtx]> = []
  const open = new Map<string, number>()
  const n = src.length
  let text = 0
  let i = 0
  const endText = (at: number) => {
    if (at > text && ![...open.values()].some(Boolean)) spans.push([text, at, 'link'])
  }
  const tagRe = /<(\/?)([a-z][^\t\n\f\r />]*)/iy
  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt === -1) break
    const next = src[lt + 1] ?? ''
    if (src.startsWith('<!--', lt)) {
      endText(lt)
      const close = /--!?>/g
      close.lastIndex = lt + 2
      const m = close.exec(src)
      i = text = m ? m.index + m[0].length : n
      spans.push([lt, i, 'skip'])
      continue
    }
    tagRe.lastIndex = lt
    const tag = tagRe.exec(src)
    if (!tag) {
      if (next === '!' || next === '?' || next === '/') {
        // doctype / bogus comment: up to the next '>'
        endText(lt)
        const gt = src.indexOf('>', lt + 2)
        i = text = gt === -1 ? n : gt + 1
        spans.push([lt, i, 'skip'])
      } else i = lt + 1 // a literal '<' in text
      continue
    }
    endText(lt)
    const name = tag[2]!.toLowerCase()
    const nameEnd = lt + tag[0].length
    const attrs = tag[1] ? [] : attributesOf(src, nameEnd)
    for (const a of attrs) if (a.start >= 0 && a.name.startsWith('on')) spans.push([a.start, a.end, 'jsattr'])
    i = text = tagEnd(src, nameEnd)
    if (NO_LINK.has(name)) open.set(name, Math.max(0, (open.get(name) ?? 0) + (tag[1] ? -1 : 1)))
    if (tag[1] || !RAW_TEXT.has(name)) continue
    if (name === 'plaintext') return spans // the rest of the document is raw text
    const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, 'gi')
    close.lastIndex = i
    const stop = close.exec(src)?.index ?? n
    if (name === 'script') {
      const type = attrValue(
        src,
        attrs.find((a) => a.name === 'type'),
      )
        .toLowerCase()
        .split(';')[0]!
        .trim()
      spans.push([i, stop, JS_SCRIPT.test(type) ? 'js' : 'skip'])
    } else if (name === 'style') spans.push([i, stop, 'css'])
    i = text = stop
  }
  endText(n)
  return spans
}

/** Escapes every character `special` accepts (and every control character) as `esc(code)`. */
function escapeChars(s: string, special: string, esc: (code: number) => string) {
  let out = ''
  for (const c of s) {
    const n = c.charCodeAt(0)
    out += n < 0x20 || special.includes(c) ? esc(n) : c
  }
  return out
}
/** The value as the text of a JS (or JSON) string literal of any quote style; never ends a <script>. */
const jsText = (s: string) =>
  escapeChars(s, '\\"\'`$<>&\u2028\u2029', (n) =>
    n === 92 ? '\\\\' : `\\u${n.toString(16).padStart(4, '0')}`,
  )
/** The value as the text of a CSS string (hex escapes); never ends a <style>. */
const cssText = (s: string) => escapeChars(s, '\\"\'<>&', (n) => `\\${n.toString(16)} `)

/** Hosts of embeds the design's sandbox inherits (they run in an opaque origin too): see htmlDesignEmbedHosts. */
const EMBED_SCRIPT_HOST =
  /(?:^|\.)(?:youtube\.com|youtube-nocookie\.com|vimeo\.com|calendly\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|facebook\.net|elfsight\.com|typeform\.com|maps\.googleapis\.com)$/i

/**
 * Where the design embeds another page or player: hosts of `<iframe src>`, `<embed src>`, `<object data>` (`this site`
 * for relative ones) and of widget scripts that create such frames (YouTube / Vimeo / Calendly / Instagram …). On spa
 * sites these run inside the design's sandbox (opaque origin: no cookies or storage), where many players and widgets
 * stay blank — the upload and connector results say so. data: / srcdoc frames work and are not listed.
 */
export function htmlDesignEmbedHosts(html: string): string[] {
  const hosts = new Set<string>()
  const spans = fillSpans(html).filter((sp) => sp[2] !== 'link' && sp[2] !== 'jsattr')
  let k = 0
  for (const m of html.matchAll(/<(iframe|embed|object|script)\b/gi)) {
    while (k < spans.length && spans[k]![1] <= m.index) k++
    if (k < spans.length && spans[k]![0] <= m.index) continue
    const name = m[1]!.toLowerCase()
    const attrs = attributesOf(html, m.index + m[0].length)
    const url = attrValue(
      html,
      attrs.find((a) => a.name === (name === 'object' ? 'data' : 'src')),
    )
    if (!url || /^(?:data:|about:|blob:|javascript:)/i.test(url)) continue
    let host: string
    try {
      const u = new URL(url, 'https://this.site/')
      if (u.protocol !== 'https:' && u.protocol !== 'http:') continue
      host = u.host === 'this.site' ? 'this site' : u.hostname.toLowerCase()
    } catch {
      continue
    }
    if (name === 'script' && !EMBED_SCRIPT_HOST.test(host)) continue
    hosts.add(host)
  }
  return [...hosts]
}

/** The warning shown after an upload / connector write that embeds other pages or players (null when none). */
export function htmlDesignEmbedWarning(hosts: string[]): string | null {
  if (!hosts.length) return null
  const list = hosts.slice(0, 5).join(', ') + (hosts.length > 5 ? ` and ${hosts.length - 5} more` : '')
  return `It embeds pages or players from ${list}. On spa sites they run inside the design's sandbox (no cookies or storage), where many video players, maps and booking widgets stay blank — check the preview; a plain link to them always works.`
}

const linkHtml = (text: string, link: HtmlDesignLink) =>
  `<a href="${escapeHtml(link.href!)}" target="_blank" rel="noopener" title="${escapeHtml(link.label)}" aria-label="${escapeHtml(`${text} (${link.label})`)}" data-spa-map>${escapeHtml(text)}</a>`

export type HtmlDesignRender = {
  /** The design's "Phone fixes" switch (`htmlDesignPhoneFixes`): viewport + base sheet + fluid wide images. */
  phoneFixes?: boolean
  /** The live page served as the design document itself (no frame): no frame link handling. */
  top?: boolean
}

/** Frame mode only: link handling of the design shell (see htmlDesignDocument). */
const linkScript = (inert: boolean, exact: boolean) =>
  `<script>(()=>{const inert=${inert},exact=${exact};const link=(e)=>e.target instanceof Element&&e.target.closest('a[href]');` +
  // `#x` resolves against the <base> (the hosting page), which would load that page in the frame: a fragment
  // navigation of the frame document itself instead (scroll-behavior, :target, hashchange, repeated clicks).
  `const hash=(e,h)=>{e.preventDefault();location.assign(location.href.split('#')[0]+h)};` +
  `if(inert){document.addEventListener('click',(e)=>{const a=link(e);if(!a)return;const h=a.getAttribute('href')||'';if(h.startsWith('#'))return hash(e,h);e.preventDefault()},true);return}` +
  `addEventListener('click',(e)=>{if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=link(e);if(!a)return;const h=a.getAttribute('href')||'';if(h.startsWith('#'))return hash(e,h);if(a.getAttribute('target')||/^javascript:/i.test(h))return;` +
  `if(exact)return a.setAttribute('target','_top');const t=/^https?:/i.test(h)?'_blank':'_top';a.setAttribute('target',t);if(t==='_blank')a.setAttribute('rel','noopener')});` +
  `if(exact)addEventListener('submit',(e)=>{const f=e.target;if(!e.defaultPrevented&&f instanceof HTMLFormElement&&!f.getAttribute('target'))f.setAttribute('target','_top')})})()</script>`

/**
 * The design as shown. Always: the per-image adjustments, `{{placeholders}}` (only where the designer wrote them;
 * `{{address}}` in page text becomes an escaped maps link) and the compat shim first in <head> (before an earlier
 * <script>). Phone fixes on: `fixHtmlDesign`, a viewport meta (if missing) and the base sheet. Frame mode (default): a
 * small click handler on the window (after the design's own handlers; skipped when they prevent the default) —
 * `#anchors` scroll inside the design, other links open in the top window like the opened file would (legacy designs:
 * outside sites in a new tab), every link is inert in the editor / previews. `top`: none of that (the live page is the
 * design document itself).
 */
export function htmlDesignDocument(
  html: string,
  values: Record<string, string>,
  inert: boolean,
  images: HtmlImageAdjust[] = [],
  links: Record<string, HtmlDesignLink> = {},
  opts: HtmlDesignRender = {},
): string {
  const fixes = Boolean(opts.phoneFixes)
  const adjusted = applyHtmlImageAdjustments(fixes ? fluidImages(html).html : html, images)
  const spans = adjusted.includes('{{') ? fillSpans(adjusted) : []
  let k = 0
  const ctxAt = (at: number): FillCtx | 'html' => {
    while (k < spans.length && spans[k]![1] <= at) k++
    return k < spans.length && spans[k]![0] <= at ? spans[k]![2] : 'html'
  }
  let spliced = false
  // Matches come in document order, so `ctxAt` walks the spans once.
  const filled = adjusted.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string, at: number) => {
    if (!(key in values)) return m
    const value = values[key]!
    const ctx = ctxAt(at)
    if (ctx === 'skip') return m
    if (ctx === 'js') return jsText(value)
    if (ctx === 'jsattr') return escapeHtml(jsText(value))
    if (ctx === 'css') return cssText(value)
    const link = links[key]
    if (ctx === 'link' && link?.href && SAFE_HREF.test(link.href)) {
      spliced = true
      return linkHtml(value, link)
    }
    return escapeHtml(value)
  })
  const shim = `<script>${HTML_DESIGN_COMPAT_SHIM}</script>`
  const head =
    (fixes
      ? `${hasViewport(filled) ? '' : VIEWPORT}<style data-spa-base>${HTML_DESIGN_BASE_CSS}</style>`
      : '') +
    (spliced ? `<style data-spa-map-style>${HTML_DESIGN_MAP_CSS}</style>` : '') +
    (opts.top ? '' : linkScript(inert, !fixes))
  const at = headIndex(filled)
  const firstScript = filled.search(/<script\b/i)
  if (firstScript >= 0 && firstScript < at)
    return filled.slice(0, firstScript) + shim + filled.slice(firstScript, at) + head + filled.slice(at)
  return filled.slice(0, at) + shim + head + filled.slice(at)
}

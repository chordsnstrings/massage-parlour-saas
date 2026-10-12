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
/**
 * Safe to put in a CSS `url()` and an attribute: absolute https/http or a site path, no quotes/parens/spaces and no
 * character reference (`&#…` / `&name;`: an attribute decodes them before CSS reads the value) once a pasted `&amp;`
 * is read as `&` (`htmlImageUrl`). `$` is fine: URLs go in through replacer functions only.
 */
export const HTML_IMAGE_URL =
  /^(?!.*&(?:amp;(?:#|[a-z][a-z\d]*;)|(?!amp;)(?:#|[a-z][a-z\d]*;)))(?:https?:\/\/|\/(?!\/))[^\s"'()<>\\`]{1,2000}$/i
/** A replace URL as the render uses it: a pasted `&amp;` read as `&` (attributes escape it again); null = refused. */
export const htmlImageUrl = (url: string | undefined): string | null =>
  url && HTML_IMAGE_URL.test(url) ? url.replace(/&amp;/gi, '&') : null
/** A picture URL inside an attribute value (src, srcset, style): `&` escaped. */
const attrUrl = (url: string) => url.replace(/&/g, '&amp;')
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A design document's file id: a stored / template file UUID (anything else reads as no document, never a query). */
export const isHtmlDesignDocFile = (file: unknown): file is string =>
  typeof file === 'string' && UUID.test(file)

/** The block's design file reference, or null (inline / legacy design, or a malformed reference). */
export function htmlDesignDocOf(props: Record<string, unknown> | null | undefined): HtmlDesignDoc | null {
  const d = props?.doc as Partial<HtmlDesignDoc> | null | undefined
  return d &&
    isHtmlDesignDocFile(d.file) &&
    typeof d.sha256 === 'string' &&
    /^[0-9a-f]{64}$/.test(d.sha256) &&
    typeof d.bytes === 'number' &&
    typeof d.chars === 'number'
    ? { file: d.file, sha256: d.sha256, bytes: d.bytes, chars: d.chars }
    : null
}

/** Drops `<!-- … -->` comments in one linear pass (an unclosed comment runs to the end, as in a browser). */
function withoutComments(s: string) {
  let out = ''
  let i = 0
  for (;;) {
    const open = s.indexOf('<!--', i)
    if (open < 0) return out + s.slice(i)
    out += s.slice(i, open)
    const close = s.indexOf('-->', open + 4)
    if (close < 0) return out
    i = close + 3
  }
}

/**
 * The charset label of the first `<meta>` that declares one (`charset=…`, also inside an http-equiv `content`), from
 * lower-cased text — a linear scan (no backtracking regex on uploaded bytes).
 */
function metaCharset(head: string): string | null {
  const space = (ch: string | undefined) =>
    ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f'
  for (let at = head.indexOf('<meta'); at >= 0; at = head.indexOf('<meta', at + 5)) {
    const after = head[at + 5]
    if (after !== undefined && !space(after) && after !== '/' && after !== '>') continue
    const end = head.indexOf('>', at)
    const tag = head.slice(at, end < 0 ? head.length : end)
    for (let c = tag.indexOf('charset'); c >= 0; c = tag.indexOf('charset', c + 7)) {
      if (/\w/.test(tag[c - 1] ?? '')) continue
      let k = c + 7
      while (space(tag[k])) k++
      if (tag[k] !== '=') continue
      k++
      while (space(tag[k])) k++
      if (tag[k] === '"' || tag[k] === "'") k++
      while (space(tag[k])) k++
      let value = ''
      while (k < tag.length && !space(tag[k]) && !'"\'>;/'.includes(tag[k]!)) value += tag[k++]
      if (value) return value
    }
  }
  return null
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
  const label = metaCharset(withoutComments(head).toLowerCase())
  if (label) {
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
/** `attr`: in a style attribute (else a `<style>` body). */
type BgHit = { id: string; src: string; urlStart: number; urlEnd: number; declEnd: number; attr: boolean }

// `&quot;` / `&#39;` need no alternatives of their own (the class already takes them: overlapping alternatives
// backtrack exponentially); the closing `\s*` sits inside each branch so two `\s*` never meet, and an unquoted url
// can't hold `(` (invalid CSS), so `url(url(…` can't rescan (both quadratic).
const URL_RE = /url\(\s*(?:"([^"]*)"\s*|'([^']*)'\s*|([^()'"\s]+)\s*)?\)/gi
const BG_PROP = /(?:^|[;{\s"'])background(?:-image)?\s*:[^;{}]*$/i

/** Background `url()`s inside one CSS text (style block body or style attribute value), absolute offsets. */
function cssBackgrounds(css: string, offset: number, attr: boolean, out: Omit<BgHit, 'id'>[]) {
  const endChars = attr ? ';' : ';}'
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
      attr,
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
    cssBackgrounds(m[2]!, m.index + m[1]!.length, false, found)
  }
  for (const m of html.matchAll(/<[a-z][\w-]*\b[^>]*?\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    if (inside(skip, m.index) || /^<style\b/i.test(m[0])) continue
    const value = m[1] ?? m[2] ?? ''
    const start = m.index + m[0].length - 1 - value.length
    cssBackgrounds(value, start, true, found)
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

/** R28 P4: an adjustment frames its image (focal point, fill / fit, alignment); a replacement alone only swaps the URL. */
export const htmlImageFramed = (a: Pick<HtmlImageAdjust, 'fit' | 'x' | 'y' | 'align'>) =>
  a.fit !== undefined || a.x !== undefined || a.y !== undefined || a.align !== undefined

/**
 * CSS / attribute edits for the adjustments whose id still points at the same image (of several with one id, the last
 * whose src matches). Only framed ones get the `data-spa-img` hook + rule (img) or position / size (bg); a replaced
 * `<img>` inside a `<picture>` also gets its `<source srcset>`s (they would win over its src).
 */
function adjustmentEdits(html: string, adjust: HtmlImageAdjust[]) {
  const byId = new Map<string, HtmlImageAdjust[]>()
  for (const a of adjust) if (HTML_IMAGE_ID.test(a.id)) byId.set(a.id, [...(byId.get(a.id) ?? []), a])
  const pick = (id: string, src: string) => byId.get(id)?.findLast((a) => a.src === srcKey(src))
  const { imgs, bgs } = scan(html)
  const edits: Edit[] = []
  const rules: string[] = []
  let pictures: { opens: number[]; closes: number[]; skip: Range[] } | null = null
  const sourcesBefore = (at: number) => {
    if (!/<picture\b/i.test(html)) return []
    if (!pictures) {
      const skip = skipRanges(html)
      const outside = (re: RegExp, end: boolean) =>
        [...html.matchAll(re)]
          .filter((m) => !inside(skip, m.index))
          .map((m) => m.index + (end ? m[0].length : 0))
      pictures = { opens: outside(/<picture\b[^>]*>/gi, true), closes: outside(/<\/picture/gi, false), skip }
    }
    const { opens, closes, skip } = pictures
    const open = opens.filter((o) => o <= at).pop()
    if (open === undefined || closes.some((c) => c >= open && c < at)) return []
    return [...html.slice(open, at).matchAll(/<source\b[^>]*>/gi)]
      .map((m) => ({ at: open + m.index, tag: m[0] }))
      .filter((m) => !inside(skip, m.at))
  }
  for (const img of imgs) {
    const a = pick(img.id, img.src)
    if (!a) continue
    const n = img.id.slice(4)
    const framed = htmlImageFramed(a)
    let tag = framed ? img.tag.replace(/^<img\b/i, `<img data-spa-img="${n}"`) : img.tag
    const replace = htmlImageUrl(a.replace)
    if (replace) {
      // Replacer functions only: a URL's `$&` / `$1` must stay text.
      const url = attrUrl(replace)
      // A replaced image must not come back through srcset.
      tag = tag.replace(/\s(?:srcset|sizes)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      tag = /\ssrc\s*=/i.test(tag)
        ? tag.replace(/(\ssrc\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i, (_, at: string) => `${at}"${url}"`)
        : tag.replace(/^<img\b/i, () => `<img src="${url}"`)
      for (const s of sourcesBefore(img.tagStart)) {
        const set = /(\ssrcset\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s>]+)/i.exec(s.tag)
        if (set)
          edits.push({
            at: s.at + set.index,
            end: s.at + set.index + set[0].length,
            text: `${set[1]}"${url}"`,
          })
      }
    }
    if (tag !== img.tag) edits.push({ at: img.tagStart, end: img.tagEnd, text: tag })
    if (!framed) continue
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
    const a = pick(bg.id, bg.src)
    if (!a) continue
    const replace = htmlImageUrl(a.replace)
    if (replace)
      edits.push({
        at: bg.urlStart,
        end: bg.urlEnd,
        text: `url(${bg.attr ? attrUrl(replace) : replace})`,
      })
    if (a.fit === undefined && a.x === undefined && a.y === undefined) continue
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
  const seen = new Set<string>()
  return allAttributes(src, j).filter((a) => !seen.has(a.name) && seen.add(a.name))
}

/** Every attribute of a tag in source order, duplicates included (each is tokenized, even if the parser drops it). */
function allAttributes(src: string, j: number): HtmlAttr[] {
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
  return out
}

/**
 * How a `{{placeholder}}` at a position is filled (R24 review): `link` = plain page text (`{{address}}` may become a
 * maps link), `js` = a JavaScript / JSON script body, `jsattr` = an `on…` handler attribute, `jsurl` = a URL attribute
 * (script only when it is a `javascript:` URL), `css` = a <style> body, `cssattr` = a style attribute, `attr` = inside
 * a tag outside quoted values (names, unquoted values), `skip` = never filled (comments, doctypes, client-side
 * templates in `<script type="text/x-…">` and other non-JS script types). Anything else (quoted attribute values,
 * title/textarea, text inside <a>/<select>/<button>) = the HTML-escaped value.
 */
type FillCtx = 'link' | 'js' | 'jsattr' | 'jsurl' | 'css' | 'cssattr' | 'attr' | 'skip'
/** `[start, end, ctx, quoted]` — `quoted` only for attribute values (false = unquoted). */
type FillSpan = [number, number, FillCtx, boolean?]

/** Script types whose body is JavaScript or JSON (JSX / TypeScript for in-browser transpilers too). */
const JS_SCRIPT =
  /^(?:|module|importmap|speculationrules|text\/(?:javascript|ecmascript|jscript|livescript|babel|jsx|typescript)|application\/(?:javascript|ecmascript|x-javascript|x-ecmascript|json|[\w.-]+\+json))$/
/** Attributes whose value is a URL that may be `javascript:`. */
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href'])

const attrValue = (src: string, a: HtmlAttr | undefined) =>
  a && a.start >= 0 ? decode(src.slice(a.start, a.end)) : ''

/**
 * `[start, end, ctx]` spans of the document in order (tokenized quote-aware like the HTML parser: `>` inside an
 * attribute value doesn't end a tag); positions outside every span are the default (HTML-escaped value).
 */
function fillSpans(src: string): FillSpan[] {
  const spans: FillSpan[] = []
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
    const attrs = tag[1] ? [] : allAttributes(src, nameEnd)
    i = text = tagEnd(src, nameEnd)
    // The tag itself: names / `=` / unquoted values can't take a value with spaces or quotes (`attr`); handler,
    // URL and style values have their own context; quoted plain values are the default.
    let from = lt
    for (const a of attrs) {
      if (a.start < 0) continue
      const quoted = src[a.start - 1] === '"' || src[a.start - 1] === "'"
      const ctx: FillCtx | null = a.name.startsWith('on')
        ? 'jsattr'
        : URL_ATTRS.has(a.name)
          ? 'jsurl'
          : a.name === 'style'
            ? 'cssattr'
            : quoted
              ? null
              : 'attr'
      if (a.start > from) spans.push([from, a.start, 'attr'])
      if (ctx) spans.push([a.start, a.end, ctx, quoted])
      from = a.end
    }
    if (i > from) spans.push([from, i, 'attr'])
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

// ---------------------------------------------------------------------------------------------------------------
// R28 P4: page texts (text nodes, alt / placeholder / aria-label / title, the page title, the meta description)
// ---------------------------------------------------------------------------------------------------------------

export type HtmlDesignTextKind = 'text' | 'attr' | 'title' | 'meta'
export type HtmlTextAttr = 'alt' | 'placeholder' | 'aria-label' | 'title'
export type HtmlDesignText = {
  /** 'txt-<n>' text node · 'attr-<n>' attribute · 'title' · 'meta-description' (positional, on the raw file). */
  id: string
  kind: HtmlDesignTextKind
  /** kind 'attr' only. */
  attr?: HtmlTextAttr
  /** Owner element name (h2, a, button, option, img, input …): editor labels. 'title' / 'meta' for those kinds. */
  tag: string
  /** Full decoded text, whitespace collapsed + trimmed, ≤ 2000 chars (what the editor / AI see). */
  text: string
  /** srcKey(text): first HTML_IMAGE_SRC_MAX (300) chars — the stored guard. */
  src: string
  /** Label of the nearest open section/header/nav/footer/main/aside/article/form/dialog; '' = page level (title/meta: ''). */
  group: string
  bound: boolean
  /**
   * Who fills a bound text: 'crm' = a CRM binding (data-crm* / data-item* / data-book-service), or the script of a
   * design with a CRM contract (`window.CRM_DATA` literal / crm-endpoint meta) writes it — change it in the CRM;
   * 'script' = the script of a design without a contract writes it ('#<id>', 'document.title') — change it in the
   * design file.
   */
  boundBy?: 'crm' | 'script'
  /** Why bound: 'data-crm=<path>' | 'data-item…' | 'data-book-service' | '#<id>' | 'document.title'. */
  binding?: string
}
/**
 * A stored page text (content.texts entry): what the render applies. Either language may be missing or blank (an
 * Arabic-only entry keeps the design's English).
 */
export type HtmlTextOverride = { id: string; src: string; t: { en?: string; ar?: string } }

export const HTML_TEXT_ID = /^(?:txt-\d{1,5}|attr-\d{1,5}|title|meta-description)$/
export const MAX_HTML_TEXTS = 2000

const TEXT_ATTRS = new Set<string>(['alt', 'placeholder', 'aria-label', 'title'])
/** Start tags whose attributes are never page text. */
const NO_TEXT_ATTRS = new Set(['html', 'head', 'meta', 'link', 'style', 'script', 'base', 'title'])
const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])
const TEXT_GROUPS = new Set([
  'section',
  'header',
  'nav',
  'footer',
  'main',
  'aside',
  'article',
  'form',
  'dialog',
])
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4'])
/** Attributes through which the design's script fills an element from the CRM (R26 contract). */
const BINDING = /^data-(?:crm|item)(?:-|$)|^data-book-service$/
/** The `window.CRM_DATA` literal (or the injected one): data, not the design's script. */
const CRM_DATA_BODY = /^\s*window\.CRM_DATA\s*=/
const MAX_TEXT = 2000

type TextSite = {
  id: string
  kind: HtmlDesignTextKind
  attr?: HtmlTextAttr
  tag: string
  text: string
  src: string
  /** `[start, end)`: the replaceable range (a text node's core, an attribute value without its quotes). */
  start: number
  end: number
  quoted: boolean
  /**
   * Listing only: ids of the open elements (text runs; innermost last), the (inherited) data binding, the innermost
   * group, inside an h1–h4.
   */
  owners?: string[]
  binding?: string
  group?: number
  heading?: boolean
  bound?: boolean
  boundBy?: 'crm' | 'script'
}
type OpenElement = { name: string; id?: string; binding?: string }

const clipText = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
/** HTML whitespace collapsed (as the page shows it); U+00A0 stays — it is the design's own character. */
const collapse = (s: string) => s.replace(/[ \t\n\f\r]+/g, ' ').trim()

/** A JS identifier, at most 64 characters (linear on long runs of letters). */
const JS_ID = String.raw`[A-Za-z_$][\w$]{0,63}`
/** A one-line quoted JS string of at most 200 characters. */
const JS_STR = String.raw`(?:'[^'\n]{0,200}'|"[^"\n]{0,200}"|\`[^\`]{0,200}\`)`
/**
 * After an element expression: its text replaced (`.textContent` / `.innerText` / `.innerHTML` / `.outerHTML`
 * assigned, jQuery `.text(v)` / `.html(v)`, `.replaceChildren(`). Adding nodes (`append` / `prepend` /
 * `insertAdjacentHTML` …) and writes to a child (`.firstElementChild…`, `#x span`) never bind the element: its own
 * texts stay the design's and stay editable.
 */
const TEXT_WRITE = String.raw`\s*\??\.\s*(?:(?:textContent|innerText|innerHTML|outerHTML)\s*\+?=(?!=)|(?:text|html)\s*\(\s*[^)\s]|replaceChildren\s*\()`
const WRITE_AFTER_CALL = new RegExp(String.raw`^\s*\)${TEXT_WRITE}`)
/** The call's element kept: the statement, list item or object entry ends. */
const KEPT_AFTER_CALL = /^\s*\)\s*(?:[;,\n})]|\|\||\?\?|$)/
const ANY_WRITE = new RegExp(TEXT_WRITE)
/** Every text write's receiver (`el` / `els.p` / `this.p`): one pass per script. */
const WRITE_TARGET = new RegExp(String.raw`(?<![\w$])(${JS_ID})(?:\s*\??\.\s*(${JS_ID}))?${TEXT_WRITE}`, 'g')
/** `a.firstElementChild.textContent`: a child's text, not `a`'s (no binding). */
const CHILD_PROP =
  /^(?:(?:first|last)(?:Element)?Child|children|childNodes|nextElementSibling|previousElementSibling|nextSibling|previousSibling|parentNode|parentElement)$/
/** `.forEach(` …: an array (`['a', 'b']` / `ids` before it) iterated with a callback. */
const ITERATE = /\.\s*(?:forEach|map|flatMap|filter|some|every|reduce)\s*\(/g
/** `for (const id of ids)` / `for (const id of [`. */
const FOR_OF = new RegExp(
  String.raw`\bfor\s*\(\s*(?:const|let|var)\s+\[?\s*(${JS_ID})[^;)]{0,80}?\s+of\s+(?:(${JS_ID})\s*\)|\[)`,
  'g',
)
/** A callback's first parameter (destructured `[id, v]` too) and where its body starts. */
const CALLBACK = new RegExp(
  String.raw`\s*(?:async\s+)?(?:function\b\s*(?:${JS_ID})?\s*\(\s*\[?\s*(${JS_ID})[^)]{0,200}\)|\(\s*\[?\s*(${JS_ID})[^)]{0,200}\)\s*=>|(${JS_ID})\s*=>)`,
  'y',
)
/**
 * Functions whose first parameter is named — `function f(id…)`, `f = function (id…)`, `f = (id…) =>`, `f = id =>` —
 * found from their `function` / `=>` (names at most 64 characters).
 */
const JS_FUNCTION = /\bfunction\b|=>/g
const FUNCTION_DECL = new RegExp(String.raw`function\s+(${JS_ID})\s*\(\s*(${JS_ID})[^)]{0,200}\)`, 'y')
const FUNCTION_EXPR = new RegExp(String.raw`function\b[^(]{0,80}\(\s*(${JS_ID})[^)]{0,200}\)`, 'y')
const ARROW_PARAM = new RegExp(String.raw`\(\s*(${JS_ID})(?![\w$])`, 'y')
/** Iterated arrays checked per design (each a callback body read). */
const MAX_ITERATED = 1000
/** What a JS scan stops at: comments / division, strings, brackets. */
const JS_SCAN = /[/'"`[\]]/g
/** The id a string names: `x` / `#x`, or a one-compound selector on it (`#x.on`, `#x:hover`); never `#x span`. */
const ID_LITERAL = /^#?([\w-]{1,200})$|^#([\w-]{1,200})(?:[.:[][^\s>+~,]{0,200})?$/
const reText = (s: string) => s.replace(/[$]/g, '\\$')
const isIdCode = (c: number) =>
  (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36
/** `at` moved back over whitespace. */
const wsBack = (js: string, at: number) => {
  let i = at
  while (i > 0 && isWs(js[i - 1])) i--
  return i
}
/** Start of the identifier ending at `end` (at most 64 characters, not a number), or -1. */
function idStart(js: string, end: number) {
  let s = end
  while (s > 0 && end - s <= 64 && isIdCode(js.charCodeAt(s - 1))) s--
  return s === end || end - s > 64 || /\d/.test(js[s]!) ? -1 : s
}
/** The name assigned what starts at `at` (`name = …`, `name = async …`; not `==` / `+=` …), or null. */
function assignedName(js: string, at: number) {
  let q = wsBack(js, at)
  if (js.slice(q - 5, q) === 'async' && !isIdCode(js.charCodeAt(q - 6))) q = wsBack(js, q - 5)
  if (js[q - 1] !== '=' || /[=!<>+\-*/%&|^?]/.test(js[q - 2] ?? '')) return null
  const end = wsBack(js, q - 1)
  const s = idStart(js, end)
  return s < 0 ? null : js.slice(s, end)
}
/** The named functions of a script with their first parameter and where their body starts. */
function* jsFunctions(js: string): Generator<{ names: string[]; param: string; at: number }> {
  for (const m of js.matchAll(JS_FUNCTION)) {
    if (m[0] === 'function') {
      const assigned = assignedName(js, m.index)
      FUNCTION_DECL.lastIndex = m.index
      const decl = FUNCTION_DECL.exec(js)
      FUNCTION_EXPR.lastIndex = m.index
      const expr = decl ?? FUNCTION_EXPR.exec(js)
      if (!expr) continue
      const names = [assigned, decl?.[1]].filter((x): x is string => Boolean(x))
      if (names.length) yield { names, param: decl ? decl[2]! : expr[1]!, at: m.index + expr[0].length }
      continue
    }
    // `=>`: `(id, …) =>` (no `)` inside) or `id =>`, assigned to a name.
    const end = wsBack(js, m.index)
    let start = -1
    let param = ''
    if (js[end - 1] === ')') {
      // The parameters' `(`: at most 200 characters back (a bounded search: linear on runs of `(`).
      const from = Math.max(0, end - 202)
      const k = js.slice(from, end - 1).lastIndexOf('(')
      const open = k < 0 ? -1 : from + k
      ARROW_PARAM.lastIndex = open
      const p = open >= 0 && !js.slice(open + 1, end - 1).includes(')') && ARROW_PARAM.exec(js)
      if (p) [start, param] = [open, p[1]!]
    } else {
      start = idStart(js, end)
      if (start >= 0) param = js.slice(start, end)
    }
    const name = start >= 0 ? assignedName(js, start) : null
    if (name) yield { names: [name], param, at: m.index + 2 }
  }
}

/** A function body from `at` (after its parameters / arrow): a `{…}` block, else the expression up to `;` / a line end. */
function jsBody(js: string, at: number) {
  let i = at
  while (i < js.length && isWs(js[i])) i++
  if (js[i] !== '{') {
    const e = js.slice(i, i + 500).search(/[;\n]/)
    return js.slice(i, e < 0 ? i + 500 : i + e)
  }
  let depth = 0
  const stop = Math.min(js.length, i + 3000)
  for (let j = i; j < stop; j++) {
    if (js[j] === '{') depth++
    else if (js[j] === '}' && --depth === 0) return js.slice(i, j + 1)
  }
  return js.slice(i, stop)
}

/**
 * Whether `body` writes the text of an element it finds by `p` (`getElementById(p)` / `querySelector('#' + p)` /
 * `` $(`#${p}`) ``): right after the call, through a variable, or through a text helper (`setText(p, …)`).
 */
function writesThrough(body: string, p: string, helpers: Set<string>) {
  const q = reText(p)
  const by = String.raw`[\w$]{1,64}\s*\(\s*(?:${q}|['"]#['"]\s*\+\s*${q}|\`#\$\{\s*${q}\s*\}\`)\s*\)`
  if (new RegExp(`${by}${TEXT_WRITE}`).test(body)) return true
  const kept = new RegExp(
    String.raw`(?<![\w$.])(${JS_ID})\s*=(?!=)\s*(?:[\w$]{1,64}\s*\??\.\s*){0,4}${by}`,
    'g',
  )
  for (const m of body.matchAll(kept))
    if (new RegExp(String.raw`(?<![\w$.])${reText(m[1]!)}${TEXT_WRITE}`).test(body)) return true
  for (const m of body.matchAll(new RegExp(String.raw`(?<![\w$.])(${JS_ID})\s*\(\s*${q}\s*[,)]`, 'g')))
    if (helpers.has(m[1]!)) return true
  return false
}

/**
 * Ids whose text the design's scripts write (the bound heuristic): `getElementById('x')` / `querySelector('#x')` /
 * `$('#x')` with a text write right after the call, kept in a variable or a holder object property (`{x: …}`, `this.x = …`) that gets one,
 * passed first to a function that writes text through that parameter (`setText('x', …)`), or listed in an array
 * literal iterated with a write through the callback's parameter (`['x', 'y'].forEach((id) => …getElementById(id)
 * .textContent = …)`, `for (const id of ids)`). An id only read, or used for listeners, classes or attributes, stays
 * editable. The write receivers are collected in one pass per script and matched against the kept elements.
 */
function scriptTextIds(scripts: string[]): Set<string> {
  const written = new Set<string>()
  const vars = new Map<string, string[]>()
  const props = new Map<string, string[]>()
  const calls: [string, string][] = []
  const helpers = new Set<string>()
  const receivers = new Set<string>()
  const properties = new Set<string>()
  const sites: { js: string; at: number; p?: string; ids: string[] }[] = []
  const keep = (map: Map<string, string[]>, name: string, id: string) => {
    const list = map.get(name)
    if (list) list.push(id)
    else map.set(name, [id])
  }
  for (const js of scripts) {
    for (const f of jsFunctions(js)) {
      const body = jsBody(js, f.at)
      const p = reText(f.param)
      if (ANY_WRITE.test(body) && new RegExp(String.raw`(?:\(\s*|\+\s*|\$\{\s*)${p}\s*[)}]`).test(body))
        for (const name of f.names) helpers.add(name)
    }
    for (const m of js.matchAll(WRITE_TARGET)) {
      if (m[2] && CHILD_PROP.test(m[2])) continue
      // `a.b.textContent`: `b` is a property of `a`; a receiver after a `.` is a property too.
      if (js[wsBack(js, m.index) - 1] === '.') properties.add(m[1]!)
      else receivers.add(m[1]!)
      if (m[2]) properties.add(m[2])
    }
    /** Id literals (positions ascending), array literals by their `[` and `]`, arrays kept in a variable. */
    const literals: { at: number; id: string }[] = []
    const opens = new Map<number, number>()
    const closes = new Map<number, number>()
    const arrays = new Map<string, [number, number]>()
    const stack: { at: number; name?: string }[] = []
    const n = js.length
    let i = 0
    while (i < n) {
      JS_SCAN.lastIndex = i
      const next = JS_SCAN.exec(js)
      if (!next) break
      i = next.index
      const c = js[i]
      if (c === '/' && js[i + 1] === '/') {
        const e = js.indexOf('\n', i)
        i = e < 0 ? n : e
        continue
      }
      if (c === '/' && js[i + 1] === '*') {
        const e = js.indexOf('*/', i + 2)
        i = e < 0 ? n : e + 2
        continue
      }
      if (c === '[') stack.push({ at: i, name: assignedName(js, i) ?? undefined })
      else if (c === ']') {
        const open = stack.pop()
        if (open) {
          opens.set(open.at, i)
          closes.set(i, open.at)
          if (open.name) arrays.set(open.name, [open.at, i])
        }
      }
      if (c !== '"' && c !== "'" && c !== '`') {
        i++
        continue
      }
      let j = i + 1
      while (j < n && js[j] !== c && (c === '`' || js[j] !== '\n')) j += js[j] === '\\' ? 2 : 1
      const found = ID_LITERAL.exec(js.slice(i + 1, j))
      const id = found ? (found[1] ?? found[2]!) : ''
      if (id) {
        literals.push({ at: i, id })
        // The call this literal is the first argument of: `name(` right before it.
        const open = wsBack(js, i)
        const nameEnd = js[open - 1] === '(' ? wsBack(js, open - 1) : -1
        const nameStart = nameEnd > 0 ? idStart(js, nameEnd) : -1
        if (nameStart >= 0) {
          const after = js.slice(j + 1, j + 400)
          if (WRITE_AFTER_CALL.test(after)) written.add(id)
          else if (KEPT_AFTER_CALL.test(after)) {
            // Over the callee's receivers (`document.`, `this.root?.`) to what the element is kept in.
            let q = nameStart
            for (let k = 0; k < 6; k++) {
              const dot = wsBack(js, q)
              if (js[dot - 1] !== '.') break
              const s = idStart(js, wsBack(js, js[dot - 2] === '?' ? dot - 2 : dot - 1))
              if (s < 0) break
              q = s
            }
            q = wsBack(js, q)
            const end = wsBack(js, q - 1)
            if (js[q - 1] === '=' && !/[=!<>+\-*/%&|^?]/.test(js[q - 2] ?? '')) {
              const s = idStart(js, end)
              // `el = …` a variable; `this.el = …` / `els.el = …` a holder property.
              if (s >= 0) keep(js[wsBack(js, s) - 1] === '.' ? props : vars, js.slice(s, end), id)
            } else if (js[q - 1] === ':') {
              // A holder object entry `{ el: …, 'el2': … }` (a ternary's `: …` too: when unsure, bound).
              const key = /(?:^|[^\w$])([A-Za-z_$][\w$]{0,63})$|(['"])([\w$-]{1,64})\2$/.exec(
                js.slice(Math.max(0, end - 70), end),
              )
              if (key) keep(props, key[1] ?? key[3]!, id)
            }
          }
          if (/^\s*[,)]/.test(after)) calls.push([js.slice(nameStart, nameEnd), id])
        }
      }
      i = j + 1
    }
    // Arrays iterated with a callback (or a for…of loop): checked once every script's helpers are known (at most
    // MAX_ITERATED, each with at most MAX_HTML_TEXTS ids).
    const site = (at: number, p: string | undefined, [from, to]: readonly [number, number]) => {
      if (sites.length >= MAX_ITERATED) return
      let lo = 0
      let hi = literals.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (literals[mid]!.at < from) lo = mid + 1
        else hi = mid
      }
      const ids: string[] = []
      for (let k = lo; k < literals.length && literals[k]!.at < to && ids.length < MAX_HTML_TEXTS; k++)
        ids.push(literals[k]!.id)
      if (ids.length) sites.push({ js, at, p, ids })
    }
    for (const m of js.matchAll(ITERATE)) {
      const end = wsBack(js, m.index)
      const open = js[end - 1] === ']' ? closes.get(end - 1) : undefined
      const name = open === undefined ? idStart(js, end) : -1
      const range =
        open !== undefined
          ? ([open, end - 1] as const)
          : name >= 0
            ? arrays.get(js.slice(name, end))
            : undefined
      if (range) site(m.index + m[0].length, undefined, range)
    }
    for (const m of js.matchAll(FOR_OF)) {
      let at = m.index + m[0].length
      let range = m[2] !== undefined ? arrays.get(m[2]) : undefined
      if (m[2] === undefined) {
        // `of [ … ])`: the loop body starts after the array and the `)`.
        const close = opens.get(at - 1)
        if (close === undefined) continue
        range = [at - 1, close]
        at = close + 1
        while (at < n && isWs(js[at])) at++
        if (js[at] !== ')') continue
        at++
      }
      if (range) site(at, m[1]!, range)
    }
  }
  for (const [name, ids] of vars) if (receivers.has(name)) for (const id of ids) written.add(id)
  for (const [name, ids] of props) if (properties.has(name)) for (const id of ids) written.add(id)
  for (const [name, id] of calls) if (helpers.has(name)) written.add(id)
  for (const s of sites) {
    if (s.ids.every((id) => written.has(id))) continue
    let p = s.p
    let at = s.at
    if (p === undefined) {
      CALLBACK.lastIndex = at
      const m = CALLBACK.exec(s.js)
      if (!m) continue
      p = m[1] ?? m[2] ?? m[3]!
      at = CALLBACK.lastIndex
    }
    if (writesThrough(jsBody(s.js, at), p, helpers)) for (const id of s.ids) written.add(id)
  }
  return written
}

/**
 * The page texts of a design, in document order (tokenized like `fillSpans`: comments, doctypes and raw-text bodies
 * are skipped; only runs and values without `<` / `>` are listed, so an escaped override never changes the markup).
 * Ids are positional and only listed sites take a number, so they stay the same through the CRM splice (it rewrites
 * a script body or adds one script at a markup boundary). `listing`: also owners, bindings and groups.
 */
function textSites(html: string, listing: boolean): { sites: TextSite[]; groups: string[] } {
  const sites: TextSite[] = []
  const stack: OpenElement[] = []
  const groups: { tag: string; n: number; aria: string; id: string; heading?: string }[] = []
  const openGroups: number[] = []
  const counts = new Map<string, number>()
  const scripts: string[] = []
  let docTitle = false
  /** A CRM contract (a `window.CRM_DATA` literal or the crm-endpoint meta): what its script writes comes from the CRM. */
  let contract = false
  let t = 0
  let a = 0
  let svg = 0
  let title = false
  let meta = false
  const n = html.length
  let text = 0
  let i = 0
  const add = (site: Omit<TextSite, 'text' | 'src'>, decoded: string, owner: OpenElement | undefined) => {
    const value = collapse(decoded).slice(0, MAX_TEXT)
    const s: TextSite = { ...site, text: value, src: srcKey(value) }
    if (listing) {
      if (site.kind === 'text') s.owners = stack.flatMap((e) => (e.id ? [e.id] : []))
      s.binding = owner?.binding
      s.group = site.kind === 'title' || site.kind === 'meta' ? -1 : (openGroups.at(-1) ?? -1)
      s.heading = site.kind === 'text' && stack.some((e) => HEADINGS.has(e.name))
    }
    sites.push(s)
  }
  const endText = (at: number) => {
    let s = text
    let e = at
    while (s < e && isWs(html[s])) s++
    while (e > s && isWs(html[e - 1])) e--
    if (s === e) return
    const core = html.slice(s, e)
    if (core.includes('<') || core.includes('>')) return
    const decoded = decodeText(core)
    if (!decoded?.trim()) return
    const parent = stack.at(-1)
    add(
      { id: `txt-${t++}`, kind: 'text', tag: parent?.name ?? '', start: s, end: e, quoted: false },
      decoded,
      parent,
    )
  }
  const tagRe = /<(\/?)([a-z][^\t\n\f\r />]*)/iy
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt === -1) break
    if (html.startsWith('<!--', lt)) {
      endText(lt)
      const close = /--!?>/g
      close.lastIndex = lt + 2
      const m = close.exec(html)
      i = text = m ? m.index + m[0].length : n
      continue
    }
    tagRe.lastIndex = lt
    const tag = tagRe.exec(html)
    if (!tag) {
      const next = html[lt + 1]
      if (next === '!' || next === '?' || next === '/') {
        endText(lt)
        const gt = html.indexOf('>', lt + 2)
        i = text = gt === -1 ? n : gt + 1
      } else i = lt + 1 // a literal '<' in text
      continue
    }
    endText(lt)
    const name = tag[2]!.toLowerCase()
    const nameEnd = lt + tag[0].length
    const end = tagEnd(html, nameEnd)
    i = text = end
    if (tag[1]) {
      const k = stack.findLastIndex((e) => e.name === name)
      if (k >= 0) stack.length = k
      if (name === 'svg' && svg > 0) svg--
      if (listing && TEXT_GROUPS.has(name)) {
        const g = openGroups.findLastIndex((x) => groups[x]!.tag === name)
        if (g >= 0) openGroups.length = g
      }
      continue
    }
    const attrs = attributesOf(html, nameEnd)
    const el: OpenElement = { name }
    if (listing) {
      const id = attrValue(
        html,
        attrs.find((x) => x.name === 'id'),
      )
      const own = attrs.find((x) => BINDING.test(x.name))
      const value = own && own.start >= 0 ? textOf(html.slice(own.start, own.end)) : ''
      el.id = id || undefined
      el.binding = own ? (value ? `${own.name}=${value}` : own.name) : stack.at(-1)?.binding
      if (TEXT_GROUPS.has(name)) {
        const c = (counts.get(name) ?? 0) + 1
        counts.set(name, c)
        const aria = attrs.find((x) => x.name === 'aria-label')
        groups.push({
          tag: name,
          n: c,
          aria:
            aria && aria.start >= 0 ? clipText(collapse(textOf(html.slice(aria.start, aria.end))), 60) : '',
          id,
        })
        openGroups.push(groups.length - 1)
      }
    }
    if (!NO_TEXT_ATTRS.has(name))
      for (const x of attrs) {
        if (!TEXT_ATTRS.has(x.name) || x.start < 0) continue
        const raw = html.slice(x.start, x.end)
        if (raw.includes('<') || raw.includes('>')) continue
        const decoded = decodeText(raw)
        if (!decoded?.trim()) continue
        const q = html[x.start - 1]
        add(
          {
            id: `attr-${a++}`,
            kind: 'attr',
            attr: x.name as HtmlTextAttr,
            tag: name,
            start: x.start,
            end: x.end,
            quoted: q === '"' || q === "'",
          },
          decoded,
          el,
        )
      }
    if (name === 'meta' && listing && !contract) {
      const kind = attrs.find((x) => x.name === 'name')
      if (
        kind &&
        kind.start >= 0 &&
        textOf(html.slice(kind.start, kind.end)).toLowerCase() === 'crm-endpoint'
      )
        contract = true
    }
    if (name === 'meta' && !meta) {
      const content = attrs.find((x) => x.name === 'content')
      const kind = attrs.find((x) => x.name === 'name')
      const raw = content && content.start >= 0 ? html.slice(content.start, content.end) : null
      if (
        content &&
        raw !== null &&
        !raw.includes('<') &&
        !raw.includes('>') &&
        kind &&
        kind.start >= 0 &&
        textOf(html.slice(kind.start, kind.end)).toLowerCase() === 'description'
      ) {
        meta = true
        const q = html[content.start - 1]
        const decoded = decodeText(raw)
        if (decoded !== null)
          add(
            {
              id: 'meta-description',
              kind: 'meta',
              tag: 'meta',
              start: content.start,
              end: content.end,
              quoted: q === '"' || q === "'",
            },
            decoded,
            el,
          )
      }
    }
    // Inside <svg> (foreign content) a tag ending in `/>` closes itself.
    const selfClosing = html[end - 2] === '/' && !attrs.some((x) => x.end > end - 2)
    if (!VOID.has(name) && !((svg > 0 || name === 'svg') && selfClosing)) {
      stack.push(el)
      if (name === 'svg') svg++
    }
    if (!RAW_TEXT.has(name)) continue
    if (name === 'plaintext') break // the rest of the document is raw text
    const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, 'gi')
    close.lastIndex = end
    const stop = close.exec(html)?.index ?? n
    if (name === 'title' && !title && svg === 0) {
      title = true
      const body = html.slice(end, stop)
      if (!body.includes('<') && !body.includes('>')) {
        let s = end
        let e = stop
        while (s < e && isWs(html[s])) s++
        while (e > s && isWs(html[e - 1])) e--
        if (s === e) [s, e] = [end, stop] // blank: the whole body
        const decoded = decodeText(html.slice(s, e))
        if (decoded !== null)
          add({ id: 'title', kind: 'title', tag: 'title', start: s, end: e, quoted: false }, decoded, el)
      }
    } else if (listing && name === 'script' && !attrs.some((x) => x.name === 'src')) {
      const type = attrValue(
        html,
        attrs.find((x) => x.name === 'type'),
      )
        .toLowerCase()
        .split(';')[0]!
        .trim()
      const body = html.slice(end, stop)
      if (JS_SCRIPT.test(type) && CRM_DATA_BODY.test(body)) contract = true
      else if (JS_SCRIPT.test(type)) {
        if (/\bdocument\.title\s*=(?!=)/.test(body)) docTitle = true
        scripts.push(body)
      }
    }
    i = text = stop
  }
  endText(n)
  if (!listing) return { sites, groups: [] }
  const written = scriptTextIds(scripts)
  for (const s of sites) {
    // The script's text writes bind text runs only (inside the element written), never attributes.
    const byJs = written.size ? s.owners?.findLast((id) => written.has(id)) : undefined
    const byTitle = s.kind === 'title' && docTitle
    s.boundBy = s.binding || ((byJs || byTitle) && contract) ? 'crm' : byJs || byTitle ? 'script' : undefined
    s.bound = s.boundBy !== undefined
    s.binding ??= byJs ? `#${byJs}` : byTitle ? 'document.title' : undefined
    const g = s.group !== undefined && s.group >= 0 ? groups[s.group]! : null
    if (g && s.heading && !s.bound && g.heading === undefined) g.heading = clipText(s.text, 60)
  }
  const human = (id: string) => {
    const s = id.replace(/[-_]+/g, ' ').trim()
    return s ? s[0]!.toUpperCase() + s.slice(1) : ''
  }
  return {
    sites,
    groups: groups.map(
      (g) => g.aria || g.heading || human(g.id) || `${g.tag[0]!.toUpperCase()}${g.tag.slice(1)} ${g.n}`,
    ),
  }
}

/** R28 P4: every page text of a design (≤ MAX_HTML_TEXTS listed; ids beyond are still counted), in document order. */
export function listHtmlDesignTexts(html: string): HtmlDesignText[] {
  const { sites, groups } = textSites(html, true)
  return sites.slice(0, MAX_HTML_TEXTS).map((s) => ({
    id: s.id,
    kind: s.kind,
    ...(s.attr ? { attr: s.attr } : {}),
    tag: s.tag,
    text: s.text,
    src: s.src,
    group: s.group !== undefined && s.group >= 0 ? groups[s.group]! : '',
    bound: Boolean(s.bound),
    ...(s.boundBy ? { boundBy: s.boundBy } : {}),
    ...(s.binding ? { binding: s.binding } : {}),
  }))
}

/**
 * R28 P4: a spa's page texts over the design: values only — text-node characters, the listed attribute values, the
 * page title, the meta description — escaped so no tag, attribute, CSS or script changes (an override never adds a
 * `<`, `>`, quote or `=`). An entry applies only while its id still points at the same design text (`src`); English
 * pages use `t.en`, Arabic ones `t.ar`, else `t.en`; a missing / blank value, or one equal to the design's own text,
 * keeps the design's original bytes. Nothing applied → the input string itself. `values`: `{{placeholders}}` in a value
 * are filled here as plain escaped text (never the link a designer's own placeholder gets); the output's `{` are
 * character references, so no later pass fills or links anything in an override.
 */
export function applyHtmlTextOverrides(
  html: string,
  texts: readonly HtmlTextOverride[] | undefined,
  locale: 'en' | 'ar',
  values: Record<string, string> = {},
): string {
  if (!Array.isArray(texts) || !texts.length) return html
  const byId = new Map<string, { src: string; value: string }>()
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : '')
  for (const e of texts as unknown[]) {
    const x = e as Partial<HtmlTextOverride> | null
    if (typeof x !== 'object' || x === null || typeof x.id !== 'string' || !HTML_TEXT_ID.test(x.id)) continue
    if (typeof x.src !== 'string' || typeof x.t !== 'object' || x.t === null) continue
    const value = (locale === 'ar' && str(x.t.ar)) || str(x.t.en)
    if (value) byId.set(x.id, { src: x.src, value })
  }
  if (!byId.size) return html
  const edits: Edit[] = []
  for (const s of textSites(html, false).sites) {
    const e = byId.get(s.id)
    if (!e || e.src !== s.src || collapse(e.value) === s.text) continue
    const v = e.value.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) =>
      Object.hasOwn(values, key) ? values[key]! : m,
    )
    const text = (
      s.kind === 'text' || s.kind === 'title'
        ? escapeHtml(v)
        : s.quoted
          ? escapeHtml(v).replace(/=/g, '&#61;')
          : attrText(v)
    ).replace(/\{/g, '&#123;')
    edits.push({ at: s.start, end: s.end, text })
  }
  return edits.length ? applyEdits(html, edits) : html
}

/** Reads whether the end of the text fed so far (in order, in pieces) is inside a string. */
type StringScan = { feed: (s: string) => void; inString: () => boolean }

/** Words after which a `/` starts a regular expression (after any other word or value it divides). */
const JS_REGEX_AFTER = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'case',
  'do',
  'else',
  'yield',
  'await',
])
const JS_WORD = /[\p{L}\p{N}_$]/u

/**
 * JavaScript / JSON: inside a string literal or a template literal's text? The usual tokenizer heuristics (a `/` after
 * a value divides, else starts a regular expression; `<!--` / line-start `-->` comments as in classic scripts).
 */
function jsScan(): StringScan {
  // 0 code, 1 '…', 2 "…", 3 `…` text, 4 line comment, 5 block comment, 6 regex, 7 regex [class]
  let mode = 0
  let regexOk = true
  let lineStart = true
  let depth = 0
  const subs: number[] = [] // brace depth of each open `${`
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!
      const nl = c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029'
      if (nl) lineStart = true
      if (mode === 1 || mode === 2) {
        if (c === '\\') i++
        else if (c === (mode === 1 ? "'" : '"')) {
          mode = 0
          regexOk = false
        } else if (nl) mode = 0
        continue
      }
      if (mode === 3) {
        if (c === '\\') i++
        else if (c === '`') {
          mode = 0
          regexOk = false
        } else if (c === '$' && s[i + 1] === '{') {
          subs.push(depth++)
          i++
          mode = 0
          regexOk = true
        }
        continue
      }
      if (mode === 4) {
        if (nl) mode = 0
        continue
      }
      if (mode === 5) {
        if (c === '*' && s[i + 1] === '/') {
          mode = 0
          i++
        }
        continue
      }
      if (mode >= 6) {
        if (c === '\\') i++
        else if (nl) mode = 0
        else if (mode === 6 && c === '/') {
          mode = 0
          regexOk = false
        } else if (c === '[') mode = 7
        else if (c === ']') mode = 6
        continue
      }
      if (nl || isWs(c) || c === '\v' || c === '\u00a0' || c === '\ufeff') continue
      const atLineStart = lineStart
      lineStart = false
      if (c === "'") mode = 1
      else if (c === '"') mode = 2
      else if (c === '`') mode = 3
      else if (c === '/' && (s[i + 1] === '/' || s[i + 1] === '*')) {
        mode = s[i + 1] === '/' ? 4 : 5
        lineStart = atLineStart
        i++
      } else if (c === '<' && s.startsWith('!--', i + 1)) {
        mode = 4
        i += 3
      } else if (c === '-' && atLineStart && s.startsWith('->', i + 1)) {
        mode = 4
        i += 2
      } else if (c === '/') {
        if (regexOk) mode = 6
        else regexOk = true
      } else if (JS_WORD.test(c)) {
        let j = i + 1
        while (j < s.length && JS_WORD.test(s[j]!)) j++
        regexOk = JS_REGEX_AFTER.has(s.slice(i, j))
        i = j - 1
      } else if (c === '}') {
        depth = Math.max(0, depth - 1)
        if (subs.length && subs[subs.length - 1] === depth) {
          subs.pop()
          mode = 3
        } else regexOk = true
      } else {
        if (c === '{') depth++
        regexOk = c !== ')' && c !== ']'
      }
    }
  }
  return { feed, inString: () => mode >= 1 && mode <= 3 }
}

/** CSS: inside a string? (comments and unquoted `url(…)` hold no strings.) */
function cssScan(): StringScan {
  // 0 normal, 1 string, 2 comment, 3 unquoted url(…), 4 right after `url(`
  let mode = 0
  let quote = ''
  let ident = ''
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      const c = s[i]!
      if (mode === 1) {
        if (c === '\\') i++
        else if (c === quote || c === '\n' || c === '\r' || c === '\f') mode = 0
        continue
      }
      if (mode === 2) {
        if (c === '*' && s[i + 1] === '/') {
          mode = 0
          i++
        }
        continue
      }
      if (mode === 4) {
        if (isWs(c)) continue
        mode = c === '"' || c === "'" ? 0 : 3
      }
      if (mode === 3) {
        if (c === '\\') i++
        else if (c === ')') mode = 0
        continue
      }
      if (c === '"' || c === "'") {
        quote = c
        mode = 1
      } else if (c === '/' && s[i + 1] === '*') {
        mode = 2
        i++
      } else if (c === '(') mode = ident.toLowerCase() === 'url' ? 4 : 0
      if (c === '\\') {
        ident += c
        i++
      } else ident = /[\w-]/.test(c) || c.charCodeAt(0) > 0x7f ? ident + c : ''
    }
  }
  return { feed, inString: () => mode === 1 }
}

/** Character references that can change how script / CSS / URL text in an attribute tokenizes (others stay). */
const REFS: Record<string, string> = {
  amp: '&',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  bsol: '\\',
  sol: '/',
  ast: '*',
  midast: '*',
  grave: '`',
  dollar: '$',
  lcub: '{',
  lbrace: '{',
  rcub: '}',
  rbrace: '}',
  lpar: '(',
  rpar: ')',
  lsqb: '[',
  lbrack: '[',
  rsqb: ']',
  rbrack: ']',
  colon: ':',
  semi: ';',
  percnt: '%',
  newline: '\n',
  tab: '\t',
}
/** Text with character references decoded (numeric ones, and the named ones of `table`). */
const refsDecoder = (table: Record<string, string>) => (s: string) =>
  s.includes('&')
    ? s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));?/g, (m, dec, hex, name: string) => {
        if (!dec && !hex) return table[name.toLowerCase()] ?? m
        const cp = Number.parseInt(dec ?? hex, dec ? 10 : 16)
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m
      })
    : s
/** An attribute value's text as the parser hands it on (character references decoded). */
const decodeRefs = refsDecoder(REFS)
/** The Latin-1 names, U+00A0 on in order: with `amp` / `lt` / `gt` / `quot` the only ones that also work without `;`. */
const LATIN1 = (
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute ' +
  'micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig ' +
  'Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash ' +
  'Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ' +
  'ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc ' +
  'uuml yacute thorn yuml'
).split(' ')
const LEGACY_REFS: Record<string, string> = {
  ...Object.fromEntries(LATIN1.map((name, i) => [name, String.fromCharCode(0xa0 + i)])),
  amp: '&',
  AMP: '&',
  lt: '<',
  LT: '<',
  gt: '>',
  GT: '>',
  quot: '"',
  QUOT: '"',
  COPY: '©',
  REG: '®',
}
/** `name char` pairs, space separated: the named references designs use in copy (with `;`, exact case). */
const SYMBOL_REFS =
  "apos ' excl ! num # dollar $ percnt % lpar ( rpar ) ast * plus + comma , period . sol / colon : semi ; " +
  'equals = quest ? commat @ lsqb [ lbrack [ bsol \\ rsqb ] rbrack ] Hat ^ lowbar _ grave ` lcub { lbrace { ' +
  'verbar | vert | rcub } rbrace } ' +
  'ndash – mdash — horbar ― hyphen ‐ dash ‐ minus − lsquo ‘ rsquo ’ rsquor ’ sbquo ‚ ldquo “ rdquo ” rdquor ” ' +
  'bdquo „ lsaquo ‹ rsaquo › bull • bullet • hellip … mldr … nldr ‥ centerdot · CenterDot · prime ′ Prime ″ ' +
  'oline ‾ frasl ⁄ dagger † Dagger ‡ permil ‰ trade ™ TRADE ™ euro € fnof ƒ circ ˆ tilde ˜ OElig Œ oelig œ ' +
  'Scaron Š scaron š Yuml Ÿ larr ← rarr → uarr ↑ darr ↓ harr ↔ crarr ↵ lArr ⇐ rArr ⇒ uArr ⇑ dArr ⇓ hArr ⇔ ' +
  'nearr ↗ nwarr ↖ searr ↘ swarr ↙ leftarrow ← rightarrow → uparrow ↑ downarrow ↓ LeftArrow ← RightArrow → ' +
  'UpArrow ↑ DownArrow ↓ Leftarrow ⇐ Rightarrow ⇒ longleftarrow ⟵ longrightarrow ⟶ LongLeftArrow ⟵ ' +
  'LongRightArrow ⟶ hearts ♥ heartsuit ♥ spades ♠ spadesuit ♠ clubs ♣ clubsuit ♣ diams ♦ diamondsuit ♦ ' +
  'check ✓ checkmark ✓ cross ✗ star ☆ starf ★ bigstar ★ phone ☎ female ♀ male ♂ sung ♪ flat ♭ natural ♮ ' +
  'sharp ♯ loz ◊ lozenge ◊ squ □ square □ squf ▪ blacksquare ▪ utrif ▴ dtrif ▾ ltrif ◂ rtrif ▸ cir ○ sext ✶ ' +
  'malt ✠ maltese ✠ le ≤ ge ≥ ne ≠ asymp ≈ infin ∞'
/** R28 P4: what page text decodes (exact case; with `;`, the legacy ones also without). */
const TEXT_REFS: Record<string, string> = {
  ...LEGACY_REFS,
  ...Object.fromEntries(
    SYMBOL_REFS.split(' ').flatMap((s, i, all) => (i % 2 ? [] : [[s, all[i + 1]!] as const])),
  ),
  Tab: '\t',
  NewLine: '\n',
  NonBreakingSpace: ' ',
  ensp: ' ',
  emsp: ' ',
  numsp: ' ',
  puncsp: ' ',
  thinsp: ' ',
  ThinSpace: ' ',
  hairsp: ' ',
  zwnj: '‌',
  zwj: '‍',
  lrm: '‎',
  rlm: '‏',
}
/**
 * R28 P4: page text as a visitor reads it (numeric references, TEXT_REFS); null = it holds a reference read another
 * way (an unknown `&name;`, a legacy name starting a longer word, a zero / C1 / surrogate number): such a run or value
 * is not listed, so nothing is ever written back from a wrong reading.
 */
function decodeText(s: string): string | null {
  if (!s.includes('&')) return s
  let unknown = false
  const out = s.replace(
    /&(?:#(\d+)|#[xX]([0-9a-fA-F]+)|([a-zA-Z][a-zA-Z0-9]{0,31}))(;?)/g,
    (
      m,
      dec: string | undefined,
      hex: string | undefined,
      name: string | undefined,
      semi: string,
      at: number,
    ) => {
      if (name === undefined) {
        const cp = Number.parseInt((dec ?? hex)!, dec ? 10 : 16)
        if (cp > 0 && cp <= 0x10ffff && !(cp >= 0x80 && cp <= 0x9f) && !(cp >= 0xd800 && cp <= 0xdfff))
          return String.fromCodePoint(cp)
      } else if (semi) {
        if (Object.hasOwn(TEXT_REFS, name)) return TEXT_REFS[name]!
      } else if (Object.hasOwn(LEGACY_REFS, name)) {
        // `&copy=` stays as written in an attribute value but not in text: read either way, so not listed.
        if (s[at + m.length] !== '=') return LEGACY_REFS[name]!
      } else {
        // `&word` is plain text unless a legacy name starts it (`&notice` reads `¬ice` in text).
        let k = name.length - 1
        while (k >= 2 && !Object.hasOwn(LEGACY_REFS, name.slice(0, k))) k--
        if (k < 2) return m
      }
      unknown = true
      return m
    },
  )
  return unknown ? null : out
}
/** A value's text for labels and checks (an unreadable reference kept as written). */
const textOf = (s: string) => decodeText(s) ?? s
/** A `javascript:` URL runs its percent-decoded text, after the URL parser dropped tabs and newlines. */
const urlScript = (s: string) =>
  s
    .replace(/[\t\n\r]/g, '')
    .replace(/%([0-9a-fA-F]{2})/g, (_, h: string) => String.fromCharCode(Number.parseInt(h, 16)))

/** Escapes every character `special` accepts (and every control character) as `esc(code)`. */
function escapeChars(s: string, special: string, esc: (code: number) => string) {
  let out = ''
  for (const c of s) {
    const n = c.charCodeAt(0)
    out += n < 0x20 || special.includes(c) ? esc(n) : c
  }
  return out
}
const jsEscape = (n: number) => (n === 92 ? '\\\\' : `\\u${n.toString(16).padStart(4, '0')}`)
/** The value as the text of a JS (or JSON) string literal of any quote style; never ends a <script> or opens `${`. */
const jsText = (s: string, extra = '') => escapeChars(s, `\\"'\`$<>&{\u2028\u2029${extra}`, jsEscape)
/**
 * Outside a string (code, or a comment / regular expression a scan can't always tell from code): a double-quoted
 * JS / JSON string literal — no quote, `*`, `/` or line break of it can end a comment or a regex.
 */
const jsLiteral = (s: string, extra = '') => `"${jsText(s, `/*${extra}`)}"`
/** The value as the text of a CSS string (hex escapes); never ends a <style>. */
const cssText = (s: string) => escapeChars(s, '\\"\'<>&', (n) => `\\${n.toString(16)} `)
/** Outside a CSS string: every character but ASCII letters and digits hex-escaped (no `;`, `:`, `}` or comment end). */
const cssEscapeAll = (s: string) => {
  let out = ''
  for (const c of s) out += /[A-Za-z0-9]/.test(c) ? c : `\\${c.codePointAt(0)!.toString(16)} `
  return out
}
/** An unquoted attribute value (or a tag outside values): no space, `=`, quote, backtick, `<` or `>` left as is. */
const attrText = (s: string) => escapeChars(escapeHtml(s), ' =', (n) => `&#${n};`)

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
  const spans = fillSpans(html).filter((sp) => sp[2] === 'js' || sp[2] === 'css' || sp[2] === 'skip')
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
  /** R28 P4: the spa's page texts (content.texts), applied first on the html given (ids = listHtmlDesignTexts; their placeholders plain text). */
  texts?: readonly HtmlTextOverride[]
  /** Language of `texts` (Arabic → English fallback); default 'en'. */
  locale?: 'en' | 'ar'
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
 * The design as shown. First the spa's page texts (R28 P4, `opts.texts`: values only, on the html given — after the
 * CRM splice, whose ids match the raw file's; placeholders in them filled as plain text), so adjusted images keep
 * their new alt / title. Always: the per-image adjustments, `{{placeholders}}` (only where the designer wrote them;
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
  const texted = applyHtmlTextOverrides(html, opts.texts, opts.locale ?? 'en', values)
  const adjusted = applyHtmlImageAdjustments(fixes ? fluidImages(texted).html : texted, images)
  const spans = adjusted.includes('{{') ? fillSpans(adjusted) : []
  let k = 0
  const spanAt = (at: number) => {
    while (k < spans.length && spans[k]![1] <= at) k++
    return k < spans.length && spans[k]![0] <= at ? spans[k]! : null
  }
  // Script / CSS text of the span being filled, scanned up to the last placeholder (each filled one fed as `0`: a
  // value token in code, a plain character in a string). `scan` null = a URL value that isn't `javascript:`.
  let lexed: { span: FillSpan; pos: number; scan: StringScan | null } | null = null
  const inString = (span: FillSpan, at: number, len: number): boolean | null => {
    const [start, , ctx] = span
    const raw = ctx === 'js' || ctx === 'css'
    const text = (piece: string) =>
      raw ? piece : ctx === 'jsurl' ? urlScript(decodeRefs(piece)) : decodeRefs(piece)
    if (lexed?.span !== span) {
      lexed = { span, pos: start, scan: ctx === 'css' || ctx === 'cssattr' ? cssScan() : jsScan() }
      if (ctx === 'jsurl') {
        const head = text(adjusted.slice(start, at))
        let lead = 0
        while (lead < head.length && head.charCodeAt(lead) <= 0x20) lead++
        if (head.slice(lead, lead + 11).toLowerCase() !== 'javascript:') lexed.scan = null
        else lexed.scan!.feed(head.slice(lead + 11))
        lexed.pos = at
      }
    }
    const scan = lexed.scan
    if (!scan) return null
    if (at > lexed.pos) scan.feed(text(adjusted.slice(lexed.pos, at)))
    const r = scan.inString()
    scan.feed('0')
    lexed.pos = at + len
    return r
  }
  let spliced = false
  // Matches come in document order, so `spanAt` walks the spans once.
  const filled = adjusted.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string, at: number) => {
    if (!(key in values)) return m
    const value = values[key]!
    const span = spanAt(at)
    const ctx = span?.[2] ?? 'html'
    if (ctx === 'skip') return m
    // HTML-escaping of an attribute value (unquoted: no space, `=` or quote either).
    const attr = (s: string) => (span?.[3] === false ? attrText(s) : escapeHtml(s))
    if (ctx === 'attr') return attrText(value)
    if (ctx === 'js') return inString(span!, at, m.length) ? jsText(value) : jsLiteral(value)
    if (ctx === 'jsattr') return attr(inString(span!, at, m.length) ? jsText(value) : jsLiteral(value))
    if (ctx === 'jsurl') {
      // Percent signs too: the URL is percent-decoded before it runs.
      const str = inString(span!, at, m.length)
      return attr(str === null ? value : str ? jsText(value, '%') : jsLiteral(value, '%'))
    }
    if (ctx === 'css') return inString(span!, at, m.length) ? cssText(value) : cssEscapeAll(value)
    if (ctx === 'cssattr') return attr(inString(span!, at, m.length) ? cssText(value) : cssEscapeAll(value))
    const link = links[key]
    if (ctx === 'link' && link?.href && SAFE_HREF.test(link.href)) {
      spliced = true
      return linkHtml(value, link)
    }
    // Right after a `<`, the value must not start a tag.
    const text = escapeHtml(value)
    return adjusted[at - 1] === '<' ? text.replace(/^[a-z/!?]/i, (c) => `&#${c.charCodeAt(0)};`) : text
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

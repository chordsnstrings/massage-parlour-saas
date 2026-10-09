/**
 * Uploaded HTML designs (R17): pure string transforms run before a design goes into its sandboxed frame.
 * Nothing here executes the design; it only lists its images and adds CSS / attributes inside the document.
 *  - `fixHtmlDesign` (upload time): adds a missing viewport meta, makes fixed-pixel-width images fluid.
 *  - `htmlDesignDocument` (render time): a zero-specificity responsive base sheet first in <head> (so the design's
 *    own rules win), the super-admin's per-image adjustments (focal point, fill/fit, replacement) last.
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

/** Responsive defaults, zero specificity (`:where`) so any rule the design sets itself wins. */
export const HTML_DESIGN_BASE_CSS =
  ':where(html,body){max-width:100%;overflow-x:clip}' +
  ':where(img,picture,video,canvas,svg,iframe){max-width:100%}' +
  ':where(img,video){height:auto}' +
  ':where(img){object-fit:cover;object-position:50% 50%}' +
  ':where(a[data-spa-map]){color:inherit;text-decoration:none}' +
  ':where(a[data-spa-map]:hover){text-decoration:underline}'

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

const URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|((?:[^)'"\s]|&quot;|&#39;)*))\s*\)/gi
const BG_PROP = /(?:^|[;{\s"'])background(?:-image)?\s*:[^;{}]*$/i

/** Background `url()`s inside one CSS text (style block body or style attribute value), absolute offsets. */
function cssBackgrounds(css: string, offset: number, endChars: string, out: Omit<BgHit, 'id'>[]) {
  for (const m of css.matchAll(URL_RE)) {
    const before = css.slice(Math.max(0, m.index - 400), m.index)
    if (!BG_PROP.test(before)) continue
    const raw = m[1] ?? m[2] ?? m[3] ?? ''
    const src = decode(raw.replace(/^(?:&quot;|&#39;)|(?:&quot;|&#39;)$/g, ''))
    if (!src || /^data:font|\.(?:woff2?|ttf|otf|eot)(?:[?#]|$)/i.test(src)) continue
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

/** Inserts `text` right after the first of <head>, <html>, <!doctype>, or at the start. */
function insertAtHead(html: string, text: string) {
  for (const tag of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    const m = tag.exec(html)
    if (m) return html.slice(0, m.index + m[0].length) + text + html.slice(m.index + m[0].length)
  }
  return text + html
}

const hasViewport = (html: string) => /<meta\b[^>]*\bname\s*=\s*["']?viewport\b/i.test(html)

export type HtmlDesignFix = 'viewport' | 'wide-image'

/** Upload-time fixes for the usual phone breakers; returns the fixed file and what was changed. */
export function fixHtmlDesign(html: string): { html: string; fixes: HtmlDesignFix[] } {
  const fixes = new Set<HtmlDesignFix>()
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
    fixes.add('wide-image')
    const q = style[2] !== undefined ? '"' : "'"
    const at = img.tagStart + style.index
    edits.push({ at, end: at + style[0].length, text: `${style[1]}${q}${fixed}${q}` })
  }
  let out = applyEdits(html, edits)
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
function tagEnd(src: string, j: number) {
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

/**
 * `[start, end)` ranges of plain page text, where a placeholder may become a link: outside tags (tokenized
 * quote-aware like the HTML parser), comments, doctypes, raw-text elements and `<a>`/`<select>`/`<button>`.
 * Anything unclear counts as not text (the value is then just escaped).
 */
function linkableTextRanges(src: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const open = new Map<string, number>()
  const n = src.length
  let text = 0
  let i = 0
  const endText = (at: number) => {
    if (at > text && ![...open.values()].some(Boolean)) ranges.push([text, at])
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
      } else i = lt + 1 // a literal '<' in text
      continue
    }
    endText(lt)
    const name = tag[2]!.toLowerCase()
    i = text = tagEnd(src, lt + tag[0].length)
    if (NO_LINK.has(name)) open.set(name, Math.max(0, (open.get(name) ?? 0) + (tag[1] ? -1 : 1)))
    if (tag[1] || !RAW_TEXT.has(name)) continue
    if (name === 'plaintext') return ranges // the rest of the document is raw text
    const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, 'gi')
    close.lastIndex = i
    i = text = close.exec(src)?.index ?? n
  }
  endText(n)
  return ranges
}

const linkHtml = (text: string, link: HtmlDesignLink) =>
  `<a href="${escapeHtml(link.href!)}" target="_blank" rel="noopener" title="${escapeHtml(link.label)}" aria-label="${escapeHtml(`${text} (${link.label})`)}" data-spa-map>${escapeHtml(text)}</a>`

/**
 * The uploaded document as the frame's `srcdoc`: placeholders filled, image adjustments applied, a viewport
 * meta (if missing) + the responsive base sheet first in <head>, plus a small click handler — in-page `#anchors`
 * scroll inside the design, other links open in the top window (outside sites in a new tab), and every link is
 * inert in the editor / previews.
 */
export function htmlDesignDocument(
  html: string,
  values: Record<string, string>,
  inert: boolean,
  images: HtmlImageAdjust[] = [],
  links: Record<string, HtmlDesignLink> = {},
): string {
  const adjusted = applyHtmlImageAdjustments(html, images)
  const text = Object.keys(links).length ? linkableTextRanges(adjusted) : []
  const inText = (at: number) => text.some(([start, end]) => at >= start && at < end)
  const filled = adjusted.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string, at: number) => {
    if (!(key in values)) return m
    const link = links[key]
    return link?.href && SAFE_HREF.test(link.href) && inText(at)
      ? linkHtml(values[key]!, link)
      : escapeHtml(values[key]!)
  })
  const script = `<script>(()=>{const inert=${inert};document.addEventListener('click',(e)=>{const a=e.target instanceof Element&&e.target.closest('a[href]');if(!a)return;const h=a.getAttribute('href')||'';if(h.startsWith('#'))return;if(inert){e.preventDefault();return}if(!a.target){a.target=/^https?:/i.test(h)?'_blank':'_top';if(a.target==='_blank')a.rel='noopener'}},true)})()</script>`
  const head = `${hasViewport(filled) ? '' : VIEWPORT}<style data-spa-base>${HTML_DESIGN_BASE_CSS}</style>${script}`
  return insertAtHead(filled, head)
}

/**
 * R24: where an uploaded HTML design references files (images, fonts, videos), as exact string ranges, so embedded
 * `data:` payloads can be moved out to stored files (same bytes, served with their type) and the URLs rewritten —
 * nothing else in the document changes. Pure; the services decode, store and decide (site-html-assets.ts).
 * Scanned: img/source src+srcset, video src+poster, input[type=image] src, link[rel~=icon|apple-touch-icon|preload]
 * href, SVG image/feImage href + xlink:href, every style="" and every <style> body (CSS url() and the strings of
 * image-set(), which covers @font-face src lists). Skipped: comments, <script> and other raw-text bodies. Anything
 * unclear (stray backslash, unterminated url(, unknown entity in a srcset) is left alone.
 */
import { HTML_IMAGE_SRC_MAX, type HtmlImageAdjust, listHtmlDesignImages, tagEnd } from './html-design'

export type HtmlAssetRef = {
  /** The URL's exact range in the document (inside the quotes). */
  start: number
  end: number
  /** The URL as the browser reads it (entities decoded, CSS line continuations removed). */
  url: string
  where: 'attr' | 'css'
  /** The element (lowercase) and attribute holding it; for CSS, the style attribute's element or 'style'. */
  tag: string
  attr?: string
  /** Index of the element's `<` and just past its name (where an attribute can be added). */
  tagStart: number
  nameEnd: number
  /** The element already has a `crossorigin` attribute. */
  crossorigin?: boolean
}

const isWs = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r'
const identChar = (c: string | undefined) => c !== undefined && /[\w-]/.test(c)

type Attr = { name: string; start: number; end: number }

/** Attributes of a tag whose attributes start at `j` (same tokenizing as `tagEnd`); value ranges exclude quotes. */
function attributesOf(src: string, j: number): Attr[] {
  const out: Attr[] = []
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
  // The parser keeps the first of duplicate attributes.
  const seen = new Set<string>()
  return out.filter((a) => !seen.has(a.name) && seen.add(a.name))
}

const NAMED: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }
/** Character references in an attribute value (unknown named ones stay as written). */
export function decodeEntities(s: string): string {
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z]{2,8}));?/g, (m, dec, hex, name) => {
    if (dec || hex) {
      const cp = Number.parseInt(dec ?? hex, dec ? 10 : 16)
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m
    }
    return NAMED[name.toLowerCase()] ?? m
  })
}

const trimUrl = (s: string) => s.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '')

/** The quote at `i`: `"` / `'`, and in attribute values also their character references. */
function quoteAt(s: string, i: number, attr: boolean): { q: string; len: number } | null {
  const c = s[i]
  if (c === '"' || c === "'") return { q: c, len: 1 }
  if (!attr || c !== '&') return null
  const m = /^&(?:quot|#0*34|#[xX]0*22|apos|#0*39|#[xX]0*27);/.exec(s.slice(i, i + 10))
  if (!m) return null
  return { q: /quot|34|22/.test(m[0]) ? '"' : "'", len: m[0].length }
}

/** End of a CSS string started at `i` (after its quote): [content end, index after the closing quote] or null. */
function stringEnd(s: string, i: number, q: string, attr: boolean): [number, number] | null {
  for (let j = i; j < s.length; j++) {
    const c = s[j]
    if (c === '\\') {
      j++
      continue
    }
    if (c === '\n' || c === '\r' || c === '\f') return null // bad string
    const close = quoteAt(s, j, attr)
    if (close && close.q === q) return [j, j + close.len]
  }
  return null
}

/** A CSS string's value: only line continuations may be escaped, anything else ⇒ null (left alone). */
function cssStringValue(raw: string, attr: boolean): string | null {
  const v = raw.replace(/\\(?:\r\n|[\n\r\f])/g, '')
  if (v.includes('\\')) return null
  return attr ? decodeEntities(v) : v
}

/** CSS url() and image-set() string refs inside one CSS text (style body or style attribute value). */
function cssRefs(
  css: string,
  offset: number,
  attr: boolean,
  base: Omit<HtmlAssetRef, 'start' | 'end' | 'url'>,
  out: HtmlAssetRef[],
) {
  const n = css.length
  let depth = 0
  const sets: number[] = []
  let i = 0
  const push = (start: number, end: number, url: string | null) => {
    const u = url === null ? null : trimUrl(url)
    if (u) out.push({ ...base, start: offset + start, end: offset + end, url: u })
  }
  while (i < n) {
    const c = css[i]!
    if (c === '/' && css[i + 1] === '*') {
      const e = css.indexOf('*/', i + 2)
      i = e < 0 ? n : e + 2
      continue
    }
    const q = quoteAt(css, i, attr)
    if (q) {
      const end = stringEnd(css, i + q.len, q.q, attr)
      if (!end) {
        // Unterminated string: skip the rest of the line.
        const nl = css.slice(i).search(/[\n\r\f]/)
        i = nl < 0 ? n : i + nl + 1
        continue
      }
      if (sets.length) push(i + q.len, end[0], cssStringValue(css.slice(i + q.len, end[0]), attr))
      i = end[1]
      continue
    }
    if (c === '\\') {
      i += 2
      continue
    }
    if ((c === 'u' || c === 'U') && !identChar(css[i - 1]) && css.slice(i, i + 4).toLowerCase() === 'url(') {
      let j = i + 4
      while (isWs(css[j])) j++
      const uq = quoteAt(css, j, attr)
      if (uq) {
        const end = stringEnd(css, j + uq.len, uq.q, attr)
        if (!end) {
          i = j
          continue
        }
        let k = end[1]
        while (isWs(css[k])) k++
        if (css[k] === ')') push(j + uq.len, end[0], cssStringValue(css.slice(j + uq.len, end[0]), attr))
        i = k + 1
        continue
      }
      let k = j
      while (k < n && css[k] !== ')' && !isWs(css[k])) k++
      const raw = css.slice(j, k)
      let e = k
      while (isWs(css[e])) e++
      if (css[e] !== ')') {
        // Unterminated or a bad url(: leave it alone.
        i = e < n ? e : n
        continue
      }
      if (raw && !/["'(\\]/.test(raw) && !(attr && raw.includes('&'))) push(j, k, raw)
      i = e + 1
      continue
    }
    if ((c === 'i' || c === 'I' || c === '-') && !identChar(css[i - 1])) {
      const m = /^(?:-webkit-)?image-set\(/i.exec(css.slice(i, i + 20))
      if (m) {
        depth++
        sets.push(depth)
        i += m[0].length
        continue
      }
    }
    if (c === '(') depth++
    else if (c === ')') {
      if (sets[sets.length - 1] === depth) sets.pop()
      depth = Math.max(0, depth - 1)
    }
    i++
  }
}

/** srcset candidates (WHATWG parsing: a URL runs until whitespace, so a data: URI's comma is fine). */
function srcsetRefs(
  html: string,
  a: Attr,
  base: Omit<HtmlAssetRef, 'start' | 'end' | 'url'>,
  out: HtmlAssetRef[],
) {
  let i = a.start
  const end = a.end
  while (i < end) {
    while (i < end && (isWs(html[i]) || html[i] === ',')) i++
    if (i >= end) break
    const us = i
    while (i < end && !isWs(html[i])) i++
    let ue = i
    let descriptors = true
    if (html[ue - 1] === ',') {
      while (ue > us && html[ue - 1] === ',') ue--
      descriptors = false
    }
    const raw = html.slice(us, ue)
    // A character reference in a candidate: positions would shift — left alone.
    if (raw && !raw.includes('&')) out.push({ ...base, start: us, end: ue, url: raw })
    if (descriptors) {
      let paren = 0
      while (i < end) {
        const c = html[i]
        if (c === '(') paren++
        else if (c === ')') paren = Math.max(0, paren - 1)
        else if (c === ',' && !paren) break
        i++
      }
      i++
    }
  }
}

const URL_ATTRS: Record<string, string[]> = {
  img: ['src', 'srcset'],
  source: ['src', 'srcset'],
  video: ['src', 'poster'],
  input: ['src'],
  link: ['href'],
  image: ['href', 'xlink:href'],
  feimage: ['href', 'xlink:href'],
}
const LINK_RELS = /(?:^|\s)(?:icon|apple-touch-icon(?:-precomposed)?|preload)(?:\s|$)/i
/** Bodies that are not markup (no element or url there loads anything). `style` bodies are CSS (scanned). */
const RAW_BODY = new Set(['script', 'title', 'textarea', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript'])

/** Every file reference of the document, in document order. */
export function htmlDesignAssetRefs(html: string): HtmlAssetRef[] {
  const out: HtmlAssetRef[] = []
  const n = html.length
  const tagRe = /<([a-zA-Z][^\t\n\f\r />]*)/y
  let i = 0
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt === -1) break
    if (html.startsWith('<!--', lt)) {
      const close = /--!?>/g
      close.lastIndex = lt + 2
      const m = close.exec(html)
      i = m ? m.index + m[0].length : n
      continue
    }
    const next = html[lt + 1]
    if (next === '/' || next === '!' || next === '?') {
      const gt = html.indexOf('>', lt + 2)
      i = gt === -1 ? n : gt + 1
      continue
    }
    tagRe.lastIndex = lt
    const tag = tagRe.exec(html)
    if (!tag) {
      i = lt + 1
      continue
    }
    const name = tag[1]!.toLowerCase()
    const nameEnd = lt + tag[0].length
    const end = tagEnd(html, nameEnd)
    const attrs = attributesOf(html, nameEnd)
    const get = (a: string) => attrs.find((x) => x.name === a)
    const value = (a: Attr | undefined) =>
      a && a.start >= 0 ? decodeEntities(html.slice(a.start, a.end)) : ''
    const base = { tag: name, tagStart: lt, nameEnd, ...(get('crossorigin') ? { crossorigin: true } : {}) }
    const wanted =
      name === 'input' && value(get('type')).trim().toLowerCase() !== 'image'
        ? []
        : name === 'link' && !LINK_RELS.test(value(get('rel')))
          ? []
          : (URL_ATTRS[name] ?? [])
    for (const a of attrs) {
      if (a.start < 0) continue
      if (a.name === 'style')
        cssRefs(html.slice(a.start, a.end), a.start, true, { ...base, where: 'css', attr: 'style' }, out)
      else if (wanted.includes(a.name)) {
        const b = { ...base, where: 'attr' as const, attr: a.name }
        if (a.name === 'srcset') srcsetRefs(html, a, b, out)
        else {
          const url = trimUrl(decodeEntities(html.slice(a.start, a.end)))
          if (url) out.push({ ...b, start: a.start, end: a.end, url })
        }
      }
    }
    i = end
    if (name === 'plaintext') break
    if (name === 'style' || RAW_BODY.has(name)) {
      const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, 'gi')
      close.lastIndex = end
      const stop = close.exec(html)?.index ?? n
      if (name === 'style')
        cssRefs(html.slice(end, stop), end, false, { tag: 'style', tagStart: lt, nameEnd, where: 'css' }, out)
      i = stop
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

/**
 * Rewrites refs: `replace(ref)` returns the new URL, or null to keep it. An <img>/<video> whose every URL is
 * rewritten (and has no crossorigin attribute) gets `crossorigin="anonymous"`: its data: original never tainted a
 * canvas / WebGL texture, and the moved file (served with `Access-Control-Allow-Origin: *`) then doesn't either.
 */
export function rewriteHtmlDesignAssets(
  html: string,
  refs: HtmlAssetRef[],
  replace: (ref: HtmlAssetRef) => string | null,
  opts: { crossorigin?: boolean } = {},
): string {
  const edits: { at: number; end: number; text: string }[] = []
  const tags = new Map<number, { ref: HtmlAssetRef; all: number; moved: number }>()
  for (const ref of refs) {
    const url = replace(ref)
    if (url !== null) edits.push({ at: ref.start, end: ref.end, text: url })
    if (
      opts.crossorigin === false ||
      ref.where !== 'attr' ||
      (ref.tag !== 'img' && ref.tag !== 'video') ||
      ref.crossorigin
    )
      continue
    const t = tags.get(ref.tagStart) ?? { ref, all: 0, moved: 0 }
    t.all++
    if (url !== null) t.moved++
    tags.set(ref.tagStart, t)
  }
  for (const t of tags.values())
    if (t.moved && t.moved === t.all)
      edits.push({ at: t.ref.nameEnd, end: t.ref.nameEnd, text: ' crossorigin="anonymous"' })
  let out = ''
  let pos = 0
  for (const e of edits.sort((a, b) => a.at - b.at || a.end - b.end)) {
    if (e.at < pos) continue
    out += html.slice(pos, e.at) + e.text
    pos = e.end
  }
  return out + html.slice(pos)
}

export type DataUri = { mime: string; base64: boolean; payload: string }

/** `data:[type][;params][;base64],payload` → its parts (type lowercased, default text/plain); null if not a data: URI. */
export function parseDataUri(url: string): DataUri | null {
  if (!/^data:/i.test(url)) return null
  const comma = url.indexOf(',')
  if (comma < 0) return null
  const head = url
    .slice(5, comma)
    .split(';')
    .map((p) => p.trim())
  const base64 = head.length > 1 && head[head.length - 1]!.toLowerCase() === 'base64'
  const mime = (head[0] || 'text/plain').toLowerCase()
  return { mime, base64, payload: url.slice(comma + 1) }
}

/** Same ids, new `src` keys: adjustments that matched an image before its URL changed still match it after. */
export function remapHtmlImageAdjustments(
  before: string,
  after: string,
  images: HtmlImageAdjust[],
): HtmlImageAdjust[] {
  if (!images.length) return images
  const was = new Map(listHtmlDesignImages(before).map((i) => [i.id, i.src.slice(0, HTML_IMAGE_SRC_MAX)]))
  const now = new Map(listHtmlDesignImages(after).map((i) => [i.id, i.src.slice(0, HTML_IMAGE_SRC_MAX)]))
  return images.map((a) => (was.get(a.id) === a.src && now.has(a.id) ? { ...a, src: now.get(a.id)! } : a))
}

/** Stored size of a design (it is saved inside page JSON: quotes, backslashes and newlines escaped). */
export const htmlDesignStoredSize = (s: string) => JSON.stringify(s).length - 2

export type HtmlDesignSizeReport = {
  total: number
  markup: number
  styles: number
  scripts: number
  svg: number
  /** data: payloads still inside the document. */
  embedded: { count: number; bytes: number }
}

/** What a design's size is made of (stored sizes), for "still too big" messages. */
export function htmlDesignSizeReport(html: string): HtmlDesignSizeReport {
  const size = htmlDesignStoredSize
  const r: HtmlDesignSizeReport = {
    total: size(html),
    markup: 0,
    styles: 0,
    scripts: 0,
    svg: 0,
    embedded: { count: 0, bytes: 0 },
  }
  const blocks: { start: number; end: number; kind: 'scripts' | 'styles' | 'svg' }[] = []
  for (const m of html.matchAll(/<(script|style|svg)\b[\s\S]*?(?:<\/\1\s*>|$)/gi)) {
    const t = m[1]!.toLowerCase()
    blocks.push({
      start: m.index,
      end: m.index + m[0].length,
      kind: t === 'script' ? 'scripts' : t === 'style' ? 'styles' : 'svg',
    })
    r[blocks[blocks.length - 1]!.kind] += size(m[0])
  }
  for (const ref of htmlDesignAssetRefs(html)) {
    if (!/^data:/i.test(ref.url)) continue
    const bytes = size(html.slice(ref.start, ref.end))
    r.embedded.count++
    r.embedded.bytes += bytes
    const inBlock = blocks.find((b) => ref.start >= b.start && ref.start < b.end)
    if (inBlock) r[inBlock.kind] -= bytes
  }
  r.markup = Math.max(0, r.total - r.styles - r.scripts - r.svg - r.embedded.bytes)
  return r
}

export type HtmlPatch = { find: string; replace: string }

/** How many times `find` occurs in `s` (overlapping), counting up to `cap`. */
function occurrences(s: string, find: string, cap: number) {
  const at: number[] = []
  for (let i = s.indexOf(find); i >= 0 && at.length < cap; i = s.indexOf(find, i + 1)) at.push(i)
  return at
}

/**
 * Exact-string edits, applied in order (each `find` against the result so far); every `find` must occur exactly
 * once. All-or-nothing: the first edit that doesn't fit returns its error.
 */
export function patchHtml(
  html: string,
  edits: HtmlPatch[],
): { ok: true; html: string; at: number[] } | { ok: false; error: string } {
  let out = html
  const at: number[] = []
  for (const [i, e] of edits.entries()) {
    if (!e.find) return { ok: false, error: `Edit ${i + 1}: \`find\` is empty` }
    const hits = occurrences(out, e.find, 100)
    if (hits.length !== 1)
      return {
        ok: false,
        error:
          hits.length === 0
            ? `Edit ${i + 1}: \`find\` matches 0 times — copy it exactly from get_html_design`
            : `Edit ${i + 1}: \`find\` matches ${hits.length === 100 ? '100+' : hits.length} times — include more surrounding text so it is unique`,
      }
    out = out.slice(0, hits[0]) + e.replace + out.slice(hits[0]! + e.find.length)
    at.push(hits[0]!)
  }
  return { ok: true, html: out, at }
}

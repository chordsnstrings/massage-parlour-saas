// Content extraction for the Studio site import (F32): one fetched HTML page → title, description, headline,
// sections (heading + paragraphs), services with prices / durations, opening hours, contact details, images and links
// worth following. Pure and dependency-free (a small quote-aware tokenizer; scripts, styles, svg, forms and nav text
// are skipped; schema.org JSON-LD is read for business data). Everything returned is untrusted text from a third-party
// site: callers treat it strictly as data (it only ever lands in block props, which the renderer escapes).

export type ImportService = { name: string; price: number | null; duration: number | null }
export type ImportContact = {
  phones: string[]
  emails: string[]
  whatsapp: string[]
  address: string | null
  instagram: string | null
  facebook: string | null
}
export type ImportImage = { url: string; alt: string }
export type ImportSection = { heading: string; text: string[] }

export type PageExtract = {
  url: string
  lang: 'en' | 'ar'
  title: string | null
  name: string | null
  description: string | null
  headline: string | null
  /** Text right under the headline (hero subtitle when there is no meta description). */
  lead: string | null
  sections: ImportSection[]
  services: ImportService[]
  hours: string[]
  contact: ImportContact
  images: ImportImage[]
  links: { url: string; text: string }[]
}

/* ------------------------------------------------------------------ Tokenizer */

type Tok =
  | { t: 'open'; name: string; attrs: Record<string, string> }
  | { t: 'close'; name: string }
  | { t: 'text'; text: string }
  | { t: 'raw'; name: string; text: string; attrs: Record<string, string> }

const RAW = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
])
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

const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  middot: '·',
  bull: '•',
  times: '×',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  deg: '°',
  laquo: '«',
  raquo: '»',
  shy: '',
  zwj: '',
  zwnj: '',
  rlm: '',
  lrm: '',
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))
      return Number.isFinite(n) && n > 0 && n < 0x110000 && !(n >= 0xd800 && n <= 0xdfff)
        ? String.fromCodePoint(n)
        : ''
    }
    const v = NAMED[e.toLowerCase()]
    return v === undefined ? m : v
  })
}

function parseAttrs(src: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const m of src.matchAll(re)) {
    const k = m[1]!.toLowerCase()
    if (!(k in out)) out[k] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

/** End of a tag starting at `i` (index of its `>`), quote-aware; -1 when unterminated. */
function tagEnd(html: string, i: number) {
  let q: string | null = null
  for (let j = i; j < html.length; j++) {
    const c = html[j]
    if (q) {
      if (c === q) q = null
    } else if (c === '"' || c === "'") q = c
    else if (c === '>') return j
  }
  return -1
}

function* tokenize(html: string): Generator<Tok> {
  let i = 0
  const n = html.length
  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      yield { t: 'text', text: decodeEntities(html.slice(i)) }
      return
    }
    if (lt > i) yield { t: 'text', text: decodeEntities(html.slice(i, lt)) }
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4)
      i = end === -1 ? n : end + 3
      continue
    }
    const next = html[lt + 1]
    if (next === '!' || next === '?') {
      const end = html.indexOf('>', lt)
      i = end === -1 ? n : end + 1
      continue
    }
    const close = next === '/'
    const nameMatch = html.slice(lt + (close ? 2 : 1), lt + 40).match(/^[a-zA-Z][a-zA-Z0-9-]*/)
    if (!nameMatch) {
      yield { t: 'text', text: '<' }
      i = lt + 1
      continue
    }
    const name = nameMatch[0].toLowerCase()
    const end = tagEnd(html, lt + 1)
    if (end === -1) return
    if (close) {
      yield { t: 'close', name }
      i = end + 1
      continue
    }
    const attrs = parseAttrs(html.slice(lt + 1 + name.length, end).replace(/\/$/, ''))
    if (RAW.has(name)) {
      const closeRe = new RegExp(`</${name}\\s*>`, 'i')
      const rest = html.slice(end + 1)
      const m = closeRe.exec(rest)
      const text = m ? rest.slice(0, m.index) : rest
      yield { t: 'raw', name, text, attrs }
      i = m ? end + 1 + m.index + m[0].length : n
      continue
    }
    yield { t: 'open', name, attrs }
    i = end + 1
  }
}

/* ------------------------------------------------------------------ Patterns */

const ARABIC_DIGITS = /[٠-٩۰-۹]/g
const toLatinDigits = (s: string) =>
  s.replace(ARABIC_DIGITS, (d) => String((d.charCodeAt(0) - (d >= '۰' ? 0x6f0 : 0x660)) % 10))
const clean = (s: string) => s.replace(/[​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim()
/** UAE numbers in one form (+971…), so a tel: link and the same number in text count once. */
export function importPhone(raw: string) {
  const d = raw.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) return d
  if (d.startsWith('00')) return `+${d.slice(2)}`
  if (d.startsWith('971')) return `+${d}`
  if (d.startsWith('0') && d.length >= 9 && d.length <= 10) return `+971${d.slice(1)}`
  return d
}
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s)

const CURRENCY = String.raw`(?:AED|Dhs?\.?|DHS|DH|د\.إ\.?|درهم)`
const AMOUNT = String.raw`(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)`
const PRICE_RE = new RegExp(
  String.raw`${CURRENCY}\s*${AMOUNT}|${AMOUNT}\s*(?:${CURRENCY}|dirhams?)(?![a-z])`,
  'gi',
)
const DURATION_RE =
  /(?<![\d.])(\d{2,3})\s*-?\s*(?:minutes?|mins?|دقيقة|دقائق)|(?<![\d.])(\d(?:\.\d)?)\s*(?:hours?|hrs?|hr\b|h\b|ساعة|ساعات)/gi
const DAY_RE =
  /\b(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|nesday|rsday|urday)?s?\b|\bdaily\b|\bevery ?day\b|\b7 days\b|\bweekdays?\b|\bweekends?\b|السبت|الأحد|الاثنين|الإثنين|الثلاثاء|الأربعاء|الخميس|الجمعة|يومي/i
const TIME_RE =
  /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|a\.m\.|p\.m\.)|\b\d{1,2}:\d{2}\b|\bmidnight\b|\bnoon\b|24\s*(?:hours|hrs|\/\s*7)|صباح|مساء/i
const PHONE_RE = /(?:\+971|00971|\b0)[\s-]?(?:5[024568]|[2-9])[\s-]?\d{3}[\s-]?\d{4}\b/g
const EMAIL_RE = /\b[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}\b/gi
const ONE_EMAIL = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}$/i
const HAS_PHONE = new RegExp(PHONE_RE.source)
const SKIP_IMAGE =
  /logo|icon|sprite|pixel|spacer|avatar|badge|payment|visa|mastercard|flag|loader|placeholder|blank\./i
const LINK_WORDS: [RegExp, number][] = [
  [/servic|treatment|menu|price|pricing|rates|massage|packages?|خدمات|الأسعار|العلاجات/i, 3],
  [/contact|location|find-us|visit|hours|تواصل|اتصل/i, 2],
  [/about|story|gallery|من-نحن|معرض/i, 1],
]

/* ------------------------------------------------------------------ Walk */

/** `row` = a table row (cells joined with ·): data for prices / hours, never section copy. */
type Block = { kind: 'h1' | 'h2' | 'h3' | 'h4' | 'p' | 'li'; text: string; footer: boolean; row?: boolean }

const BLOCK = new Set([
  'p',
  'div',
  'section',
  'article',
  'main',
  'aside',
  'header',
  'footer',
  'li',
  'ul',
  'ol',
  'dl',
  'dt',
  'dd',
  'tr',
  'table',
  'tbody',
  'thead',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'address',
  'figure',
  'figcaption',
  'br',
  'hr',
  'label',
])
/** Text inside these is not page copy (menus, forms, decoration). */
const SKIP_TEXT = new Set(['nav', 'svg', 'form', 'select', 'button', 'template', 'math', 'canvas'])

const absolute = (href: string, base: string) => {
  try {
    const u = new URL(href.trim(), base)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null
  } catch {
    return null
  }
}

function srcsetBest(srcset: string) {
  let best: { url: string; w: number } | null = null
  for (const part of srcset.split(',')) {
    const [url, d] = part.trim().split(/\s+/)
    if (!url) continue
    const w = d?.endsWith('w') ? Number.parseInt(d, 10) : d?.endsWith('x') ? Number.parseFloat(d) * 1000 : 1
    if (!best || w >= best.w) best = { url, w }
  }
  return best?.url ?? null
}

/** Extracts one page. `url` = its final address (relative links resolve against it, or `<base href>`). */
export function extractPage(html: string, url: string): PageExtract {
  let base = url
  let lang: 'en' | 'ar' = 'en'
  let title: string | null = null
  const meta: Record<string, string> = {}
  const blocks: Block[] = []
  const images: ImportImage[] = []
  const links: { url: string; text: string }[] = []
  const phones: string[] = []
  const emails: string[] = []
  const whatsapp: string[] = []
  let instagram: string | null = null
  let facebook: string | null = null
  const jsonLd: unknown[] = []

  const stack: string[] = []
  let skip = 0
  let footer = 0
  let heading: Block['kind'] | null = null
  let inLi = 0
  let cells = false
  let buf = ''
  // The open <a> (set by onLink, a closure — kept in an object so its type isn't narrowed to null below).
  const link: { open: { url: string; text: string } | null } = { open: null }
  const hiddenAt: number[] = []

  const flush = () => {
    const text = clean(buf)
    buf = ''
    const row = cells
    cells = false
    if (row) {
      const t = text.replace(/^·\s*/, '')
      if (t.length >= 2) blocks.push({ kind: 'li', text: t, footer: footer > 0, row: true })
      return
    }
    if (!text || text.length < 2) return
    blocks.push({
      kind: heading ?? (inLi ? 'li' : 'p'),
      text,
      footer: footer > 0,
      ...(cells ? { row: true } : {}),
    })
  }
  const addImage = (src: string | undefined, alt: string, w?: string, h?: string) => {
    if (!src || src.startsWith('data:')) return
    const u = absolute(src, base)
    if (!u || /\.(svg|ico)(?:$|[?#])/i.test(u.pathname)) return
    if ((w && Number.parseInt(w, 10) < 120) || (h && Number.parseInt(h, 10) < 120)) return
    if (SKIP_IMAGE.test(u.pathname) || SKIP_IMAGE.test(alt)) return
    const href = u.toString()
    if (href.length > 1500 || images.some((i) => i.url === href)) return
    images.push({ url: href, alt: clip(clean(alt), 200) })
  }
  const styleImage = (style: string | undefined) => {
    const m = style?.match(/background(?:-image)?\s*:[^;]*url\(\s*['"]?([^'")]+)['"]?\s*\)/i)
    if (m) addImage(m[1], '')
  }
  const onLink = (href: string) => {
    const h = href.trim()
    if (/^tel:/i.test(h)) {
      const num = importPhone(decodeURIComponent(h.slice(4)))
      if (num.length >= 7) phones.push(num)
      return
    }
    if (/^mailto:/i.test(h)) {
      const e = decodeURIComponent(h.slice(7).split('?')[0] ?? '').trim()
      if (ONE_EMAIL.test(e)) emails.push(e.toLowerCase())
      return
    }
    const u = absolute(h, base)
    if (!u) return
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'wa.me' || host === 'api.whatsapp.com' || host === 'web.whatsapp.com') {
      const num = (host === 'wa.me' ? u.pathname.slice(1) : (u.searchParams.get('phone') ?? '')).replace(
        /\D/g,
        '',
      )
      if (num.length >= 7) whatsapp.push(num)
      return
    }
    if (host === 'instagram.com' && !instagram) {
      const handle = u.pathname.split('/').filter(Boolean)[0]
      if (handle && !['p', 'reel', 'reels', 'explore', 'stories'].includes(handle))
        instagram = `https://instagram.com/${handle}`
      return
    }
    if ((host === 'facebook.com' || host === 'fb.com') && !facebook) {
      const page = u.pathname.split('/').filter(Boolean)[0]
      if (page && !['sharer', 'sharer.php', 'share', 'dialog', 'tr', 'plugins'].includes(page))
        facebook = `https://facebook.com/${page}`
      return
    }
    link.open = { url: u.toString(), text: '' }
  }

  for (const tok of tokenize(html)) {
    if (tok.t === 'raw') {
      if (tok.name === 'title' && !title) title = clip(clean(decodeEntities(tok.text)), 200) || null
      if (tok.name === 'script' && /ld\+json/i.test(tok.attrs.type ?? '')) {
        try {
          jsonLd.push(JSON.parse(tok.text))
        } catch {
          // not JSON
        }
      }
      continue
    }
    if (tok.t === 'text') {
      // Menu links keep their text (it names the page) even though menus aren't page copy.
      if (link.open) link.open.text += tok.text
      if (skip) continue
      buf += tok.text
      continue
    }
    if (tok.t === 'open') {
      const { name, attrs } = tok
      if (name === 'html') {
        if (/^ar\b/i.test(attrs.lang ?? '') || attrs.dir === 'rtl') lang = 'ar'
        continue
      }
      if (name === 'base' && attrs.href) {
        const b = absolute(attrs.href, url)
        if (b) base = b.toString()
        continue
      }
      if (name === 'meta') {
        const key = (attrs.property ?? attrs.name ?? '').toLowerCase()
        if (key && attrs.content) meta[key] = attrs.content
        continue
      }
      if (name === 'img') {
        addImage(
          attrs['data-src'] ??
            attrs['data-lazy-src'] ??
            (attrs.srcset ? srcsetBest(attrs.srcset) : null) ??
            attrs.src,
          attrs.alt ?? '',
          attrs.width,
          attrs.height,
        )
        styleImage(attrs.style)
        continue
      }
      if (name === 'source' && attrs.srcset && (attrs.type ?? 'image/').startsWith('image/')) {
        addImage(srcsetBest(attrs.srcset) ?? undefined, '')
        continue
      }
      styleImage(attrs.style)
      if (VOID.has(name)) {
        if (name === 'br' || name === 'hr') flush()
        continue
      }
      stack.push(name)
      const hidden =
        'hidden' in attrs || attrs['aria-hidden'] === 'true' || /display\s*:\s*none/i.test(attrs.style ?? '')
      if (SKIP_TEXT.has(name) || hidden) {
        skip++
        hiddenAt.push(stack.length)
      }
      if (name === 'footer') footer++
      if (name === 'a' && attrs.href) onLink(attrs.href)
      if (name === 'td' || name === 'th') {
        buf += ' · '
        cells = true
      }
      if (BLOCK.has(name)) flush()
      if (/^h[1-6]$/.test(name)) heading = (Number(name[1]) <= 3 ? name : 'h4') as Block['kind']
      if (name === 'li' || name === 'dt' || name === 'dd') inLi++
      continue
    }
    // close
    const { name } = tok
    const at = stack.lastIndexOf(name)
    if (at === -1) continue
    while (stack.length > at) {
      const open = stack.pop()!
      if (hiddenAt.length && hiddenAt[hiddenAt.length - 1] === stack.length + 1) {
        hiddenAt.pop()
        skip--
      }
      if (open === 'a' && link.open) {
        links.push({ url: link.open.url, text: clip(clean(link.open.text), 80) })
        link.open = null
      }
      if (BLOCK.has(open) || /^h[1-6]$/.test(open)) flush()
      if (/^h[1-6]$/.test(open)) heading = null
      if (open === 'li' || open === 'dt' || open === 'dd') inLi = Math.max(0, inLi - 1)
      if (open === 'footer') footer = Math.max(0, footer - 1)
    }
  }
  flush()

  const ld = readJsonLd(jsonLd)
  const og = meta['og:image'] ?? meta['twitter:image']
  if (og) {
    const before = images.length
    addImage(og, meta['og:image:alt'] ?? '')
    // The share image is usually the best hero: put it first.
    if (images.length > before) images.unshift(images.pop()!)
  }
  for (const src of ld.images) addImage(src, '')

  // Contact details in text (phones, emails) + labelled address lines.
  let address: string | null = ld.address
  for (const b of blocks) {
    const latin = toLatinDigits(b.text)
    for (const m of latin.matchAll(PHONE_RE)) phones.push(importPhone(m[0]))
    for (const m of b.text.matchAll(EMAIL_RE)) emails.push(m[0].toLowerCase())
    if (!address) {
      const a = b.text.match(/^(?:address|location|find us|العنوان|الموقع)\s*[:：-]\s*(.{8,200})$/i)
      if (a) address = clean(a[1]!)
    }
  }

  const textBlocks = blocks.filter((b) => !b.footer)
  const headline = textBlocks.find((b) => b.kind === 'h1')?.text ?? null
  const services = dedupeServices([...ld.services, ...findServices(blocks)])
  const hours = [...new Set([...ld.hours, ...findHours(blocks)])].slice(0, 8)
  const { sections, lead } = buildSections(textBlocks, headline)
  return {
    url,
    lang,
    title,
    name: clip(clean(meta['og:site_name'] ?? ld.name ?? ''), 80) || null,
    description: clip(clean(meta.description ?? meta['og:description'] ?? ''), 400) || null,
    headline: headline ? clip(headline, 160) : null,
    lead,
    sections,
    services,
    hours,
    contact: {
      phones: [...new Set([...ld.phones, ...phones])].slice(0, 3),
      emails: [...new Set([...ld.emails, ...emails])].slice(0, 2),
      whatsapp: [...new Set(whatsapp)].slice(0, 2),
      address: address ? clip(address, 200) : null,
      instagram: instagram ?? ld.instagram,
      facebook: facebook ?? ld.facebook,
    },
    images: images.slice(0, 16),
    links,
  }
}

/* ------------------------------------------------------------------ Structure */

const isPriceText = (s: string) => {
  PRICE_RE.lastIndex = 0
  const r = PRICE_RE.test(toLatinDigits(s))
  PRICE_RE.lastIndex = 0
  return r
}
const isHoursText = (s: string) => s.length <= 160 && DAY_RE.test(s) && TIME_RE.test(s)

function buildSections(blocks: Block[], headline: string | null) {
  const sections: ImportSection[] = []
  let current: ImportSection | null = null
  let lead: string | null = null
  let afterHeadline = false
  for (const b of blocks) {
    if (b.kind === 'h1' || b.kind === 'h2' || b.kind === 'h3') {
      afterHeadline = b.kind === 'h1' && b.text === headline
      if (afterHeadline) {
        current = null
        continue
      }
      if (b.text.length > 120 || isPriceText(b.text)) {
        current = null
        continue
      }
      current = { heading: b.text, text: [] }
      sections.push(current)
      continue
    }
    if (b.row || b.text.length < 30 || isPriceText(b.text) || isHoursText(b.text) || HAS_PHONE.test(b.text))
      continue
    if (afterHeadline && !lead) {
      lead = clip(b.text, 400)
      continue
    }
    if (current && current.text.length < 4 && !current.text.includes(b.text))
      current.text.push(clip(b.text, 700))
  }
  const seen = new Set<string>()
  return {
    lead,
    sections: sections
      .filter((s) => s.text.length > 0)
      .filter((s) => {
        const k = s.heading.toLowerCase()
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      .slice(0, 6),
  }
}

/** "Swedish massage — 60 min · AED 350", "90 mins 420 AED", table rows, a name heading above a price line. */
function findServices(blocks: Block[]): ImportService[] {
  const out: ImportService[] = []
  blocks.forEach((b, i) => {
    const text = toLatinDigits(b.text)
    if (text.length > 300) return
    const prices = [...text.matchAll(PRICE_RE)]
    if (!prices.length) return
    const durations = [...text.matchAll(DURATION_RE)]
    const firstAt = Math.min(prices[0]!.index!, durations[0]?.index ?? Number.POSITIVE_INFINITY)
    let name = clean(
      text
        .slice(0, firstAt)
        .replace(/[\s:|·•–—\-.,(/]+$/, '')
        .replace(/\s+(?:from|starting(?: at)?|starts at|only|at|for)$/i, '')
        .replace(/^[\s:|·•–—\-.]+/, ''),
    )
    if (name.length < 3 || name.length > 80 || /^(from|starting|only|price|السعر)$/i.test(name)) {
      // The name is usually the heading / line just above the price line.
      name = ''
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const prev = blocks[j]!.text
        if (prev.length >= 3 && prev.length <= 80 && !isPriceText(prev) && !isHoursText(prev)) {
          name = clean(prev)
          break
        }
      }
    }
    if (!name || name.length > 80) return
    let prevEnd = 0
    for (const p of prices) {
      const amount = Number((p[1] ?? p[2] ?? '').replace(/,/g, ''))
      if (!(amount >= 10 && amount <= 20000)) continue
      const at = p.index!
      const before = durations.filter((d) => d.index! >= prevEnd && d.index! < at).pop()
      const after = durations.find(
        (d) => d.index! > at && !prices.some((q) => q.index! > at && q.index! < d.index!),
      )
      const d = before ?? (prices.length === 1 ? (after ?? durations[0]) : after)
      const minutes = d ? (d[1] ? Number(d[1]) : Math.round(Number(d[2]) * 60)) : null
      out.push({ name: clip(name, 80), price: amount, duration: minutes && minutes <= 600 ? minutes : null })
      prevEnd = at + p[0].length
    }
  })
  return out
}

function dedupeServices(list: ImportService[]) {
  const seen = new Set<string>()
  return list
    .filter((s) => {
      const k = `${s.name.toLowerCase()}|${s.price}|${s.duration}`
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, 40)
}

function findHours(blocks: Block[]) {
  return blocks
    .map((b) => b.text)
    .filter(isHoursText)
    .map((t) => clip(t, 160))
}

/* ------------------------------------------------------------------ JSON-LD */

type Ld = {
  name: string | null
  phones: string[]
  emails: string[]
  address: string | null
  hours: string[]
  images: string[]
  services: ImportService[]
  instagram: string | null
  facebook: string | null
}

const BUSINESS =
  /LocalBusiness|DaySpa|HealthAndBeautyBusiness|BeautySalon|HealthClub|MedicalBusiness|Organization|Store|Hotel|Resort/i
const str = (v: unknown) => (typeof v === 'string' ? clean(v) : null)
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v])
const DAY_NAMES: Record<string, string> = {
  mo: 'Mon',
  tu: 'Tue',
  we: 'Wed',
  th: 'Thu',
  fr: 'Fri',
  sa: 'Sat',
  su: 'Sun',
}

function readJsonLd(docs: unknown[]): Ld {
  const ld: Ld = {
    name: null,
    phones: [],
    emails: [],
    address: null,
    hours: [],
    images: [],
    services: [],
    instagram: null,
    facebook: null,
  }
  const nodes: Record<string, unknown>[] = []
  const walk = (v: unknown, depth: number) => {
    if (depth > 6 || nodes.length > 400) return
    if (Array.isArray(v)) for (const x of v) walk(x, depth + 1)
    else if (v && typeof v === 'object') {
      nodes.push(v as Record<string, unknown>)
      for (const x of Object.values(v)) if (x && typeof x === 'object') walk(x, depth + 1)
    }
  }
  walk(docs, 0)
  const offer = (o: Record<string, unknown>) => {
    const item = (o.itemOffered ?? {}) as Record<string, unknown>
    const name = str(item.name) ?? str(o.name)
    const price = Number(o.price ?? (o.priceSpecification as Record<string, unknown> | undefined)?.price)
    const currency = str(o.priceCurrency) ?? 'AED'
    if (name && Number.isFinite(price) && price >= 10 && /^aed$/i.test(currency))
      ld.services.push({ name: clip(name, 80), price, duration: null })
  }
  for (const n of nodes) {
    const types = list(n['@type']).map(String).join(' ')
    if (/Offer\b/.test(types) && !/AggregateOffer/.test(types)) offer(n)
    if (!BUSINESS.test(types)) continue
    ld.name ??= str(n.name)
    for (const t of list(n.telephone)) if (str(t)) ld.phones.push(importPhone(str(t)!))
    for (const e of list(n.email))
      if (str(e))
        ld.emails.push(
          str(e)!
            .replace(/^mailto:/i, '')
            .toLowerCase(),
        )
    if (!ld.address) {
      const a = n.address
      if (typeof a === 'string') ld.address = clean(a)
      else if (a && typeof a === 'object') {
        const p = a as Record<string, unknown>
        const parts = [p.streetAddress, p.addressLocality, p.addressRegion]
          .map(str)
          .filter((x): x is string => Boolean(x))
        if (parts.length) ld.address = parts.join(', ')
      }
    }
    for (const h of list(n.openingHours)) {
      const s = str(h)
      if (s) ld.hours.push(s.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su)\b/g, (d) => DAY_NAMES[d.toLowerCase()] ?? d))
    }
    for (const spec of list(n.openingHoursSpecification)) {
      const s = spec as Record<string, unknown>
      const days = list(s.dayOfWeek)
        .map((d) => String(d).split('/').pop()!.slice(0, 3))
        .join(', ')
      if (days && str(s.opens) && str(s.closes)) ld.hours.push(`${days} ${str(s.opens)}–${str(s.closes)}`)
    }
    for (const img of list(n.image)) {
      const u = typeof img === 'string' ? img : str((img as Record<string, unknown>)?.url)
      if (u) ld.images.push(u)
    }
    for (const s of list(n.sameAs)) {
      const u = str(s)
      if (u && /^https?:\/\/(?:www\.)?instagram\.com\//i.test(u)) ld.instagram ??= u
      if (u && /^https?:\/\/(?:www\.)?facebook\.com\//i.test(u)) ld.facebook ??= u
    }
  }
  ld.hours = ld.hours.map((h) => clip(h, 160)).slice(0, 8)
  return ld
}

/* ------------------------------------------------------------------ Links */

const FILE_EXT = /\.(?:pdf|jpe?g|png|gif|webp|avif|svg|zip|docx?|xlsx?|mp4|mp3|ics)$/i

/** Same-site pages worth reading next (services / prices first, then contact / about), best first. */
export function linksToFollow(page: Pick<PageExtract, 'links' | 'url'>, max: number) {
  const here = new URL(page.url)
  const scored = new Map<string, number>()
  for (const l of page.links) {
    let u: URL
    try {
      u = new URL(l.url)
    } catch {
      continue
    }
    if (u.hostname.replace(/^www\./, '') !== here.hostname.replace(/^www\./, '')) continue
    if (FILE_EXT.test(u.pathname)) continue
    u.hash = ''
    const key = u.toString()
    if (key === here.toString() || u.pathname === here.pathname) continue
    let path = u.pathname
    try {
      path = decodeURIComponent(path)
    } catch {
      // keep the encoded path
    }
    const hay = `${path} ${l.text}`
    let score = 0
    for (const [re, w] of LINK_WORDS) if (re.test(hay)) score = Math.max(score, w)
    if (score) scored.set(key, Math.max(scored.get(key) ?? 0, score))
  }
  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([u]) => u)
}

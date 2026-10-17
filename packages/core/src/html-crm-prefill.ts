// Contract §12 "Server prefill (crawler text)" (owner "Option A", R33 2026-10-17): search crawlers that run no
// JavaScript read the spa's address, phone numbers, opening hours and links in the raw HTML of a contract design,
// where visitors see them. On the live page's FINAL html (after htmlDesignDocument: page-text ids are positional) the
// CRM values the design's own script writes go into its empty `data-crm` slots, three `[crm-*]` link tokens and the
// rows of three `data-crm-list`s; the script then writes the very same DOM (R24: invisible changes only). Opt-in per
// design version: `contract: {version: 2, prefill: 1}` — 1 = the BE RELAX v2.x binder, whose formats (buildModel,
// renderLists, bindValues, bindUi in docs/design/be-relax-site/be-relax-v2.8.html) are ported here exactly.
import { dubaiParts } from './booking'
import { htmlCrmContractOf } from './html-crm'
import { attributesOf, HTML_RAW_TEXT, HTML_SAFE_HREF, HTML_VOID, htmlTextOf, tagEnd } from './html-design'

/** The prefill format a design declares in `contract.prefill`: 1 = the BE RELAX v2.x binder's formats. */
export const CRM_PREFILL_FORMAT = 1

type Obj = Record<string, unknown>
const rec = (v: unknown): Obj => (typeof v === 'object' && v !== null ? (v as Obj) : {})
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
/** `v || ''` as the script writes it into the page. */
const str = (v: unknown) => (v ? String(v) : '')
const get = (obj: unknown, path: string): unknown =>
  path.split('.').reduce<unknown>((a, k) => (a == null ? a : (a as Obj)[k]), obj)
const empty = (v: unknown) => v == null || v === '' || v === false || (Array.isArray(v) && v.length === 0)
const pad2 = (n: unknown) => String(n).padStart(2, '0')
/** Arabic-Indic (٠-٩) and Extended Arabic-Indic (۰-۹) digits read as 0-9. */
const latin = (s: unknown) =>
  String(s || '')
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
const waLink = (num: unknown, msg: string) =>
  `https://wa.me/${latin(num).replace(/\D/g, '')}${msg ? `?text=${encodeURIComponent(msg)}` : ''}`

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
/** The binder's Arabic names of the UAE cities (exact names only). */
const AR_CITY: Record<string, string> = {
  'abu dhabi': 'أبوظبي',
  dubai: 'دبي',
  sharjah: 'الشارقة',
  ajman: 'عجمان',
  'umm al quwain': 'أم القيوين',
  'ras al khaimah': 'رأس الخيمة',
  fujairah: 'الفجيرة',
  'al ain': 'العين',
}

type Model = {
  values: Record<string, string>
  /** Item counts of the binder's lists (`data-if` on a list name). */
  counts: Record<string, number>
  /** The items of the lists rendered here. */
  rows: Record<string, Obj[]>
  phoneBy: Map<string, Obj>
  primaryCall: Obj
  message: string
  links: { whatsapp: string; maps: string; booking: string }
  /** A `ui.*` (any path) string of the data, else null (contract v2 markup texts). */
  text: (path: string) => string | null
}

/** The binder's buildModel, the parts the prefill writes (same formats, same fallbacks). Throws where it would. */
function buildModel(crm: Obj, now: Date): Model {
  // T(path) without vars: the string as written ({tokens} kept), a missing key ''.
  const T = (path: string) => {
    const v = get(crm, path)
    return typeof v === 'string' ? v : ''
  }
  const spa = rec(crm.spa)
  const contact = rec(crm.contact)
  const loc = rec(crm.location)
  const booking = rec(crm.booking)
  const spaName = str(spa.short_name || spa.name)
  const message = String(contact.whatsapp_message || '')
    .replace(/\{spa\}/g, spaName)
    .replace(/\{service\}/g, '')
  // No label from the CRM: UAE mobiles (+9715…) read "mobile", other UAE numbers "landline".
  const phoneLabel = (p: Obj) =>
    p.label ||
    (/^\+9715/.test(String(p.number || ''))
      ? T('ui.contact.mobile')
      : /^\+971/.test(String(p.number || ''))
        ? T('ui.contact.landline')
        : '')
  const phones: Obj[] = list(contact.phones).map((x, i) => {
    const p = rec(x)
    const ways = [p.calls && T('ui.contact.calls'), p.whatsapp && T('ui.contact.whatsapp')]
    return {
      ...p,
      index: String(i),
      kind: [phoneLabel(p), ways.filter(Boolean).join(T('ui.contact.and'))]
        .filter(Boolean)
        .join(' · ')
        .toLowerCase(),
    }
  })
  const waPhones = phones.filter((p) => p.whatsapp)
  const mainWa = contact.whatsapp_number || waPhones[0]?.number || ''
  const callPhones = phones.filter((p) => p.calls)
  const primaryCall = callPhones.find((p) => !p.whatsapp) || callPhones[0] || phones[0] || {}
  const parts = [loc.address_line1, loc.address_line2, loc.city, loc.country].filter(Boolean)
  const links = {
    whatsapp: mainWa ? waLink(mainWa, message) : '',
    maps:
      str(loc.maps_url) ||
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(parts.join(', '))}`,
    booking: str(booking.url) || '#book',
  }

  const hours = list(crm.hours)
  const byDay: Obj = Object.fromEntries(hours.map((h) => [String(rec(h).day), h]))
  const sig = (d: string) => {
    const h = byDay[d]
    return !h || rec(h).closed ? 'closed' : `${String(rec(h).open)}-${String(rec(h).close)}`
  }
  const label: Record<string, string> = Object.fromEntries(DAYS.map((d) => [d, T(`ui.hours.days.${d}`)]))
  const fmtTime = (hhmm: unknown) => {
    const [h0, m] = String(hhmm).split(':').map(Number)
    const h = h0! % 24
    const ap = T(`ui.hours.${h >= 12 ? 'pm' : 'am'}`)
    const h12 = h % 12 === 0 ? 12 : h % 12
    return m ? `${h12}:${pad2(m)} ${ap}` : `${h12} ${ap}`
  }
  const groups: { sig: string; from: string; to: string }[] = []
  for (const d of DAYS) {
    const last = groups.at(-1)
    if (last && last.sig === sig(d)) last.to = d
    else groups.push({ sig: sig(d), from: d, to: d })
  }
  const daysOf = (g: { from: string; to: string }) =>
    g.from === g.to ? label[g.from] : `${label[g.from]} – ${label[g.to]}`
  const rows: Obj[] = groups.map((g) => {
    const h = rec(byDay[g.from])
    return {
      days: daysOf(g),
      time: g.sig === 'closed' ? T('ui.hours.closed') : `${fmtTime(h.open)} – ${fmtTime(h.close)}`,
    }
  })
  const openGroups = groups.filter((g) => g.sig !== 'closed')
  const openSigs = new Set(openGroups.map((g) => g.sig))
  const sameEveryDay = groups.length === 1 && groups[0]!.sig !== 'closed'
  const openDays = DAYS.filter((d) => sig(d) !== 'closed')
  const operatingDays = openDays.length === 7 ? T('ui.hours.every_day') : openGroups.map(daysOf).join(', ')
  const workingHours =
    openSigs.size === 1
      ? String(rows[groups.findIndex((g) => g.sig !== 'closed')]!.time)
      : openSigs.size
        ? T('ui.hours.vary')
        : T('ui.hours.closed_all')
  // v2.6: on the Arabic page the city reads in Arabic: the spa's Arabic area label, else a known UAE city's name.
  const arabic = (s: unknown) => /[؀-ۿ]/.test(String(s || ''))
  const arCity = (s: unknown) => {
    const k = String(s || '')
      .toLowerCase()
      .replace(/[\s.-]+/g, ' ')
      .trim()
    return Object.hasOwn(AR_CITY, k) ? AR_CITY[k]! : ''
  }
  const city =
    crm.locale === 'ar'
      ? arabic(spa.area_label)
        ? str(spa.area_label)
        : arCity(loc.city) || str(loc.city)
      : str(loc.city)
  const services = list(crm.services)
  return {
    values: {
      'spa-name': str(spa.name),
      city,
      'booking-label': str(booking.label) || T('ui.cta.book_now'),
      // The script reads the visitor's year; the server the spa's (Dubai).
      year: dubaiParts(now).date.slice(0, 4),
      'working-hours': workingHours,
      'operating-days': operatingDays,
      address: parts.join(', '),
      'address-line1': str(loc.address_line1),
      'hours-varies': !sameEveryDay && rows.length > 0 ? 'yes' : '',
      'has-hours': hours.length ? 'yes' : '',
      'logo-on-dark': str(spa.logo_on_dark),
      'logo-on-light': str(spa.logo_on_light),
      'experience-image': str(spa.experience_image),
      'experience-image-alt': str(spa.experience_image_alt),
      'booking-image': str(booking.image),
      'booking-image-alt': str(booking.image_alt),
    },
    counts: {
      services: services.length,
      'services-with-image': services.filter((s) => rec(s).image).length,
      staff: list(crm.staff).filter((m) => m && rec(m).photo).length,
      phones: phones.length,
      'whatsapp-phones': waPhones.length,
      'hours-rows': rows.length,
      experience: list(spa.experience).length,
    },
    rows: { phones, 'whatsapp-phones': waPhones, 'hours-rows': rows },
    phoneBy: new Map(phones.map((p) => [p.index as string, p])),
    primaryCall,
    message,
    links,
    text: (path) => {
      const v = get(crm, path)
      return typeof v === 'string' ? v : null
    },
  }
}

/** `data-crm` keys filled into empty slots (never `live-status`: it changes with the time of day). */
const FILLED = new Set([
  'spa-name',
  'city',
  'booking-label',
  'year',
  'working-hours',
  'operating-days',
  'address',
  'address-line1',
  'phone',
])
/** The lists whose rows are rendered (the owner's scope: phone numbers and opening hours). */
const ROW_LISTS = new Set(['phones', 'whatsapp-phones', 'hours-rows'])
const tags = (names: string) => new Set(names.split(' '))
/** Slots whose own text the parser moves out (tables) or the select parts: never filled. */
const NO_TEXT = tags('table thead tbody tfoot tr colgroup select datalist optgroup')
// Rendered rows stand in the document, where the parser's closing rules reach them (template content is walled off):
// they go only into a container no row tag closes, with no open element above it that one could close or that parses
// its content differently, and only from a template whose tree the parser keeps as this module reads it (rowsKept).
const ROW_BOXES = tags('div section article aside nav main header footer ul ol')
/** Open elements above a container that rule rows out (a block closes a <p>, <li> an <li>, <a> an <a>, …). */
const ROW_ABOVE = tags(
  'p a button li dd dt h1 h2 h3 h4 h5 h6 math table caption colgroup thead tbody tfoot tr td th select datalist optgroup option',
)
/** Tags no rendered row holds: active or loading in the document (inert in a template), or parsed differently. */
const ROW_DENY = tags(
  'script style link meta base title noscript noembed noframes plaintext xmp iframe frame frameset object embed applet ' +
    'img image picture video audio source track html head body form nobr select datalist optgroup option ' +
    'table caption col colgroup thead tbody tfoot tr td th math rb rp rt rtc',
)
/** Start tags that close an open <p>. */
const CLOSES_P = tags(
  'address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer header hgroup ' +
    'main menu nav ol p search section summary ul h1 h2 h3 h4 h5 h6 pre listing hr li dd dt',
)
/** In <svg>: tags that act or load, or HTML start tags that end svg content (the parser closes the svg). */
const SVG_DENY = tags(
  'script style image foreignobject b big blockquote body br center code dd div dl dt em embed font h1 h2 h3 h4 h5 h6 ' +
    'head hr i img li listing menu meta nobr ol p pre ruby s small span strong strike sub sup table tt u ul var',
)
const HEADING = /^h[1-6]$/
const ATTR_NAME = /^[A-Za-z_:][-A-Za-z0-9_:.]*$/
const isWs = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r'
const TEXT_ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '{': '&#123;' }
const ATTR_ESC: Record<string, string> = {
  '&': '&amp;',
  '"': '&quot;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
}
/** Text as markup (`{` too, so no later pass reads a placeholder). */
const escText = (s: string) => s.replace(/[&<>{]/g, (c) => TEXT_ESC[c]!)
const escAttr = (s: string, q: string) => s.replace(q === "'" ? /[&'<>]/g : /[&"<>]/g, (c) => ATTR_ESC[c]!)
const tagRe = /<(\/?)([a-z][^\t\n\f\r />]*)/iy

/** Whether a data-if on an element outside the lists hides it once the script runs (bindValues). */
const ifHidden = (m: Model, k: string) =>
  Object.hasOwn(m.counts, k) ? m.counts[k] === 0 : Object.hasOwn(m.values, k) ? m.values[k] === '' : false
const phoneOf = (m: Model, index: string | null) =>
  str(((index !== null && m.phoneBy.get(index)) || m.primaryCall).display)
/** v2.6: an address right after the first-line heading shows only the rest (null = the rule doesn't apply). */
function addressRest(m: Model): string | null {
  const l1 = m.values['address-line1']!
  const full = m.values.address!
  return l1 && full.startsWith(l1) ? full.slice(l1.length).replace(/^[\s,]+/, '') : null
}

type Edit = { start: number; end: number; text: string }
type Box = { name: string; pure: boolean; at: number; from: number; to: number; hidden: boolean }
type Frame = {
  name: string
  /** Inside a <template> (or one itself): not in the document the script binds. */
  tpl: boolean
  /** A [data-crm-list] container or inside one: the script renders or removes it. */
  list: boolean
  /** A data-if on it or an ancestor hides it once the script runs. */
  hidden: boolean
  svg: boolean
  /** data-crm of the last element child seen (the next child's previousElementSibling); null = none / no data-crm. */
  last: string | null
  /** A rendered list's container. */
  box?: Box
  /** The container's <template> this element is. */
  content?: Box
}

/**
 * Contract §12: the live page of a design that declares `contract.prefill: 1` with the CRM values its binder writes
 * — empty `data-crm` slots outside templates / lists / data-if-hidden parts, the `[crm-whatsapp-link]` (no
 * data-phone, a number), `[crm-maps-link]` (http(s)) and `[crm-booking-url]` (an in-page `#` target) hrefs, and the
 * rows of the `phones`, `whatsapp-phones` and `hours-rows` lists before their <template> (the script removes and
 * renders them again). Anything else, including no opt-in, returns the very same string. Linear in the document.
 */
export function prefillCrmMarkup(html: string, opts: { now?: Date } = {}): string {
  if (!html.includes('data-crm') && !html.includes('[crm-')) return html
  const found = htmlCrmContractOf(html)
  const data = found?.literal?.data
  if (!data || found.version !== 2 || rec(data.contract).prefill !== CRM_PREFILL_FORMAT) return html
  let edits: Edit[]
  try {
    edits = prefillEdits(html, buildModel(data, opts.now ?? new Date()))
  } catch {
    return html // the script fails on this data too (e.g. a lone surrogate in the WhatsApp message)
  }
  if (!edits.length) return html
  edits.sort((a, b) => a.start - b.start)
  let out = ''
  let at = 0
  for (const e of edits) {
    out += html.slice(at, e.start) + e.text
    at = e.end
  }
  return out + html.slice(at)
}

function prefillEdits(html: string, m: Model): Edit[] {
  const edits: Edit[] = []
  const boxes: Box[] = []
  const stack: Frame[] = []
  let rootLast: string | null = null
  const n = html.length
  let i = 0
  while (i < n) {
    const lt = html.indexOf('<', i)
    const top = stack.at(-1)
    // A rendered list's container holds only whitespace and its template (the script keeps text, drops elements).
    if (top?.box?.pure)
      for (let k = i; k < (lt === -1 ? n : lt); k++)
        if (!isWs(html[k])) {
          top.box.pure = false
          break
        }
    if (lt === -1) break
    if (html.startsWith('<!--', lt)) {
      const close = /--!?>/g
      close.lastIndex = lt + 2
      const c = close.exec(html)
      i = c ? c.index + c[0].length : n
      continue
    }
    tagRe.lastIndex = lt
    const tag = tagRe.exec(html)
    if (!tag) {
      const next = html[lt + 1]
      if (next === '!' || next === '?' || next === '/') {
        const gt = html.indexOf('>', lt + 2)
        i = gt === -1 ? n : gt + 1
      } else {
        if (top?.box) top.box.pure = false // a literal '<' in text
        i = lt + 1
      }
      continue
    }
    const name = tag[2]!.toLowerCase()
    const nameEnd = lt + tag[0].length
    const end = tagEnd(html, nameEnd)
    i = end
    if (tag[1]) {
      const k = stack.findLastIndex((e) => e.name === name)
      if (k >= 0) {
        for (let j = stack.length - 1; j >= k; j--) {
          const box = stack[j]!.content
          if (box && j === k) box.to = lt
          else if (box) box.pure = false // closed by another element's end tag
        }
        stack.length = k
      }
      continue
    }
    const attrs = attributesOf(html, nameEnd)
    const val = (k: string) => {
      const a = attrs.find((x) => x.name === k)
      return a ? (a.start >= 0 ? htmlTextOf(html.slice(a.start, a.end)) : '') : null
    }
    const parent = stack.at(-1)
    const crm = val('data-crm')
    const prev = parent ? parent.last : rootLast
    if (parent) parent.last = crm
    else rootLast = crm
    const tpl = (parent?.tpl ?? false) || name === 'template'
    const inList = parent?.list ?? false
    const ifKey = val('data-if')
    const hidden = (parent?.hidden ?? false) || (!tpl && !inList && ifKey !== null && ifHidden(m, ifKey))
    const listName = val('data-crm-list')
    const svg = (parent?.svg ?? false) || name === 'svg'
    // Inside <svg> (foreign content) a tag ending in `/>` closes itself.
    const selfClosing = html[end - 2] === '/' && !attrs.some((x) => x.end > end - 2)
    const opens = !HTML_VOID.has(name) && !(svg && selfClosing)
    const frame: Frame = { name, tpl, list: inList || listName !== null, hidden, svg, last: null }
    if (parent?.box) {
      // renderLists keeps the first direct <template> and removes every other element child.
      if (name === 'template' && parent.box.at < 0) {
        parent.box.at = lt
        parent.box.from = end
        frame.content = parent.box
      } else parent.box.pure = false
    }
    if (
      listName !== null &&
      !tpl &&
      !inList &&
      !svg &&
      ROW_LISTS.has(listName) &&
      ROW_BOXES.has(name) &&
      !stack.some((e) => ROW_ABOVE.has(e.name))
    ) {
      frame.box = { name: listName, pure: true, at: -1, from: -1, to: -1, hidden }
      boxes.push(frame.box)
    }
    const bound = !frame.tpl && !frame.list && !hidden
    if (
      bound &&
      crm !== null &&
      FILLED.has(crm) &&
      opens &&
      !HTML_RAW_TEXT.has(name) &&
      !NO_TEXT.has(name) &&
      val('data-crm-text') === null &&
      val('data-crm-tpl') === null &&
      !(crm === 'address' && name === 'a')
    ) {
      const rest = crm === 'address' && prev === 'address-line1' ? addressRest(m) : null
      const value = crm === 'phone' ? phoneOf(m, val('data-phone')) : (rest ?? m.values[crm]!)
      const k = html.indexOf('<', end)
      if (value && k >= 0 && closes(html, k, name) && blank(html, end, k))
        edits.push({ start: end, end: k, text: escText(value) })
    }
    if (bound && name === 'a') {
      const href = attrs.find((x) => x.name === 'href')
      const q = href && href.start > 0 ? html[href.start - 1]! : ''
      if (href && (q === '"' || q === "'")) {
        const to = tokenHref(
          m,
          htmlTextOf(html.slice(href.start, href.end)),
          attrs.some((x) => x.name === 'data-phone'),
        )
        if (to) edits.push({ start: href.start, end: href.end, text: escAttr(to, q) })
      }
    }
    if (opens) stack.push(frame)
    if (!HTML_RAW_TEXT.has(name)) continue
    if (name === 'plaintext') break
    const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, 'gi')
    close.lastIndex = end
    i = close.exec(html)?.index ?? n
  }
  for (const box of boxes) {
    const items = m.rows[box.name] ?? []
    if (!box.pure || box.to < 0 || box.hidden || !items.length) continue
    const nodes = parseFragment(html, box.from, box.to)
    if (!rowsKept(nodes, NONE_OPEN)) continue
    const prev = { crm: null as string | null }
    const rows = items.map((item) =>
      nodes.map((x) => (typeof x === 'string' ? '' : row(html, x, item, m, prev))),
    )
    edits.push({ start: box.at, end: box.at, text: rows.flat().join('') })
  }
  return edits
}

/** The binder's link for a token href outside the lists; null = left for the script (it hides or targets it). */
function tokenHref(m: Model, token: string, perPhone: boolean): string | null {
  if (token === '[crm-whatsapp-link]') return !perPhone && m.links.whatsapp ? m.links.whatsapp : null
  if (token === '[crm-maps-link]') return HTML_SAFE_HREF.test(m.links.maps) ? m.links.maps : null
  if (token === '[crm-booking-url]') return m.links.booking.startsWith('#') ? m.links.booking : null
  return null
}

const blank = (html: string, from: number, to: number) => {
  for (let k = from; k < to; k++) if (!isWs(html[k])) return false
  return true
}
/** `</name` (any case, then a delimiter) at `k`. */
const closes = (html: string, k: number, name: string) =>
  html[k + 1] === '/' &&
  html.slice(k + 2, k + 2 + name.length).toLowerCase() === name &&
  /^[\t\n\f\r />]$/.test(html[k + 2 + name.length] ?? '')

// ---------------------------------------------------------------------------------------------------------------
// List rows: the template's content as renderLists, bindValues and bindUi leave each clone
// ---------------------------------------------------------------------------------------------------------------

type FAttr = { name: string; value: string | null }
type FEl = { name: string; start: number; end: number; attrs: FAttr[]; shut: boolean; kids: FNode[] }
/** Markup kept as written (text, comments, raw-text bodies) or an element. */
type FNode = string | FEl

/** A template's content as a tree (same tokenizing as the page pass; end tags pop to the last same-named element). */
function parseFragment(html: string, from: number, to: number): FNode[] {
  const top: FNode[] = []
  const stack: { el: FEl; svg: boolean }[] = []
  const add = (x: FNode) => (stack.at(-1)?.el.kids ?? top).push(x)
  let i = from
  while (i < to) {
    const found = html.indexOf('<', i)
    const lt = found === -1 || found > to ? to : found
    if (lt > i) add(html.slice(i, lt))
    if (lt >= to) break
    let next = -1
    if (html.startsWith('<!--', lt)) {
      const close = /--!?>/g
      close.lastIndex = lt + 2
      const c = close.exec(html)
      next = c ? c.index + c[0].length : to
    }
    tagRe.lastIndex = lt
    const tag = next < 0 ? tagRe.exec(html) : null
    if (!tag) {
      const c = html[lt + 1]
      if (next < 0 && (c === '!' || c === '?' || c === '/')) {
        const gt = html.indexOf('>', lt + 2)
        next = gt === -1 ? to : gt + 1
      }
      if (next < 0) next = lt + 1
      i = Math.min(next, to)
      add(html.slice(lt, i))
      continue
    }
    const name = tag[2]!.toLowerCase()
    const nameEnd = lt + tag[0].length
    const end = Math.min(tagEnd(html, nameEnd), to)
    i = end
    if (tag[1]) {
      const k = stack.findLastIndex((e) => e.el.name === name)
      if (k >= 0) stack.length = k
      continue
    }
    const attrs = attributesOf(html, nameEnd)
    const svg = (stack.at(-1)?.svg ?? false) || name === 'svg'
    const shut = svg && html[end - 2] === '/' && !attrs.some((x) => x.end > end - 2)
    const el: FEl = {
      name,
      start: lt,
      end,
      shut,
      kids: [],
      attrs: attrs.map((a) => ({
        name: a.name,
        value: a.start >= 0 ? htmlTextOf(html.slice(a.start, a.end)) : null,
      })),
    }
    add(el)
    if (HTML_VOID.has(name) || shut) continue
    if (HTML_RAW_TEXT.has(name)) {
      const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, 'gi')
      close.lastIndex = end
      const stop = name === 'plaintext' ? to : Math.min(close.exec(html)?.index ?? to, to)
      if (stop > end) el.kids.push(html.slice(end, stop))
      i = stop
      continue
    }
    stack.push({ el, svg })
  }
  return top
}

type Open = { p: boolean; li: boolean; dd: boolean; h: boolean; a: boolean; button: boolean; svg: boolean }
const NONE_OPEN: Open = { p: false, li: false, dd: false, h: false, a: false, button: false, svg: false }

/**
 * Whether the parser keeps a template's content as this tree once it stands in the document as rows: no tag that
 * acts or loads there (ROW_DENY, SVG_DENY, custom elements, `on*` handlers, autofocus) and none the parser closes early, which
 * this tree does not model (a block in a <p>, <li> in <li>, <dd>/<dt> in either, a heading in a heading, <a> in <a>,
 * <button> in <button>, HTML in <svg>, markup in an svg <title>/<desc>). A nested <template>'s content stays inert.
 */
function rowsKept(nodes: FNode[], o: Open): boolean {
  for (const x of nodes) {
    if (typeof x === 'string') continue
    const n = x.name
    const bad = o.svg
      ? SVG_DENY.has(n) ||
        ((n === 'title' || n === 'desc') && x.kids.some((k) => typeof k !== 'string' || k.includes('<')))
      : ROW_DENY.has(n) ||
        (o.p && CLOSES_P.has(n)) ||
        (o.li && n === 'li') ||
        (o.dd && (n === 'dd' || n === 'dt')) ||
        (o.h && HEADING.test(n)) ||
        (o.a && n === 'a') ||
        (o.button && n === 'button')
    if (
      bad ||
      n.includes('-') ||
      x.attrs.some((a) => /^on/i.test(a.name) || a.name === 'is' || a.name === 'autofocus')
    )
      return false
    if (n === 'template') continue
    const inner: Open =
      o.svg || n === 'svg'
        ? { ...o, svg: true }
        : {
            p: o.p || n === 'p',
            li: n === 'li' || (o.li && n !== 'ul' && n !== 'ol'),
            dd: n === 'dd' || n === 'dt' || (o.dd && n !== 'dl'),
            h: o.h || HEADING.test(n),
            a: o.a || n === 'a',
            button: o.button || n === 'button',
            svg: false,
          }
    if (!rowsKept(x.kids, inner)) return false
  }
  return true
}

/**
 * One element of a list row as the script leaves it: fillPlaceholders + bindItemFields (renderLists), then the
 * bindValues and bindUi effects on it. `prev` = data-crm of its previous element sibling; a nested <template>'s
 * content stays as written. Unchanged start tags keep their bytes; every element gets its end tag.
 */
function row(
  html: string,
  el: FEl,
  item: Obj,
  m: Model,
  prev: { crm: string | null },
  inert = false,
): string {
  const before = prev.crm
  const crm = el.attrs.find((a) => a.name === 'data-crm')
  prev.crm = crm ? (crm.value ?? '') : null
  const attrs = el.attrs.map((a) => ({ ...a }))
  let dirty = false
  let content: string | null = null
  const at = (k: string) => attrs.find((a) => a.name === k)
  const read = (k: string) => {
    const a = at(k)
    return a ? (a.value ?? '') : null
  }
  const set = (k: string, v: string) => {
    const a = at(k)
    if (a?.value === v) return
    if (a) a.value = v
    else attrs.push({ name: k, value: v })
    dirty = true
  }
  const drop = (k: string) => {
    const x = attrs.findIndex((a) => a.name === k)
    if (x < 0) return
    attrs.splice(x, 1)
    dirty = true
  }
  if (!inert) {
    // fillPlaceholders
    const map: Obj = { '[service-id]': item.id, '[staff-id]': item.id, '[phone-index]': item.index }
    for (const a of attrs) {
      const v = a.value !== null && Object.hasOwn(map, a.value) ? map[a.value] : null
      if (v != null) {
        a.value = String(v)
        dirty = true
      }
    }
    // bindItemFields (data-item-src is not rendered: the template's src stays until the script runs)
    const ifPath = read('data-if')
    if (ifPath !== null) {
      if (empty(get(item, ifPath))) set('hidden', '')
      else drop('hidden')
    }
    const itemPath = read('data-item')
    if (itemPath !== null) content = escText(String(get(item, itemPath) ?? ''))
    const altPath = read('data-item-alt')
    // `el.alt =` reflects on these only
    if (altPath !== null && (el.name === 'img' || el.name === 'input' || el.name === 'area'))
      set('alt', str(get(item, altPath)))
    const copyPath = read('data-item-copy')
    if (copyPath !== null) set('data-copy', str(get(item, copyPath)))
    // bindValues
    const key = read('data-crm')
    const rest = key === 'address' && before === 'address-line1' ? addressRest(m) : null
    if (key === 'phone') content = escText(phoneOf(m, read('data-phone')))
    else if (key === 'address' && el.name === 'a') {
      if (HTML_SAFE_HREF.test(m.links.maps)) set('href', m.links.maps)
    } else if (rest !== null) {
      content = escText(rest)
      if (rest) drop('hidden')
      else set('hidden', '')
    } else if (key !== null && key !== 'live-status' && Object.hasOwn(m.values, key))
      content = escText(m.values[key]!)
    const aria = read('data-crm-aria')
    if (aria !== null) set('aria-label', Object.hasOwn(m.values, aria) ? m.values[aria]! : '')
    if (el.name === 'a' && read('href') === '[crm-whatsapp-link]') {
      const phone = read('data-phone')
      const p = phone !== null ? m.phoneBy.get(phone) : undefined
      const to = p ? waLink(p.number, m.message) : m.links.whatsapp
      if (to) set('href', to)
      else set('hidden', '')
    }
    const booking = m.links.booking
    if (el.name === 'a' && read('href') === '[crm-booking-url]') {
      if (booking.startsWith('#') || HTML_SAFE_HREF.test(booking)) set('href', booking)
      if (HTML_SAFE_HREF.test(booking)) {
        set('target', '_blank')
        set('rel', 'noopener')
      }
    }
    if (el.name === 'a' && read('href') === '[crm-maps-link]' && HTML_SAFE_HREF.test(m.links.maps))
      set('href', m.links.maps)
    // bindUi: data-crm-text (data-crm-tpl also fills {days} and {hours}, each in its own span), data-crm-attr
    const textPath = read('data-crm-text')
    const v = textPath !== null ? m.text(textPath) : null
    if (v !== null && read('data-crm-tpl') !== null) {
      const vars: Record<string, string> = {
        days: m.values['operating-days']!,
        hours: m.values['working-hours']!,
      }
      content = v
        .split(/(\{(?:days|hours)\})/)
        .map((part) => {
          const k = /^\{(days|hours)\}$/.exec(part)
          return k ? `<span>${escText(vars[k[1]!]!)}</span>` : escText(part)
        })
        .join('')
    } else if (v !== null) content = escText(v)
    for (const part of (read('data-crm-attr') ?? '').split(';')) {
      const c = part.indexOf(':')
      const name = part.slice(0, c).trim()
      const value = c > 0 ? m.text(part.slice(c + 1).trim()) : null
      if (name && value !== null && ATTR_NAME.test(name)) set(name.toLowerCase(), value)
    }
  }
  const leaf = HTML_VOID.has(el.name)
  const shut = el.shut && content === null
  const open = dirty || (el.shut && !shut) ? startTag(el.name, attrs, shut) : html.slice(el.start, el.end)
  if (leaf || shut) return open
  let inner = content
  if (inner === null) {
    inner = ''
    const sibling = { crm: null as string | null }
    for (const k of el.kids)
      inner += typeof k === 'string' ? k : row(html, k, item, m, sibling, inert || el.name === 'template')
  }
  return `${open}${inner}</${el.name}>`
}

const startTag = (name: string, attrs: FAttr[], shut: boolean) =>
  `<${name}${attrs.map((a) => (a.value === null ? ` ${a.name}` : ` ${a.name}="${escAttr(a.value, '"')}"`)).join('')}${shut ? '/' : ''}>`

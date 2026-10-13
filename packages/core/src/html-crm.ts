// R26: the CRM data contract for HTML designs (docs/design/html-crm-contract.md). A design that renders its business
// data from `window.CRM_DATA` (an inline `<script>window.CRM_DATA = {…}</script>` JSON literal) or fetches it from
// `<meta name="crm-endpoint" content="crm-data.json">` (the "Candlelight" contract) gets the operational values live
// from the spa's CRM: only that JSON changes, every other byte of the design stays as built (R24 hard rule).
import type { OpeningHours, Weekday } from './booking'
import { attributesOf, tagEnd } from './html-design'
import { branchMapsHref } from './maps'
import { toE164 } from './whatsapp'

/** Path of the contract JSON on a spa's public site (`{site}/crm-data.json`; the design's meta names it). */
export const CRM_DATA_PATH = 'crm-data.json'
/** Path of the booking-request endpoint on a spa's public site (`{site}/crm-enquiry`, JSON POST). */
export const CRM_ENQUIRY_PATH = 'crm-enquiry'

// ---------------------------------------------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------------------------------------------

export type HtmlCrmContract = {
  /** `literal`: the design holds a `window.CRM_DATA` JSON literal; `endpoint`: only the crm-endpoint meta. */
  mode: 'literal' | 'endpoint'
  /** The literal's JSON range (in the stored html) and its parsed value. */
  literal: { start: number; end: number; data: Record<string, unknown> } | null
  /** The crm-endpoint meta's content, as written ('' = present but empty), or null. */
  endpoint: string | null
  /** Where an injected `<script>window.CRM_DATA=…</script>` goes (frames of an endpoint-only design). */
  inject: number
  /**
   * R28 P5: an endpoint design's own data — the first `<script type="application/json" id="crm-defaults">` whose
   * body is a JSON object of at most CRM_DEFAULTS_MAX chars (its JSON range + value); null with a literal.
   */
  defaults: { start: number; end: number; data: Record<string, unknown> } | null
  /** R28 P5: 2 = the design's data declares `contract{version: 2, …}` (docs §9), else 1. */
  version: 1 | 2
  manifest: CrmContractManifest | null
}

// ---------------------------------------------------------------------------------------------------------------
// R28 P5: contract v2 (the design's `contract{}` manifest)
// ---------------------------------------------------------------------------------------------------------------

/** The largest `crm-defaults` body read (UTF-16 chars); a larger one is ignored. */
export const CRM_DEFAULTS_MAX = 512 * 1024
export type CrmContractField = { label?: string; group?: string; hint?: string; locales?: CrmLocale[] }
export type CrmContractManifest = {
  version: 2
  /** Default ['en']. */
  locales: CrmLocale[]
  /** Keys: slot path patterns — `[]` = any item ('journey[].clip'), trailing `.*` = any descendant ('ui.wa.*'). */
  fields: Record<string, CrmContractField>
  /** Reviewed Arabic defaults by CONCRETE slot path ('ui.form.submit', 'journey[welcome].tags'): string | string[]. */
  l10n: { ar: Record<string, string | string[]> }
}

const L10N_MAX = 2000
const L10N_TEXT_MAX = 2000
const FIELD_PATH = /^[A-Za-z0-9_.[\]*-]{1,400}$/
const localesOf = (v: unknown): CrmLocale[] =>
  Array.isArray(v) ? [...new Set(v.filter((l): l is CrmLocale => l === 'en' || l === 'ar'))] : []
const manifests = new WeakMap<object, CrmContractManifest | null>()

/**
 * The design data's `contract{}` (v2 manifest), or null (v1: none, or a version below 2). Never throws; invalid parts
 * are dropped (≤ 2000 l10n entries, each ≤ 2000 chars; version ≥ 2 is read as 2). Memoised per contract object (design
 * data is never mutated).
 */
export function crmContractManifest(data: unknown): CrmContractManifest | null {
  const c = isPlainObject(data) ? data.contract : undefined
  if (!isPlainObject(c)) return null
  const hit = manifests.get(c)
  if (hit !== undefined) return hit
  let out: CrmContractManifest | null = null
  if (typeof c.version === 'number' && c.version >= 2) {
    const fields: Record<string, CrmContractField> = {}
    for (const [k, v] of Object.entries(isPlainObject(c.fields) ? c.fields : {})) {
      if (!FIELD_PATH.test(k) || !isPlainObject(v)) continue
      const f: CrmContractField = {}
      for (const key of ['label', 'group', 'hint'] as const) {
        const x = v[key]
        if (typeof x === 'string' && x.trim() && x.length <= 200) f[key] = x
      }
      if (Array.isArray(v.locales)) f.locales = localesOf(v.locales)
      fields[k] = f
    }
    const ar: Record<string, string | string[]> = {}
    const l10n = isPlainObject(c.l10n) && isPlainObject(c.l10n.ar) ? c.l10n.ar : {}
    let n = 0
    for (const [k, v] of Object.entries(l10n)) {
      if (n >= L10N_MAX) break
      if (k.length > 400) continue
      if (typeof v === 'string' && v.length <= L10N_TEXT_MAX) ar[k] = v
      else if (
        Array.isArray(v) &&
        v.length <= 50 &&
        v.every((x) => typeof x === 'string' && x.length <= L10N_TEXT_MAX)
      )
        ar[k] = [...(v as string[])]
      else continue
      n++
    }
    const locales = localesOf(c.locales)
    out = { version: 2, locales: locales.length ? locales : ['en'], fields, l10n: { ar } }
  }
  manifests.set(c, out)
  return out
}

/** 2 = the data declares a v2 manifest, else 1. */
export const crmContractVersion = (data: unknown): 1 | 2 => (crmContractManifest(data) ? 2 : 1)

/** A manifest field for a concrete slot path: exact pattern first ('journey[welcome].clip' → 'journey[].clip'), then the longest `.*` prefix. */
export function contractField(m: CrmContractManifest | null, path: string): CrmContractField | null {
  if (!m) return null
  // Linear: an index ends at the next ']' and never spans another '['.
  const pattern = path.replace(/\[[^[\]]*\]/g, '[]')
  const exact = (k: string) => (Object.hasOwn(m.fields, k) ? m.fields[k]! : null)
  const hit = exact(path) ?? exact(pattern)
  if (hit) return hit
  const parts = pattern.split('.')
  for (let k = parts.length - 1; k >= 1; k--) {
    const prefix = exact(`${parts.slice(0, k).join('.')}.*`)
    if (prefix) return prefix
  }
  return null
}

/** The field is declared for some locales and Arabic isn't one of them (it always shows its English). */
export const englishOnly = (m: CrmContractManifest | null, path: string): boolean => {
  const locales = contractField(m, path)?.locales
  return Boolean(locales && !locales.includes('ar'))
}

/** `ui.*` system copy: English-only, or covered by l10n.ar. Write texts never writes it; leftovers / the report skip it. */
export const systemCopy = (m: CrmContractManifest | null, path: string): boolean =>
  m !== null &&
  (path.startsWith('ui.') || path.startsWith('ui[')) &&
  (englishOnly(m, path) || Object.hasOwn(m.l10n.ar, path))

/** The design's own data: the literal's, else an endpoint design's `crm-defaults`. */
export const crmDesignData = (c: HtmlCrmContract | null | undefined): Record<string, unknown> | null =>
  c?.literal?.data ?? c?.defaults?.data ?? null

/** Raw-text elements: their bodies are never tags (same set as the placeholder tokenizer). */
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
/** Script types whose body runs as JavaScript (an assignment to window.CRM_DATA only runs there). */
const JS_TYPE =
  /^(?:|module|text\/(?:javascript|ecmascript|jscript|livescript)|application\/(?:x-)?(?:javascript|ecmascript))$/
const attrDecode = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .trim()
const isWs = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r'
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** A `crm-defaults` body: a JSON object (whitespace around it) of at most CRM_DEFAULTS_MAX chars. */
function defaultsIn(html: string, from: number, to: number): HtmlCrmContract['defaults'] {
  let start = from
  let end = to
  while (start < end && isWs(html[start])) start++
  while (end > start && isWs(html[end - 1])) end--
  if (end - start > CRM_DEFAULTS_MAX || html[start] !== '{' || html[end - 1] !== '}') return null
  try {
    const data: unknown = JSON.parse(html.slice(start, end))
    return isPlainObject(data) ? { start, end, data } : null
  } catch {
    return null
  }
}

/** `window.CRM_DATA = {json};` as the whole body of a script (leading/trailing whitespace, one optional `;`). */
function literalIn(html: string, from: number, to: number): HtmlCrmContract['literal'] {
  let i = from
  while (i < to && isWs(html[i])) i++
  const head = /window\.CRM_DATA\s*=\s*/y
  head.lastIndex = i
  const m = head.exec(html)
  if (!m || head.lastIndex > to) return null
  const start = head.lastIndex
  let end = to
  while (end > start && isWs(html[end - 1])) end--
  if (html[end - 1] === ';') end--
  while (end > start && isWs(html[end - 1])) end--
  if (html[start] !== '{' || html[end - 1] !== '}') return null
  try {
    const data: unknown = JSON.parse(html.slice(start, end))
    return isPlainObject(data) ? { start, end, data } : null
  } catch {
    return null
  }
}

/**
 * Whether a design uses the CRM data contract (tokenized like the browser: comments, doctypes and raw-text bodies
 * are skipped, `>` inside quoted attribute values doesn't end a tag): the first JavaScript `<script>` (no `src`)
 * whose body is exactly a `window.CRM_DATA = {…}` JSON literal, and/or `<meta name="crm-endpoint">`. Null = no
 * contract, so the design is served exactly as today.
 */
export function htmlCrmContractOf(html: string): HtmlCrmContract | null {
  if (!html.includes('CRM_DATA') && !/crm-endpoint/i.test(html)) return null
  let literal: HtmlCrmContract['literal'] = null
  let defaults: HtmlCrmContract['defaults'] = null
  let endpoint: string | null = null
  let firstScript = -1
  let headOpen = -1
  let htmlOpen = -1
  const n = html.length
  const tagRe = /<(\/?)([a-z][^\t\n\f\r />]*)/iy
  let i = 0
  while (i < n) {
    const lt = html.indexOf('<', i)
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
      } else i = lt + 1
      continue
    }
    const name = tag[2]!.toLowerCase()
    const nameEnd = lt + tag[0].length
    const end = tagEnd(html, nameEnd)
    i = end
    if (tag[1]) continue
    const attrs = attributesOf(html, nameEnd)
    const val = (k: string) => {
      const a = attrs.find((x) => x.name === k)
      return a && a.start >= 0 ? attrDecode(html.slice(a.start, a.end)) : ''
    }
    if (name === 'head' && headOpen < 0) headOpen = end
    else if (name === 'html' && htmlOpen < 0) htmlOpen = end
    else if (name === 'meta' && endpoint === null && val('name').toLowerCase() === 'crm-endpoint')
      endpoint = val('content')
    if (!RAW_TEXT.has(name)) continue
    if (name === 'plaintext') break
    const close = new RegExp(`</${name}(?=[\\t\\n\\f\\r />]|$)`, 'gi')
    close.lastIndex = end
    const stop = close.exec(html)?.index ?? n
    if (name === 'script') {
      if (firstScript < 0) firstScript = lt
      const type = val('type').toLowerCase().split(';')[0]!.trim()
      if (!literal && JS_TYPE.test(type) && !attrs.some((a) => a.name === 'src'))
        literal = literalIn(html, end, stop)
      else if (!defaults && type === 'application/json' && val('id') === 'crm-defaults')
        defaults = defaultsIn(html, end, stop)
    }
    i = stop
  }
  if (!literal && endpoint === null) return null
  const own = literal ? null : defaults
  const manifest = crmContractManifest(literal?.data ?? own?.data)
  return {
    mode: literal ? 'literal' : 'endpoint',
    literal,
    endpoint,
    inject: firstScript >= 0 ? firstScript : headOpen >= 0 ? headOpen : htmlOpen >= 0 ? htmlOpen : 0,
    defaults: own,
    version: manifest ? 2 : 1,
    manifest,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The contract built from the CRM
// ---------------------------------------------------------------------------------------------------------------

type Bi = { en: string; ar?: string }
export type CrmLocale = 'en' | 'ar'
export type CrmDay = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'
export const CRM_DAYS: readonly CrmDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

export type CrmBranchSource = {
  name: string
  address: string | null
  mapsUrl: string | null
  phone: string | null
  whatsappE164: string | null
  openingHours: OpeningHours | null
  /** The branch's "Area shown on the website" (R28); null / empty = the city from the address. */
  areaLabel?: Bi | null
}

/** What the platform reads from the CRM (public facts only). */
export type CrmContractSource = {
  spa: { name: string /** Absolute URL of the spa's CRM logo, or null. */; logoUrl: string | null }
  /** Active branches, the default one first. */
  branches: CrmBranchSource[]
  /** Website services (the CRM Website "On the website" rule), in site order; prices already public-filtered. */
  services: {
    id: string
    name: Bi
    description: Bi | null
    category: Bi | null
    imageUrl: string | null
    variants: { durationMin: number; priceAed: string | null }[]
  }[]
  /** Active staff with "Show on website" on. */
  staff: { id: string; name: string; bio: Bi | null; photoUrl: string | null }[]
  /** The booking-request endpoint (live pages only), or null (previews: the design falls back to WhatsApp). */
  formEndpoint: string | null
  /** Origin that makes `/files/…` image paths absolute. */
  filesOrigin: string
}

export type CrmPhone = { number: string; display: string; label: string; whatsapp: boolean; calls: boolean }
export type CrmHour = { day: CrmDay; open: string; close: string; closed: boolean }
export type CrmService = {
  id: string
  name: string
  category: string
  description: string
  durations: number[]
  /** Lowest public price (AED) as a number; null = hidden / on request. */
  price: number | null
  image: string
  /** Identity of the service for the merge (normalised names, slug); never sent to the page. */
  match: { names: string[]; slug: string }
}
export type CrmStaffMember = { id: string; name: string; specialty: string; photo: string }

/** The CRM side of the contract ('' / [] = the CRM has no value; the merge keeps the design's only on its own design). */
export type CrmContract = {
  spa: {
    name: string
    short_name: string
    area_label: string
    /** `area_label` is the branch's own label (wins over the design's); never sent to the page. */
    area_explicit?: boolean
    logo_on_dark: string
    logo_on_light: string
    timezone: 'Asia/Dubai'
    currency: 'AED'
  }
  contact: { whatsapp_number: string; phones: CrmPhone[] }
  location: { address_line1: string; address_line2: string; city: string; country: string; maps_url: string }
  hours: CrmHour[]
  /** No `url`: the design's own booking target stays (owner R26 (1): requests, never automatic bookings). */
  booking: { form_endpoint: string | null }
  services: CrmService[]
  staff: CrmStaffMember[]
}

/** Identity of a name: NFKC, lower case, every run of non letters/digits one space, trimmed. */
export const crmName = (s: unknown): string =>
  typeof s === 'string'
    ? s
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
    : ''
/** `crmName` as a slug (`Normal massage` → `normal-massage`), the ids designs tend to use. */
export const crmSlug = (s: unknown): string => crmName(s).replace(/ /g, '-')

/** A UAE number as written locally (`052 510 8633`, `02 557 6533`); other countries `+{digits}`. */
export function uaePhoneDisplay(e164: string): string {
  const d = e164.replace(/\D/g, '')
  const mobile = /^9715(\d)(\d{3})(\d{4})$/.exec(d)
  if (mobile) return `05${mobile[1]} ${mobile[2]} ${mobile[3]}`
  const land = /^971([2-46-9])(\d{3})(\d{4})$/.exec(d)
  if (land) return `0${land[1]} ${land[2]} ${land[3]}`
  return d ? `+${d}` : ''
}

/** UAE cities and towns an address names (normalised, `crmName`). */
export const UAE_CITIES = [
  'abu dhabi',
  'dubai',
  'sharjah',
  'ajman',
  'umm al quwain',
  'ras al khaimah',
  'fujairah',
  'al ain',
  'khor fakkan',
  'dibba',
  'kalba',
  'hatta',
  'ruwais',
  'madinat zayed',
]
const COUNTRY = /^(?:uae|u a e|united arab emirates)$/

/**
 * A free-text branch address split for the contract: comma parts, a trailing UAE country part dropped, city = the
 * last part that is a UAE city, line 1 = the first part, line 2 = the parts in between (heuristic; documented).
 */
export function crmAddress(address: string): {
  address_line1: string
  address_line2: string
  city: string
  country: string
} {
  const parts = address
    .split(/[,\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length > 1 && COUNTRY.test(crmName(parts[parts.length - 1]))) parts.pop()
  let cityAt = -1
  for (let k = parts.length - 1; k >= 0; k--)
    if (UAE_CITIES.includes(crmName(parts[k]))) {
      cityAt = k
      break
    }
  const city = cityAt >= 0 ? parts[cityAt]! : ''
  const rest = cityAt >= 0 ? [...parts.slice(0, cityAt), ...parts.slice(cityAt + 1)] : parts
  return {
    address_line1: rest[0] ?? '',
    address_line2: rest.slice(1).join(', '),
    city,
    country: 'UAE',
  }
}

const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

/** Branch opening hours as seven contract rows (first open – last close a day); [] = not set up. */
export function crmHours(hours: OpeningHours | null | undefined): CrmHour[] {
  if (!hours || !Object.keys(hours).length) return []
  return CRM_DAYS.map((day) => {
    const iv = (hours[day as Weekday] ?? [])
      .filter((x) => x && HHMM.test(x.open) && HHMM.test(x.close))
      .sort((a, b) => minutes(a.open) - minutes(b.open))
    return iv.length
      ? { day, open: iv[0]!.open, close: iv[iv.length - 1]!.close, closed: false }
      : { day, open: '', close: '', closed: true }
  })
}

/** An image the page may load: https URLs as they are, site paths (`/files/…`) made absolute; else ''. */
export function crmImageUrl(src: string | null | undefined, origin: string): string {
  const s = src?.trim() ?? ''
  if (/^https:\/\/[^\s"'<>\\`]{1,2000}$/i.test(s)) return s
  if (!/^\/(?!\/)[^\s"'<>\\`]{0,2000}$/.test(s)) return ''
  let base = origin
  while (base.endsWith('/')) base = base.slice(0, -1)
  return `${base}${s}`
}

const firstLine = (s: string, max: number) => {
  const line = (s.split(/\r?\n/)[0] ?? '').trim()
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line
}

/** The CRM side of the contract for one locale (pure; see the precedence table in the contract doc). */
export function buildCrmContract(src: CrmContractSource, opts: { locale: CrmLocale }): CrmContract {
  const pick = (b: Bi | null | undefined) =>
    (b ? (opts.locale === 'ar' && b.ar?.trim() ? b.ar : b.en) : '')?.trim() ?? ''
  const img = (u: string | null | undefined) => crmImageUrl(u, src.filesOrigin)
  const branch = src.branches[0] ?? null
  const many = src.branches.length > 1
  const phones: CrmPhone[] = []
  const add = (digits: string, label: string, flags: { calls: boolean; whatsapp: boolean }) => {
    const seen = phones.find((p) => p.number === `+${digits}`)
    if (seen) {
      seen.calls ||= flags.calls
      seen.whatsapp ||= flags.whatsapp
    } else phones.push({ number: `+${digits}`, display: uaePhoneDisplay(digits), label, ...flags })
  }
  let whatsapp = ''
  for (const b of src.branches) {
    const label = many ? b.name.trim() : ''
    const tel = b.phone ? toE164(b.phone) : null
    const wa = b.whatsappE164 ? toE164(b.whatsappE164) : null
    if (wa && !whatsapp) whatsapp = `+${wa}`
    if (tel) add(tel, label, { calls: true, whatsapp: tel === wa })
    if (wa && wa !== tel) add(wa, label, { calls: false, whatsapp: true })
  }
  const address = branch?.address?.trim() ? crmAddress(branch.address) : null
  const logo = img(src.spa.logoUrl)
  const area = pick(branch?.areaLabel)
  return {
    spa: {
      name: src.spa.name.trim(),
      short_name: src.spa.name.trim(),
      area_label: area || (address?.city ?? ''),
      area_explicit: area !== '',
      logo_on_dark: logo,
      logo_on_light: logo,
      timezone: 'Asia/Dubai',
      currency: 'AED',
    },
    contact: { whatsapp_number: whatsapp, phones },
    location: {
      ...(address ?? { address_line1: '', address_line2: '', city: '', country: '' }),
      maps_url: branchMapsHref(branch) ?? '',
    },
    hours: crmHours(branch?.openingHours),
    booking: { form_endpoint: src.formEndpoint },
    services: collapseSameName(
      src.services.map((s) => {
        const prices = s.variants
          .map((v) => (v.priceAed === null ? Number.NaN : Number(v.priceAed)))
          .filter((p) => Number.isFinite(p) && p > 0)
        return {
          id: s.id,
          name: pick(s.name),
          category: pick(s.category),
          description: pick(s.description),
          durations: [...new Set(s.variants.map((v) => v.durationMin))]
            .filter((m) => Number.isInteger(m) && m > 0)
            .sort((a, b) => a - b),
          price: prices.length ? Math.round(Math.min(...prices) * 100) / 100 : null,
          image: img(s.imageUrl),
          match: {
            names: [...new Set([crmName(s.name.en), crmName(pick(s.name))])],
            slug: crmSlug(s.name.en),
          },
        }
      }),
    ),
    staff: src.staff
      .map((m) => ({
        id: m.id,
        name: m.name.trim(),
        specialty: firstLine(pick(m.bio), 80),
        photo: img(m.photoUrl),
      }))
      .filter((m) => m.name),
  }
}

/**
 * One entry per treatment name (R28): a service in two menus (e.g. "Asian Menu" + "Arabic Menu") shows once —
 * durations joined, the lowest public price, the first id (booking requests resolve it), description, photo and
 * category, every identity name for the design match. Unnamed services are never joined.
 */
function collapseSameName(services: CrmService[]): CrmService[] {
  const out: CrmService[] = []
  const byName = new Map<string, CrmService>()
  for (const s of services) {
    const key = s.match.names[0] ?? ''
    const seen = key ? byName.get(key) : undefined
    if (!seen) {
      const first = { ...s, durations: [...s.durations], match: { ...s.match, names: [...s.match.names] } }
      out.push(first)
      if (key) byName.set(key, first)
      continue
    }
    seen.durations = [...new Set([...seen.durations, ...s.durations])].sort((a, b) => a - b)
    if (s.price !== null && (seen.price === null || s.price < seen.price)) seen.price = s.price
    seen.description ||= s.description
    seen.image ||= s.image
    seen.category ||= s.category
    for (const n of s.match.names) if (!seen.match.names.includes(n)) seen.match.names.push(n)
  }
  return out
}

// ---------------------------------------------------------------------------------------------------------------
// Merge with the design's own data
// ---------------------------------------------------------------------------------------------------------------

const obj = (v: unknown): Record<string, unknown> => (isPlainObject(v) ? v : {})
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const digitsOf = (v: unknown) => str(v).replace(/\D/g, '')

/**
 * R28 P5: the content paths `overlayHtmlContent` set on its output (keyed by that output object). The v2 merge takes
 * `spa.short_name` / `spa.logo_on_dark` / `spa.logo_on_light` from a spa's website content only, never from the
 * design's own defaults (owner D1).
 */
const contentPaths = new WeakMap<object, ReadonlySet<string>>()
/** Records which paths a spa's website content set on `data` (an overlay's output; earlier marks of `from` kept). */
export function markHtmlContentPaths(data: object, paths: Iterable<string>, from?: object): void {
  contentPaths.set(data, new Set([...(from ? (contentPaths.get(from) ?? []) : []), ...paths]))
}
const contentSet = (data: object, path: string) => contentPaths.get(data)?.has(path) === true

/** Whether `part` names the spa `name`: the same name, or a whole-word start of it (`Be Relax` of `Be Relax Spa`). */
function namesSpa(part: unknown, name: string) {
  const s = crmName(part)
  const full = crmName(name)
  return s !== '' && (full === s || full.startsWith(`${s} `))
}

/**
 * Whether a design was made for the spa `name` (its own `spa.name` or `spa.short_name` names it). A contract v2
 * design never is (R28 P5: its defaults are neutral; a spa's own look is its website content).
 */
export function isOwnDesign(design: Record<string, unknown> | null | undefined, name: string): boolean {
  if (crmContractVersion(design) === 2) return false
  const spa = obj(obj(design).spa)
  return namesSpa(spa.name, name) || namesSpa(spa.short_name, name)
}

/**
 * The contract the page gets: the design's embedded data with the CRM's operational keys over it. CRM wins for
 * name, logo (on light; on dark too unless the design is this spa's own and has one), phones, WhatsApp, address,
 * maps, area label, hours, form endpoint, services (prices, durations) and staff (opted-in only: none → []). An empty
 * CRM value or collection keeps the design's only when the design is this spa's own (its name names the tenant);
 * on another spa's design it stays empty and the design hides that block (owner R28 D1: never another spa's phones,
 * logo or menu). Per-item image / alt / note / description / specialty come only from the design item with the same
 * identity (normalised name, or the service's slug as id); prices are never inherited. Staff still without a photo
 * after that are left out (R28 D2: no empty frames; the therapist select follows). Everything else (booking url,
 * journey, experience, story texts, message templates, booking label/image, unknown keys) is the design's, kept by
 * reference (the serializer memoises it). `design` null = the CRM alone.
 * R28 P5, contract v2 (`contract{version: 2}`): never the spa's "own design" (D1 applies everywhere); the design's
 * own short name and logos never show — `short_name` = the spa's website content (any value, any locale), else the
 * CRM name; `logo_on_dark` = the content's, else the CRM's; `logo_on_light` = the CRM's, else the content's (content =
 * what `overlayHtmlContent` set on `design`); `opts.locale` is written as `locale` (last key) for v2 designs and the
 * CRM alone, never for v1 (byte-for-byte R26).
 */
export function mergeCrmContract(
  design: Record<string, unknown> | null,
  crm: CrmContract,
  opts: { locale?: CrmLocale } = {},
) {
  const d = obj(design)
  const v2 = crmContractVersion(d) === 2
  const dSpa = obj(d.spa)
  const dContact = obj(d.contact)
  const dLoc = obj(d.location)
  const dBooking = obj(d.booking)
  const dServices = list(d.services).map(obj)
  const dStaff = list(d.staff).map(obj)
  const dPhones = list(dContact.phones).map(obj)

  const name = crm.spa.name || str(dSpa.name)
  // The design was made for this spa (its name or short name names the tenant): its logo for dark backgrounds is this
  // spa's own variant, which the CRM (one logo, made for the light-only CRM) doesn't have. Another spa's never shows.
  const ownDesign = !v2 && (namesSpa(dSpa.name, name) || namesSpa(dSpa.short_name, name))
  // The design's own value when the CRM has none — only on this spa's own design (R28 D1).
  const own = <T>(v: T, empty: T): T => (ownDesign ? v : empty)
  // v2: a spa's website content only (never the design's defaults).
  const set = (key: string) => (v2 && contentSet(d, `spa.${key}`) ? str(dSpa[key]) : '')
  const spa = {
    ...dSpa,
    name,
    short_name: v2
      ? set('short_name') || name
      : namesSpa(dSpa.short_name, name)
        ? str(dSpa.short_name)
        : name,
    // The branch's own area label always wins; else own design: its finer label ("Al Zahiyah, Abu Dhabi") over the
    // CRM city; another spa's: never its area.
    area_label: crm.spa.area_explicit
      ? crm.spa.area_label
      : (ownDesign && str(dSpa.area_label)) || crm.spa.area_label,
    logo_on_dark: (v2 ? set('logo_on_dark') : ownDesign && str(dSpa.logo_on_dark)) || crm.spa.logo_on_dark,
    logo_on_light: crm.spa.logo_on_light || (v2 ? set('logo_on_light') : own(str(dSpa.logo_on_light), '')),
    timezone: crm.spa.timezone,
    currency: crm.spa.currency,
  }
  const contact = {
    ...dContact,
    whatsapp_number: crm.contact.whatsapp_number || own(str(dContact.whatsapp_number), ''),
    phones: crm.contact.phones.length
      ? crm.contact.phones.map((p) => {
          const same = dPhones.find((x) => digitsOf(x.number) === digitsOf(p.number))
          return { ...p, label: str(same?.label) || p.label }
        })
      : own(list(dContact.phones), []),
  }
  const hasAddress = Boolean(crm.location.address_line1 || crm.location.city)
  const location = {
    address_line1: '',
    address_line2: '',
    city: '',
    country: '',
    maps_url: '',
    ...(ownDesign ? dLoc : {}),
    ...(hasAddress
      ? {
          address_line1: crm.location.address_line1,
          address_line2: crm.location.address_line2,
          city: crm.location.city,
          country: crm.location.country,
        }
      : {}),
    ...(crm.location.maps_url ? { maps_url: crm.location.maps_url } : {}),
  }
  const booking = {
    ...dBooking,
    url: typeof dBooking.url === 'string' ? dBooking.url : null,
    form_endpoint: crm.booking.form_endpoint,
  }
  const services = crm.services.length
    ? crm.services.map(({ match, ...s }) => {
        const m = dServices.find(
          (x) =>
            (crmName(x.name) !== '' && match.names.includes(crmName(x.name))) ||
            (str(x.id) !== '' && str(x.id) === match.slug),
        )
        return {
          ...m,
          ...s,
          description: s.description || str(m?.description),
          note: str(m?.note),
          image: s.image || str(m?.image),
          image_alt: s.image ? s.name : str(m?.image_alt) || s.name,
        }
      })
    : own(list(d.services), [])
  // Staff only with "Show on website" (owner R26 (2)): nobody switched on → [] (designs hide an empty team), never
  // the design's own people. Still no photo (CRM or same-name design item) → left out (R28 D2).
  const staff = crm.staff
    .map((s) => {
      const key = crmName(s.name)
      const m = key ? dStaff.find((x) => crmName(x.name) === key) : undefined
      return {
        ...m,
        ...s,
        specialty: s.specialty || str(m?.specialty),
        photo: s.photo || str(m?.photo),
        photo_alt: s.photo ? s.name : str(m?.photo_alt) || s.name,
      }
    })
    .filter((s) => s.photo !== '')
  return {
    ...d,
    spa,
    contact,
    location,
    hours: crm.hours.length ? crm.hours : own(list(d.hours), []),
    booking,
    services,
    staff,
    ...(opts.locale && (design === null || v2) ? { locale: opts.locale } : {}),
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Script-safe JSON + splice
// ---------------------------------------------------------------------------------------------------------------

/** Serialisations of the design's (immutable, cached) objects and long strings: re-serialising them is free. */
export type CrmJsonMemo = { objects: WeakMap<object, string>; strings: Map<string, string> }
export const crmJsonMemo = (): CrmJsonMemo => ({ objects: new WeakMap(), strings: new Map() })

const UNSAFE = /[<>&\u2028\u2029]/
const UNSAFE_ALL = /[<>&\u2028\u2029]/g
const scriptSafe = (json: string) =>
  UNSAFE.test(json)
    ? json.replace(UNSAFE_ALL, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    : json
/** Only strings this long are memoised (the design's data: images), and only so many of them. */
const MEMO_STRING_MIN = 4096
const MEMO_STRINGS_MAX = 512

/**
 * `JSON.stringify(value)` that is safe inside a `<script>` (`<`, `>`, `&`, U+2028, U+2029 as `\uXXXX`; lone
 * surrogates are escaped by JSON.stringify itself), so the data can never close the script or open a comment.
 * Same output as JSON.stringify otherwise (key order, undefined skipped / null in arrays). `memo`: objects and long
 * strings seen before are not serialised again (objects must never be mutated once serialised).
 */
export function crmScriptJson(value: unknown, memo?: CrmJsonMemo): string {
  const ser = (v: unknown): string | undefined => {
    if (typeof v === 'string') {
      if (!memo || v.length < MEMO_STRING_MIN) return scriptSafe(JSON.stringify(v))
      let s = memo.strings.get(v)
      if (s === undefined) {
        s = scriptSafe(JSON.stringify(v))
        if (memo.strings.size < MEMO_STRINGS_MAX) memo.strings.set(v, s)
      }
      return s
    }
    if (v === null || typeof v !== 'object') return JSON.stringify(v)
    const hit = memo?.objects.get(v)
    if (hit !== undefined) return hit
    let out: string
    if (Array.isArray(v)) out = `[${v.map((x) => ser(x) ?? 'null').join(',')}]`
    else {
      const toJSON = (v as { toJSON?: unknown }).toJSON
      if (typeof toJSON === 'function') return ser(toJSON.call(v))
      const parts: string[] = []
      for (const k of Object.keys(v)) {
        const s = ser((v as Record<string, unknown>)[k])
        if (s !== undefined) parts.push(`${scriptSafe(JSON.stringify(k))}:${s}`)
      }
      out = `{${parts.join(',')}}`
    }
    memo?.objects.set(v, out)
    return out
  }
  return ser(value) ?? 'null'
}

/**
 * The design with the contract's data in it: `literal` = only the literal's JSON range replaced; `endpoint` with
 * `inject` (frames, which have no site to fetch from) = one `<script>window.CRM_DATA=…;</script>` before the design's
 * first script; otherwise unchanged (the live page fetches crm-data.json itself).
 */
export function spliceCrmData(
  html: string,
  found: HtmlCrmContract,
  json: string,
  opts: { inject: boolean },
): string {
  if (found.literal) return html.slice(0, found.literal.start) + json + html.slice(found.literal.end)
  if (!opts.inject) return html
  return `${html.slice(0, found.inject)}<script>window.CRM_DATA=${json};</script>${html.slice(found.inject)}`
}

/** cyrb53: a fast 53-bit string hash (content-addressed cache keys, not security). */
export function cyrb53(s: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

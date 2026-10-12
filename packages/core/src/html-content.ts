// R28: per-spa website content for HTML designs (docs/design/r28-dynamic-html-designs.md). The design file stays byte
// for byte: a spa's content (stored on its HtmlDesign block, so it goes draft → publish with the page) replaces only
// design-owned VALUES of the design's `window.CRM_DATA` (story scenes, experience, booking label / picture, message
// templates …) before the CRM merge. Operational keys (name, phones, address, hours, services, staff …) are the CRM's
// and never content; layout, CSS and scripts are never touched (R24).
import { type CrmLocale, crmImageUrl, crmName, isOwnDesign, UAE_CITIES } from './html-crm'

export type HtmlContentBi = { en: string; ar?: string }
/** One slot's value: a text (EN + AR), a tag list, a picture / video URL, a switch, or hidden (empty). */
export type HtmlContentValue =
  | { t: HtmlContentBi }
  | { tags: { en: string[]; ar?: string[] } }
  | { img: string }
  | { video: string }
  | { on: boolean }
  | { hide: true }
/** One stored value: the slot path (`journey[welcome].title`, `spa.experience[1].text`, `booking.label`) + its value. */
export type HtmlContentEntry = { path: string; value: HtmlContentValue }
/**
 * Stored on the HtmlDesign block. A list, never an object keyed by path: Puck's editor flattens block props on `.`
 * (the `flat` package) and would split such keys into nested objects.
 */
export type HtmlDesignContent = { v: 1; values?: HtmlContentEntry[] }

/** The stored values by path (later entries win; malformed ones skipped). */
export function htmlContentMap(content: unknown): Record<string, HtmlContentValue> {
  const out: Record<string, HtmlContentValue> = {}
  const list = isObj(content) && Array.isArray(content.values) ? content.values : []
  for (const e of list)
    if (isObj(e) && typeof e.path === 'string' && isObj(e.value)) out[e.path] = e.value as HtmlContentValue
  return out
}
/** Values by path as stored content; undefined when there is none. */
export function htmlContentOf(map: Record<string, HtmlContentValue>): HtmlDesignContent | undefined {
  const values = Object.entries(map).map(([path, value]) => ({ path, value }))
  return values.length ? { v: 1, values } : undefined
}
export type HtmlContentKind = 'text' | 'longtext' | 'tags' | 'image' | 'video' | 'bool' | 'focus' | 'color'
export type HtmlContentSlot = {
  path: string
  kind: HtmlContentKind
  /** The design's own value (pictures as stored: usually an embedded `data:` URL). */
  value: string | boolean | string[] | null
  /** The slot's parent (`journey[welcome]`, `booking`, `spa`): what an editor groups by. */
  group: string
  /** The value's key (`title`, `experience_image`). */
  key: string
}

/** Operational roots: the CRM's (R26 contract), never content. Matched on the path without item selectors. */
const OPERATIONAL = [
  'spa.name',
  'spa.short_name',
  'spa.area_label',
  'spa.logo_on_light',
  'spa.timezone',
  'spa.currency',
  'contact.whatsapp_number',
  'contact.phones',
  'location',
  'hours',
  'booking.url',
  'booking.form_endpoint',
  'services',
  'staff',
] as const
const isOperational = (plain: string) => OPERATIONAL.some((p) => plain === p || plain.startsWith(`${p}.`))

const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/
const SEGMENT = /^([A-Za-z_][A-Za-z0-9_]{0,63})((?:\[[A-Za-z0-9_-]{1,64}\])*)$/
const MAX_SLOTS = 2000
/** Limits a stored content value must keep (save time; render re-checks paths and kinds). */
export const HTML_CONTENT_LIMITS = { text: 2000, tags: 20, tag: 200, url: 2000, bytes: 64 * 1024 } as const

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** The kind of a design value from its key and value; null = not editable content (numbers, objects, ids). */
function kindOf(key: string, v: unknown): HtmlContentKind | null {
  const k = key.toLowerCase()
  if (k === 'id') return null
  if (typeof v === 'boolean') return 'bool'
  if (isStrings(v)) return 'tags'
  if (v !== null && typeof v !== 'string') return null
  if (!k.endsWith('alt') && /(image|photo|logo|still|picture|poster)/.test(k)) return 'image'
  if (/(clip|video)/.test(k)) return 'video'
  if (v === null) return null
  if (k === 'focus') return 'focus'
  if (/(accent|colou?r)$/.test(k) && /^#[0-9a-f]{3,8}$/i.test(v)) return 'color'
  return v.length > 90 || v.includes('\n') ? 'longtext' : 'text'
}

/** Item selectors of an array: its items' ids when every item has a distinct safe one, else their indexes. */
function itemIds(list: unknown[]): string[] {
  const ids = list.map((x) => (isObj(x) && typeof x.id === 'string' && ITEM_ID.test(x.id) ? x.id : ''))
  return ids.every(Boolean) && new Set(ids).size === ids.length ? ids : list.map((_, i) => String(i))
}

/** Every editable value of a design's `window.CRM_DATA` (operational keys left out), in document order. */
export function htmlContentSlots(data: Record<string, unknown> | null | undefined): HtmlContentSlot[] {
  const out: HtmlContentSlot[] = []
  const walk = (v: unknown, path: string, plain: string, group: string, key: string) => {
    if (out.length >= MAX_SLOTS || (plain && isOperational(plain))) return
    if (Array.isArray(v) && !isStrings(v)) {
      const ids = itemIds(v)
      v.forEach((x, i) => {
        if (isObj(x)) walk(x, `${path}[${ids[i]}]`, plain, `${path}[${ids[i]}]`, key)
      })
      return
    }
    if (isObj(v)) {
      for (const [k, x] of Object.entries(v)) {
        if (KEY.test(k)) walk(x, path ? `${path}.${k}` : k, plain ? `${plain}.${k}` : k, path, k)
      }
      return
    }
    const kind = path ? kindOf(key, v) : null
    if (kind) out.push({ path, kind, value: v as HtmlContentSlot['value'], group: group || key, key })
  }
  walk(data ?? {}, '', '', '', '')
  return out
}

type Seg = { key: string; items: string[] }
function parsePath(path: string): Seg[] | null {
  if (path.length > 400) return null
  const segs: Seg[] = []
  for (const part of path.split('.')) {
    const m = SEGMENT.exec(part)
    if (!m) return null
    segs.push({ key: m[1]!, items: [...(m[2] ?? '').matchAll(/\[([A-Za-z0-9_-]+)\]/g)].map((x) => x[1]!) })
  }
  return segs
}

const HIDE = Symbol('hide')
type Resolved = string | boolean | string[] | typeof HIDE

/** The value a slot shows in a locale (Arabic → English fallback); undefined = unusable. */
function resolve(v: HtmlContentValue, locale: CrmLocale, filesOrigin: string): Resolved | undefined {
  if (!isObj(v)) return undefined
  if ('hide' in v) return v.hide === true ? HIDE : undefined
  if ('on' in v) return typeof v.on === 'boolean' ? v.on : undefined
  if ('t' in v) {
    const t = v.t
    if (!isObj(t) || typeof t.en !== 'string') return undefined
    return locale === 'ar' && typeof t.ar === 'string' && t.ar.trim() ? t.ar : t.en
  }
  if ('tags' in v) {
    const t = v.tags
    if (!isObj(t) || !isStrings(t.en)) return undefined
    return locale === 'ar' && isStrings(t.ar) && t.ar.length ? t.ar : t.en
  }
  const url = 'img' in v ? v.img : 'video' in v ? v.video : undefined
  if (typeof url !== 'string' || !contentUrlOk(url)) return undefined
  return crmImageUrl(url, filesOrigin) || undefined
}

/** A content picture / video: one of the platform's files (`/files/{uuid}`) or an https URL; never data: / js. */
export function contentUrlOk(url: string): boolean {
  return (
    url.length <= HTML_CONTENT_LIMITS.url &&
    (/^\/files\/[0-9a-f-]{36}$/i.test(url) || /^https:\/\/[^\s"'<>\\`]+$/i.test(url))
  )
}

/** Which content value kinds a slot kind takes. */
const ACCEPTS: Record<HtmlContentKind, (v: HtmlContentValue) => boolean> = {
  text: (v) => 't' in v,
  longtext: (v) => 't' in v,
  focus: (v) => 't' in v,
  color: (v) => 't' in v,
  tags: (v) => 'tags' in v,
  image: (v) => 'img' in v,
  video: (v) => 'video' in v,
  bool: (v) => 'on' in v,
}

/** Copy-on-write set of one leaf; null = no such slot here (stale path, changed kind or an operational key). */
function setAt(node: unknown, segs: Seg[], i: number, v: HtmlContentValue, value: Resolved): unknown | null {
  const seg = segs[i]!
  if (!isObj(node) || !Object.hasOwn(node, seg.key)) return null
  let child: unknown = node[seg.key]
  const trail: { list: unknown[]; at: number }[] = []
  for (const sel of seg.items) {
    if (!Array.isArray(child) || isStrings(child)) return null
    const at = itemIds(child).indexOf(sel)
    if (at < 0) return null
    trail.push({ list: child, at })
    child = child[at]
  }
  let next: unknown
  if (i === segs.length - 1) {
    const kind = seg.items.length ? null : kindOf(seg.key, child)
    if (!kind) return null
    if (value === HIDE) next = kind === 'bool' ? false : kind === 'tags' ? [] : ''
    else {
      const shape =
        kind === 'tags'
          ? isStrings(value)
          : kind === 'bool'
            ? typeof value === 'boolean'
            : typeof value === 'string'
      if (!ACCEPTS[kind](v) || !shape) return null
      next = value
    }
  } else {
    next = setAt(child, segs, i + 1, v, value)
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

/**
 * The design's data with a spa's content over it (copy-on-write: untouched subtrees keep their identity, so the
 * serializer's memo still hits; no content → the very same object). Paths that no longer exist in the design, wrong
 * kinds and operational keys are skipped.
 */
export function overlayHtmlContent(
  data: Record<string, unknown>,
  content: HtmlDesignContent | null | undefined,
  opts: { locale: CrmLocale; filesOrigin?: string },
): Record<string, unknown> {
  const entries = Object.entries(htmlContentMap(content))
  let root = data
  for (const [path, v] of entries) {
    const segs = parsePath(path)
    if (!segs || isOperational(segs.map((s) => s.key).join('.'))) continue
    const value = resolve(v, opts.locale, opts.filesOrigin ?? '')
    if (value === undefined) continue
    const next = setAt(root, segs, 0, v, value)
    if (next) root = next as Record<string, unknown>
  }
  return root
}

/** Whether a content object sets anything. */
export const hasHtmlContent = (content: HtmlDesignContent | null | undefined): boolean =>
  Object.keys(htmlContentMap(content)).length > 0

/** Save-time check of a spa's content against its design's slots: [] = fine, else readable problems. */
export function htmlContentErrors(content: unknown, slots: HtmlContentSlot[]): string[] {
  if (content === undefined || content === null) return []
  if (!isObj(content) || content.v !== 1) return ['content: unknown format']
  if (content.values === undefined) return []
  if (!Array.isArray(content.values)) return ['content: values must be a list']
  if (content.values.some((e) => !isObj(e) || typeof e.path !== 'string'))
    return ['content: every value needs a path']
  if (JSON.stringify(content).length > HTML_CONTENT_LIMITS.bytes) return ['content: more than 64 KB']
  const data = htmlContentMap(content)
  const bySlot = new Map(slots.map((s) => [s.path, s]))
  const errors: string[] = []
  const textOk = (s: unknown) => typeof s === 'string' && s.length <= HTML_CONTENT_LIMITS.text
  const tagsOk = (s: unknown) =>
    isStrings(s) &&
    s.length <= HTML_CONTENT_LIMITS.tags &&
    s.every((x) => x.length <= HTML_CONTENT_LIMITS.tag)
  for (const [path, v] of Object.entries(data)) {
    const slot = bySlot.get(path)
    if (!slot) {
      errors.push(`${path}: not an editable part of this design`)
      continue
    }
    if (!isObj(v)) {
      errors.push(`${path}: invalid value`)
      continue
    }
    const val = v as HtmlContentValue
    if ('hide' in val) {
      if (val.hide !== true) errors.push(`${path}: invalid value`)
      continue
    }
    if (!ACCEPTS[slot.kind](val)) {
      errors.push(`${path}: expects a ${slot.kind} value`)
      continue
    }
    if ('t' in val) {
      const t = val.t as unknown
      if (!isObj(t) || !textOk(t.en) || (t.ar !== undefined && !textOk(t.ar)))
        errors.push(`${path}: text must be at most ${HTML_CONTENT_LIMITS.text} characters`)
      else if (slot.kind === 'color' && !/^#[0-9a-f]{3,8}$/i.test(String(t.en)))
        errors.push(`${path}: a colour like #c27b3f`)
      else if (slot.kind === 'focus' && !/^[0-9.]{1,6}% [0-9.]{1,6}%$/.test(String(t.en)))
        errors.push(`${path}: a focal point like "50% 30%"`)
    } else if ('tags' in val) {
      const t = val.tags as unknown
      if (!isObj(t) || !tagsOk(t.en) || (t.ar !== undefined && !tagsOk(t.ar)))
        errors.push(
          `${path}: at most ${HTML_CONTENT_LIMITS.tags} tags of ${HTML_CONTENT_LIMITS.tag} characters`,
        )
    } else if ('img' in val || 'video' in val) {
      const url = 'img' in val ? val.img : val.video
      if (typeof url !== 'string' || !contentUrlOk(url))
        errors.push(`${path}: a picture from the media library (/files/…) or an https link`)
    } else if ('on' in val && typeof val.on !== 'boolean') errors.push(`${path}: on / off`)
  }
  return errors
}

/** The platform files (`/files/{uuid}` ids) a content object uses: the save checks they are this spa's. */
export function htmlContentFileIds(content: HtmlDesignContent | null | undefined): string[] {
  const ids = new Set<string>()
  for (const v of Object.values(htmlContentMap(content))) {
    const url = isObj(v) ? ('img' in v ? v.img : 'video' in v ? v.video : null) : null
    const m = typeof url === 'string' ? /^\/files\/([0-9a-f-]{36})$/i.exec(url) : null
    if (m) ids.add(m[1]!.toLowerCase())
  }
  return [...ids]
}

export type HtmlContentLeftover = {
  path: string
  /**
   * `other-spa`: names the spa the design was made for; `city`: another UAE city than the spa's; `phone` / `email`:
   * contact details in the copy; `test`: test or filler copy; `arabic`: set in English only; `stale`: the design no
   * longer has this slot.
   */
  reason: 'other-spa' | 'city' | 'phone' | 'email' | 'test' | 'arabic' | 'stale'
  text: string
}

const PHONE = /(?:\+|00)?971[\s-]?\d|\b0\d{1,2}[\s-]?\d{3}[\s-]?\d{4}\b/
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/
const TEST = /\b(?:test build|lorem ipsum|dolor sit|placeholder)\b/i

/**
 * Readiness (R28): what on a spa's HTML-design page still looks like the design's own spa — design-owned texts the
 * spa hasn't replaced that name the spa the design was made for (when it isn't this one), name another UAE city than
 * the spa's, carry a phone number / email or test copy; values set in English only (`arabic`: the site has Arabic);
 * values whose slot the design no longer has. Never blocks publishing; the console lists it.
 */
export function htmlContentLeftovers(
  data: Record<string, unknown> | null | undefined,
  content: HtmlDesignContent | null | undefined,
  ctx: { spaName: string; city: string; arabic: boolean },
): HtmlContentLeftover[] {
  const slots = htmlContentSlots(data)
  const set = htmlContentMap(content)
  const own = isOwnDesign(data, ctx.spaName)
  const spa = isObj(data?.spa) ? data.spa : {}
  const designNames = own ? [] : [spa.name, spa.short_name].map(crmName).filter((n) => n.length >= 3)
  const city = crmName(ctx.city)
  const out: HtmlContentLeftover[] = []
  for (const slot of slots) {
    if (set[slot.path] || !['text', 'longtext', 'tags'].includes(slot.kind)) continue
    const raw = Array.isArray(slot.value) ? slot.value.join(' · ') : String(slot.value ?? '')
    if (!raw.trim()) continue
    const words = ` ${crmName(raw)} `
    const reason: HtmlContentLeftover['reason'] | null = designNames.some((n) => words.includes(` ${n} `))
      ? 'other-spa'
      : UAE_CITIES.some((c) => c !== city && words.includes(` ${c} `))
        ? 'city'
        : PHONE.test(raw)
          ? 'phone'
          : EMAIL.test(raw)
            ? 'email'
            : TEST.test(raw)
              ? 'test'
              : null
    if (reason) out.push({ path: slot.path, reason, text: raw.length > 160 ? `${raw.slice(0, 159)}…` : raw })
  }
  const paths = new Set(slots.map((s) => s.path))
  for (const [path, v] of Object.entries(set)) {
    if (!paths.has(path)) out.push({ path, reason: 'stale', text: '' })
    else if (
      ctx.arabic &&
      isObj(v) &&
      't' in v &&
      isObj(v.t) &&
      String(v.t.en ?? '').trim() &&
      !String(v.t.ar ?? '').trim()
    )
      out.push({ path, reason: 'arabic', text: String(v.t.en) })
  }
  return out
}

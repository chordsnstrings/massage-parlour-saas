// R28: per-spa website content for HTML designs (docs/design/r28-dynamic-html-designs.md). The design file stays byte
// for byte: a spa's content (stored on its HtmlDesign block, so it goes draft → publish with the page) replaces only
// design-owned VALUES of the design's `window.CRM_DATA` (story scenes, experience, booking label / picture, message
// templates …) before the CRM merge. Operational keys (name, phones, address, hours, services, staff …) are the CRM's
// and never content; layout, CSS and scripts are never touched (R24).
import { type CrmLocale, crmImageUrl, crmName, htmlCrmContractOf, isOwnDesign, UAE_CITIES } from './html-crm'
import {
  HTML_IMAGE_ID,
  HTML_IMAGE_SRC_MAX,
  HTML_IMAGE_URL,
  HTML_TEXT_ID,
  type HtmlDesignImage,
  type HtmlDesignText,
  type HtmlDesignTextKind,
  type HtmlImageAdjust,
  type HtmlTextAttr,
  type HtmlTextOverride,
  listHtmlDesignImages,
  listHtmlDesignTexts,
} from './html-design'

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
/** R28 P4: one page text of the design (`listHtmlDesignTexts` id + its `src` guard, filled by the server). */
export type HtmlContentText = HtmlTextOverride
/** R28 P4: one picture of the design replaced for this spa (`listHtmlDesignImages` id + src guard); replace-only. */
export type HtmlContentPicture = { id: string; src: string; img: string }
/**
 * Stored on the HtmlDesign block. Lists, never objects keyed by path or id: Puck's editor flattens block props on `.`
 * (the `flat` package) and would split such keys into nested objects.
 */
export type HtmlDesignContent = {
  v: 1
  values?: HtmlContentEntry[]
  texts?: HtmlContentText[]
  pictures?: HtmlContentPicture[]
}
/** The stored parts by path / id (local state only, never stored like this). */
export type HtmlContentParts = {
  values: Record<string, HtmlContentValue>
  texts: Record<string, HtmlContentText>
  pictures: Record<string, HtmlContentPicture>
}

/** The stored values by path (later entries win; malformed ones skipped). */
export function htmlContentMap(content: unknown): Record<string, HtmlContentValue> {
  const out: Record<string, HtmlContentValue> = {}
  const list = isObj(content) && Array.isArray(content.values) ? content.values : []
  for (const e of list)
    if (isObj(e) && typeof e.path === 'string' && isObj(e.value)) out[e.path] = e.value as HtmlContentValue
  return out
}
/** Every stored part by path / id (later entries win; malformed ones skipped). */
export function htmlContentParts(content: unknown): HtmlContentParts {
  const texts: Record<string, HtmlContentText> = {}
  const pictures: Record<string, HtmlContentPicture> = {}
  for (const e of isObj(content) && Array.isArray(content.texts) ? content.texts : []) {
    if (!isObj(e) || typeof e.id !== 'string' || !HTML_TEXT_ID.test(e.id) || typeof e.src !== 'string')
      continue
    if (!isObj(e.t) || (typeof e.t.en !== 'string' && typeof e.t.ar !== 'string')) continue
    const t = {
      ...(typeof e.t.en === 'string' ? { en: e.t.en } : {}),
      ...(typeof e.t.ar === 'string' ? { ar: e.t.ar } : {}),
    }
    texts[e.id] = { id: e.id, src: e.src, t }
  }
  for (const e of isObj(content) && Array.isArray(content.pictures) ? content.pictures : []) {
    if (!isObj(e) || typeof e.id !== 'string' || !HTML_IMAGE_ID.test(e.id)) continue
    if (typeof e.src === 'string' && typeof e.img === 'string')
      pictures[e.id] = { id: e.id, src: e.src, img: e.img }
  }
  return { values: htmlContentMap(content), texts, pictures }
}
/** The parts as stored content (lists; empty parts left out); undefined when there is nothing. */
export function htmlContentFrom(parts: Partial<HtmlContentParts>): HtmlDesignContent | undefined {
  const values = Object.entries(parts.values ?? {}).map(([path, value]) => ({ path, value }))
  const texts = Object.values(parts.texts ?? {})
  const pictures = Object.values(parts.pictures ?? {})
  if (!values.length && !texts.length && !pictures.length) return undefined
  return {
    v: 1,
    ...(values.length ? { values } : {}),
    ...(texts.length ? { texts } : {}),
    ...(pictures.length ? { pictures } : {}),
  }
}
/** Values by path as stored content (`keep`: the stored content whose page texts and pictures stay); undefined = none. */
export function htmlContentOf(
  map: Record<string, HtmlContentValue>,
  keep?: unknown,
): HtmlDesignContent | undefined {
  return htmlContentFrom({ ...htmlContentParts(keep), values: map })
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
export const HTML_CONTENT_LIMITS = {
  text: 2000,
  tags: 20,
  tag: 200,
  url: 2000,
  texts: 2000,
  pictures: 200,
  bytes: 192 * 1024,
} as const

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

/** Whether a content object sets any value of the design's data (page texts and pictures don't touch CRM_DATA). */
export const hasHtmlContent = (content: HtmlDesignContent | null | undefined): boolean =>
  Object.keys(htmlContentMap(content)).length > 0
/** R28 P4: whether a content object sets page texts or pictures. */
export const hasHtmlPageContent = (content: unknown): boolean => {
  const parts = htmlContentParts(content)
  return Object.keys(parts.texts).length > 0 || Object.keys(parts.pictures).length > 0
}

const PARTS = new Set(['v', 'values', 'texts', 'pictures'])
/** A content picture: a content URL that is also safe in an unquoted CSS `url()` (HTML_IMAGE_URL: no parentheses or character references; a pasted `&amp;` reads as `&`). */
const pictureUrlOk = (url: unknown): url is string =>
  typeof url === 'string' && contentUrlOk(url) && HTML_IMAGE_URL.test(url)

/**
 * Save-time check of a spa's content: [] = fine, else readable problems. `slots`: the design's (values must be
 * editable parts of the right kind); null = shape only (draft saves: stale entries are fine, the render skips them).
 */
export function htmlContentErrors(content: unknown, slots: HtmlContentSlot[] | null): string[] {
  if (content === undefined || content === null) return []
  if (!isObj(content) || content.v !== 1) return ['content: unknown format']
  const unknown = Object.keys(content).filter((k) => !PARTS.has(k))
  if (unknown.length) return unknown.map((k) => `content: unknown part "${k.slice(0, 40)}"`)
  if (JSON.stringify(content).length > HTML_CONTENT_LIMITS.bytes)
    return [`content: more than ${HTML_CONTENT_LIMITS.bytes / 1024} KB`]
  return [
    ...(content.values === undefined ? [] : valueErrors(content, slots)),
    ...(content.texts === undefined ? [] : textErrors(content.texts)),
    ...(content.pictures === undefined ? [] : pictureErrors(content.pictures)),
  ]
}

function valueErrors(content: Record<string, unknown>, slots: HtmlContentSlot[] | null): string[] {
  if (!Array.isArray(content.values)) return ['content: values must be a list']
  if (content.values.some((e) => !isObj(e) || typeof e.path !== 'string'))
    return ['content: every value needs a path']
  const data = htmlContentMap(content)
  const bySlot = slots && new Map(slots.map((s) => [s.path, s]))
  const errors: string[] = []
  const textOk = (s: unknown) => typeof s === 'string' && s.length <= HTML_CONTENT_LIMITS.text
  const tagsOk = (s: unknown) =>
    isStrings(s) &&
    s.length <= HTML_CONTENT_LIMITS.tags &&
    s.every((x) => x.length <= HTML_CONTENT_LIMITS.tag)
  for (const [path, v] of Object.entries(data)) {
    const slot = bySlot?.get(path)
    if (bySlot && !slot) {
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
    // Shape only (no slots): any known value kind.
    if (slot ? !ACCEPTS[slot.kind](val) : !Object.values(ACCEPTS).some((ok) => ok(val))) {
      errors.push(slot ? `${path}: expects a ${slot.kind} value` : `${path}: invalid value`)
      continue
    }
    if ('t' in val) {
      const t = val.t as unknown
      if (!isObj(t) || !textOk(t.en) || (t.ar !== undefined && !textOk(t.ar)))
        errors.push(`${path}: text must be at most ${HTML_CONTENT_LIMITS.text} characters`)
      else if (slot?.kind === 'color' && !/^#[0-9a-f]{3,8}$/i.test(String(t.en)))
        errors.push(`${path}: a colour like #c27b3f`)
      else if (slot?.kind === 'focus' && !/^[0-9.]{1,6}% [0-9.]{1,6}%$/.test(String(t.en)))
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

/** R28 P4: the page-text list (ids from listHtmlDesignTexts, src guard, English and / or Arabic: one not blank). */
function textErrors(texts: unknown): string[] {
  if (!Array.isArray(texts)) return ['content: texts must be a list']
  if (texts.length > HTML_CONTENT_LIMITS.texts)
    return [`content: more than ${HTML_CONTENT_LIMITS.texts} page texts`]
  const errors: string[] = []
  const seen = new Set<string>()
  const max = HTML_CONTENT_LIMITS.text
  for (const e of texts) {
    const id = isObj(e) && typeof e.id === 'string' ? e.id.slice(0, 40) : '?'
    const t = isObj(e) && isObj(e.t) ? e.t : null
    if (!isObj(e) || !HTML_TEXT_ID.test(id)) errors.push(`text ${id}: not a page text of a design`)
    else if (seen.has(id)) errors.push(`text ${id}: set twice`)
    else if (typeof e.src !== 'string' || e.src.length > HTML_IMAGE_SRC_MAX)
      errors.push(`text ${id}: src must be the design text's first ${HTML_IMAGE_SRC_MAX} characters`)
    else if (!t) errors.push(`text ${id}: an English or Arabic text of 1 to ${max} characters`)
    else if (t.en !== undefined && (typeof t.en !== 'string' || t.en.length > max))
      errors.push(`text ${id}: the English text must be at most ${max} characters`)
    else if (t.ar !== undefined && (typeof t.ar !== 'string' || t.ar.length > max))
      errors.push(`text ${id}: the Arabic text must be at most ${max} characters`)
    else if (!String(t.en ?? '').trim() && !String(t.ar ?? '').trim())
      errors.push(`text ${id}: an English or Arabic text of 1 to ${max} characters`)
    seen.add(id)
  }
  return errors
}

/** R28 P4: the picture list (ids from listHtmlDesignImages, src guard, a /files or https URL). */
function pictureErrors(pictures: unknown): string[] {
  if (!Array.isArray(pictures)) return ['content: pictures must be a list']
  if (pictures.length > HTML_CONTENT_LIMITS.pictures)
    return [`content: more than ${HTML_CONTENT_LIMITS.pictures} pictures`]
  const errors: string[] = []
  const seen = new Set<string>()
  for (const e of pictures) {
    const id = isObj(e) && typeof e.id === 'string' ? e.id.slice(0, 40) : '?'
    if (!isObj(e) || !HTML_IMAGE_ID.test(id)) errors.push(`picture ${id}: not a picture of a design`)
    else if (seen.has(id)) errors.push(`picture ${id}: set twice`)
    else if (typeof e.src !== 'string' || e.src.length > HTML_IMAGE_SRC_MAX)
      errors.push(`picture ${id}: src must be the design picture's first ${HTML_IMAGE_SRC_MAX} characters`)
    else if (!pictureUrlOk(e.img))
      errors.push(`picture ${id}: a picture from the media library (/files/…) or an https link`)
    seen.add(id)
  }
  return errors
}

/** The platform files (`/files/{uuid}` ids) a content object uses (values + pictures): the save checks they are this spa's. */
export function htmlContentFileIds(content: unknown): string[] {
  const ids = new Set<string>()
  const parts = htmlContentParts(content)
  const urls = [
    ...Object.values(parts.values).map((v) =>
      isObj(v) ? ('img' in v ? v.img : 'video' in v ? v.video : null) : null,
    ),
    ...Object.values(parts.pictures).map((p) => p.img),
  ]
  for (const url of urls) {
    const m = typeof url === 'string' ? /^\/files\/([0-9a-f-]{36})$/i.exec(url) : null
    if (m) ids.add(m[1]!.toLowerCase())
  }
  return [...ids]
}

/**
 * R28 P4: the block's image adjustments (the template's) with the spa's pictures over them: a picture of an adjusted
 * image (same id + src) keeps its framing and takes the new URL; others become their own replace-only entry. No valid
 * picture → `images` itself.
 */
export function htmlPictureAdjustments(images: HtmlImageAdjust[], content: unknown): HtmlImageAdjust[] {
  const pictures = Object.values(htmlContentParts(content).pictures).filter((p) => pictureUrlOk(p.img))
  if (!pictures.length) return images
  const byId = new Map(pictures.map((p) => [p.id, p]))
  const merged = new Set<string>()
  const out = images.map((a) => {
    const p = byId.get(a.id)
    if (!p || p.src !== a.src) return a
    merged.add(p.id)
    return { ...a, replace: p.img }
  })
  for (const p of pictures) if (!merged.has(p.id)) out.push({ id: p.id, src: p.src, replace: p.img })
  return out
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
/** Linear: a match starts only where a run of address characters starts, each part bounded. */
const EMAIL = /(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}\.[\w.]{2,63}/
const TEST = /\b(?:test build|lorem ipsum|dolor sit|placeholder)\b/i

/** Why a design-owned text still looks like the design's own spa (null = fine): other spa > city > phone > email > test. */
function leftoverReason(
  raw: string,
  designNames: string[],
  city: string,
): HtmlContentLeftover['reason'] | null {
  const words = ` ${crmName(raw)} `
  return designNames.some((n) => words.includes(` ${n} `))
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
}
const leftoverText = (raw: string) => (raw.length > 160 ? `${raw.slice(0, 159)}…` : raw)

/**
 * Readiness (R28): what on a spa's HTML-design page still looks like the design's own spa — design-owned texts the
 * spa hasn't replaced that name the spa the design was made for (when it isn't this one), name another UAE city than
 * the spa's, carry a phone number / email or test copy; values set in English only (`arabic`: the site has Arabic);
 * values whose slot the design no longer has. `page` (R28 P4: the design's page texts + pictures): the same for its
 * unbound page texts (`text:<id>`), and stale / English-only page texts and stale pictures (`picture:<id>`). Never
 * blocks publishing; the console lists it.
 */
export function htmlContentLeftovers(
  data: Record<string, unknown> | null | undefined,
  content: HtmlDesignContent | null | undefined,
  ctx: {
    spaName: string
    city: string
    arabic: boolean
    page?: { texts: HtmlDesignText[]; images: HtmlDesignImage[] }
  },
): HtmlContentLeftover[] {
  const slots = htmlContentSlots(data)
  const parts = htmlContentParts(content)
  const set = parts.values
  const own = isOwnDesign(data, ctx.spaName)
  const spa = isObj(data?.spa) ? data.spa : {}
  const designNames = own ? [] : [spa.name, spa.short_name].map(crmName).filter((n) => n.length >= 3)
  const city = crmName(ctx.city)
  const out: HtmlContentLeftover[] = []
  /** A set value whose English is still the design's (an Arabic-only edit keeps it): its English is checked too. */
  const designEnglish = (v: HtmlContentValue | undefined, design: unknown) => {
    if (!isObj(v)) return false
    const flat = (x: unknown) =>
      (Array.isArray(x) ? x.join(' · ') : String(x ?? '')).replace(/\s+/g, ' ').trim()
    if ('t' in v) return flat(v.t.en) === flat(design)
    if ('tags' in v) return flat(v.tags.en) === flat(design)
    return false
  }
  for (const slot of slots) {
    if (
      (set[slot.path] && !designEnglish(set[slot.path], slot.value)) ||
      !['text', 'longtext', 'tags'].includes(slot.kind)
    )
      continue
    const raw = Array.isArray(slot.value) ? slot.value.join(' · ') : String(slot.value ?? '')
    if (!raw.trim()) continue
    const reason = leftoverReason(raw, designNames, city)
    if (reason) out.push({ path: slot.path, reason, text: leftoverText(raw) })
  }
  const paths = new Set(slots.map((s) => s.path))
  const englishOnly = (t: unknown) =>
    ctx.arabic && isObj(t) && String(t.en ?? '').trim() !== '' && !String(t.ar ?? '').trim()
  for (const [path, v] of Object.entries(set)) {
    if (!paths.has(path)) out.push({ path, reason: 'stale', text: '' })
    else if (isObj(v) && 't' in v && englishOnly(v.t))
      out.push({ path, reason: 'arabic', text: String(v.t.en) })
  }
  if (!ctx.page) return out
  const texts = new Map(ctx.page.texts.map((x) => [x.id, x]))
  for (const x of ctx.page.texts) {
    // Replaced only by a current entry with English: an Arabic-only one leaves the design's English on the page.
    const e = parts.texts[x.id]
    const en = String(e?.t.en ?? '')
      .replace(/[ \t\n\f\r]+/g, ' ')
      .trim()
    // An English equal to the design's (echoed with an Arabic) leaves the design's text on the page: still checked.
    if (x.bound || (e?.src === x.src && en && en !== x.text)) continue
    const reason = leftoverReason(x.text, designNames, city)
    if (reason) out.push({ path: `text:${x.id}`, reason, text: leftoverText(x.text) })
  }
  for (const e of Object.values(parts.texts)) {
    if (texts.get(e.id)?.src !== e.src) out.push({ path: `text:${e.id}`, reason: 'stale', text: '' })
    else if (englishOnly(e.t))
      out.push({ path: `text:${e.id}`, reason: 'arabic', text: leftoverText(e.t.en ?? '') })
  }
  const images = new Map(ctx.page.images.map((x) => [x.id, x]))
  for (const p of Object.values(parts.pictures)) {
    const image = images.get(p.id)
    if (!image || image.src.slice(0, HTML_IMAGE_SRC_MAX) !== p.src)
      out.push({ path: `picture:${p.id}`, reason: 'stale', text: '' })
  }
  return out
}

/** A design value as a listing shows it: embedded pictures summarised, long strings clipped. */
const summarise = (v: unknown, clip = 400) =>
  typeof v === 'string' && v.startsWith('data:')
    ? `embedded ${v.slice(5, v.indexOf(';') > 0 ? v.indexOf(';') : 20)}, ${Math.round((v.length * 3) / 4 / 1024)} KB`
    : typeof v === 'string' && v.length > clip
      ? `${v.slice(0, clip)}…`
      : v

/** A string `summarise` clips: `cut` + its full length (an AI caller must not translate or rewrite a cut value). */
const cutMark = (v: unknown, clip: number) =>
  typeof v === 'string' && !v.startsWith('data:') && v.length > clip
    ? { cut: true as const, length: v.length }
    : {}

/** R28 P4: what a spa can change on an HTML-design page (connector get_html_content, Ask AI). */
export type HtmlContentView = {
  /** The design has a window.CRM_DATA literal (else no data slots: its words are page texts). */
  crmData: boolean
  /** `cut`: `design` is clipped (`length` = the full one). */
  slots: {
    path: string
    kind: HtmlContentKind
    group: string
    design: unknown
    cut?: true
    length?: number
    spa?: HtmlContentValue
  }[]
  texts: {
    id: string
    kind: HtmlDesignTextKind
    tag: string
    attr?: HtmlTextAttr
    group: string
    design: string
    /** `design` is clipped (`length` = the full one): never translate or rewrite a cut text. */
    cut?: true
    length?: number
    bound: boolean
    /** Bound texts: 'crm' (change it in the CRM) or 'script' (the design's script writes it). */
    boundBy?: 'crm' | 'script'
    spa?: HtmlTextOverride['t']
  }[]
  /** Page texts after part / search filtering, before paging. */
  textsTotal: number
  pictures: { id: string; kind: 'img' | 'bg'; design: string; spa?: string }[]
  /** Stored entries the design no longer has: values paths, 'text:<id>', 'picture:<id>'. */
  stale: string[]
}

/**
 * The design's editable parts with the spa's values: data slots (`group` = path prefix), page texts (`bound` false
 * leaves out the CRM-filled ones; `search` over text, values and group; paged by `start` / `limit`, default 200, at
 * most 500) and pictures; `part` picks one of them. Design values summarised (`clip`, default 400 characters); a
 * clipped text or data value is marked `cut` with its full `length`.
 */
export function htmlContentView(
  html: string,
  content: unknown,
  opts: {
    group?: string
    part?: 'all' | 'data' | 'texts' | 'pictures'
    search?: string
    start?: number
    limit?: number
    clip?: number
    bound?: boolean
  } = {},
): HtmlContentView {
  const part = opts.part ?? 'all'
  const clip = opts.clip ?? 400
  const group = opts.group ?? ''
  const parts = htmlContentParts(content)
  const literal = htmlCrmContractOf(html)?.literal
  const allSlots = htmlContentSlots(literal?.data)
  const slots =
    part === 'all' || part === 'data'
      ? allSlots
          .filter((x) => x.path.startsWith(group))
          .map((x) => ({
            path: x.path,
            kind: x.kind,
            group: x.group,
            design: summarise(x.value, clip),
            ...cutMark(x.value, clip),
            ...(parts.values[x.path] ? { spa: parts.values[x.path] } : {}),
          }))
      : []
  const listed = listHtmlDesignTexts(html)
  const current = (x: HtmlDesignText) => (parts.texts[x.id]?.src === x.src ? parts.texts[x.id] : undefined)
  const q = (opts.search ?? '').trim().toLowerCase()
  const texts =
    part === 'all' || part === 'texts'
      ? listed.filter((x) => {
          if (opts.bound === false && x.bound) return false
          if (!q) return true
          const t = current(x)?.t
          return [x.text, t?.en ?? '', t?.ar ?? '', x.group].some((s) => s.toLowerCase().includes(q))
        })
      : []
  const start = Math.max(0, Math.floor(opts.start ?? 0))
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 200)))
  const images = listHtmlDesignImages(html)
  const paths = new Set(allSlots.map((s) => s.path))
  const textIds = new Map(listed.map((x) => [x.id, x.src]))
  const imageIds = new Map(images.map((x) => [x.id, x.src.slice(0, HTML_IMAGE_SRC_MAX)]))
  return {
    crmData: Boolean(literal),
    slots,
    texts: texts.slice(start, start + limit).map((x) => {
      const t = current(x)?.t
      return {
        id: x.id,
        kind: x.kind,
        tag: x.tag,
        ...(x.attr ? { attr: x.attr } : {}),
        group: x.group,
        design: summarise(x.text, clip) as string,
        ...cutMark(x.text, clip),
        bound: x.bound,
        ...(x.boundBy ? { boundBy: x.boundBy } : {}),
        ...(t ? { spa: t } : {}),
      }
    }),
    textsTotal: texts.length,
    pictures:
      part === 'all' || part === 'pictures'
        ? images.map((x) => {
            const p = parts.pictures[x.id]
            return {
              id: x.id,
              kind: x.kind,
              design: summarise(x.src, clip) as string,
              ...(p && p.src === x.src.slice(0, HTML_IMAGE_SRC_MAX) ? { spa: p.img } : {}),
            }
          })
        : [],
    stale: [
      ...Object.keys(parts.values).filter((k) => !paths.has(k) && k.startsWith(group)),
      ...Object.values(parts.texts)
        .filter((e) => textIds.get(e.id) !== e.src)
        .map((e) => `text:${e.id}`),
      ...Object.values(parts.pictures)
        .filter((p) => imageIds.get(p.id) !== p.src)
        .map((p) => `picture:${p.id}`),
    ],
  }
}

// R28: per-spa website content for HTML designs (docs/design/r28-dynamic-html-designs.md). The design file stays byte
// for byte: a spa's content (stored on its HtmlDesign block, so it goes draft → publish with the page) replaces only
// design-owned VALUES of the design's `window.CRM_DATA` (story scenes, experience, booking label / picture, message
// templates …) before the CRM merge. Operational keys (name, phones, address, hours, services, staff …) are the CRM's
// and never content; layout, CSS and scripts are never touched (R24).
import {
  type CrmLocale,
  crmContractManifest,
  crmContractVersion,
  crmDesignData,
  crmImageUrl,
  crmName,
  englishOnly,
  htmlCrmContractOf,
  isOwnDesign,
  markHtmlContentPaths,
  systemCopy,
  UAE_CITIES,
} from './html-crm'
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
/** R28 P5: on contract v2 these are content (a spa's own short name / light logo), the merge still decides. */
const V2_CONTENT = new Set(['spa.short_name', 'spa.logo_on_light'])
const isOperational = (plain: string, v2: boolean) =>
  OPERATIONAL.some((p) => (plain === p || plain.startsWith(`${p}.`)) && !(v2 && V2_CONTENT.has(p)))
/** Roots the platform owns in every version (the design's manifest, the page locale): never slots, overlays or leftovers. */
const RESERVED = ['contract', 'locale'] as const
const isReserved = (plain: string) => RESERVED.some((p) => plain === p || plain.startsWith(`${p}.`))
const isPlatform = (plain: string, v2: boolean) => isReserved(plain) || isOperational(plain, v2)

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

/**
 * Every editable value of a design's `window.CRM_DATA` (operational keys and the reserved `contract` / `locale` roots
 * left out; contract v2 read from the data), in document order.
 */
export function htmlContentSlots(data: Record<string, unknown> | null | undefined): HtmlContentSlot[] {
  const out: HtmlContentSlot[] = []
  const v2 = crmContractVersion(data) === 2
  const walk = (v: unknown, path: string, plain: string, group: string, key: string) => {
    if (out.length >= MAX_SLOTS || (plain && isPlatform(plain, v2))) return
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

/**
 * The value a slot shows in a locale; undefined = unusable. Arabic: the content's Arabic, else the design's reviewed
 * Arabic for that path (`l10n`: a v2 `contract.l10n.ar` entry, same shape only), else the content's English.
 */
function resolve(
  v: HtmlContentValue,
  locale: CrmLocale,
  filesOrigin: string,
  l10n?: string | string[],
): Resolved | undefined {
  if (!isObj(v)) return undefined
  if ('hide' in v) return v.hide === true ? HIDE : undefined
  if ('on' in v) return typeof v.on === 'boolean' ? v.on : undefined
  if ('t' in v) {
    const t = v.t
    if (!isObj(t) || typeof t.en !== 'string') return undefined
    if (locale !== 'ar') return t.en
    return typeof t.ar === 'string' && t.ar.trim() ? t.ar : typeof l10n === 'string' ? l10n : t.en
  }
  if ('tags' in v) {
    const t = v.tags
    if (!isObj(t) || !isStrings(t.en)) return undefined
    if (locale !== 'ar') return t.en
    return isStrings(t.ar) && t.ar.length ? t.ar : isStrings(l10n) ? l10n : t.en
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
 * kinds, operational keys and the reserved roots are skipped; a v2 field declared English-only always shows English.
 * Arabic pages of a v2 design (integrator decision, 2026-10-13): content Arabic > the design's `contract.l10n.ar` >
 * content English > the design's English, so a value set in English only shows the design's reviewed Arabic there
 * (`spa.short_name` is a name: its English stays). The paths set are recorded on the output (`mergeCrmContract`).
 */
export function overlayHtmlContent(
  data: Record<string, unknown>,
  content: HtmlDesignContent | null | undefined,
  opts: { locale: CrmLocale; filesOrigin?: string },
): Record<string, unknown> {
  const entries = Object.entries(htmlContentMap(content))
  if (!entries.length) return data
  const manifest = crmContractManifest(data)
  const l10n = manifest && opts.locale === 'ar' ? manifest.l10n.ar : null
  let root = data
  const applied: string[] = []
  for (const [path, v] of entries) {
    const segs = parsePath(path)
    if (!segs || isPlatform(segs.map((s) => s.key).join('.'), manifest !== null)) continue
    const locale = opts.locale === 'ar' && englishOnly(manifest, path) ? 'en' : opts.locale
    const reviewed =
      locale === 'ar' && l10n && path !== 'spa.short_name' && Object.hasOwn(l10n, path)
        ? l10n[path]
        : undefined
    const value = resolve(v, locale, opts.filesOrigin ?? '', reviewed)
    if (value === undefined) continue
    const next = setAt(root, segs, 0, v, value)
    if (!next) continue
    root = next as Record<string, unknown>
    applied.push(path)
  }
  if (root !== data) markHtmlContentPaths(root, applied, data)
  return root
}

/**
 * R28 P5: a v2 design's data in a locale — on `ar`, each reviewed Arabic default of `contract.l10n.ar` written into
 * its slot (string → text / longtext, string[] → tags; operational, reserved and English-only paths skipped), copy on
 * write (the input is never mutated). Other locales, v1 or no l10n → the very same object. The spa's content goes over
 * it afterwards (`overlayHtmlContent`: content `t.ar` > l10n > content `t.en` > the design's English).
 */
export function contractLocaleData(
  data: Record<string, unknown>,
  locale: CrmLocale,
): Record<string, unknown> {
  if (locale !== 'ar') return data
  const manifest = crmContractManifest(data)
  const entries = manifest ? Object.entries(manifest.l10n.ar) : []
  if (!entries.length) return data
  const slots = new Map(htmlContentSlots(data).map((x) => [x.path, x]))
  let root = data
  for (const [path, v] of entries) {
    const slot = slots.get(path)
    if (!slot || englishOnly(manifest, path)) continue
    const fits =
      typeof v === 'string' ? slot.kind === 'text' || slot.kind === 'longtext' : slot.kind === 'tags'
    const segs = fits ? parsePath(path) : null
    if (!segs) continue
    const value: HtmlContentValue = typeof v === 'string' ? { t: { en: v } } : { tags: { en: v } }
    const next = setAt(root, segs, 0, value, v)
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
  const manifest = crmContractManifest(data)
  const spa = isObj(data?.spa) ? data.spa : {}
  // A v2 design names no spa (neutral defaults; R28 P5).
  const designNames =
    own || manifest ? [] : [spa.name, spa.short_name].map(crmName).filter((n) => n.length >= 3)
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
      !['text', 'longtext', 'tags'].includes(slot.kind) ||
      systemCopy(manifest, slot.path)
    )
      continue
    const raw = Array.isArray(slot.value) ? slot.value.join(' · ') : String(slot.value ?? '')
    if (!raw.trim()) continue
    const reason = leftoverReason(raw, designNames, city)
    if (reason) out.push({ path: slot.path, reason, text: leftoverText(raw) })
  }
  const paths = new Set(slots.map((s) => s.path))
  const englishOnlyText = (t: unknown) =>
    ctx.arabic && isObj(t) && String(t.en ?? '').trim() !== '' && !String(t.ar ?? '').trim()
  for (const [path, v] of Object.entries(set)) {
    if (!paths.has(path)) out.push({ path, reason: 'stale', text: '' })
    else if (isObj(v) && 't' in v && englishOnlyText(v.t) && !englishOnly(manifest, path))
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
    else if (englishOnlyText(e.t))
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
  /** The design has its own data — a window.CRM_DATA literal or `crm-defaults` (else no data slots: its words are page texts). */
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
  const data = crmDesignData(htmlCrmContractOf(html))
  const allSlots = htmlContentSlots(data)
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
    crmData: Boolean(data),
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

// ---------------------------------------------------------------------------------------------------------------
// R28 P5: a spa's content on a new version of its design (template rollout, owner D4)
// ---------------------------------------------------------------------------------------------------------------

export type HtmlContentCarryDrop = {
  /** A data value (`key` = its path), a page text (text id) or a picture (picture id) of the old file. */
  part: 'value' | 'text' | 'picture'
  key: string
  /**
   * `gone`: the new file has no such slot / text / picture; `kind`: the slot takes another kind of value (or the value
   * no longer fits it); `bound`: the text is filled from the CRM or the design's script there; `ambiguous`: more
   * edits than matching texts / pictures; `duplicate`: a value already sets the slot the text became; `part`: the
   * text is only part of what the new file writes there (its `data-crm-text` element has several text runs or is a
   * `data-crm-tpl` template); `tokens`: the slot's text has `{tokens}` the old text lacks (they would be lost).
   */
  reason: 'gone' | 'kind' | 'bound' | 'ambiguous' | 'duplicate' | 'part' | 'tokens'
  /** ≤ 80 chars of the old value / text / picture src. */
  text?: string
}
export type HtmlContentCarry = {
  content: HtmlDesignContent | undefined
  carried: { values: number; texts: number; pictures: number; converted: number }
  dropped: HtmlContentCarryDrop[]
}

/** A design script's `{token}` (single braces; `{{placeholders}}` are the platform's). */
const SINGLE_TOKEN = /(?<!\{)\{[A-Za-z_][A-Za-z0-9_]*\}(?!\})/g
const carryText = (s: unknown) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length > 80 ? `${t.slice(0, 79)}…` : t
}
const valueText = (v: unknown): string =>
  !isObj(v)
    ? ''
    : isObj(v.t)
      ? String(v.t.en ?? v.t.ar ?? '')
      : isObj(v.tags)
        ? (isStrings(v.tags.en) ? v.tags.en : []).join(' · ')
        : String(v.img ?? v.video ?? '')

/** A stored path on another version of the data: `[n]` → the item id now at n when that array has unique ids; null = gone. */
function remapPath(path: string, data: unknown): string | null {
  const segs = parsePath(path)
  if (!segs) return null
  let node: unknown = data
  const out: string[] = []
  for (const seg of segs) {
    if (!isObj(node) || !Object.hasOwn(node, seg.key)) return null
    let child: unknown = node[seg.key]
    let part = seg.key
    for (const sel of seg.items) {
      if (!Array.isArray(child) || isStrings(child)) return null
      const ids = itemIds(child)
      let at = ids.indexOf(sel)
      if (at < 0 && /^\d{1,4}$/.test(sel) && Number(sel) < ids.length) at = Number(sel)
      if (at < 0) return null
      part += `[${ids[at]}]`
      child = child[at]
    }
    out.push(part)
    node = child
  }
  return out.join('.')
}

/** The id family of a page text / picture id (`txt` / `attr` / `title` / `meta-description` / `img` / `bg`). */
const idPrefix = (id: string) => /^(txt|attr|img|bg)-\d+$/.exec(id)?.[1] ?? id
const idNumber = (id: string) => Number(/\d+$/.exec(id)?.[0] ?? 0)
const srcKeyOf = (id: string, src: string) => `${idPrefix(id)}\u0000${src}`

/**
 * Old entries paired with the new file's items of the same id family and `src`: by the entry's rank among the old
 * file's items of that family + src when the old file is known (`ranks`; entries it doesn't list are gone), else in
 * id order; each new item is taken once.
 */
function pairBySrc<O extends { id: string; src: string }, N extends { id: string }>(
  old: O[],
  fresh: N[],
  srcOf: (n: N) => string,
  ranks: Map<string, number> | null,
): { pairs: [O, N][]; gone: O[]; ambiguous: O[] } {
  const byKey = new Map<string, N[]>()
  for (const n of fresh) {
    const k = srcKeyOf(n.id, srcOf(n))
    const list = byKey.get(k)
    if (list) list.push(n)
    else byKey.set(k, [n])
  }
  const groups = new Map<string, O[]>()
  for (const o of old) {
    const k = srcKeyOf(o.id, o.src)
    const list = groups.get(k)
    if (list) list.push(o)
    else groups.set(k, [o])
  }
  const out = { pairs: [] as [O, N][], gone: [] as O[], ambiguous: [] as O[] }
  for (const [k, list] of groups) {
    const candidates = byKey.get(k) ?? []
    if (!candidates.length) {
      out.gone.push(...list)
      continue
    }
    if (ranks) {
      for (const o of list) {
        const r = ranks.get(`${o.id}\u0000${o.src}`)
        if (r === undefined) out.gone.push(o)
        else if (r < candidates.length) out.pairs.push([o, candidates[r]!])
        else out.ambiguous.push(o)
      }
      continue
    }
    const sorted = [...list].sort((a, b) => idNumber(a.id) - idNumber(b.id))
    sorted.forEach((o, i) => {
      if (i < candidates.length) out.pairs.push([o, candidates[i]!])
      else out.ambiguous.push(o)
    })
  }
  return out
}

/** Each listed item's rank among the items of its id family + src, in document order (key: `id \0 src`). */
function srcRanks<T extends { id: string }>(items: T[], srcOf: (x: T) => string): Map<string, number> {
  const seen = new Map<string, number>()
  const ranks = new Map<string, number>()
  for (const x of items) {
    const k = srcKeyOf(x.id, srcOf(x))
    const r = seen.get(k) ?? 0
    seen.set(k, r + 1)
    ranks.set(`${x.id}\u0000${srcOf(x)}`, r)
  }
  return ranks
}

/**
 * A spa's content on a new design file (pure): data values whose slot path still exists with the same kind (`[n]`
 * item selectors become the item's id when the new array has unique ids), page texts and pictures re-pointed at the
 * new file's texts / pictures with the same id family and `src` (several equal ones paired in id order; `oldHtml`,
 * when given, pairs them by their position in the old file instead), and page texts the new file binds to a text slot
 * (`data-crm-text`) turned into that value (the Arabic kept, a missing English filled from the design) — never a
 * fragment of that element (`pathPart`) nor a text missing the slot's `{tokens}`. Everything else is listed in
 * `dropped`. The result passes `htmlContentErrors(content, htmlContentSlots(newData))`.
 */
export function carryHtmlContent(
  oldContent: unknown,
  newData: Record<string, unknown> | null,
  newHtml: string,
  oldHtml?: string,
): HtmlContentCarry {
  const parts = htmlContentParts(oldContent)
  const slots = new Map(htmlContentSlots(newData).map((x) => [x.path, x]))
  const values: Record<string, HtmlContentValue> = {}
  const texts: Record<string, HtmlContentText> = {}
  const pictures: Record<string, HtmlContentPicture> = {}
  const carried = { values: 0, texts: 0, pictures: 0, converted: 0 }
  const dropped: HtmlContentCarryDrop[] = []
  const fits = (path: string, value: HtmlContentValue, slot: HtmlContentSlot) =>
    htmlContentErrors({ v: 1, values: [{ path, value }] }, [slot]).length === 0

  for (const [path, value] of Object.entries(parts.values)) {
    const to = newData ? remapPath(path, newData) : null
    const slot = to ? slots.get(to) : undefined
    const text = carryText(valueText(value))
    if (!to || !slot) dropped.push({ part: 'value', key: path, reason: 'gone', text })
    else if (!fits(to, value, slot)) dropped.push({ part: 'value', key: path, reason: 'kind', text })
    else {
      values[to] = value
      carried.values++
    }
  }

  const textOf = (e: HtmlContentText) => carryText(e.t.en?.trim() ? e.t.en : (e.t.ar ?? e.src))
  const t = pairBySrc(
    Object.values(parts.texts),
    listHtmlDesignTexts(newHtml),
    (x) => x.src,
    oldHtml === undefined ? null : srcRanks(listHtmlDesignTexts(oldHtml), (x) => x.src),
  )
  for (const e of t.gone) dropped.push({ part: 'text', key: e.id, reason: 'gone', text: textOf(e) })
  for (const e of t.ambiguous) dropped.push({ part: 'text', key: e.id, reason: 'ambiguous', text: textOf(e) })
  for (const [e, n] of t.pairs) {
    const drop = (reason: HtmlContentCarryDrop['reason']) =>
      dropped.push({ part: 'text', key: e.id, reason, text: textOf(e) })
    if (!n.bound) {
      const entry = { id: n.id, src: e.src, t: e.t }
      if (textErrors([entry]).length) drop('kind')
      else {
        texts[n.id] = entry
        carried.texts++
      }
      continue
    }
    const slot = n.path ? slots.get(n.path) : undefined
    if (!n.path || !slot || (slot.kind !== 'text' && slot.kind !== 'longtext')) {
      drop('bound')
      continue
    }
    if (n.pathPart) {
      drop('part')
      continue
    }
    if (values[n.path]) {
      drop('duplicate')
      continue
    }
    const ar = e.t.ar?.trim() ? e.t.ar : undefined
    const value = {
      t: { en: e.t.en?.trim() ? e.t.en : String(slot.value ?? ''), ...(ar ? { ar } : {}) },
    }
    const tokens = String(slot.value ?? '').match(SINGLE_TOKEN) ?? []
    if (tokens.some((x) => !value.t.en.includes(x) || (value.t.ar !== undefined && !value.t.ar.includes(x))))
      drop('tokens')
    else if (!fits(n.path, value, slot)) drop('kind')
    else {
      values[n.path] = value
      carried.converted++
    }
  }

  const imageSrc = (x: HtmlDesignImage) => x.src.slice(0, HTML_IMAGE_SRC_MAX)
  const p = pairBySrc(
    Object.values(parts.pictures),
    listHtmlDesignImages(newHtml),
    imageSrc,
    oldHtml === undefined ? null : srcRanks(listHtmlDesignImages(oldHtml), imageSrc),
  )
  for (const e of p.gone) dropped.push({ part: 'picture', key: e.id, reason: 'gone', text: carryText(e.src) })
  for (const e of p.ambiguous)
    dropped.push({ part: 'picture', key: e.id, reason: 'ambiguous', text: carryText(e.src) })
  for (const [e, n] of p.pairs) {
    const entry = { id: n.id, src: e.src, img: e.img }
    if (pictureErrors([entry]).length)
      dropped.push({ part: 'picture', key: e.id, reason: 'kind', text: carryText(e.src) })
    else {
      pictures[n.id] = entry
      carried.pictures++
    }
  }
  return { content: htmlContentFrom({ values, texts, pictures }), carried, dropped }
}

export type HtmlDesignOwnPins = { values: HtmlContentEntry[]; files: { path: string; dataUrl: string }[] }

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
/** Whether `tpl` with its `{city}` / `{area}` / `{spa}` filled by one of `fill`'s values each reads `old` (trimmed). */
function sameFilled(tpl: string, old: string, fill: Record<string, unknown[]>): boolean {
  const parts = tpl.trim().split(/\{(city|area|spa)\}/)
  if (parts.length === 1) return false
  let re = ''
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      re += escapeRe(parts[i]!)
      continue
    }
    const values = (fill[parts[i]!] ?? []).filter(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    )
    if (!values.length) return false
    re += `(?:${values.map(escapeRe).join('|')})`
  }
  return new RegExp(`^${re}$`).test(old.trim())
}

/** The old data's value for a new slot path: items by the same id when the old array has it, else the same position. */
function atSamePosition(oldData: unknown, newData: unknown, path: string): unknown {
  const segs = parsePath(path)
  if (!segs) return undefined
  let o: unknown = oldData
  let n: unknown = newData
  for (const seg of segs) {
    if (!isObj(n) || !isObj(o) || !Object.hasOwn(o, seg.key)) return undefined
    n = n[seg.key]
    o = o[seg.key]
    for (const sel of seg.items) {
      if (!Array.isArray(n) || !Array.isArray(o)) return undefined
      const at = itemIds(n).indexOf(sel)
      if (at < 0) return undefined
      const same = itemIds(o).indexOf(sel)
      n = n[at]
      o = o[same >= 0 ? same : at]
    }
  }
  return o
}

/**
 * A spa's own v1 look on a neutral v2 design (R28 P5 rollout): only when `oldData` was made for the spa
 * (`isOwnDesign`) and `newData` is contract v2. Every v2 slot whose v1 value (same item id, else the same position)
 * differs becomes a content value — texts / focus / colours `{t: {en}}`, tags, switches, https / `/files` pictures
 * `{img}`; an embedded `data:image/*` picture goes to `files` (the caller stores it and writes `{img: '/files/{id}'}`).
 * `spa.short_name` only when the old one names the spa. Never operational, reserved, `ui.*` or `contract` paths, nor
 * a path `keep` (the carried content) already sets, nor a text equal to the v2 default once its `{city}` / `{area}` /
 * `{spa}` are filled with the old design's own values (the v2 default, with its reviewed Arabic, says the same).
 */
export function htmlDesignOwnPins(
  oldData: Record<string, unknown> | null,
  newData: Record<string, unknown> | null,
  tenantName: string,
  keep?: unknown,
): HtmlDesignOwnPins {
  const out: HtmlDesignOwnPins = { values: [], files: [] }
  if (!oldData || !newData || crmContractVersion(newData) !== 2 || !isOwnDesign(oldData, tenantName))
    return out
  const kept = new Set(Object.keys(htmlContentMap(keep)))
  const oldSpa = isObj(oldData.spa) ? oldData.spa : {}
  const oldLoc = isObj(oldData.location) ? oldData.location : {}
  const fill: Record<string, unknown[]> = {
    city: [oldLoc.city],
    area: [oldSpa.area_label],
    spa: [oldSpa.short_name, oldSpa.name, tenantName],
  }
  for (const slot of htmlContentSlots(newData)) {
    const root = slot.path.split(/[.[]/)[0]
    if (kept.has(slot.path) || root === 'ui' || root === 'contract') continue
    const old = atSamePosition(oldData, newData, slot.path)
    if (old === undefined || JSON.stringify(old) === JSON.stringify(slot.value)) continue
    if (typeof old === 'string' && typeof slot.value === 'string' && sameFilled(slot.value, old, fill))
      continue
    if (slot.path === 'spa.short_name' && !isOwnDesign({ spa: { short_name: old } }, tenantName)) continue
    let value: HtmlContentValue | null = null
    if (slot.kind === 'image' || slot.kind === 'video') {
      if (typeof old !== 'string') continue
      if (slot.kind === 'image' && /^data:image\/[a-z0-9.+-]+[;,]/i.test(old)) {
        out.files.push({ path: slot.path, dataUrl: old })
        continue
      }
      if (contentUrlOk(old)) value = slot.kind === 'image' ? { img: old } : { video: old }
    } else if (slot.kind === 'tags') value = isStrings(old) ? { tags: { en: old } } : null
    else if (slot.kind === 'bool') value = typeof old === 'boolean' ? { on: old } : null
    else value = typeof old === 'string' ? { t: { en: old } } : null
    if (value && htmlContentErrors({ v: 1, values: [{ path: slot.path, value }] }, [slot]).length === 0)
      out.values.push({ path: slot.path, value })
  }
  return out
}

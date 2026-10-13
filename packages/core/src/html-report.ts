// R28 P5: how dynamic an uploaded HTML design is (docs/design/html-crm-contract.md §9) — CRM contract none / v1 / v2,
// what a spa can edit (data slots, page texts, pictures) and authoring warnings. Shown before and after an upload
// and on the Studio Pages card; it never blocks anything.
import { type HtmlContentKind, htmlContentSlots } from './html-content'
import { CRM_DEFAULTS_MAX, type CrmLocale, crmDesignData, htmlCrmContractOf, systemCopy } from './html-crm'
import {
  attributesOf,
  htmlDesignEmbedHosts,
  htmlDesignEmbedWarning,
  listHtmlDesignImages,
  listHtmlDesignTexts,
} from './html-design'

export type HtmlDesignWarningCode =
  | 'not-json'
  | 'locale-in-data'
  | 'no-ids'
  | 'staff-no-photo-guard'
  | 'named-spa'
  | 'contact-in-defaults'
  | 'fixed-title'
  | 'no-arabic-font'
  | 'bound-no-slot'
  | 'ui-kind'
  | 'no-ui'
  | 'defaults-too-large'
  | 'embeds'
export type HtmlDesignWarning = { code: HtmlDesignWarningCode; message: string; path?: string }
export type HtmlDesignReport = {
  contract: 'none' | 'v1' | 'v2'
  mode: 'literal' | 'endpoint' | null
  /** The v2 manifest's; else ['en']. */
  locales: CrmLocale[]
  slots: { total: number; ui: number; byKind: Partial<Record<HtmlContentKind, number>> }
  /** `bound`: texts a v2 binding names a slot for (`data-crm-text` / `data-crm-attr`). */
  texts: { total: number; editable: number; crm: number; script: number; bound: number }
  pictures: number
  /** ≤ 20, in the order of the codes above. */
  warnings: HtmlDesignWarning[]
}

const MAX_WARNINGS = 20
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const clip = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
const ITEM_ID = /^[A-Za-z0-9_-]{1,64}$/
/** An array's items all carry a distinct safe id (else edits are kept by position). */
const hasIds = (list: unknown[]) => {
  const ids = list.map((x) => (isObj(x) && typeof x.id === 'string' && ITEM_ID.test(x.id) ? x.id : ''))
  return ids.every(Boolean) && new Set(ids).size === ids.length
}
/** A 9+ digit phone number (spaces, dots, dashes and brackets between digits) or an email address. */
const PHONE_RUN = /\+?\(?\d[\d\s().-]{7,}\d/g
const EMAIL = /(?<![\w.+-])[\w.+-]{1,64}@[\w-]{1,63}\.[\w.]{2,63}/g
function contactIn(s: string): string[] {
  const out: string[] = []
  for (const m of s.matchAll(PHONE_RUN)) if (m[0].replace(/\D/g, '').length >= 9) out.push(m[0].trim())
  for (const m of s.matchAll(EMAIL)) out.push(m[0])
  return out
}
const ARABIC_FACE = /@font-face\s*\{[^}]*unicode-range\s*:[^;}]*U\+0?6[0-9a-f]{2}/i
const ARABIC_GOOGLE = /fonts\.googleapis\.com\/css2?\?[^"'\s>]*family=[^"'\s>&]*Arabic/i
const DEFAULTS_SCRIPT = /<script\b[^>]*\bid\s*=\s*["']?crm-defaults\b[^>]*>([\s\S]*?)<\/script/i
const STAFF_LIST = /\bdata-crm-list\s*=\s*(["']?)staff\1(?=[\s>/])/i

/** The first element of the `data-crm-list="staff"` template has a `data-if` naming `photo` (null = no staff list). */
function staffPhotoGuard(html: string): boolean | null {
  const list = STAFF_LIST.exec(html)
  if (!list) return null
  const tpl = /<template\b[^>]*>/i.exec(html.slice(list.index, list.index + 20000))
  if (!tpl) return null
  const from = list.index + tpl.index + tpl[0].length
  const first = /<([a-z][^\t\n\f\r />]*)/i.exec(html.slice(from, from + 20000))
  if (!first) return false
  const at = from + first.index + first[0].length
  const attr = attributesOf(html, at).find((a) => a.name === 'data-if')
  return Boolean(attr && attr.start >= 0 && /\bphoto\b/.test(html.slice(attr.start, attr.end)))
}

/** The report of one design (pure; never throws — unreadable input reads as contract 'none'). */
export function htmlDesignReport(html: string): HtmlDesignReport {
  try {
    return report(typeof html === 'string' ? html : '')
  } catch {
    return {
      contract: 'none',
      mode: null,
      locales: ['en'],
      slots: { total: 0, ui: 0, byKind: {} },
      texts: { total: 0, editable: 0, crm: 0, script: 0, bound: 0 },
      pictures: 0,
      warnings: [],
    }
  }
}

function report(html: string): HtmlDesignReport {
  const found = htmlCrmContractOf(html)
  const v2 = found?.version === 2
  const manifest = found?.manifest ?? null
  const data = crmDesignData(found)
  const slots = htmlContentSlots(data)
  const byKind: Partial<Record<HtmlContentKind, number>> = {}
  for (const s of slots) byKind[s.kind] = (byKind[s.kind] ?? 0) + 1
  const texts = listHtmlDesignTexts(html)
  const warnings: HtmlDesignWarning[] = []
  const warn = (code: HtmlDesignWarningCode, message: string, path?: string) => {
    if (warnings.length < MAX_WARNINGS) warnings.push({ code, message, ...(path ? { path } : {}) })
  }
  const slotPaths = new Set(slots.map((s) => s.path))

  if (!found?.literal && /window\.CRM_DATA\s*=\s*\{/.test(html))
    warn('not-json', 'window.CRM_DATA is not a plain JSON literal, so the design keeps its own data.')
  if (data && Object.hasOwn(data, 'locale'))
    warn('locale-in-data', 'locale is set by the platform; remove it from CRM_DATA.', 'locale')
  if (data) {
    // Arrays of objects a spa edits (they hold slots) whose items have no unique ids.
    let visited = 0
    const walk = (v: unknown, path: string, depth: number) => {
      if (++visited > 5000 || depth > 8) return
      if (Array.isArray(v)) {
        const objects = v.some(isObj)
        const ids = hasIds(v)
        if (objects && !ids && [...slotPaths].some((p) => p.startsWith(`${path}[`)))
          warn('no-ids', `${path} has no item ids: edits are kept by position.`, path)
        v.forEach((x, i) => {
          if (isObj(x)) walk(x, `${path}[${ids ? (x.id as string) : i}]`, depth + 1)
        })
      } else if (isObj(v))
        for (const [k, x] of Object.entries(v))
          if (typeof x === 'object' && x !== null) walk(x, path ? `${path}.${k}` : k, depth + 1)
    }
    walk(data, '', 0)
  }
  if (found && staffPhotoGuard(html) === false)
    warn(
      'staff-no-photo-guard',
      'Team cards have no data-if="photo": a therapist without a photo shows an empty frame.',
    )
  const spa = isObj(data?.spa) ? data.spa : {}
  const names = [spa.name, spa.short_name]
    .filter((n): n is string => typeof n === 'string' && n.trim() !== '')
    .filter((n) => !(v2 && n.trim() === 'Your Spa'))
  if (names.length)
    warn(
      'named-spa',
      `The design's defaults name a spa ("${clip(names[0]!)}"): other spas see them only where noted.`,
      'spa.name',
    )
  if (data) {
    const hits: string[] = []
    for (const s of slots) {
      if (systemCopy(manifest, s.path) || !['text', 'longtext', 'tags'].includes(s.kind)) continue
      const raw = Array.isArray(s.value) ? s.value.join(' · ') : String(s.value ?? '')
      hits.push(...contactIn(raw))
    }
    if (v2) {
      const contact = isObj(data.contact) ? data.contact : {}
      const location = isObj(data.location) ? data.location : {}
      if (typeof contact.whatsapp_number === 'string' && contact.whatsapp_number.trim())
        hits.push('contact.whatsapp_number')
      if (Array.isArray(contact.phones) && contact.phones.length) hits.push('contact.phones')
      if (Object.values(location).some((x) => typeof x === 'string' && x.trim())) hits.push('location')
      if (Array.isArray(data.hours) && data.hours.length) hits.push('hours')
    }
    const list = [...new Set(hits)]
    if (list.length)
      warn(
        'contact-in-defaults',
        `The design's defaults carry contact details (${list
          .slice(0, 3)
          .map((x) => clip(x, 40))
          .join(', ')}${list.length > 3 ? ` and ${list.length - 3} more` : ''}).`,
      )
  }
  const title = texts.find((x) => x.id === 'title')
  const scriptTitle = /\bdocument\.title\s*=(?!=)/.test(html)
  if ((title && !title.text.includes('{{spa_name}}')) || scriptTitle)
    warn(
      'fixed-title',
      `The page title is fixed text ("${clip(title?.text || 'document.title')}"); use {{spa_name}}.`,
      'title',
    )
  if (v2 && manifest?.locales.includes('ar') && !ARABIC_FACE.test(html) && !ARABIC_GOOGLE.test(html))
    warn('no-arabic-font', "Arabic texts fall back to the visitor's system font.")
  if (v2) {
    const seen = new Set<string>()
    for (const x of texts) {
      if (!x.path || slotPaths.has(x.path) || seen.has(x.path)) continue
      seen.add(x.path)
      const attr = x.kind === 'attr' ? 'data-crm-attr' : 'data-crm-text'
      warn('bound-no-slot', `${attr} "${clip(x.path)}" names no text in CRM_DATA.`, x.path)
    }
    for (const s of slots)
      if (s.path.startsWith('ui.') && !['text', 'longtext', 'tags'].includes(s.kind))
        warn('ui-kind', `${s.path} reads as a ${s.kind} (key name); rename it.`, s.path)
    if (!isObj(data?.ui)) warn('no-ui', 'Contract v2 without ui{}: script texts stay fixed.')
  }
  if (!found?.literal) {
    const body = DEFAULTS_SCRIPT.exec(html)?.[1]
    if (body !== undefined && body.trim().length > CRM_DEFAULTS_MAX)
      warn('defaults-too-large', 'crm-defaults is over 512 KB and is ignored.')
  }
  const embeds = htmlDesignEmbedWarning(htmlDesignEmbedHosts(html))
  if (embeds) warn('embeds', embeds)

  return {
    contract: !found ? 'none' : v2 ? 'v2' : 'v1',
    mode: found?.mode ?? null,
    locales: manifest ? [...manifest.locales] : ['en'],
    slots: { total: slots.length, ui: slots.filter((s) => s.path.startsWith('ui.')).length, byKind },
    texts: {
      total: texts.length,
      editable: texts.filter((x) => !x.bound).length,
      crm: texts.filter((x) => x.boundBy === 'crm').length,
      script: texts.filter((x) => x.boundBy === 'script').length,
      bound: texts.filter((x) => x.path).length,
    },
    pictures: listHtmlDesignImages(html).length,
    warnings,
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/**
 * One line for upload messages and cards, e.g. "CRM contract v2 · 214 editable values (152 interface texts) · 9 of
 * 61 page texts editable · 1 warning" / "Not connected to the CRM · 40 page texts editable".
 */
export function htmlDesignReportLine(r: HtmlDesignReport): string {
  const parts =
    r.contract === 'none'
      ? ['Not connected to the CRM', `${plural(r.texts.editable, 'page text')} editable`]
      : [
          `CRM contract ${r.contract}`,
          `${plural(r.slots.total, 'editable value')}${r.slots.ui ? ` (${plural(r.slots.ui, 'interface text')})` : ''}`,
          `${r.texts.editable} of ${plural(r.texts.total, 'page text')} editable`,
        ]
  if (r.warnings.length) parts.push(plural(r.warnings.length, 'warning'))
  return parts.join(' · ')
}

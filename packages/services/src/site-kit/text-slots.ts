import {
  htmlContentFrom,
  htmlContentParts,
  htmlContentSlots,
  htmlCrmContractOf,
  listHtmlDesignTexts,
} from '@spa/core'
import type { PropSpec, SiteEditSchema } from './edit-ops'
import { isNode, type PuckNode, walkNodes } from './tree'

/**
 * R23 "Write texts": the bilingual text props of a page the AI may rewrite, and writing its drafts back. Only
 * existing `bi` leaves change (structure, images, links and styles stay byte-identical). Pure and client-safe.
 */
export type TextSlot = {
  /** `{blockId}/{prop}` with `.{index}.{field}` into lists and objects, e.g. `hero-1/buttons.0.label`. */
  key: string
  /** Block id (`root` = the page's own props). */
  block: string
  /** Block type (`root` for the page). */
  type: string
  /** Prop path inside the block, e.g. `title`, `items.2.a`. */
  prop: string
  multiline: boolean
  en: string
  ar: string
  /** Page texts of an HTML design (R28 P4): the design text's guard (`listHtmlDesignTexts` src). */
  src?: string
}
export type TextDraft = { key: string; en: string; ar: string }

const MAX_LINE = 200
const MAX_MULTILINE = 1500
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isAlt = (prop: string) => prop === 'alt' || prop.endsWith('Alt')
const HTML_DESIGN = 'HtmlDesign'
const MAX_KEY = 200

/** HTML-design pages (R17 uploads) are shown exactly as built: never rewritten (R28 P4: only their website content). */
const isHtmlPage = (data: unknown) => {
  const d = data as { root?: { props?: Record<string, unknown> }; content?: unknown } | null
  return d?.root?.props?.htmlDesign === true || htmlDesignNode(data) !== null
}
const htmlDesignNode = (data: unknown): PuckNode | null => {
  const content = (data as { content?: unknown } | null)?.content
  return (Array.isArray(content) && content.find((n) => isNode(n) && n.type === HTML_DESIGN)) || null
}

/**
 * Every non-empty bilingual text of a page (root props + every block, slots included), in reading order. An
 * HTML-design page has none unless `html` (its design) is given: then its website content texts (`htmlTextSlots`,
 * `first` keys ahead).
 */
export function textSlots(
  data: unknown,
  schema: SiteEditSchema,
  opts: { maxPerPage?: number; html?: string; first?: ReadonlySet<string> } = {},
): TextSlot[] {
  const max = opts.maxPerPage ?? 120
  const out: TextSlot[] = []
  if (isHtmlPage(data))
    return opts.html === undefined
      ? out
      : htmlTextSlots(data, opts.html, { maxPerPage: opts.maxPerPage, first: opts.first })
  const visit = (block: string, type: string, specs: Record<string, PropSpec>, props: unknown, at = '') => {
    if (!isObj(props)) return
    for (const [name, spec] of Object.entries(specs)) {
      const prop = at ? `${at}.${name}` : name
      const v = props[name]
      if (spec.kind === 'bi') {
        if (isAlt(name) || !isObj(v) || typeof v.en !== 'string' || !v.en.trim()) continue
        if (out.length >= max) return
        out.push({
          key: `${block}/${prop}`,
          block,
          type,
          prop,
          multiline: spec.multiline === true,
          en: v.en,
          ar: typeof v.ar === 'string' ? v.ar : '',
        })
      } else if (spec.kind === 'object') visit(block, type, spec.fields, v, prop)
      else if (spec.kind === 'array' && Array.isArray(v))
        v.forEach((item, i) => {
          visit(block, type, spec.item, item, `${prop}.${i}`)
        })
    }
  }
  visit('root', 'root', schema.root, (data as { root?: { props?: unknown } } | null)?.root?.props)
  walkNodes(data, (n) => {
    const spec = schema.blocks[n.type]
    if (spec && typeof n.props.id === 'string' && n.props.id) visit(n.props.id, n.type, spec.props, n.props)
  })
  return out
}

/**
 * R28 P4: the texts of an HTML-design page (`html` = its design) as slots, with the spa's values over the design's:
 * the design data's text / longtext values (`{block}/content:{path}`; hidden or empty ones left out) and its page
 * texts the CRM doesn't fill (`{block}/text:{id}`, with the design text's src guard). Pictures and tags never.
 * `first` (Write texts' leftovers) go ahead of the rest before the cap, so late ones (a footer) still make it.
 */
export function htmlTextSlots(
  data: unknown,
  html: string,
  opts: { maxPerPage?: number; first?: ReadonlySet<string> } = {},
): TextSlot[] {
  const max = opts.maxPerPage ?? 400
  const node = htmlDesignNode(data)
  const block = typeof node?.props.id === 'string' ? node.props.id : ''
  const out: TextSlot[] = []
  if (!node || !block) return out
  const parts = htmlContentParts(node.props.content)
  const push = (slot: TextSlot) => {
    if (slot.key.length <= MAX_KEY && slot.en.trim()) out.push(slot)
  }
  for (const s of htmlContentSlots(htmlCrmContractOf(html)?.literal?.data)) {
    const v = parts.values[s.path]
    if ((s.kind !== 'text' && s.kind !== 'longtext') || (v && 'hide' in v)) continue
    const t = v && 't' in v ? v.t : undefined
    push({
      key: `${block}/content:${s.path}`,
      block,
      type: HTML_DESIGN,
      prop: `content:${s.path}`,
      multiline: s.kind === 'longtext',
      en: t?.en ?? String(s.value ?? ''),
      ar: t?.ar ?? '',
    })
  }
  for (const x of listHtmlDesignTexts(html)) {
    if (x.bound) continue
    const t = parts.texts[x.id]?.src === x.src ? parts.texts[x.id]?.t : undefined
    push({
      key: `${block}/text:${x.id}`,
      block,
      type: HTML_DESIGN,
      prop: `text:${x.id}`,
      multiline: x.kind === 'meta' || x.text.length > 160,
      en: t?.en ?? x.text,
      ar: t?.ar ?? '',
      src: x.src,
    })
  }
  const first = opts.first
  const ordered = first?.size
    ? [...out.filter((s) => first.has(s.key)), ...out.filter((s) => !first.has(s.key))]
    : out
  return ordered.slice(0, max)
}

/**
 * Drops `<…>` tags and every stray `<` / `>` in one linear pass, so nothing tag-like survives (an unclosed `<` loses
 * only itself). No regex: a tag-stripping pattern can be fooled by nesting (`<scr<script>ipt>`).
 */
function stripTags(s: string) {
  let out = ''
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === '<') {
      let j = i + 1
      while (j < s.length && s[j] !== '<' && s[j] !== '>') j++
      i = s[j] === '>' ? j + 1 : i + 1
    } else {
      if (c !== '>') out += c
      i++
    }
  }
  return out
}

/** Plain text for a slot: no tags, angle brackets or control characters, single spaces (paragraph breaks kept when multiline). */
export function plainText(s: string, multiline: boolean) {
  let t = stripTags(s)
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control characters is the point
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
  t = multiline
    ? t
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
    : t.replace(/\s+/g, ' ')
  // Cut by code points: a split surrogate pair is invalid JSON text for Postgres jsonb.
  return Array.from(t.trim())
    .slice(0, multiline ? MAX_MULTILINE : MAX_LINE)
    .join('')
    .trim()
}

/** The bilingual leaf a slot points at in `data`, found by block id (moves since the read don't matter). */
function leafOf(data: { root?: { props?: Record<string, unknown> } }, slot: TextSlot) {
  let cur: unknown
  if (slot.block === 'root') cur = data.root?.props
  else
    walkNodes(data, (n: PuckNode) => {
      if (cur === undefined && n.props.id === slot.block && n.type === slot.type) cur = n.props
    })
  for (const part of slot.prop.split('.')) {
    if (Array.isArray(cur)) cur = cur[Number(part)]
    else if (isObj(cur)) cur = cur[part]
    else return null
  }
  return isObj(cur) && typeof cur.en === 'string' ? cur : null
}

/**
 * Writes AI drafts into a copy of `data`: only for slots the model was given (unknown keys are ignored) and only
 * where the English text is still what the model saw (an edit made meanwhile wins). Empty drafts are skipped.
 * HTML-design slots need `html` (the page's design, else skipped): written into the block's website content where
 * the slot and the design text are unchanged (pictures and the other parts kept).
 */
export function fillTextSlots<T>(
  data: T,
  slots: TextSlot[],
  drafts: TextDraft[],
  opts: { html?: string } = {},
) {
  const copy = structuredClone(data) as T & { root?: { props?: Record<string, unknown> } }
  const byKey = new Map(slots.map((s) => [s.key, s]))
  const node = opts.html === undefined ? null : htmlDesignNode(copy)
  const fresh = node
    ? new Map(
        htmlTextSlots(copy, opts.html ?? '', { maxPerPage: Number.POSITIVE_INFINITY }).map((s) => [s.key, s]),
      )
    : null
  const parts = node ? htmlContentParts(node.props.content) : null
  const done = new Set<string>()
  let filled = 0
  let skipped = 0
  let content = false
  for (const d of drafts) {
    const slot = byKey.get(d.key)
    if (!slot || done.has(d.key)) continue
    done.add(d.key)
    const en = plainText(String(d.en ?? ''), slot.multiline)
    const ar = plainText(String(d.ar ?? ''), slot.multiline)
    if (slot.type === HTML_DESIGN) {
      const now = fresh?.get(slot.key)
      if (!en || !ar || !now || !parts || now.en !== slot.en || now.src !== slot.src) {
        skipped++
        continue
      }
      if (slot.prop.startsWith('text:')) {
        const id = slot.prop.slice(5)
        parts.texts[id] = { id, src: now.src ?? '', t: { en, ar } }
      } else parts.values[slot.prop.slice(8)] = { t: { en, ar } }
      content = true
      filled++
      continue
    }
    const leaf = leafOf(copy, slot)
    if (!en || !ar || !leaf || leaf.en !== slot.en) {
      skipped++
      continue
    }
    leaf.en = en
    leaf.ar = ar
    filled++
  }
  if (node && parts && content) node.props.content = htmlContentFrom(parts)
  return { data: copy as T, filled, skipped }
}

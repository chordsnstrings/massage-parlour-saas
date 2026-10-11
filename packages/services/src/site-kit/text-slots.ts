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
}
export type TextDraft = { key: string; en: string; ar: string }

const MAX_LINE = 200
const MAX_MULTILINE = 1500
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isAlt = (prop: string) => prop === 'alt' || prop.endsWith('Alt')

/** HTML-design pages (R17 uploads) are shown exactly as built: never rewritten. */
const isHtmlPage = (data: unknown) => {
  const d = data as { root?: { props?: Record<string, unknown> }; content?: unknown } | null
  return (
    d?.root?.props?.htmlDesign === true ||
    (Array.isArray(d?.content) && d.content.some((n) => isNode(n) && n.type === 'HtmlDesign'))
  )
}

/** Every non-empty bilingual text of a page (root props + every block, slots included), in reading order. */
export function textSlots(data: unknown, schema: SiteEditSchema, opts: { maxPerPage?: number } = {}) {
  const max = opts.maxPerPage ?? 120
  const out: TextSlot[] = []
  if (isHtmlPage(data)) return out
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
 * Plain text for a slot: no tags, angle brackets or control characters, single spaces (paragraph breaks kept when
 * multiline). Tags go first (linear: `[^<>]`), then any `<` / `>` left over, so nothing tag-like survives.
 */
export function plainText(s: string, multiline: boolean) {
  let t = s
    .replace(/<[^<>]*>/g, '')
    .replace(/[<>]/g, '')
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
 */
export function fillTextSlots<T>(data: T, slots: TextSlot[], drafts: TextDraft[]) {
  const copy = structuredClone(data) as T & { root?: { props?: Record<string, unknown> } }
  const byKey = new Map(slots.map((s) => [s.key, s]))
  const done = new Set<string>()
  let filled = 0
  let skipped = 0
  for (const d of drafts) {
    const slot = byKey.get(d.key)
    if (!slot || done.has(d.key)) continue
    done.add(d.key)
    const en = plainText(String(d.en ?? ''), slot.multiline)
    const ar = plainText(String(d.ar ?? ''), slot.multiline)
    const leaf = leafOf(copy, slot)
    if (!en || !ar || !leaf || leaf.en !== slot.en) {
      skipped++
      continue
    }
    leaf.en = en
    leaf.ar = ar
    filled++
  }
  return { data: copy as T, filled, skipped }
}

/**
 * Content vs design (PLAN §11.1): block props listed here are content (text, images, links, list items) and
 * editable with `site.content`; every other prop, plus the block tree itself, is layout/design (`site.design`).
 */
export const CONTENT_KEYS = new Set([
  'title',
  'description',
  'eyebrow',
  'text',
  'subtitle',
  'intro',
  'label',
  'message',
  'buttonLabel',
  'tagline',
  'caption',
  'alt',
  'imageAlt',
  'src',
  'image',
  'bgImage',
  'images',
  'items',
  'buttons',
  // F15: video link/upload + poster, enquiry thank-you text.
  'url',
  'poster',
  'success',
])

type Node = { type?: unknown; props?: Record<string, unknown> }
const isComponent = (v: unknown): v is Node =>
  typeof v === 'object' && v !== null && 'type' in v && 'props' in v && typeof (v as Node).props === 'object'
const isSlot = (v: unknown): v is Node[] => Array.isArray(v) && v.length > 0 && v.every(isComponent)

function shape(props: Record<string, unknown> | undefined): unknown {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    if (CONTENT_KEYS.has(key)) continue
    out[key] = isSlot(value) ? value.map(node) : value
  }
  return out
}
const node = (n: Node) => ({ type: n.type, props: shape(n.props) })

/** Everything about a page except its content. Equal signatures ⇒ only content changed. */
export function designSignature(data: unknown): string {
  const d = (data ?? {}) as { root?: { props?: Record<string, unknown> }; content?: unknown }
  const content = Array.isArray(d.content) ? d.content.filter(isComponent).map(node) : []
  return JSON.stringify({ root: shape(d.root?.props), content })
}

/** Cheap structural check before storing editor JSON. */
export function isPageData(value: unknown): value is { root: object; content: unknown[] } {
  if (typeof value !== 'object' || value === null) return false
  const v = value as { root?: unknown; content?: unknown }
  return typeof v.root === 'object' && v.root !== null && Array.isArray(v.content)
}

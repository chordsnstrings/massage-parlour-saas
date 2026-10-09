import { imageSrc, isImageValue, normalizeImage, toImageProp, withImageSrc } from './image'
import { isNode, isNodeArray, type PuckNode } from './tree'

/**
 * AI site editing (R16): typed operations on Puck page data, validated against the real block schema
 * (built from the Puck config by the web app) before anything is applied. Pure and client-safe.
 */
export type PropSpec =
  | { kind: 'bi'; multiline?: boolean }
  | { kind: 'text' }
  | { kind: 'image' }
  | { kind: 'color' }
  | { kind: 'number'; min?: number; max?: number }
  | { kind: 'enum'; options: (string | number | boolean)[] }
  | { kind: 'responsive'; options: string[] }
  | { kind: 'slot'; allow?: string[]; disallow?: string[] }
  | { kind: 'array'; item: Record<string, PropSpec>; max?: number }
  | { kind: 'object'; fields: Record<string, PropSpec> }

export type EditBlockSpec = {
  label?: string
  category?: string
  props: Record<string, PropSpec>
  defaults?: Record<string, unknown>
}
export type EditPreset = { key: string; name: string; category: string; description: string; node: PuckNode }
export type SiteEditSchema = {
  blocks: Record<string, EditBlockSpec>
  /** Page-level (root) props such as the SEO title/description. */
  root: Record<string, PropSpec>
  theme: Record<string, PropSpec>
  presets: EditPreset[]
}

/** Where a block goes: after/before a block id, at the end of a block's slot, or (none) at the end of the page. */
export type EditPlace = { after?: string; before?: string; into?: { id: string; slot: string } }
export type SiteEditOp =
  | ({ op: 'add'; type: string; props?: Record<string, unknown> } & EditPlace)
  | ({ op: 'preset'; key: string } & EditPlace)
  | ({ op: 'move'; id: string } & EditPlace)
  | { op: 'remove'; id: string }
  /** `id: 'root'` edits the page's own props (SEO title/description). */
  | { op: 'update'; id: string; props: Record<string, unknown> }
  | { op: 'theme'; tokens: Record<string, unknown> }

export type EditPageData = { root: { props?: Record<string, unknown> }; content: PuckNode[] }
export type ApplyResult =
  | {
      ok: true
      data: EditPageData
      /** Merged theme tokens, or null when no theme op ran. */
      theme: Record<string, unknown> | null
      summary: string[]
    }
  | { ok: false; errors: string[] }

export const MAX_EDIT_OPS = 40
const MAX_TEXT = 5000
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i
const SAFE_URL = /^(?:https:\/\/[^\s"'<>()]+|\/[^\s"'<>()]*)?$/

class OpError extends Error {}
const fail = (msg: string): never => {
  throw new OpError(msg)
}
const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const DEVICES = new Set(['base', 'md', 'lg'])

type Ctx = { schema: SiteEditSchema; newId: (type: string) => string }

function str(v: unknown, at: string, max = MAX_TEXT) {
  if (typeof v !== 'string') fail(`${at}: expected text`)
  if ((v as string).length > max) fail(`${at}: text is too long`)
  return v as string
}

/** Validates one value; `prev` is the stored value (partial bilingual/responsive/object values merge into it). */
function value(spec: PropSpec, v: unknown, at: string, ctx: Ctx, prev?: unknown): unknown {
  switch (spec.kind) {
    case 'bi': {
      const next = typeof v === 'string' ? { en: v } : v
      if (!isObj(next)) return fail(`${at}: expected {en, ar}`)
      for (const k of Object.keys(next)) if (k !== 'en' && k !== 'ar') fail(`${at}: unknown language "${k}"`)
      const merged: Record<string, string> = isObj(prev) ? { ...(prev as Record<string, string>) } : {}
      for (const k of ['en', 'ar'] as const) if (next[k] !== undefined) merged[k] = str(next[k], `${at}.${k}`)
      if (typeof merged.en !== 'string') fail(`${at}: English text is required`)
      return merged
    }
    case 'text':
      return str(v, at, 2000)
    case 'image': {
      // A URL, or { src?, frame } — src omitted keeps the current image and only reframes it.
      if (typeof v !== 'string' && !isObj(v)) fail(`${at}: expected an image URL or {src, frame}`)
      const o = isObj(v) ? v : { src: v }
      for (const k of Object.keys(o))
        if (k !== 'src' && k !== 'frame') fail(`${at}: unknown image key "${k}"`)
      const s = str(o.src === undefined ? imageSrc(prev) : o.src, `${at}.src`, 2000)
      if (!SAFE_URL.test(s)) fail(`${at}: images must be https:// or site-relative URLs`)
      if (!isObj(v)) return withImageSrc(prev, s)
      if (o.frame !== undefined && !isObj(o.frame)) fail(`${at}.frame: expected {base, md?, lg?}`)
      const frame = { ...(isImageValue(prev) ? prev.frame : {}), ...(o.frame as object) } as Record<
        string,
        unknown
      >
      for (const k of Object.keys(frame)) if (!DEVICES.has(k)) fail(`${at}.frame: unknown device "${k}"`)
      const { frames } = normalizeImage({ src: s, frame })
      return toImageProp(s, frames)
    }
    case 'color': {
      const s = str(v, at, 9)
      if (!HEX.test(s)) fail(`${at}: expected a #hex colour`)
      return s.toLowerCase()
    }
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return fail(`${at}: expected a number`)
      if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max))
        fail(`${at}: out of range`)
      return v
    }
    case 'enum':
      if (!spec.options.includes(v as string)) fail(`${at}: must be one of ${spec.options.join(', ')}`)
      return v
    case 'responsive': {
      const next = typeof v === 'string' ? { base: v } : v
      if (!isObj(next)) return fail(`${at}: expected {base, md, lg}`)
      const merged: Record<string, unknown> = isObj(prev) ? { ...prev } : {}
      for (const [k, d] of Object.entries(next)) {
        if (k !== 'base' && k !== 'md' && k !== 'lg') fail(`${at}: unknown device "${k}"`)
        if (d === null) {
          if (k === 'base') fail(`${at}: base is required`)
          delete merged[k]
          continue
        }
        if (!spec.options.includes(d as string)) fail(`${at}.${k}: must be one of ${spec.options.join(', ')}`)
        merged[k] = d
      }
      if (merged.base === undefined) fail(`${at}: base (mobile) value is required`)
      return merged
    }
    case 'slot': {
      if (!Array.isArray(v)) return fail(`${at}: expected a list of blocks`)
      return v.map((child, i) => {
        if (!isObj(child) || typeof child.type !== 'string') fail(`${at}[${i}]: expected a block`)
        const c = child as { type: string; props?: unknown }
        allowed(spec, c.type, at)
        return block(c.type, c.props, `${at}[${i}]`, ctx)
      })
    }
    case 'array': {
      if (!Array.isArray(v)) return fail(`${at}: expected a list`)
      if (spec.max !== undefined && v.length > spec.max) fail(`${at}: at most ${spec.max} items`)
      return v.map((item, i) => fields(spec.item, item, `${at}[${i}]`, ctx, undefined))
    }
    case 'object':
      return fields(spec.fields, v, at, ctx, prev)
  }
}

function fields(
  specs: Record<string, PropSpec>,
  v: unknown,
  at: string,
  ctx: Ctx,
  prev: unknown,
): Record<string, unknown> {
  if (!isObj(v)) return fail(`${at}: expected an object`)
  const out: Record<string, unknown> = isObj(prev) ? { ...prev } : {}
  for (const [k, x] of Object.entries(v)) {
    const spec = specs[k]
    if (!spec) fail(`${at}: unknown field "${k}"`)
    out[k] = value(spec!, x, `${at}.${k}`, ctx, out[k])
  }
  return out
}

function allowed(spec: { allow?: string[]; disallow?: string[] } | undefined, type: string, at: string) {
  if (spec?.allow && !spec.allow.includes(type)) fail(`${at}: ${type} can't go here`)
  if (spec?.disallow?.includes(type)) fail(`${at}: ${type} can't go here`)
}

/** A new block: known type, known props merged over the block's defaults, fresh ids (children too). */
function block(type: string, props: unknown, at: string, ctx: Ctx): PuckNode {
  const spec = ctx.schema.blocks[type]
  if (!spec) return fail(`${at}: unknown block "${type}"`)
  if (props !== undefined && !isObj(props)) fail(`${at}: props must be an object`)
  const out: Record<string, unknown> = structuredClone(spec.defaults ?? {})
  for (const [k, x] of Object.entries((props as Record<string, unknown>) ?? {})) {
    if (k === 'id') continue
    const p = spec.props[k]
    if (!p) fail(`${at}: ${type} has no prop "${k}"`)
    out[k] = value(p!, x, `${at}.${k}`, ctx, p!.kind === 'slot' ? undefined : out[k])
  }
  // Default slot children (rare) get fresh ids too.
  for (const [k, p] of Object.entries(spec.props))
    if (p.kind === 'slot' && Array.isArray(out[k]))
      out[k] = (out[k] as PuckNode[]).map((c) => (isObj(props) && k in props ? c : reId(c, ctx)))
  return { type, props: { ...out, id: ctx.newId(type) } }
}

function reId(node: PuckNode, ctx: Ctx): PuckNode {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node.props))
    props[k] = isNodeArray(v) ? v.map((c) => reId(c, ctx)) : structuredClone(v)
  return { type: node.type, props: { ...props, id: ctx.newId(node.type) } }
}

type Located = {
  list: PuckNode[]
  index: number
  node: PuckNode
  slot?: { allow?: string[]; disallow?: string[] }
}

/** Finds a block by id anywhere in the tree, with the list it sits in and that slot's allow/disallow rules. */
function locate(data: EditPageData, id: string, schema: SiteEditSchema): Located | null {
  const search = (list: PuckNode[], slot?: Located['slot']): Located | null => {
    for (let index = 0; index < list.length; index++) {
      const node = list[index]!
      if (node.props.id === id) return { list, index, node, slot }
      for (const [k, v] of Object.entries(node.props)) {
        if (!Array.isArray(v) || !v.every(isNode)) continue
        const p = schema.blocks[node.type]?.props[k]
        const hit = search(v, p?.kind === 'slot' ? { allow: p.allow, disallow: p.disallow } : undefined)
        if (hit) return hit
      }
    }
    return null
  }
  return search(data.content)
}

function insert(data: EditPageData, node: PuckNode, place: EditPlace, at: string, ctx: Ctx) {
  const anchors = [place.after, place.before, place.into].filter((x) => x !== undefined && x !== null)
  if (anchors.length > 1) fail(`${at}: give only one of after / before / into`)
  if (place.into) {
    const target = locate(data, place.into.id, ctx.schema)
    if (!target) fail(`${at}: no block with id "${place.into.id}"`)
    const spec = ctx.schema.blocks[target!.node.type]?.props[place.into.slot]
    if (spec?.kind !== 'slot') fail(`${at}: ${target!.node.type} has no slot "${place.into.slot}"`)
    allowed(spec as { disallow?: string[] }, node.type, at)
    const list = Array.isArray(target!.node.props[place.into.slot])
      ? (target!.node.props[place.into.slot] as PuckNode[])
      : []
    list.push(node)
    target!.node.props[place.into.slot] = list
    return
  }
  const anchor = place.after ?? place.before
  if (anchor) {
    const target = locate(data, anchor, ctx.schema)
    if (!target) fail(`${at}: no block with id "${anchor}"`)
    allowed(target!.slot, node.type, at)
    target!.list.splice(target!.index + (place.after ? 1 : 0), 0, node)
    return
  }
  data.content.push(node)
}

const labelOf = (schema: SiteEditSchema, type: string) => schema.blocks[type]?.label ?? type
const where = (schema: SiteEditSchema, data: EditPageData, place: EditPlace) => {
  const name = (id: string) => {
    const n = locate(data, id, schema)?.node
    return n ? labelOf(schema, n.type) : id
  }
  if (place.after) return ` after ${name(place.after)}`
  if (place.before) return ` before ${name(place.before)}`
  if (place.into) return ` inside ${name(place.into.id)}`
  return ' at the end of the page'
}

/**
 * Validates and applies AI edit ops to a copy of the page data (and theme). All-or-nothing: any invalid op
 * rejects the whole plan with readable errors, so a half-applied change never reaches the draft.
 */
export function applySiteEditOps(
  input: { data: unknown; theme: Record<string, unknown>; ops: SiteEditOp[] },
  schema: SiteEditSchema,
  newId: (type: string) => string = (type) => `${type}-${crypto.randomUUID()}`,
): ApplyResult {
  if (!Array.isArray(input.ops) || input.ops.length === 0)
    return { ok: false, errors: ['No changes proposed'] }
  if (input.ops.length > MAX_EDIT_OPS)
    return { ok: false, errors: [`At most ${MAX_EDIT_OPS} changes at once`] }
  const src = input.data as Partial<EditPageData> | null
  const data: EditPageData = {
    root: structuredClone(isObj(src?.root) ? src.root : { props: {} }),
    content: Array.isArray(src?.content) ? structuredClone(src.content.filter(isNode)) : [],
  }
  let theme: Record<string, unknown> | null = null
  const ctx: Ctx = { schema, newId }
  const summary: string[] = []
  const errors: string[] = []
  input.ops.forEach((op, i) => {
    const at = `Change ${i + 1}`
    try {
      if (!isObj(op)) fail(`${at}: not an operation`)
      switch (op.op) {
        case 'add': {
          const node = block(op.type, op.props, at, ctx)
          const desc = where(schema, data, op)
          insert(data, node, op, at, ctx)
          summary.push(`Added ${labelOf(schema, op.type)}${desc}`)
          break
        }
        case 'preset': {
          const preset = schema.presets.find((p) => p.key === op.key)
          if (!preset) fail(`${at}: unknown section preset "${op.key}"`)
          const desc = where(schema, data, op)
          insert(data, reId(preset!.node, ctx), op, at, ctx)
          summary.push(`Added the "${preset!.name}" section${desc}`)
          break
        }
        case 'move': {
          const found = locate(data, op.id, schema)
          if (!found) fail(`${at}: no block with id "${op.id}"`)
          if ([op.after, op.before, op.into?.id].includes(op.id))
            fail(`${at}: can't move a block next to itself`)
          found!.list.splice(found!.index, 1)
          const desc = where(schema, data, op)
          insert(data, found!.node, op, at, ctx)
          summary.push(`Moved ${labelOf(schema, found!.node.type)}${desc}`)
          break
        }
        case 'remove': {
          const found = locate(data, op.id, schema)
          if (!found) fail(`${at}: no block with id "${op.id}"`)
          found!.list.splice(found!.index, 1)
          summary.push(`Removed ${labelOf(schema, found!.node.type)}`)
          break
        }
        case 'update': {
          if (!isObj(op.props) || !Object.keys(op.props).length) fail(`${at}: nothing to update`)
          if (op.id === 'root') {
            data.root.props = fields(schema.root, op.props, `${at} (page)`, ctx, data.root.props ?? {})
            summary.push(`Updated the page's ${Object.keys(op.props).join(', ')}`)
            break
          }
          const found = locate(data, op.id, schema)
          if (!found) fail(`${at}: no block with id "${op.id}"`)
          const node = found!.node
          const spec = schema.blocks[node.type]
          if (!spec) fail(`${at}: ${node.type} blocks can't be edited by AI`)
          for (const [k, v] of Object.entries(op.props)) {
            const p = spec!.props[k]
            if (!p) fail(`${at}: ${node.type} has no prop "${k}"`)
            if (p!.kind === 'slot') fail(`${at}: use add/move/remove for the blocks inside "${k}"`)
            node.props[k] = value(p!, v, `${at}.${k}`, ctx, node.props[k])
          }
          summary.push(`Updated ${labelOf(schema, node.type)} (${Object.keys(op.props).join(', ')})`)
          break
        }
        case 'theme': {
          theme = fields(schema.theme, op.tokens, `${at} (theme)`, ctx, theme ?? input.theme)
          summary.push(`Theme: ${Object.keys(op.tokens).join(', ')}`)
          break
        }
        default:
          fail(`${at}: unknown operation "${String((op as { op?: unknown }).op)}"`)
      }
    } catch (e) {
      if (e instanceof OpError) errors.push(e.message)
      else throw e
    }
  })
  if (errors.length) return { ok: false, errors }
  return { ok: true, data, theme, summary }
}

/**
 * Compact view of a page for the model: block ids, types and props (long text clipped, advanced CSS and
 * schedules dropped), slots nested as children. Spa text is data for the model, never instructions.
 */
export function trimPageForPrompt(data: unknown, clip = 240): unknown {
  const trim = (v: unknown): unknown => {
    if (typeof v === 'string') return v.length > clip ? `${v.slice(0, clip)}…` : v
    if (Array.isArray(v)) return v.map(trim)
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trim(x)]))
    return v
  }
  const node = (n: PuckNode): unknown => {
    const { id, advanced: _advanced, ...rest } = n.props
    return { id, type: n.type, props: trim(rest) }
  }
  const d = data as Partial<EditPageData> | null
  return {
    root: trim(d?.root?.props ?? {}),
    content: (Array.isArray(d?.content) ? d.content.filter(isNode) : []).map(function walk(n): unknown {
      const out = node(n) as { props: Record<string, unknown> }
      for (const [k, v] of Object.entries(n.props))
        if (Array.isArray(v) && v.length && v.every(isNode)) out.props[k] = v.map(walk)
      return out
    }),
  }
}

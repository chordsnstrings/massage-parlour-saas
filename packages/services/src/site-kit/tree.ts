/** Helpers for Puck page data (`{ root: { props }, content: Node[] }`, slots = arrays of nodes in props). */
export type PuckNode = { type: string; props: Record<string, unknown> }
export type DataPath = (string | number)[]

/** Block type that renders a tenant's global saved section by reference. */
export const GLOBAL_SECTION = 'GlobalSection'

export const isNode = (v: unknown): v is PuckNode =>
  typeof v === 'object' &&
  v !== null &&
  !Array.isArray(v) &&
  typeof (v as PuckNode).type === 'string' &&
  typeof (v as PuckNode).props === 'object' &&
  (v as PuckNode).props !== null

export const isNodeArray = (v: unknown): v is PuckNode[] =>
  Array.isArray(v) && v.length > 0 && v.every(isNode)

/** Depth-first walk over every block (top-level content and slot children) with its path in the data. */
export function walkNodes(
  data: unknown,
  visit: (node: PuckNode, path: DataPath, depth: number) => void,
): void {
  const walk = (node: PuckNode, path: DataPath, depth: number) => {
    visit(node, path, depth)
    for (const [key, value] of Object.entries(node.props)) {
      if (isNodeArray(value))
        value.forEach((child, i) => {
          walk(child, [...path, 'props', key, i], depth + 1)
        })
    }
  }
  const content = (data as { content?: unknown } | null)?.content
  if (Array.isArray(content))
    content.forEach((n, i) => {
      if (isNode(n)) walk(n, ['content', i], 0)
    })
}

/** Saved-section ids referenced by GlobalSection blocks. */
export function collectGlobalIds(data: unknown): string[] {
  const ids = new Set<string>()
  walkNodes(data, (n) => {
    if (n.type === GLOBAL_SECTION && typeof n.props.sectionId === 'string' && n.props.sectionId)
      ids.add(n.props.sectionId)
  })
  return [...ids]
}

export function getAt(root: unknown, path: DataPath): unknown {
  let cur: unknown = root
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string | number, unknown>)[key]
  }
  return cur
}

/** Immutable set: copies each container along `path`. */
export function setAt<T>(root: T, path: DataPath, value: unknown): T {
  if (!path.length) return value as T
  const [key, ...rest] = path
  const container = (root ?? (typeof key === 'number' ? [] : {})) as Record<string | number, unknown>
  const copy = (Array.isArray(container) ? [...container] : { ...container }) as Record<
    string | number,
    unknown
  >
  copy[key!] = setAt(container[key!], rest, value)
  return copy as T
}

/** Immutable removal of an array element (or object key) at `path`. */
export function removeAt<T>(root: T, path: DataPath): T {
  const parentPath = path.slice(0, -1)
  const key = path[path.length - 1]
  const parent = getAt(root, parentPath)
  if (Array.isArray(parent) && typeof key === 'number')
    return setAt(
      root,
      parentPath,
      parent.filter((_, i) => i !== key),
    )
  if (parent && typeof parent === 'object' && key !== undefined) {
    const { [key]: _drop, ...rest } = parent as Record<string | number, unknown>
    return setAt(root, parentPath, rest)
  }
  return root
}

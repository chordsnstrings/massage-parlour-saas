// R26: an HTML design with the CRM data contract, rendered with the spa's live CRM data (docs/design/html-crm-contract.md).
// Isomorphic: the server (live page, previews) and the Studio editor's canvas (client) both call it right before
// htmlDesignDocument. A design without the contract comes back as the very same string.
import {
  type CrmContract,
  type CrmJsonMemo,
  type CrmLocale,
  crmJsonMemo,
  crmScriptJson,
  cyrb53,
  type HtmlCrmContract,
  type HtmlDesignContent,
  hasHtmlContent,
  htmlCrmContractOf,
  mergeCrmContract,
  overlayHtmlContent,
  spliceCrmData,
} from '@spa/core'

/** A bounded map by size (insertion order = recency): the caches below are content-addressed, never invalidated. */
class SizedCache<V> {
  private map = new Map<string, { v: V; size: number }>()
  private total = 0
  constructor(private readonly max: number) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key)
    if (!hit) return undefined
    this.map.delete(key)
    this.map.set(key, hit)
    return hit.v
  }
  set(key: string, v: V, size: number) {
    if (size > this.max) return
    const old = this.map.get(key)
    if (old) this.total -= old.size
    this.map.delete(key)
    this.map.set(key, { v, size })
    this.total += size
    for (const [k, e] of this.map) {
      if (this.total <= this.max) break
      this.map.delete(k)
      this.total -= e.size
    }
  }
}

type Parsed = { found: HtmlCrmContract | null; memo: CrmJsonMemo }
const MB = 1024 * 1024
const browser = typeof window !== 'undefined'
// globalThis: route handlers and pages are separate bundles in one server process.
const g = globalThis as unknown as {
  __spaCrmContracts?: SizedCache<Parsed>
  __spaCrmOutputs?: SizedCache<string>
}
// Parsed design data (+ its serialisation memo), ~3× the literal's length; outputs at 2 bytes a character.
g.__spaCrmContracts ??= new SizedCache<Parsed>((browser ? 24 : 128) * MB)
g.__spaCrmOutputs ??= new SizedCache<string>((browser ? 24 : 96) * MB)
const contracts = g.__spaCrmContracts
const outputs = g.__spaCrmOutputs

/** Cache key of a stored design document (content-addressed: file id + sha256); null = an inline legacy design. */
export const designKey = (doc: { file: string; sha256: string } | null | undefined) =>
  doc ? `${doc.file}:${doc.sha256}` : null

/** The design's contract (parsed once per stored document); null = none. */
export function designContract(html: string, key: string | null): Parsed | null {
  if (!html) return null
  const hit = key ? contracts.get(key) : undefined
  if (hit) return hit.found ? hit : null
  const found = htmlCrmContractOf(html)
  const parsed = { found, memo: crmJsonMemo() }
  if (key)
    contracts.set(key, parsed, found?.literal ? (found.literal.end - found.literal.start) * 3 + 1024 : 256)
  return found ? parsed : null
}

/**
 * The design with the spa's data: `literal` designs get only their `window.CRM_DATA` JSON replaced — the design's
 * data with the spa's website content over it (R28, draft → publish with the page), then the CRM's operational keys
 * (R26); endpoint-only designs get the CRM contract injected in frames (`inject`), and are left as they are on the
 * live page (which fetches `crm-data.json`). No contract, or neither CRM data nor content → `html` unchanged.
 */
export function designWithCrm(
  html: string,
  key: string | null,
  crm: CrmContract | null | undefined,
  opts: { inject: boolean; content?: HtmlDesignContent | null; locale?: CrmLocale },
): string {
  const content = hasHtmlContent(opts.content) ? opts.content : null
  if (!crm && !content) return html
  const parsed = designContract(html, key)
  if (!parsed?.found) return html
  const found = parsed.found
  if (!found.literal && (!opts.inject || !crm)) return html
  const locale = opts.locale ?? 'en'
  const outKey = key
    ? `${key}|${found.literal ? 'l' : 'i'}|${crm ? cyrb53(JSON.stringify(crm)) : '-'}${
        content && found.literal ? `|${locale}|${cyrb53(JSON.stringify(content))}` : ''
      }`
    : null
  const hit = outKey ? outputs.get(outKey) : undefined
  if (hit !== undefined) return hit
  const own = found.literal
    ? content
      ? overlayHtmlContent(found.literal.data, content, { locale })
      : found.literal.data
    : null
  const json = crmScriptJson(crm ? mergeCrmContract(own, crm) : own, parsed.memo)
  const out = spliceCrmData(html, found, json, opts)
  if (outKey) outputs.set(outKey, out, out.length * 2)
  return out
}

/** Whether a page's data has an HtmlDesign block whose design uses the contract (`htmlDocs`: the editor's designs). */
export function pageUsesCrmContract(data: unknown, htmlDocs?: Record<string, string>): boolean {
  const content = (data as { content?: { type?: unknown; props?: Record<string, unknown> }[] } | null)
    ?.content
  for (const n of Array.isArray(content) ? content : []) {
    if (n?.type !== 'HtmlDesign') continue
    const doc = n.props?.doc as { file?: unknown; sha256?: unknown } | undefined
    const ref =
      doc && typeof doc.file === 'string' && typeof doc.sha256 === 'string'
        ? { file: doc.file, sha256: doc.sha256 }
        : null
    const html =
      (typeof n.props?.html === 'string' && n.props.html) || (ref ? htmlDocs?.[ref.file] : '') || ''
    if (designContract(html, designKey(ref))) return true
  }
  return false
}

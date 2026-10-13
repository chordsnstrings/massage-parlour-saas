// R26: an HTML design with the CRM data contract, rendered with the spa's live CRM data (docs/design/html-crm-contract.md).
// Isomorphic: the server (live page, previews) and the Studio editor's canvas (client) both call it right before
// htmlDesignDocument. A design without the contract comes back as the very same string.
import {
  applyCrmInline,
  type CrmContract,
  type CrmInline,
  type CrmJsonMemo,
  type CrmLocale,
  contractLocaleData,
  crmInlineKey,
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

/** `ar`: a v2 design's data with its Arabic defaults (`contractLocaleData`), made once per document. */
type Parsed = { found: HtmlCrmContract | null; memo: CrmJsonMemo; ar?: Record<string, unknown> }
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
  const range = found?.literal ?? found?.defaults
  if (key) contracts.set(key, parsed, range ? (range.end - range.start) * 3 + 1024 : 256)
  return found ? parsed : null
}

/**
 * The design with the spa's data: `literal` designs get only their `window.CRM_DATA` JSON replaced — the design's
 * data with the spa's website content over it (R28, draft → publish with the page), then the CRM's operational keys
 * (R26); endpoint-only designs get the CRM contract injected in frames (`inject`; R28 P5: over their `crm-defaults`
 * with the content), and are left as they are on the live page (which fetches `crm-data.json?page=`). No contract,
 * or neither CRM data nor content values → `html` unchanged (a v1 design keeps its P4 output and key). Contract v2
 * (R28 P5): `locale` written into the data (the frame's script sets `lang`), and on `ar` the design's reviewed Arabic
 * defaults (`contract.l10n.ar`) applied before the content. Only `content.values` count here (and in the output key):
 * page texts and pictures (R28 P4) are applied by htmlDesignDocument afterwards, so texts-only content keeps the
 * no-content path and key. `inline` (contract.inline): its pictures replace their urls last (part of the key).
 */
export function designWithCrm(
  html: string,
  key: string | null,
  crm: CrmContract | null | undefined,
  opts: CrmOpts,
): string {
  const p = prepare(html, key, crm, opts)
  if (!p) return html
  const inline = crmInlineKey(opts.inline)
  const outKey = p.outKey ? `${p.outKey}${inline ? `|in:${cyrb53(inline)}` : ''}` : null
  const hit = outKey ? outputs.get(outKey) : undefined
  if (hit !== undefined) return hit
  const base = merged(p, crm)
  const data = base && opts.inline ? applyCrmInline(base, opts.inline) : base
  const json = crmScriptJson(data, p.parsed.memo, {
    transient: opts.inline ? new Set(Object.values(opts.inline).map((x) => x.data)) : undefined,
  })
  const out = spliceCrmData(html, p.found, json, opts)
  if (outKey) outputs.set(outKey, out, out.length * 2)
  return out
}

type CrmOpts = {
  inject: boolean
  content?: HtmlDesignContent | null
  locale?: CrmLocale
  /**
   * contract.inline (owner 2026-10-13 "no delay when I reload"): the server's plan of first-screen pictures as data:
   * URIs (server/crm-inline.ts) — the live page and share links only, never the Studio editor.
   */
  inline?: CrmInline | null
}

/** What a render merges (+ its output cache key), or null when `html` comes back unchanged. */
function prepare(html: string, key: string | null, crm: CrmContract | null | undefined, opts: CrmOpts) {
  const content = opts.content && hasHtmlContent(opts.content) ? opts.content : null
  const locale = opts.locale ?? 'en'
  if (!crm && !content && locale !== 'ar') return null
  const parsed = designContract(html, key)
  if (!parsed?.found) return null
  const found = parsed.found
  const v2 = found.version === 2
  if (!crm && !content && !v2) return null
  const base = found.literal?.data ?? (opts.inject ? (found.defaults?.data ?? null) : null)
  if (!found.literal && (!opts.inject || (!crm && !base))) return null
  const loc = v2 || (content && base) ? `|${locale}` : ''
  const outKey = key
    ? `${key}|${found.literal ? 'l' : 'i'}|${crm ? cyrb53(JSON.stringify(crm)) : '-'}${loc}${
        content && base ? `|${cyrb53(JSON.stringify(content.values))}` : ''
      }`
    : null
  return { parsed, found, v2, base, content, locale, outKey }
}

/** The render's data: the design's (Arabic defaults on `ar`, v2), the spa's content over it, then the CRM. */
function merged(p: NonNullable<ReturnType<typeof prepare>>, crm: CrmContract | null | undefined) {
  const { parsed, v2, base, content, locale } = p
  // Copy-on-write: untouched subtrees keep their identity, so the serialiser's memo still hits.
  let local = base
  if (base && v2 && locale === 'ar') {
    parsed.ar ??= contractLocaleData(base, 'ar')
    local = parsed.ar
  }
  const own = local && content ? overlayHtmlContent(local, content, { locale }) : local
  return crm ? mergeCrmContract(own, crm, v2 ? { locale } : {}) : own && v2 ? { ...own, locale } : own
}

/**
 * The data a render puts into `window.CRM_DATA` before contract.inline, or null when it leaves `html` as it is
 * (server/crm-inline.ts plans the inline pictures from it; not cached).
 */
export function designCrmData(
  html: string,
  key: string | null,
  crm: CrmContract | null | undefined,
  opts: CrmOpts,
): Record<string, unknown> | null {
  const p = prepare(html, key, crm, opts)
  return p ? merged(p, crm) : null
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

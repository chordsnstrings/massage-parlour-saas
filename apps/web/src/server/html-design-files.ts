// R24: HTML design documents and the files they use. A design is stored byte for byte as a file (a spa's own private
// stored file, a template's `site_template_files` row) and the HtmlDesign block keeps only the reference; these
// helpers fill the html right before rendering (cached by file id: the files are content-addressed, never changed)
// and copy a template's design into a spa when it is applied (console switch, connector apply_template).
import { type HtmlDesignDoc, htmlDesignDocOf } from '@spa/core'
import { platformDb, type Tx, withTenant } from '@spa/db'
import {
  type FileUrl,
  type HtmlDocReader,
  materializeTemplatePageData,
  type PageData,
  resolveHtmlDesignDocs,
  spaHtmlDocReader,
  templateHtmlDocReader,
} from '@spa/services'
import { LRUCache } from 'lru-cache'
import { canonicalUrls } from '@/server/origin'

/** Absolute canonical /files URL of a public file (works from the sandboxed design and under a design's <base>). */
export const designFileUrl: FileUrl = (id, name) => canonicalUrls().api(`/files/${id}/${name}`)

/** switchTemplate `prepare`: a template's HTML designs copied into the spa's own files before they are written. */
export const templateIntoSpa =
  (tx: Tx, tenantId: string, userId?: string) =>
  async (data: PageData): Promise<PageData> =>
    (await materializeTemplatePageData(tx, { tenantId, data, fileUrl: designFileUrl, userId })).data

// One process serves every route: a bounded cache of design texts (≤ 64 MB, counted in UTF-8 bytes — a string of
// non-Latin-1 text takes two bytes a character in the heap, so characters would undercount it).
const g = globalThis as unknown as { __spaHtmlDocs?: LRUCache<string, string> }
g.__spaHtmlDocs ??= new LRUCache<string, string>({
  maxSize: 64 * 1024 * 1024,
  sizeCalculation: (v) => Math.max(1, Buffer.byteLength(v, 'utf8')),
})
const docs = g.__spaHtmlDocs

/** `read` with the cache in front (key: owner + file id + sha; a missing file is never cached). */
const cached =
  (owner: string, read: HtmlDocReader): HtmlDocReader =>
  async (doc: HtmlDesignDoc) => {
    const key = `${owner}:${doc.file}:${doc.sha256}`
    const hit = docs.get(key)
    if (hit !== undefined) return hit
    const html = await read(doc)
    if (html !== null) docs.set(key, html)
    return html
  }

/** Reader of a spa's own design documents inside its tenant transaction. */
export const spaDocReader = (tx: Tx, tenantId: string) =>
  cached(`spa:${tenantId}`, spaHtmlDocReader(tx, tenantId))
/** Reader of template design documents (platform role). */
export const templateDocReader = () => cached('template', templateHtmlDocReader(platformDb()))

/** A spa page's data ready to render: its HTML designs' html filled from the spa's files. */
export const spaDesignData = <T>(tenantId: string, data: T, tx?: Tx): Promise<T> =>
  tx
    ? resolveHtmlDesignDocs(data, spaDocReader(tx, tenantId))
    : withTenant(tenantId, (t) => resolveHtmlDesignDocs(data, spaDocReader(t, tenantId)))

/** A template page's data ready to render (its HTML designs' html filled from the template files). */
export const templateDesignData = <T>(data: T): Promise<T> => resolveHtmlDesignDocs(data, templateDocReader())

/**
 * The Studio editor keeps the references in its page data (it saves that data back, and a whole design would not fit
 * a server action body): the designs it shows travel next to it, in the metadata (SiteMeta.htmlDocs, by file id).
 */
export async function editorHtmlDocs(tenantId: string, data: unknown): Promise<Record<string, string>> {
  const shown = (await spaDesignData(tenantId, data)) as {
    content?: { type?: unknown; props?: Record<string, unknown> }[]
  } | null
  const out: Record<string, string> = {}
  for (const n of shown?.content ?? []) {
    const doc = htmlDesignDocOf(n?.props)
    if (n?.type === 'HtmlDesign' && doc && typeof n.props?.html === 'string') out[doc.file] = n.props.html
  }
  return out
}

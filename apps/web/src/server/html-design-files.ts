// R24: where a spa's HTML design files go (its own public stored files) and how they are addressed (absolute
// canonical /files URLs: they work from the sandboxed design frame, the direct design page and under a design's own
// <base>). Shared by the console template switch, Ask AI / MCP edits and the template upload.
import type { Tx } from '@spa/db'
import {
  type FileUrl,
  materializeTemplatePageData,
  type PageData,
  prepareHtmlDesign,
  type SiteEditDeps,
  tenantHtmlAssetSink,
} from '@spa/services'
import { canonicalUrls } from '@/server/origin'

export const designFileUrl: FileUrl = (id, name) => canonicalUrls().api(`/files/${id}/${name}`)

/** switchTemplate `prepare`: a template's HTML designs copied to the spa's own files before they are written. */
export const templateIntoSpa =
  (tx: Tx, tenantId: string, userId?: string) =>
  async (data: PageData): Promise<PageData> =>
    (await materializeTemplatePageData(tx, { tenantId, data, fileUrl: designFileUrl, userId })).data

/** runSiteEdit `prepareHtml` for one spa: embedded files of a design move to its stored files. */
export const spaPrepareHtml =
  (tx: Tx, tenantId: string, userId?: string): NonNullable<SiteEditDeps['prepareHtml']> =>
  (html, o) =>
    prepareHtmlDesign({
      html,
      images: o.images,
      sink: tenantHtmlAssetSink(tx, tenantId, userId),
      fileUrl: designFileUrl,
      dryRun: o.dryRun,
    })

// R28 P5: how dynamic each HTML-design page of a spa is (core `htmlDesignReport`: CRM contract none / v1 / v2, slot
// counts, warnings) — the Studio Pages card and D5's "is this a contract v2 page" check.
import { type HtmlDesignReport, htmlDesignDocOf, htmlDesignReport } from '@spa/core'
import type { Tx } from '@spa/db'
import { HTML_DESIGN_BLOCK } from './site-edit'
import { htmlDesignSource, spaHtmlDocReader } from './site-html-assets'
import { getEditablePage, listPages, type PageSummary } from './sites'

export type PageDesignReport = {
  pageId: string
  slug: string
  report: HtmlDesignReport
  /** The page's design file (null: an inline legacy design). */
  sha256: string | null
}

// Content-addressed (tenant + file id + sha): never invalidated, the oldest dropped past 256.
const g = globalThis as unknown as { __spaDesignReports?: Map<string, HtmlDesignReport> }
g.__spaDesignReports ??= new Map()
const reports = g.__spaDesignReports
const MAX = 256

/**
 * The report of each page whose newest version (draft or published) has an HtmlDesign block, in menu order (`pages`:
 * the spa's `listPages`, read when not given). Inside the spa's tenant transaction; a missing design file is skipped.
 */
export async function pageDesignReports(
  tx: Tx,
  tenantId: string,
  pages?: PageSummary[],
): Promise<PageDesignReport[]> {
  const out: PageDesignReport[] = []
  const read = spaHtmlDocReader(tx, tenantId)
  for (const p of pages ?? (await listPages(tx, tenantId))) {
    const page = await getEditablePage(tx, tenantId, p.id)
    const content = (page?.data as { content?: unknown } | undefined)?.content
    const node = Array.isArray(content)
      ? (content as { type?: unknown; props?: Record<string, unknown> }[]).find(
          (n) => n?.type === HTML_DESIGN_BLOCK && n.props,
        )
      : undefined
    if (!node?.props) continue
    const doc = htmlDesignDocOf(node.props)
    const key = doc ? `${tenantId}:${doc.file}:${doc.sha256}` : null
    let report = key ? reports.get(key) : undefined
    if (!report) {
      const html = await htmlDesignSource(node.props, read)
      if (html === null) continue
      report = htmlDesignReport(html)
      if (key) {
        reports.set(key, report)
        if (reports.size > MAX) reports.delete(reports.keys().next().value!)
      }
    }
    out.push({ pageId: p.id, slug: p.slug, report, sha256: doc?.sha256 ?? null })
  }
  return out
}

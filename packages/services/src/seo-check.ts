// R30 (owner 2026-10-13): the weekly search check of a spa's live site, stored per site (latest 8). The check
// itself is pure (@spa/core `seoCheck`); this loads the live pages (block pages and HTML designs, whose source is
// the spa's design file) and the sitemap's page list (the same rule as the public sitemap.xml: `siteIndexable`).
// Takes the caller's tx (`withTenant`); no permission checks or audit here.
import { type SeoCheckPage, seoCheck, siteIndexable } from '@spa/core'
import { type SeoCheckFinding, seoChecks, type Tx, tenants } from '@spa/db'
import { and, desc, eq, notInArray } from 'drizzle-orm'
import { htmlDesignSource, spaHtmlDocReader } from './site-html-assets'
import { getSite, latestVersion, listPublishedPages } from './sites'

/** Checks kept per site. */
export const SEO_CHECKS_KEPT = 8

export type SeoCheckRow = typeof seoChecks.$inferSelect

type Node = { type?: unknown; props?: Record<string, unknown> }

/**
 * Checks the spa's live pages and stores the result (older checks beyond the latest 8 are deleted in the same
 * transaction). null = no site or nothing published yet (nothing stored).
 */
export async function runSeoCheck(
  tx: Tx,
  tenantId: string,
  opts: { trigger: 'weekly' | 'manual'; now?: Date },
): Promise<SeoCheckRow | null> {
  const site = await getSite(tx, tenantId)
  if (!site) return null
  const live = await listPublishedPages(tx, tenantId)
  if (!live.length) return null
  const [tenant] = await tx
    .select({ name: tenants.name, status: tenants.status })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
  const read = spaHtmlDocReader(tx, tenantId)
  const pages: SeoCheckPage[] = []
  for (const p of live) {
    const version = await latestVersion(tx, tenantId, p.id, 'published')
    if (!version) continue
    const content = (version.data as { content?: unknown } | null)?.content
    const design = Array.isArray(content)
      ? (content as Node[]).find((n) => n?.type === 'HtmlDesign' && n.props)
      : undefined
    pages.push({
      slug: p.slug,
      data: version.data,
      ...(design ? { html: await htmlDesignSource(design.props, read) } : {}),
    })
  }
  const { findings, counts } = seoCheck({
    spaName: tenant?.name ?? '',
    arabic: site.locales.includes('ar'),
    pages,
    sitemap: siteIndexable(tenant?.status ?? '', live.length) ? live.map((p) => p.slug) : [],
  })
  const [row] = await tx
    .insert(seoChecks)
    .values({
      tenantId,
      siteId: site.id,
      checkedAt: opts.now ?? new Date(),
      findings: findings as SeoCheckFinding[],
      counts,
      trigger: opts.trigger,
    })
    .returning()
  const keep = tx
    .select({ id: seoChecks.id })
    .from(seoChecks)
    .where(eq(seoChecks.siteId, site.id))
    .orderBy(desc(seoChecks.checkedAt), desc(seoChecks.id))
    .limit(SEO_CHECKS_KEPT)
  await tx.delete(seoChecks).where(and(eq(seoChecks.siteId, site.id), notInArray(seoChecks.id, keep)))
  return row!
}

/** The site's latest check, or null. */
export async function latestSeoCheck(tx: Tx, siteId: string): Promise<SeoCheckRow | null> {
  const [row] = await tx
    .select()
    .from(seoChecks)
    .where(eq(seoChecks.siteId, siteId))
    .orderBy(desc(seoChecks.checkedAt), desc(seoChecks.id))
    .limit(1)
  return row ?? null
}

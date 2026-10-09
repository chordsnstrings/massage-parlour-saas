import { robotsTxt, type SitemapEntry, sitemapXml } from '@spa/core'
import { sites, socialAccounts, tenants, withTenant } from '@spa/db'
import { fileUrl, listPublishedPages } from '@spa/services'
import { imageSrc, walkNodes } from '@spa/services/site-kit'
import { and, eq, ne } from 'drizzle-orm'
import { cache } from 'react'
import { publicSiteUrl } from '@/server/sites'

/**
 * Search + social data for a spa's public site (PLAN §17 F12). Canonical address = its primary active custom domain,
 * else the free subdomain (/s/{slug} with path routing) — publicSiteUrl. robots.txt, sitemap.xml, canonical/hreflang
 * links, og:image and JSON-LD all use it, whichever host the visitor came in on.
 */
type SiteTenant = { id: string; slug: string; name: string; status: string }

/** Paths no crawler needs on a spa site (the booking widget's chrome-less iframe, API routes). */
const PRIVATE_PATHS = ['/book/embed', '/api/']

/** Canonical URL of one site page ('' = home); `?lang=ar` for the Arabic version. */
export function sitePageUrl(base: string, slug: string, lang?: 'en' | 'ar') {
  const path = new URL(base).pathname
  const url = slug ? `${base}/${slug}` : path === '/' || path === '' ? `${base.replace(/\/$/, '')}/` : base
  return lang === 'ar' ? `${url}?lang=ar` : url
}

/** hreflang links for a page (English is the default version). */
export const hreflang = (base: string, slug: string, arabic: boolean): Record<string, string> | undefined =>
  arabic
    ? {
        en: sitePageUrl(base, slug),
        ar: sitePageUrl(base, slug, 'ar'),
        'x-default': sitePageUrl(base, slug),
      }
    : undefined

/** One request's SEO facts about a spa (shared by generateMetadata and the page through React cache). */
export const siteSeo = cache(async (tenant: SiteTenant) => {
  const base = (await publicSiteUrl(tenant)).replace(/\/$/, '')
  const origin = new URL(base).origin
  const facts = await withTenant(tenant.id, async (tx) => {
    const [t] = await tx.select({ logo: tenants.logoFileId }).from(tenants).where(eq(tenants.id, tenant.id))
    const [site] = await tx
      .select({ locales: sites.locales })
      .from(sites)
      .where(eq(sites.tenantId, tenant.id))
    const [ig] = await tx
      .select({ username: socialAccounts.username })
      .from(socialAccounts)
      .where(
        and(
          eq(socialAccounts.tenantId, tenant.id),
          eq(socialAccounts.platform, 'instagram'),
          ne(socialAccounts.status, 'disconnected'),
        ),
      )
      .limit(1)
    return {
      logo: t?.logo ?? null,
      locales: site?.locales ?? ['en'],
      ig,
      pages: await listPublishedPages(tx, tenant.id),
    }
  })
  const username = facts.ig?.username?.replace(/^@/, '')
  return {
    base,
    origin,
    home: sitePageUrl(base, ''),
    arabic: facts.locales.includes('ar'),
    logo: facts.logo ? `${origin}${fileUrl(facts.logo)}` : null,
    instagram:
      username && /^[A-Za-z0-9._]{1,30}$/.test(username) ? `https://www.instagram.com/${username}/` : null,
    pages: facts.pages.map((p) => ({ slug: p.slug, title: p.title, publishedAt: p.publishedAt })),
    /** Suspended spas and sites with nothing published stay out of search (pages say noindex; empty sitemap). */
    indexable: tenant.status !== 'suspended' && facts.pages.length > 0,
  }
})

/** Absolute URL for a site image ('https://…' or a site-relative '/files/…'); null for anything else. */
export function absoluteImage(src: string, origin: string): string | null {
  if (/^https:\/\/[^\s"<>]+$/.test(src)) return src
  if (/^\/(?!\/)[^\s"<>]*$/.test(src)) return `${origin}${src}`
  return null
}

/** The page's hero picture: the first Hero block image, else the first section background image. */
export function heroImageOf(data: unknown, origin: string): string | null {
  let hero = ''
  let band = ''
  walkNodes(data, (node) => {
    if (!hero && node.type === 'Hero') hero = imageSrc(node.props.image)
    if (!band && node.props.background === 'image') band = imageSrc(node.props.bgImage)
  })
  return absoluteImage(hero, origin) ?? absoluteImage(band, origin)
}

const text = (body: string, type: string) =>
  new Response(body, { headers: { 'content-type': type, 'cache-control': 'public, max-age=3600' } })

/** robots.txt for a spa's own host (custom domain, or {slug}.domain with host routing). */
export async function siteRobots(tenant: SiteTenant | null): Promise<Response> {
  if (!tenant) return text(robotsTxt({ disallowAll: true }), 'text/plain; charset=utf-8')
  const seo = await siteSeo(tenant)
  // A site kept out of search is still crawlable, so crawlers see its pages' noindex and drop them.
  return text(
    robotsTxt({
      disallow: PRIVATE_PATHS,
      sitemaps: seo.indexable ? [`${seo.base}/sitemap.xml`] : [],
    }),
    'text/plain; charset=utf-8',
  )
}

/** sitemap.xml: the spa's published pages (+ /book) at their canonical address, with EN/AR alternates. */
export async function siteSitemap(tenant: SiteTenant | null): Promise<Response> {
  const entries: SitemapEntry[] = []
  if (tenant) {
    const seo = await siteSeo(tenant)
    if (seo.indexable) {
      const add = (slug: string, lastModified: Date | null) => {
        const alternates = hreflang(seo.base, slug, seo.arabic)
        entries.push({ url: sitePageUrl(seo.base, slug), lastModified, alternates })
        if (seo.arabic) entries.push({ url: sitePageUrl(seo.base, slug, 'ar'), lastModified, alternates })
      }
      for (const p of seo.pages) add(p.slug, p.publishedAt)
      if (!seo.pages.some((p) => p.slug === 'book')) add('book', null)
    }
  }
  return text(sitemapXml(entries), 'application/xml; charset=utf-8')
}

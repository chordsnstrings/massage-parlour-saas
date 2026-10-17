import { sitemapXml } from '@spa/core'
import { MARKETING_PAGES } from '@/components/marketing/seo'
import { canonicalUrls } from '@/server/origin'

export const dynamic = 'force-dynamic'

/** The marketing site's pages at the canonical domain (spa sites have their own sitemaps, see robots.txt). */
export function GET() {
  const root = canonicalUrls().marketing()
  const body = sitemapXml(Object.values(MARKETING_PAGES).map((p) => ({ url: `${root}${p.path}` })))
  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  })
}

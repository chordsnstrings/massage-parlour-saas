import { siteSitemap } from '@/server/seo'
import { resolveSiteTenant } from '@/server/sites'

export const dynamic = 'force-dynamic'

/** sitemap.xml on a spa's custom domain (an unknown host gets an empty one). */
export async function GET(_req: Request, { params }: { params: Promise<{ hostname: string }> }) {
  return siteSitemap(await resolveSiteTenant({ hostname: decodeURIComponent((await params).hostname) }))
}

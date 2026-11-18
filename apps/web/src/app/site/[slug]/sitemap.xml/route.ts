import { siteSitemap } from '@/server/seo'
import { resolveSiteTenant } from '@/server/sites'

export const dynamic = 'force-dynamic'

/** {slug}.domain/sitemap.xml, or /s/{slug}/sitemap.xml with path routing (listed in the platform's robots.txt). */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return siteSitemap(await resolveSiteTenant({ slug: (await params).slug }))
}

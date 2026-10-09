import { siteRobots } from '@/server/seo'
import { resolveSiteTenant } from '@/server/sites'

export const dynamic = 'force-dynamic'

/** {slug}.domain/robots.txt (host routing); with path routing the platform's robots.txt covers /s/{slug}. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  return siteRobots(await resolveSiteTenant({ slug: (await params).slug }))
}

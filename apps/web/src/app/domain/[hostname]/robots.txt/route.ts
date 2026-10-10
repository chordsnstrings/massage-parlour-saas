import { siteRobots } from '@/server/seo'
import { resolveSiteTenant } from '@/server/sites'

export const dynamic = 'force-dynamic'

/** robots.txt on a spa's custom domain (an unknown host disallows everything). */
export async function GET(_req: Request, { params }: { params: Promise<{ hostname: string }> }) {
  return siteRobots(await resolveSiteTenant({ hostname: decodeURIComponent((await params).hostname) }))
}

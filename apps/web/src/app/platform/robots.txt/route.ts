import { robotsTxt } from '@spa/core'

export const dynamic = 'force-static'

/** admin.{domain}/robots.txt: the console is never crawled (path routing: the platform robots.txt blocks /admin/). */
export function GET() {
  return new Response(robotsTxt({ disallowAll: true }), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

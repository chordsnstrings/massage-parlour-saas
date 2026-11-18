import { robotsTxt } from '@spa/core'

export const dynamic = 'force-static'

/** app.{domain}/robots.txt: the spa dashboard is never crawled (path routing: the platform robots.txt blocks /app/). */
export function GET() {
  return new Response(robotsTxt({ disallowAll: true }), {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  })
}

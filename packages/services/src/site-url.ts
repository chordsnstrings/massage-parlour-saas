// A spa's public site address outside a web request (worker jobs, services): the same rule as the web app's
// `publicSiteUrl` (apps/web server/sites.ts) — primary active custom domain, else the free address on the canonical
// platform domain ({slug}.{root}, or {root}/s/{slug} with path routing).
import { parseRoots, trimTrailingSlashes } from '@spa/core'
import { domains, type Tx } from '@spa/db'
import { and, eq } from 'drizzle-orm'

type Env = Record<string, string | undefined>

const isLocal = (host: string) => {
  const bare = host.replace(/:\d+$/, '')
  return bare === 'localhost' || bare.endsWith('.localhost') || /^[\d.]+$/.test(bare)
}

/** The free site address on the canonical platform domain (no request needed). */
export function freeSiteUrl(slug: string, env: Env = process.env) {
  const root = parseRoots(env.ROOT_DOMAIN ?? 'localhost:3000', env.EXTRA_ROOT_DOMAINS)[0] ?? 'localhost:3000'
  const app = env.APP_URL ?? ''
  const scheme = app.startsWith('https:')
    ? 'https'
    : app.startsWith('http:')
      ? 'http'
      : isLocal(root)
        ? 'http'
        : 'https'
  return env.NEXT_PUBLIC_ROUTING === 'path' ? `${scheme}://${root}/s/${slug}` : `${scheme}://${slug}.${root}`
}

/** Public site address of the spa in this tenant transaction; `custom` = it is the spa's own domain. */
export async function publicSiteBase(tx: Tx, slug: string, env: Env = process.env) {
  const [primary] = await tx
    .select({ hostname: domains.hostname })
    .from(domains)
    .where(and(eq(domains.kind, 'custom'), eq(domains.status, 'active'), eq(domains.isPrimary, true)))
    .limit(1)
  return primary
    ? { url: `https://${primary.hostname}`, custom: true }
    : { url: freeSiteUrl(slug, env), custom: false }
}

/** Online booking link with an F13 entry tag (`?src=`), e.g. the Google "Book" button → `src=google`. */
export const bookingLink = (siteBase: string, src: string) =>
  `${trimTrailingSlashes(siteBase)}/book?src=${src}`

/** The site's sitemap (F12: every site host answers /sitemap.xml). */
export const sitemapUrlOf = (siteBase: string) => `${trimTrailingSlashes(siteBase)}/sitemap.xml`

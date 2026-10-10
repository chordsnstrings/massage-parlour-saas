import { expect, type Page, test } from '@playwright/test'
import { domains, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import {
  admin,
  altBase,
  app,
  base,
  PATH,
  PORT,
  signInPlatformAdmin,
  signUpOwner,
  site,
  testDb,
  uniqueSlug,
} from './helpers'

type Method = 'GET' | 'HEAD' | 'POST'
/** Same-host request as the browser would send it (Node can't resolve *.localhost: ask 127.0.0.1 with the Host). */
const viaHost = (page: Page, url: string, method: Method = 'GET') => {
  const u = new URL(url)
  return page.request.fetch(`http://127.0.0.1:${PORT}${u.pathname}${u.search}`, {
    method,
    headers: {
      host: u.host,
      ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    data: method === 'POST' ? 'a=1' : undefined,
    failOnStatusCode: false,
    maxRedirects: 0,
  })
}
const altSite = (slug: string) => (PATH ? `${altBase}/s/${slug}` : `http://${slug}.alt.localhost:${PORT}`)
/** The site's home page on the temporary address (path routing serves it without the trailing slash). */
const home = (slug: string) => (PATH ? site(slug) : `${site(slug)}/`)

// R20: a spa's website lives only on its own domain once that is active + primary: the temporary address
// ({slug}.{platform root} / /s/{slug}) 301s there; spas without one keep the temporary address.
test('R20: the temporary address redirects to the spa’s own domain once it is active and primary', async ({
  browser,
}) => {
  test.slow() // owner + super-admin, console activate/deactivate/rename, owner domain settings
  const ownerCtx = await browser.newContext()
  const adminCtx = await browser.newContext()
  const owner = await ownerCtx.newPage()
  const ops = await adminCtx.newPage()
  const { slug } = await signUpOwner(owner, { spa: 'Own Domain Spa' })
  const HOST = `www.${slug}.test`
  const own = (path: string) => `https://${HOST}${path}`
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  await signInPlatformAdmin(ops)

  const redirects = async (from: string, to: string, method: Method = 'GET') => {
    const res = await viaHost(ops, from, method)
    expect(res.status(), `${method} ${from}`).toBe(301)
    expect(res.headers().location, `${method} ${from}`).toBe(to)
    expect(res.headers()['cache-control'], from).toBe('private, max-age=300')
  }
  const served = async (url: string, status = 200) => {
    const res = await viaHost(ops, url)
    expect(res.headers().location, url).toBeUndefined()
    expect(res.status(), url).toBe(status)
    return res
  }
  /** Console → Domains: force-activate / deactivate (each clears the web app's caches). */
  const consoleOp = async (button: 'Activate' | 'Deactivate', done: string) => {
    await ops.goto(`${admin}/domains?q=${HOST}`)
    ops.once('dialog', (d) => d.accept())
    await ops.locator('tr', { hasText: HOST }).getByRole('button', { name: button }).click()
    await expect(ops.getByText(`${HOST} ${done}`)).toBeVisible()
  }

  await test.step('no own domain: the temporary address serves the site', async () => {
    await served(home(slug))
    await served(`${site(slug)}/book?src=qr`)
  })

  await test.step('a pending domain (even marked primary) never redirects', async () => {
    await db
      .insert(domains)
      .values({ tenantId: tenant!.id, hostname: HOST, kind: 'custom', status: 'pending', isPrimary: true })
    await served(home(slug))
    await served(`${site(slug)}/book?src=qr`)
    await served(`http://${HOST}/`, 404)
  })

  await test.step('activated by the worker’s check: the 301 starts only once the own domain serves', async () => {
    // As saveDomain on first activation, from another process (no web cache cleared); HOST's 404 above is cached.
    await db
      .update(domains)
      .set({ status: 'active', isPrimary: true, verifiedAt: new Date() })
      .where(eq(domains.hostname, HOST))
    let toA404 = false
    await expect
      .poll(
        async () => {
          if ((await viaHost(ops, home(slug))).status() !== 301) return false
          toA404 ||= (await viaHost(ops, `http://${HOST}/`)).status() !== 200
          return true
        },
        { timeout: 45_000 }, // the own-domain map refreshes every 30 s
      )
      .toBe(true)
    expect(toA404, 'a 301 to an own domain that still answered 404').toBe(false)
  })

  await test.step('active + primary → GET/HEAD 301 to the own domain, path + query kept', async () => {
    await redirects(home(slug), own('/'))
    await redirects(`${site(slug)}/book?src=qr&lang=ar`, own('/book?src=qr&lang=ar'))
    await redirects(`${site(slug)}/book`, own('/book'), 'HEAD')
    await redirects(`${site(slug)}/voucher/abc123`, own('/voucher/abc123'))
    await redirects(`${site(slug)}/sitemap.xml`, own('/sitemap.xml'))
    // Every platform domain (production: the old sslip.io address too).
    await redirects(`${altSite(slug)}/about?x=1`, own('/about?x=1'))
    if (!PATH) {
      // An address from the path-routing days goes straight to the own domain (one hop) …
      await redirects(`${base}/s/${slug}/book?src=qr`, own('/book?src=qr'))
      // … except the widget iframe, which keeps its host-routed home.
      await redirects(`${base}/s/${slug}/book/embed`, `${site(slug)}/book/embed`)
    }
    const res = await served(`http://${HOST}/`)
    expect(await res.text()).toContain('Own Domain Spa')
  })

  await test.step('kept on the temporary address: other methods, the widget iframe, robots.txt, API + static', async () => {
    const post = await viaHost(ops, `${site(slug)}/book`, 'POST')
    expect(post.headers().location).toBeUndefined()
    expect([301, 302, 307, 308]).not.toContain(post.status())
    await served(`${site(slug)}/book/embed?src=widget&lang=en`)
    await served(`${site(slug)}/robots.txt`)
    const root = PATH ? base : site(slug)
    await served(`${root}/api/health`)
    await served(`${root}/widget.js`)
  })

  await test.step('the own domain answers only the spa’s site: no platform surfaces', async () => {
    for (const path of [
      '/login',
      '/signup',
      '/dashboard',
      '/admin',
      '/platform',
      `/app/${slug}`,
      `/${slug}/calendar`,
      '/api/auth/get-session',
      '/api/mcp',
      '/api/integrations/google/callback',
      '/.well-known/oauth-authorization-server/api/auth',
    ])
      await served(`http://${HOST}${path}`, 404)
    // The platform itself still answers them.
    await served(`${base}/api/auth/get-session`)
    await served(`${base}/.well-known/oauth-authorization-server/api/auth`)
  })

  const next = uniqueSlug('own-renamed')
  await test.step('renamed spa: its previous temporary address reaches the own domain in one hop', async () => {
    await ops.goto(`${admin}/tenants/${tenant!.id}`)
    await ops.getByLabel('New address').fill(next)
    await ops
      .locator('form')
      .filter({ has: ops.getByLabel('New address') })
      .getByRole('button', { name: 'Rename' })
      .click()
    await expect(ops.getByText(`Address changed to ${next}`)).toBeVisible()
    await redirects(`${site(slug)}/book?src=qr`, own('/book?src=qr'))
    await redirects(home(next), own('/'))
    // The widget iframe under the old slug still lands on the current temporary address (F23), not the own domain.
    const embed = await viaHost(ops, `${site(slug)}/book/embed`)
    expect(embed.status()).toBe(301)
    expect(embed.headers().location).not.toContain(HOST)
  })

  await test.step('deactivated → served again at once; activated again → redirects', async () => {
    await consoleOp('Deactivate', 'deactivated')
    await served(home(next))
    await served(`http://${HOST}/`, 404)
    await consoleOp('Activate', 'activated')
    await redirects(home(next), own('/'))
  })

  await test.step('owner: free address primary → served; own domain primary → redirects; removed → served', async () => {
    await owner.goto(`${app}/${next}/settings/domains`)
    await owner.getByRole('button', { name: 'Make primary' }).click()
    await expect(owner.getByText('Your free address is primary again')).toBeVisible()
    await served(home(next))
    await owner.getByRole('button', { name: 'Make primary' }).click()
    await expect(owner.getByText('Primary address updated')).toBeVisible()
    await redirects(home(next), own('/'))
    const card = owner.locator('section', { has: owner.getByRole('heading', { name: HOST }) })
    owner.once('dialog', (d) => d.accept())
    await card.getByRole('button', { name: 'Remove' }).click()
    await expect(owner.getByText(`${HOST} removed`)).toBeVisible()
    await served(home(next))
    await served(`${site(next)}/book?src=qr`)
  })

  await ownerCtx.close()
  await adminCtx.close()
})

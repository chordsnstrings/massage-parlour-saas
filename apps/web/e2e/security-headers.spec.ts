import { expect, type Page, test } from '@playwright/test'
import { auditLog, bookings, cspViolations, platformSettings, sitePages } from '@spa/db'
import { ensureSite } from '@spa/services'
import { desc, eq, like } from 'drizzle-orm'
import {
  admin,
  app,
  base,
  editorUrl,
  makeStudio,
  PORT,
  seedCatalog,
  signInPlatformAdmin,
  signInStudioOnAdmin,
  signUpOwner,
  site,
  studioUrl,
  testDb,
} from './helpers'

// F10 (G11): nonce CSP + security headers on every surface; F9 owner request: Turnstile keys in the console.

const directives = (csp: string | undefined) =>
  Object.fromEntries(
    (csp ?? '').split(';').map((d) => {
      const [name, ...values] = d.trim().split(/\s+/)
      return [name!, values]
    }),
  )
const nonceOf = (csp: string | undefined) => /'nonce-([^']+)'/.exec(csp ?? '')?.[1]

/** Every CSP violation in the page and its frames: the DOM event (main document) and Chromium's console report. */
function watchCsp(page: Page) {
  const seen: string[] = []
  page.on('console', (m) => {
    if (/Content Security Policy/i.test(m.text())) seen.push(m.text().slice(0, 300))
  })
  return seen
}

/** Same-host request as the browser would send it (Node can't resolve *.localhost: ask 127.0.0.1 with the Host). */
const viaHost = (page: Page, url: string, extra: Record<string, string> = {}) => {
  const u = new URL(url)
  return page.request.get(`http://127.0.0.1:${PORT}${u.pathname}${u.search}`, {
    headers: { host: u.host, ...extra },
    failOnStatusCode: false,
    maxRedirects: 0,
  })
}

test('F10: every surface sends a nonce CSP and the standard headers; APIs and the widget get their own', async ({
  page,
}) => {
  const { slug } = await signUpOwner(page, { spa: 'Header Spa' })
  await seedCatalog(slug)

  const pages = {
    marketing: `${base}/`,
    app: `${app}/login`,
    admin: `${admin}/login`,
    site: `${site(slug)}/book`,
  }
  const nonces = new Set<string>()
  for (const [surface, url] of Object.entries(pages)) {
    const res = await viaHost(page, url)
    expect(res.status(), url).toBeLessThan(400)
    const h = res.headers()
    const csp = directives(h['content-security-policy'])
    expect(csp['script-src'], surface).toEqual(expect.arrayContaining(["'strict-dynamic'", "'self'"]))
    expect(csp['script-src']).not.toContain("'unsafe-inline'")
    expect(csp['object-src']).toEqual(["'none'"])
    expect(csp['base-uri']).toEqual(["'self'"])
    expect(csp['form-action']).toEqual(["'self'"])
    expect(csp['frame-ancestors']).toEqual(["'self'"])
    expect(csp['report-uri']).toEqual([`/api/csp-report?s=${surface}`])
    expect(h['x-frame-options']).toBe('SAMEORIGIN')
    expect(h['x-content-type-options']).toBe('nosniff')
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(h['permissions-policy']).toContain('camera=()')
    expect(h['cross-origin-opener-policy']).toBe(
      surface === 'app' ? 'same-origin-allow-popups' : 'same-origin',
    )
    expect(h['strict-transport-security']).toBeUndefined() // plain http here
    const nonce = nonceOf(h['content-security-policy'])!
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    // Next stamps the nonce on its own scripts; the HTML never carries a script without one.
    const html = await res.text()
    expect(html).toContain(`nonce="${nonce}"`)
    for (const tag of html.match(/<script\b[^>]*>/g) ?? [])
      if (!/type="application\/ld\+json"/.test(tag)) expect(tag, surface).toContain(`nonce="${nonce}"`)
    nonces.add(nonce)
  }
  expect(nonces.size).toBe(4) // fresh per response
  // Turnstile only where a Turnstile form exists.
  const adminCsp = directives((await viaHost(page, pages.admin)).headers()['content-security-policy'])
  expect(adminCsp['frame-src']).toEqual(["'self'"])
  const siteCsp = directives((await viaHost(page, pages.site)).headers()['content-security-policy'])
  // + the F15 Map / Video players.
  expect(siteCsp['frame-src']).toEqual([
    "'self'",
    'https://challenges.cloudflare.com',
    'https://www.google.com',
    'https://www.youtube-nocookie.com',
    'https://player.vimeo.com',
  ])
  // JSON-LD on the spa site carries the nonce too.
  const siteHome = await (await viaHost(page, `${site(slug)}/`)).text()
  for (const tag of siteHome.match(/<script type="application\/ld\+json"[^>]*>/g) ?? [])
    expect(tag).toMatch(/nonce="[^"]+"/)

  // The booking widget's iframe route: any site may frame it.
  const embed = (await viaHost(page, `${site(slug)}/book/embed`)).headers()
  expect(directives(embed['content-security-policy'])['frame-ancestors']).toEqual(['*'])
  expect(embed['x-frame-options']).toBeUndefined()

  // A spa's custom domain (unknown here → 404, still with the page headers).
  const custom = await page.request.get(`http://127.0.0.1:${PORT}/`, {
    headers: { host: 'www.csp-headers-test.ae', 'x-forwarded-proto': 'https' },
    failOnStatusCode: false,
  })
  expect(directives(custom.headers()['content-security-policy'])['report-uri']).toEqual([
    '/api/csp-report?s=domain',
  ])
  expect(custom.headers()['strict-transport-security']).toBe('max-age=31536000')
  expect(directives(custom.headers()['content-security-policy'])['upgrade-insecure-requests']).toEqual([])
  // Behind Caddy (https): HSTS, with includeSubDomains on platform hosts only.
  const httpsApp = await viaHost(page, pages.app, { 'x-forwarded-proto': 'https' })
  expect(httpsApp.headers()['strict-transport-security']).toBe('max-age=31536000; includeSubDomains')

  // API, OAuth discovery and MCP endpoints: nothing may load or frame them.
  for (const path of ['/api/health', '/.well-known/oauth-authorization-server', '/api/mcp']) {
    const res = await page.request.get(`${base}${path}`, { failOnStatusCode: false, maxRedirects: 0 })
    const h = res.headers()
    expect(h['content-security-policy'], path).toBe(
      "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    )
    expect(h['x-frame-options'], path).toBe('DENY')
    expect(h['x-content-type-options']).toBe('nosniff')
  }
  const httpsApi = await page.request.get(`${base}/api/health`, { headers: { 'x-forwarded-proto': 'https' } })
  expect(httpsApi.headers()['strict-transport-security']).toBe('max-age=31536000')
  // The HTML design shell keeps its own sandbox policy (one CSP header only).
  const shell = (await page.request.get(`${base}/api/html-design/frame`)).headers()
  expect(shell['content-security-policy']).toContain('sandbox allow-scripts')
  expect(shell['content-security-policy']).not.toContain("default-src 'none'")
})

test('F10: an injected script without the nonce never runs; the page itself still works', async ({
  page,
}) => {
  await page.route(`${base}/`, async (route) => {
    const res = await route.fetch()
    const headers = { ...res.headers() }
    delete headers['content-encoding']
    delete headers['content-length']
    const body = (await res.text())
      .replace(
        '</head>',
        `<script>window.__injected = 1</script><script nonce="guessed">window.__guessed = 1</script></head>`,
      )
      .replace(
        '</body>',
        `<img src="/icon.svg" onerror="window.__attr = 1" onload="window.__attr = 1"></body>`,
      )
    await route.fulfill({ status: res.status(), headers, body })
  })
  await page.addInitScript(() => {
    const w = window as unknown as { __violations: string[] }
    w.__violations = []
    document.addEventListener('securitypolicyviolation', (e) => {
      w.__violations.push(e.effectiveDirective)
    })
  })
  await page.goto(`${base}/`)
  // Next's own (nonced) runtime booted and our nonced inline bootstrap ran.
  await page.waitForFunction(() =>
    Boolean((window as unknown as { next?: { version?: string } }).next?.version),
  )
  expect(await page.evaluate(() => document.documentElement.classList.contains('scenes-on'))).toBe(true)
  const state = await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>
    return { injected: w.__injected, guessed: w.__guessed, attr: w.__attr }
  })
  expect(state).toEqual({ injected: undefined, guessed: undefined, attr: undefined })
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __violations: string[] }).__violations))
    .toEqual(expect.arrayContaining(['script-src-elem', 'script-src-attr']))
})

test('F10: no CSP violations on the main screens (marketing, Apply, spa site + booking, dashboard, console, editor)', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const seen = watchCsp(page)
  const { slug, email } = await signUpOwner(page, { spa: 'Clean Spa' })
  await makeStudio(slug)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db.transaction((tx) =>
    ensureSite(tx, seed.tenantId, {
      key: 'nordic',
      name: 'Nordic Clean',
      theme: {},
      pages: [
        {
          slug: '',
          title: { en: 'Home', ar: 'الرئيسية' },
          data: {
            root: { props: { title: { en: 'Home' }, description: { en: '' } } },
            content: [
              {
                type: 'Heading',
                props: {
                  id: 'h1',
                  eyebrow: { en: '' },
                  text: { en: 'Clean policy' },
                  level: 'h2',
                  size: 'lg',
                },
              },
            ],
          },
        },
        {
          // An uploaded HTML design (R17) inside the editor's canvas frame: the design shell runs it there too.
          slug: 'design',
          title: { en: 'Design' },
          data: {
            root: { props: { htmlDesign: true, title: { en: 'Design' }, description: { en: '' } } },
            content: [
              {
                type: 'HtmlDesign',
                props: {
                  id: 'design-1',
                  images: [],
                  html: '<!doctype html><html><head><style>h1{color:rgb(4, 5, 6)}</style></head><body><h1>Design of {{spa_name}}</h1><script>document.body.dataset.ran = "yes"</script></body></html>',
                },
              },
            ],
          },
        },
      ],
    }),
  )
  const pages = await db.select().from(sitePages).where(eq(sitePages.tenantId, seed.tenantId))
  const home = pages.find((p) => p.slug === '')
  const design = pages.find((p) => p.slug === 'design')

  await page.goto(`${base}/contact`)
  await expect(page.getByRole('button', { name: /send/i }).first()).toBeVisible()
  await page.goto(`${app}/${slug}`)
  await expect(page.getByRole('navigation').first()).toBeVisible()
  // R23: the Website Studio is in the console (admin host); its editor + preview may frame the Map / Video players.
  await signInStudioOnAdmin(page, email)
  const frameSrc = async (url: string) =>
    directives((await page.goto(url))!.headers()['content-security-policy'])['frame-src']
  expect(await frameSrc(studioUrl(slug, '/preview'))).toContain('https://www.youtube-nocookie.com')
  expect(await frameSrc(`${admin}/websites`)).toEqual(["'self'"])
  expect(await frameSrc(editorUrl(slug, home!.id))).toEqual(
    expect.arrayContaining(["'self'", 'https://www.google.com', 'https://player.vimeo.com']),
  )
  await expect(page.frameLocator('#preview-frame').first().getByText('Clean policy')).toBeVisible({
    timeout: 30_000,
  })
  await page.goto(editorUrl(slug, design!.id))
  const designDoc = page.frameLocator('#preview-frame').first().frameLocator('iframe.site-html-design')
  await expect(designDoc.getByRole('heading', { name: 'Design of Clean Spa' })).toHaveCSS(
    'color',
    'rgb(4, 5, 6)',
    {
      timeout: 30_000,
    },
  )
  await expect(designDoc.locator('body')).toHaveAttribute('data-ran', 'yes')
  await page.goto(`${site(slug)}/book`)
  await expect(page.getByRole('heading', { name: 'Book a treatment' })).toBeVisible()
  await page
    .getByRole('region', { name: 'Swedish massage' })
    .getByRole('button', { name: /60 min/ })
    .click()
  await page.getByRole('button', { name: /^Tomorrow/ }).click()
  await page.getByTestId('slots').getByRole('button').first().click()
  await expect(page.getByRole('heading', { name: 'Your details' })).toBeVisible()
  // The details step loads Turnstile through strict-dynamic (its script + challenge frame are allowed).
  await expect.poll(() => page.evaluate(() => 'turnstile' in window), { timeout: 20_000 }).toBe(true)
  await page.goto(`${site(slug)}/book/embed`)
  await expect(page.getByRole('heading', { name: 'Book a treatment' })).toBeVisible()
  await page.context().clearCookies()
  await page.goto(`${app}/signup`)
  await expect(page.getByRole('button', { name: /apply|send/i }).first()).toBeVisible()
  await signInPlatformAdmin(page)
  await page.goto(`${admin}/settings`)
  await expect(page.getByTestId('turnstile-settings')).toBeVisible()
  await page.waitForTimeout(500)
  expect(seen).toEqual([])
})

test('F10: CSP reports are counted and shown in the console; F9: Turnstile keys from the console win over env', async ({
  page,
}) => {
  test.setTimeout(180_000)
  // The spa first: its Apply form would be refused once the always-fail secret below is saved.
  const { slug } = await signUpOwner(page)
  const seed = await seedCatalog(slug)
  // A browser-style violation report (CSP2 format) → 204, counted per surface/directive/origin; junk is ignored.
  const report = await page.request.post(`${base}/api/csp-report?s=admin`, {
    headers: { 'content-type': 'application/csp-report' },
    data: JSON.stringify({
      'csp-report': {
        'document-uri': 'http://admin.localhost/settings?token=secret',
        'effective-directive': 'script-src-elem',
        'blocked-uri': 'https://evil.csp-e2e.test/x.js',
      },
    }),
  })
  expect(report.status()).toBe(204)
  expect(
    (
      await page.request.post(`${base}/api/csp-report`, {
        data: 'not json',
        headers: { 'content-type': 'text/plain' },
      })
    ).status(),
  ).toBe(400)
  const db = testDb()
  const [row] = await db
    .select()
    .from(cspViolations)
    .where(eq(cspViolations.blocked, 'https://evil.csp-e2e.test'))
  expect(row).toMatchObject({ surface: 'admin', directive: 'script-src-elem', lastPath: '/settings' })

  await signInPlatformAdmin(page)
  const cspRow = page.getByTestId('health-csp')
  await expect(cspRow).toHaveAttribute('data-ok', 'false')
  await expect(cspRow).toContainText('script-src-elem https://evil.csp-e2e.test (admin /settings)')
  // Env test keys (playwright.config) → from env.
  await expect(page.getByTestId('config-TURNSTILE')).toContainText('from env')

  // Console keys: Cloudflare's invisible always-pass site key + the always-fail secret → bookings are refused.
  const SITE_KEY = '1x00000000000000000000BB'
  const SECRET = '2x0000000000000000000000000000000AA'
  await page.goto(`${admin}/settings`)
  const card = page.getByTestId('turnstile-settings')
  await expect(card).toContainText('from env')
  await card.getByLabel('Site key').fill('nope')
  await card.getByRole('button', { name: 'Save bot check' }).click()
  await expect(card.getByText('A Turnstile site key looks like 0x4AAAA…')).toBeVisible()
  await card.getByLabel('Site key').fill(SITE_KEY)
  await card.getByLabel('Secret key').fill(SECRET)
  await card.getByRole('button', { name: 'Save bot check' }).click()
  await expect(page.getByText('Bot check settings saved')).toBeVisible()
  await page.reload()
  await expect(card).toContainText('Set ✓ (…00AA)')
  await expect(card).toContainText('from console')
  await expect(card.getByLabel('Secret key')).toHaveValue('')
  await expect(card.getByLabel('Site key')).toHaveValue(SITE_KEY)
  expect(await page.content()).not.toContain(SECRET)
  const [settings] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1))
  expect(settings?.turnstileSecretEnc).not.toContain(SECRET)
  const [audit] = await db
    .select()
    .from(auditLog)
    .where(like(auditLog.action, 'platform.turnstile.updated'))
    .orderBy(desc(auditLog.createdAt))
    .limit(1)
  expect(JSON.stringify(audit?.data)).not.toContain(SECRET)
  expect(audit?.data).toMatchObject({ secretKey: 'replaced', siteKey: SITE_KEY })
  await page.goto(`${admin}/`)
  await expect(page.getByTestId('config-TURNSTILE')).toContainText('from console')

  try {
    await page.goto(`${site(slug)}/book`)
    expect(await page.content()).toContain(SITE_KEY) // the console site key is the one sent to visitors
    await page
      .getByRole('region', { name: 'Swedish massage' })
      .getByRole('button', { name: /60 min/ })
      .click()
    await page.getByRole('button', { name: /^Tomorrow/ }).click()
    await page.getByTestId('slots').getByRole('button').first().click()
    await page.getByLabel('Your name').fill('Console Key')
    await page.getByLabel('UAE mobile').fill('050 777 6655')
    await page.getByRole('button', { name: 'Request booking' }).click()
    await expect(page.getByText("We couldn't confirm you're not a robot").first()).toBeVisible({
      timeout: 30_000,
    })
    expect(await db.select().from(bookings).where(eq(bookings.tenantId, seed.tenantId))).toHaveLength(0)
  } finally {
    // Back to the env keys for every later spec.
    await signInPlatformAdmin(page)
    await page.goto(`${admin}/settings`)
    await card.getByLabel('Remove the stored keys').check()
    await card.getByRole('button', { name: 'Save bot check' }).click()
    await expect(page.getByText('Bot check settings saved')).toBeVisible()
    await page.reload()
    await expect(card).toContainText('from env')
  }
})

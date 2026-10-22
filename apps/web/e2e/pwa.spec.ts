import { mkdir, writeFile } from 'node:fs/promises'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { type APIRequestContext, type Browser, expect, type Page, request, test } from '@playwright/test'
import { storedFiles, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import {
  admin,
  app,
  applyForSpa,
  approveApplication,
  base,
  enableTotp,
  PATH,
  PORT,
  testDb,
  uniqueSlug,
} from './helpers'

// Installable spa dashboard (docs/PLAN.md §18.6): per-spa manifest + icons (cookie-free), <head> wiring, the service
// worker controlling every dashboard, offline page, "Install app" in the user menu, the owner tip and iOS steps.
const SCREENS = 'test-results/screens'
const LIME = { r: 217, g: 242, b: 106 }

// A wide logo (not square) with a transparent margin, so trimming + centring are exercised.
const wideLogo = async () => ({
  name: 'logo.png',
  mimeType: 'image/png',
  buffer: await sharp({
    create: { width: 900, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: await sharp({ create: { width: 700, height: 240, channels: 4, background: '#0f3d3e' } })
          .png()
          .toBuffer(),
        gravity: 'centre',
      },
    ])
    .png()
    .toBuffer(),
})

async function newSpa(browser: Browser, spa: string, withLogo: boolean) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const slug = uniqueSlug('pwa')
  const email = `owner-${slug}@e2e.test`
  await applyForSpa(page, { slug, email, spa, ...(withLogo ? { logo: await wideLogo() } : {}) })
  await approveApplication(email)
  await enableTotp(email)
  await page.goto(`${app}/${slug}`)
  await page.waitForURL(`${app}/${slug}`)
  return { slug, page, context, dashboard: `${app}/${slug}` }
}

/** Cookie-free GET (like a browser fetching a manifest); Node can't resolve *.localhost, so dial 127.0.0.1 + Host. */
function get(api: APIRequestContext, url: string, headers: Record<string, string> = {}) {
  const u = new URL(url)
  const host = u.host
  u.hostname = '127.0.0.1'
  return api.get(u.href, { headers: { ...headers, host }, failOnStatusCode: false })
}

const dashPath = (slug: string) => `${PATH ? '/app' : ''}/${slug}`

type Manifest = {
  id: string
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  theme_color: string
  background_color: string
  icons: { src: string; sizes: string; type: string; purpose: string }[]
}

async function manifestOf(api: APIRequestContext, slug: string) {
  const res = await get(api, `${app}/${slug}/app.webmanifest`)
  expect(res.status()).toBe(200)
  expect(res.headers()['content-type']).toContain('application/manifest+json')
  return (await res.json()) as Manifest
}

/** Decoded corner + centre pixels of a PNG. */
async function pixels(body: Buffer) {
  const { data, info } = await sharp(body).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const px = (x: number, y: number) => {
    const i = (y * info.width + x) * 4
    return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! }
  }
  return { corner: px(0, 0), centre: px(info.width >> 1, info.height >> 1) }
}

/** Fetches an icon without cookies; checks type, size and caching; returns the decoded pixels' corner + centre. */
async function icon(api: APIRequestContext, src: string, size: number, save?: string) {
  const url = new URL(src, `${app}/`).href
  const res = await get(api, url)
  expect(res.status(), url).toBe(200)
  expect(res.headers()['content-type']).toBe('image/png')
  expect(res.headers()['cache-control']).toContain('immutable')
  const body = await res.body()
  const meta = await sharp(body).metadata()
  expect([meta.format, meta.width, meta.height]).toEqual(['png', size, size])
  if (save) await writeFile(`${SCREENS}/${save}.png`, body)
  return { ...(await pixels(body)), etag: res.headers().etag!, url }
}

/**
 * A pass-through proxy on its own port that counts page loads (document requests) per path, so the test sees exactly
 * what reaches the server: a navigation the worker leaves alone would arrive twice (navigation preload + the browser's
 * own request). Cookies are per host, not port, so the signed-in session carries over.
 */
async function countingProxy() {
  const loads = new Map<string, number>()
  const server = http.createServer((req, res) => {
    const path = (req.url ?? '/').split('?')[0]!
    if (req.headers['sec-fetch-dest'] === 'document') loads.set(path, (loads.get(path) ?? 0) + 1)
    const host = (req.headers.host ?? '').replace(/:\d+$/, `:${PORT}`)
    const up = http.request(
      { host: '127.0.0.1', port: PORT, method: req.method, path: req.url, headers: { ...req.headers, host } },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers)
        r.pipe(res)
      },
    )
    up.on('error', () => res.destroy())
    req.pipe(up)
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const port = (server.address() as AddressInfo).port
  return {
    loads,
    via: (url: string) => Object.assign(new URL(url), { port: String(port) }).href,
    close: () => {
      server.closeAllConnections()
      return new Promise((resolve) => server.close(resolve))
    },
  }
}

type WindowFor = (
  windows: { url: string }[],
  href: string,
) => { client: { url: string }; exact: boolean } | null

const near = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) =>
  Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 12

const headLinks = (page: Page) =>
  page.evaluate(() => ({
    manifest: document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null,
    apple: document.querySelector('link[rel="apple-touch-icon"]')?.getAttribute('href') ?? null,
    theme: document.querySelector('meta[name="theme-color"]')?.getAttribute('content') ?? null,
    title: document.querySelector('meta[name="apple-mobile-web-app-title"]')?.getAttribute('content') ?? null,
    capable:
      document.querySelector('meta[name="apple-mobile-web-app-capable"]')?.getAttribute('content') ?? null,
  }))

/** What Chrome's own install flow sees for this page (manifest parse + installability), like Lighthouse. */
async function installability(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const manifest = (await cdp.send('Page.getAppManifest')) as { url: string; errors: { message: string }[] }
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: { errorId: string }[]
  }
  await cdp.detach()
  return { manifest, errors: installabilityErrors.map((e) => e.errorId) }
}

/** Chrome fires this when it would offer installation; the test can't wait for the real one (headless). */
const fakeInstallPrompt = (page: Page) =>
  page.evaluate(() => {
    const e = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>
    e.prompt = async () => {
      ;(window as unknown as { __prompted: boolean }).__prompted = true
    }
    e.userChoice = Promise.resolve({ outcome: 'dismissed' })
    window.dispatchEvent(e)
  })

test('installable spa dashboard: manifest, icons, worker, install entry', async ({ browser }) => {
  await mkdir(SCREENS, { recursive: true })
  const api = await request.newContext() // no cookies, like a browser fetching a manifest
  const tamara = await newSpa(browser, 'Tamara Spa & Wellness', true)
  const lotus = await newSpa(browser, 'Lotus Garden Spa', false)
  const { page } = tamara

  let tamaraIcons: { src: string }[] = []
  await test.step('per-spa manifest: name rule, scope, start_url, icons', async () => {
    const m = await manifestOf(api, tamara.slug)
    const home = dashPath(tamara.slug)
    expect(m).toMatchObject({
      id: home,
      name: 'Tamara Management',
      short_name: 'Tamara Management',
      start_url: home,
      scope: home,
      display: 'standalone',
      theme_color: '#0f6b4b',
      background_color: '#f6f6f9',
    })
    expect(m.icons.map((i) => [i.sizes, i.type, i.purpose])).toEqual([
      ['192x192', 'image/png', 'any'],
      ['512x512', 'image/png', 'any'],
      ['512x512', 'image/png', 'maskable'],
    ])
    for (const i of m.icons) expect(i.src.startsWith(`${home}/app-icon/`)).toBe(true)
    tamaraIcons = m.icons

    const other = await manifestOf(api, lotus.slug)
    expect(other.name).toBe('Lotus Management')
    expect(other.scope).toBe(dashPath(lotus.slug))
    expect(other.icons[0]!.src).not.toBe(m.icons[0]!.src)

    expect((await get(api, `${app}/no-such-spa-${Date.now()}/app.webmanifest`)).status()).toBe(404)
  })

  await test.step('icons: logo on white (any = rounded, maskable = full bleed), initials on lime', async () => {
    const [any192, any512, maskable] = tamaraIcons
    const small = await icon(api, any192!.src, 192, 'pwa-icon-logo-192')
    expect(small.corner.a).toBe(0) // rounded tile: transparent corners
    expect(near(small.centre, { r: 0x0f, g: 0x3d, b: 0x3e })).toBe(true) // the logo's mark in the middle
    await icon(api, any512!.src, 512, 'pwa-icon-logo-512')
    const mask = await icon(api, maskable!.src, 512, 'pwa-icon-logo-maskable')
    expect(mask.corner).toMatchObject({ r: 255, g: 255, b: 255, a: 255 })
    // Cheap revalidation and no unknown variants.
    expect((await get(api, mask.url, { 'if-none-match': mask.etag })).status()).toBe(304)
    expect((await get(api, mask.url.replace(/maskable-512$/, '1024'))).status()).toBe(404)

    const lotusManifest = await manifestOf(api, lotus.slug)
    const initials = await icon(api, lotusManifest.icons[2]!.src, 512, 'pwa-icon-initials-maskable')
    expect(near(initials.corner, LIME)).toBe(true)
    expect(near(initials.centre, LIME)).toBe(false) // ink of "LG" crosses the middle
    await icon(api, lotusManifest.icons[1]!.src, 512, 'pwa-icon-initials-512')
  })

  await test.step('dashboard <head>: spa manifest, apple icon + title, theme colour', async () => {
    const head = await headLinks(page)
    expect(head).toMatchObject({
      manifest: `${dashPath(tamara.slug)}/app.webmanifest`,
      theme: '#0f6b4b',
      title: 'Tamara Management',
      capable: 'yes',
    })
    const apple = await icon(api, head.apple!, 180, 'pwa-icon-logo-apple')
    expect(apple.corner).toMatchObject({ r: 255, g: 255, b: 255, a: 255 })
  })

  await test.step('console and marketing keep the platform manifest', async () => {
    const other = await browser.newPage()
    for (const url of [`${base}/`, `${admin}/login`]) {
      await other.goto(url)
      const head = await headLinks(other)
      expect(head.manifest, url).toBe('/manifest.webmanifest')
      expect(head.apple, url).toBeNull()
    }
    await other.close()
  })

  await test.step('service worker controls the dashboard; Chrome finds it installable', async () => {
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 20_000 })
    const sw = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration('/')
      return { scope: reg?.scope, script: navigator.serviceWorker.controller?.scriptURL }
    })
    expect(new URL(sw.scope!).pathname).toBe('/')
    expect(new URL(sw.script!).pathname).toBe('/sw.js')
    await page.reload()
    const { manifest, errors } = await installability(page)
    expect(manifest.url).toContain(`${dashPath(tamara.slug)}/app.webmanifest`)
    expect(manifest.errors).toEqual([])
    // Playwright contexts are off-the-record profiles, which Chrome never installs from; nothing else may be missing.
    expect(errors.filter((e) => e !== 'in-incognito')).toEqual([])
  })

  await test.step('worker: every page load reaches the server once; pushes open in their own spa', async () => {
    const proxy = await countingProxy()
    // Own context (session cookies only), so nothing of the proxy's origin outlives the proxy.
    const cookies = (await tamara.context.storageState()).cookies
    const viaProxy = await browser.newContext({ storageState: { cookies, origins: [] } })
    const other = await viaProxy.newPage()
    await other.goto(proxy.via(tamara.dashboard))
    // The dashboard's own registration (lib/sw.ts); done here because behind this plain proxy (no websocket upgrade)
    // the dev server's page doesn't hydrate.
    await other.evaluate(
      (url) => navigator.serviceWorker.register(url, { scope: '/' }),
      `/sw.js${PATH ? '?base=%2Fapp' : ''}`,
    )
    await other.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 20_000 })
    proxy.loads.clear()
    // Path routing: marketing and an API GET (like the OAuth callbacks) are outside the dashboards but in the worker's
    // scope; host routing has nothing outside them on the app host.
    const pages = [
      `${tamara.dashboard}/clients`,
      ...(PATH ? [`${base}/`, `${base}/api/health`] : [`${app}/api/health`]),
    ]
    for (const url of pages) await other.goto(proxy.via(url))
    await other.goto(proxy.via(tamara.dashboard))
    const once = Object.fromEntries(pages.map((url) => [new URL(url).pathname, 1]))
    expect(Object.fromEntries([...proxy.loads].filter(([path]) => path in once))).toEqual(once)
    await viaProxy.close()
    await proxy.close()

    // Notification clicks reuse a window of the same spa only: each spa is its own installed app.
    const origin = new URL(app).origin
    const sw = tamara.context.serviceWorkers().find((w) => new URL(w.url()).origin === origin)!
    const pick = (windows: string[], href: string) =>
      sw.evaluate(
        ({ windows, href }) => {
          const found = (globalThis as unknown as { windowFor: WindowFor }).windowFor(
            windows.map((url) => ({ url })),
            href,
          )
          return found && { url: found.client.url, exact: found.exact }
        },
        { windows, href },
      )
    const tam = `${origin}${dashPath(tamara.slug)}`
    const lot = `${origin}${dashPath(lotus.slug)}`
    expect(await pick([`${tam}/clients`, `${origin}/`], `${lot}/billing`)).toBeNull()
    expect(await pick([`${tam}/clients`, lot], `${lot}/billing`)).toEqual({ url: lot, exact: false })
    expect(await pick([`${tam}/clients`, `${lot}/billing`], `${lot}/billing`)).toEqual({
      url: `${lot}/billing`,
      exact: true,
    })
    expect(await pick([`${tam}x/clients`], `${tam}/calendar`)).toBeNull() // a longer slug is another spa
  })

  await test.step('offline: page loads fall back to the offline page', async () => {
    await tamara.context.setOffline(true)
    await page.goto(`${tamara.dashboard}/clients`).catch(() => {})
    await expect(page.getByRole('heading', { name: 'You’re offline' })).toBeVisible()
    await expect(page.getByText('Reconnect to continue.')).toBeVisible()
    await page.screenshot({ path: `${SCREENS}/pwa-offline.png` })
    if (PATH) {
      // Outside the dashboards (marketing, console, sites) the worker never shows the dashboard's offline page.
      await expect(page.goto(`${base}/`)).rejects.toThrow()
      await expect(page.getByRole('heading', { name: 'You’re offline' })).toHaveCount(0)
    }
    await tamara.context.setOffline(false)
    await page.goto(tamara.dashboard)
    await expect(page.getByRole('button', { name: /^Profile menu for/ })).toBeVisible()
  })

  await test.step('user menu + owner tip: Chrome install prompt, dismiss is remembered', async () => {
    const profile = page.getByRole('button', { name: /^Profile menu for/ })
    await profile.click()
    await expect(page.getByRole('menuitem', { name: 'Install app' })).toHaveCount(0) // no prompt offered yet
    await page.keyboard.press('Escape')

    await fakeInstallPrompt(page)
    const tip = page.getByRole('region', { name: 'Install Tamara Management' })
    await expect(tip).toBeVisible()
    await page.screenshot({ path: `${SCREENS}/pwa-tip.png` })
    await profile.click()
    await page.getByRole('menuitem', { name: 'Install app' }).click()
    expect(await page.evaluate(() => (window as unknown as { __prompted?: boolean }).__prompted)).toBe(true)

    await fakeInstallPrompt(page)
    await tip.getByRole('button', { name: 'Not now' }).first().click()
    await expect(tip).toHaveCount(0)
    await page.reload()
    await fakeInstallPrompt(page)
    await profile.click()
    await expect(page.getByRole('menuitem', { name: 'Install app' })).toBeVisible() // menu entry stays
    await page.keyboard.press('Escape')
    await expect(page.getByRole('region', { name: 'Install Tamara Management' })).toHaveCount(0)
  })

  await test.step('iOS: Share → Add to Home Screen steps with the app name', async () => {
    const ios = await browser.newContext({
      // Session cookies only: the desktop browser's "Not now" (localStorage) shouldn't follow to the phone.
      storageState: { cookies: (await tamara.context.storageState()).cookies, origins: [] },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    })
    const phone = await ios.newPage()
    await phone.goto(tamara.dashboard)
    const tip = phone.getByRole('region', { name: 'Install Tamara Management' })
    await tip.getByRole('button', { name: 'Show me how' }).click()
    const sheet = phone.getByRole('dialog', { name: 'Install Tamara Management' })
    await expect(sheet).toContainText('Tap the Share button in the browser toolbar.')
    await expect(sheet).toContainText('Scroll down and tap “Add to Home Screen”.')
    await expect(sheet).toContainText('Tamara Management appears on your Home Screen.')
    await phone.screenshot({ path: `${SCREENS}/pwa-ios-steps.png` })
    await sheet.getByRole('button', { name: 'Got it' }).click()
    await expect(sheet).toHaveCount(0)
    await ios.close()
  })

  await test.step('unreadable logo: initials stand in uncached; the real icon follows once storage is back', async () => {
    const db = testDb()
    const [lotusRow] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, lotus.slug))
    const { buffer } = await wideLogo()
    // An S3 object this environment can't reach, like a storage outage.
    const [file] = await db
      .insert(storedFiles)
      .values({
        tenantId: lotusRow!.id,
        storage: 's3',
        objectKey: 'e2e/unreachable.png',
        bytes: buffer,
        contentType: 'image/png',
        size: buffer.length,
        purpose: 'logo',
      })
      .returning({ id: storedFiles.id })
    await db.update(tenants).set({ logoFileId: file!.id }).where(eq(tenants.id, lotusRow!.id))
    // A key the server doesn't know yet makes it read the spa again, so the new logo counts at once.
    const icons = `${app}/${lotus.slug}/app-icon/${'n'.repeat(16)}`
    const broken = await get(api, `${icons}/maskable-512`)
    expect(broken.status()).toBe(200)
    expect(broken.headers()['cache-control']).toBe('no-store')
    expect(broken.headers().etag).toBeUndefined()
    expect(near((await pixels(await broken.body())).corner, LIME)).toBe(true)

    await db.update(storedFiles).set({ storage: 'db', objectKey: null }).where(eq(storedFiles.id, file!.id))
    const healed = await get(api, `${icons}/512`)
    expect(healed.headers()['cache-control']).toBe('public, max-age=300') // made-up key: today's icon, briefly
    expect(healed.headers().etag).toBeTruthy()
    expect(near((await pixels(await healed.body())).centre, { r: 0x0f, g: 0x3d, b: 0x3e })).toBe(true)

    // Made-up keys re-read the spa at most every few seconds: a change right now isn't seen yet (still the logo).
    await db.update(tenants).set({ logoFileId: null }).where(eq(tenants.id, lotusRow!.id))
    const again = await get(api, `${icons}/192`)
    expect(near((await pixels(await again.body())).centre, { r: 0x0f, g: 0x3d, b: 0x3e })).toBe(true)
  })

  await api.dispose()
  await tamara.context.close()
  await lotus.context.close()
})

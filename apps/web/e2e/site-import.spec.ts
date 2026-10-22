import http from 'node:http'
import { expect, test } from '@playwright/test'
import { auditLog, mediaAssets, pageVersions, sitePages, tenants } from '@spa/db'
import { ensureSite } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { makeStudio, PNG, PORT, signInStudioOnAdmin, signUpOwner, site, studioUrl, testDb } from './helpers'

// The spa's "existing website": a local fixture server on E2E_PORT + 1 (playwright.config.ts exempts exactly this
// host:port from the SSRF rules via SITE_IMPORT_E2E_ALLOW).
const FIXTURE_PORT = PORT + 1
const fixtureUrl = `http://127.0.0.1:${FIXTURE_PORT}/`
const HOME = `<!doctype html><html lang="en"><head>
<title>Lotus Garden Spa | Massage in JLT</title>
<meta name="description" content="Thai and Balinese massage in Jumeirah Lake Towers, open daily.">
<meta property="og:image" content="/img/hero.png">
</head><body>
<nav><a href="/treatments">Treatments &amp; prices</a> <a href="/private/menu">Staff menu</a></nav>
<h1>Unwind at Lotus Garden</h1>
<p>Traditional Thai and Balinese therapies by certified therapists in a calm garden setting.</p>
<h2>About our spa</h2>
<p>Since 2012 we have welcomed guests from across Dubai for unhurried, expert massage in private rooms.</p>
<img src="/img/room.png" alt="Treatment room"><img src="/img/garden.png" alt="Garden">
<footer><p>Saturday – Thursday: 10am – 11pm</p><p>Call 04 123 4567</p></footer>
</body></html>`
const TREATMENTS = `<!doctype html><html><body><h2>Treatments</h2><table>
<tr><td>Thai massage</td><td>60 min</td><td>AED 250</td></tr>
<tr><td>Balinese massage</td><td>90 min</td><td>AED 380</td></tr></table></body></html>`

let server: http.Server
test.beforeAll(async () => {
  server = http.createServer((req, res) => {
    const send = (type: string, body: string | Buffer) => {
      res.writeHead(200, { 'content-type': type })
      res.end(body)
    }
    if (req.url === '/robots.txt') send('text/plain', 'User-agent: *\nDisallow: /private\n')
    else if (req.url === '/') send('text/html; charset=utf-8', HOME)
    else if (req.url === '/treatments') send('text/html; charset=utf-8', TREATMENTS)
    else if (req.url?.startsWith('/img/')) send('image/png', PNG)
    else {
      res.writeHead(404)
      res.end()
    }
  })
  await new Promise<void>((r) => server.listen(FIXTURE_PORT, '127.0.0.1', r))
})
test.afterAll(async () => {
  await new Promise((r) => server.close(r))
})

// F32: Studio "Import from existing website" — SSRF-guarded fetch, preview (dry run), apply = a DRAFT page with the
// photos in the media library; never published.
test('website studio: import an existing website as a draft page (preview → apply), never published', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const { slug, email } = await signUpOwner(page, { spa: 'Lotus Import Spa' })
  await makeStudio(slug)
  await signInStudioOnAdmin(page, email)
  const db = testDb()
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug))
  await db.transaction((tx) =>
    ensureSite(tx, tenant!.id, {
      key: 'nordic',
      name: 'Nordic Clean',
      theme: {},
      pages: [{ slug: '', title: { en: 'Home' }, data: { root: { props: {} }, content: [] } }],
    }),
  )
  await page.goto(studioUrl(slug))
  await page.getByRole('button', { name: 'Import from website' }).click()
  const sheet = page.getByRole('dialog')
  const address = sheet.getByLabel('Current website address')
  const fetchIt = sheet.getByRole('button', { name: 'Fetch and preview' })

  await test.step('SSRF guard: private / internal addresses are refused', async () => {
    await address.fill('http://169.254.169.254/latest/meta-data/')
    await fetchIt.click()
    await expect(page.getByText(/points to a private network/).first()).toBeVisible()
    // The app itself (another local port) is not reachable either.
    await address.fill(`http://localhost:${PORT}/`)
    await fetchIt.click()
    await expect(page.getByText(/non-standard port/).first()).toBeVisible()
  })

  await test.step('preview: what was found and the draft page it builds (nothing stored yet)', async () => {
    await address.fill(fixtureUrl)
    await fetchIt.click()
    const found = sheet.getByRole('region', { name: 'Found on the site' })
    await expect(found).toContainText('Unwind at Lotus Garden', { timeout: 30_000 })
    await expect(found).toContainText('Thai massage · 60 min · AED 250')
    await expect(found).toContainText('Saturday – Thursday: 10am – 11pm')
    await expect(found).toContainText('Treatment room')
    await expect(sheet.getByText(/2 pages read/)).toBeVisible()
    // robots.txt: the disallowed link was not read.
    await expect(sheet.getByText(/Skipped: menu \(robots\.txt\)/)).toBeVisible()
    await expect(sheet.getByRole('region', { name: 'The new draft page' })).toContainText(
      'Added the page "Imported site" (/imported) as a draft',
    )
    expect(await db.select().from(sitePages).where(eq(sitePages.slug, 'imported'))).toHaveLength(0)
  })

  await test.step('apply: draft page created with the photos in the media library, opened in the editor', async () => {
    await sheet.getByRole('button', { name: 'Create draft page' }).click()
    await page.waitForURL(/\/websites\/[^/]+\/editor\//, { timeout: 30_000 })
    const canvas = page.frameLocator('#preview-frame').first()
    await expect(canvas.getByRole('heading', { name: 'Unwind at Lotus Garden' })).toBeVisible({
      timeout: 30_000,
    })
    const [imported] = await db
      .select()
      .from(sitePages)
      .where(and(eq(sitePages.tenantId, tenant!.id), eq(sitePages.slug, 'imported')))
    expect(imported).toBeTruthy()
    const versions = await db.select().from(pageVersions).where(eq(pageVersions.pageId, imported!.id))
    expect(versions.map((v) => v.status)).toEqual(['draft'])
    const data = JSON.stringify(versions[0]!.data)
    expect(data).toContain('Balinese massage · 90 min · AED 380')
    expect(data).toMatch(/\/files\/[0-9a-f-]{36}/)
    expect(data).not.toContain('import-image-')
    const media = await db.select().from(mediaAssets).where(eq(mediaAssets.tenantId, tenant!.id))
    expect(media).toHaveLength(3)
    expect(media.every((m) => m.tags.includes('import'))).toBe(true)
    const [row] = await db
      .select({ data: auditLog.data })
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, tenant!.id), eq(auditLog.action, 'site.page.imported')))
    expect(row?.data).toMatchObject({ host: '127.0.0.1', slug: 'imported', images: 3 })
  })

  await test.step('not published: the public site has no /imported page', async () => {
    const res = await page.goto(`${site(slug)}/imported`)
    expect(res?.status()).toBe(404)
  })
})

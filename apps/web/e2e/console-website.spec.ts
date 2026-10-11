import { expect, type Page, test } from '@playwright/test'
import { sitePages, sites, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import {
  admin,
  app,
  editorUrl,
  makeStudio,
  OWNER_PASSWORD,
  PATH,
  passTwoFactor,
  seedCatalog,
  signInPlatformAdmin,
  signUpOwner,
  site,
  studioUrl,
  testDb,
} from './helpers'

// R23 (owner, 2026-10-10): the Website Studio lives in the platform console. The super-admin builds and publishes
// every spa's site there (no spa review step); the spa edits services + prices and sends change requests.

/** Password + 2FA sign-in on the console host (sessions are host-only; path routing shares one session). */
async function signInOnAdmin(page: Page, email: string) {
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(OWNER_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL(/\/two-factor/)
  await passTwoFactor(page, email)
  await page.waitForURL((u) => !u.pathname.includes('two-factor'))
}

const noSideScroll = (page: Page) =>
  expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360)

test('console Websites: status + next step, full-screen editor, publish without review, change requests', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const { slug } = await signUpOwner(page, { spa: 'Linden Spa' })
  await seedCatalog(slug)
  const studio = await (await browser.newContext()).newPage()
  await signInPlatformAdmin(studio)
  const row = () => studio.getByRole('row', { name: new RegExp(`/${slug}\\b`) })
  const list = async () => {
    await studio.goto(`${admin}/websites`)
    await expect(row()).toBeVisible()
  }

  await test.step('Not started → "Choose template" → the spa website page; a template pick = Template chosen', async () => {
    await list()
    await expect(row().getByText('Not started')).toBeVisible()
    await row().getByRole('link', { name: 'Choose template for Linden Spa' }).click()
    await studio.waitForURL(`${studioUrl(slug)}#templates`)
    await expect(studio.getByRole('heading', { name: 'Linden Spa' })).toBeVisible()
    await expect(studio.getByTestId('website-status')).toContainText('Pick a template below.')
    await studio.getByRole('button', { name: 'Use Nordic Clean' }).click()
    await expect(studio.getByTestId('current-template')).toHaveText('Nordic Clean', { timeout: 30_000 })
    await list()
    await expect(row().getByText('Template chosen')).toBeVisible()
  })

  await test.step('"Continue editing" opens the editor full screen; "Back to console" returns to the spa page', async () => {
    await row().getByRole('link', { name: 'Continue editing for Linden Spa' }).click()
    await studio.waitForURL(/\/websites\/[^/]+\/editor\/[0-9a-f-]{36}$/)
    await expect(studio.frameLocator('#preview-frame').first().getByRole('heading').first()).toBeVisible({
      timeout: 30_000,
    })
    // No console shell around the editor.
    await expect(studio.getByRole('link', { name: /^Applications/ })).toHaveCount(0)
    await expect(studio.getByRole('link', { name: /^Websites/ })).toHaveCount(0)
    await studio.getByRole('link', { name: 'Back to console' }).click()
    await studio.waitForURL(studioUrl(slug))
    await expect(studio.getByTestId('website-status')).toBeVisible()
  })

  await test.step('a page written by the studio = Draft → "Publish" opens the publish sheet; no review step', async () => {
    await studio.getByRole('button', { name: 'Add page' }).click()
    const dialog = studio.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Ramadan offers/ }).check()
    await dialog.getByRole('button', { name: 'Add page' }).click()
    await expect(studio.getByText('Ramadan offers added as a draft')).toBeVisible({ timeout: 30_000 })
    for (const text of ['Send for review', 'Approve', 'Ready for review'])
      await expect(studio.getByText(text)).toHaveCount(0)
    await list()
    await expect(row().getByText('Draft', { exact: true })).toBeVisible()
    await row().getByRole('link', { name: 'Publish for Linden Spa' }).click()
    await studio.waitForURL(studioUrl(slug, '?publish=1'))
    await studio.getByRole('dialog').getByRole('button', { name: 'Publish now' }).click()
    await expect(studio.getByText(/Published \d+ pages/)).toBeVisible({ timeout: 30_000 })
    await expect(studio.getByTestId('website-status')).toContainText('Live')
    await list()
    await expect(row().getByText('Live', { exact: true })).toBeVisible()
    const open = row().getByRole('link', { name: 'Open site for Linden Spa' })
    await expect(open).toHaveAttribute('href', site(slug))
    await expect(open).toHaveAttribute('target', '_blank')
  })

  await test.step('spa: preview of the live site, services + prices, and a change request', async () => {
    await page.goto(`${app}/${slug}/website`)
    expect(page.url()).toBe(`${app}/${slug}/website`)
    await expect(page.getByRole('heading', { name: 'Services & prices' })).toBeVisible()
    await expect(page.getByText('60 min · AED 350')).toBeVisible()
    await expect(
      page.frameLocator('iframe[title="Preview of your website"]').getByRole('heading').first(),
    ).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('link', { name: 'View live site' })).toHaveAttribute('href', site(slug))
    await expect(page.getByRole('button', { name: /^Use / })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Publish site' })).toHaveCount(0)
    await page.getByLabel('What should change?').fill('Please use our new logo on every page.')
    await page.getByRole('button', { name: 'Send to studio' }).click()
    await expect(page.getByText('Sent to our studio')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByLabel('What should change?')).toHaveValue('')
    await expect(page.getByText('Please use our new logo on every page.')).toBeVisible()
    await expect(page.getByText('Open', { exact: true })).toBeVisible()
  })

  await test.step('console: the open request shows in the list and nav; Mark done with a note', async () => {
    await list()
    await expect(studio.getByRole('link', { name: /^Websites\s*\d+/ }).first()).toBeVisible()
    const requests = row().getByRole('link', { name: 'Open requests for Linden Spa' })
    await expect(requests).toHaveText('1 open')
    await requests.click()
    await studio.waitForURL(`${studioUrl(slug)}#requests`)
    const card = studio.locator('#requests')
    await expect(card).toContainText('Please use our new logo on every page.')
    await card.getByRole('button', { name: 'Mark done' }).click()
    const dialog = studio.getByRole('dialog')
    await dialog.getByLabel('Note to the spa (optional)').fill('Done — the new logo is live.')
    await dialog.getByRole('button', { name: 'Close request' }).click()
    await expect(studio.getByText('Marked done')).toBeVisible({ timeout: 30_000 })
    await list()
    await expect(row().getByRole('link', { name: 'Open requests for Linden Spa' })).toHaveCount(0)
  })

  await test.step('spa: sees the request done with the studio note', async () => {
    await page.reload()
    await expect(page.getByText('Done', { exact: true })).toBeVisible()
    await expect(page.getByText('Studio: Done — the new logo is live.')).toBeVisible()
  })

  await test.step('phones: the Websites list and the spa website page fit 360 px', async () => {
    await studio.setViewportSize({ width: 360, height: 780 })
    await studio.goto(`${admin}/websites`)
    await expect(studio.getByRole('heading', { name: 'Websites' })).toBeVisible()
    await noSideScroll(studio)
    await studio.goto(studioUrl(slug))
    await expect(studio.getByTestId('website-status')).toBeVisible()
    await noSideScroll(studio)
  })
})

test('old studio links forward super-admins to the console; spa members keep their page and no studio actions', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
  const owner = await signUpOwner(page, { spa: 'Forward Spa' })
  await makeStudio(owner.slug)
  const db = testDb()
  let useTemplate: { url: string; action: string; type: string; body: string } | undefined

  await test.step('super-admin: /{slug}/website opens the console spa page (its own sign-in on the admin host)', async () => {
    await page.goto(`${app}/${owner.slug}/website`)
    if (!PATH) {
      await page.waitForURL(/\/login\?next=/)
      await signInOnAdmin(page, owner.email)
    }
    await page.waitForURL(studioUrl(owner.slug))
    await expect(page.getByTestId('website-status')).toContainText('Not started')
    const call = page.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action'])
    await page.getByRole('button', { name: 'Use Nordic Clean' }).click()
    const req = await call
    useTemplate = {
      url: req.url(),
      action: req.headers()['next-action']!,
      type: req.headers()['content-type'] ?? '',
      body: req.postData() ?? '',
    }
    await expect(page.getByTestId('current-template')).toHaveText('Nordic Clean', { timeout: 30_000 })
  })

  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, owner.slug))
  const [home] = await db.select().from(sitePages).where(eq(sitePages.tenantId, tenant!.id)).limit(1)

  await test.step('super-admin: old editor + blog links land on the console; other ids are a 404', async () => {
    await page.goto(`${app}/${owner.slug}/website/editor/${home!.id}`)
    await page.waitForURL(editorUrl(owner.slug, home!.id))
    await expect(page.getByRole('link', { name: 'Back to console' })).toBeVisible()
    await page.goto(`${app}/${owner.slug}/website/blog/new`)
    await page.waitForURL(studioUrl(owner.slug, '/blog/new'))
    // Only checked ids are forwarded (built from the stored slug): no open redirect.
    const odd = `${app}/${owner.slug}/website/editor/evil.example`
    expect((await page.goto(odd))?.status()).toBe(404)
    expect(page.url()).toBe(odd)
  })

  const spaPage = await (await browser.newContext()).newPage()
  const spa = await signUpOwner(spaPage, { spa: 'Plain Spa' })
  const [spaTenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, spa.slug))

  await test.step('spa owner: the simple Website page — no studio tools, old studio links are a 404', async () => {
    await spaPage.goto(`${app}/${spa.slug}/website`)
    expect(spaPage.url()).toBe(`${app}/${spa.slug}/website`)
    await expect(spaPage.getByText('Our studio is crafting your website')).toBeVisible()
    await expect(spaPage.getByRole('heading', { name: 'Services & prices' })).toBeVisible()
    await expect(spaPage.getByRole('heading', { name: 'Request a change' })).toBeVisible()
    for (const text of ['Send for review', 'Approve', 'Publish site', 'Choose a template'])
      await expect(spaPage.getByText(text)).toHaveCount(0)
    await expect(spaPage.getByRole('button', { name: /^Use / })).toHaveCount(0)
    expect((await spaPage.goto(`${app}/${spa.slug}/website/editor/${home!.id}`))?.status()).toBe(404)
    expect((await spaPage.goto(`${app}/${spa.slug}/website/blog/new`))?.status()).toBe(404)
  })

  await test.step('spa owner: no console page, and a replayed studio action is refused server-side', async () => {
    if (!PATH) {
      await spaPage.goto(`${admin}/login`)
      await signInOnAdmin(spaPage, spa.email)
    }
    expect((await spaPage.goto(studioUrl(spa.slug)))?.status()).toBe(404)
    await expect(spaPage.getByTestId('website-status')).toHaveCount(0)
    // The super-admin's "Use Nordic Clean" call, aimed at the spa owner's own spa (owner permissions, not studio).
    const text = await spaPage.evaluate(
      async ({ url, action, type, body }) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'next-action': action, 'content-type': type, accept: 'text/x-component' },
          body,
        })
        return r.text()
      },
      { ...useTemplate!, url: spaPage.url(), body: useTemplate!.body.replaceAll(owner.slug, spa.slug) },
    )
    expect(text).toContain('Only our studio team can change the website design or publish it.')
    expect(await db.select().from(sites).where(eq(sites.tenantId, spaTenant!.id))).toHaveLength(0)
  })
})

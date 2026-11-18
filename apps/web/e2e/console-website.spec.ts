import { expect, type Page, test } from '@playwright/test'
import { aiUsage, auditLog, pageVersions, sitePageLocks, sitePages, sites, tenants, user } from '@spa/db'
import { textSlots } from '@spa/services/site-kit'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { siteEditSchema } from '../src/components/site/ai-schema'
import { designSignature } from '../src/components/site/content'
import {
  ADMIN,
  admin,
  app,
  editorUrl,
  makeSiteAiEditor,
  makeStudio,
  mockAiReply,
  OWNER_PASSWORD,
  PATH,
  passTwoFactor,
  seedCatalog,
  signInPlatformAdmin,
  signInStudioOnAdmin,
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
    const publish = studio.getByRole('dialog').getByRole('button', { name: 'Publish now' })
    await expect(publish).toBeVisible({ timeout: 30_000 })
    // The sheet drops ?publish=1, so it doesn't open by itself when new drafts appear later.
    await expect(studio).toHaveURL(studioUrl(slug))
    await publish.click()
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
    // Menu-only edit (name, description, durations, prices; no delete): the live site shows it without a republish.
    await page.getByRole('button', { name: 'Edit Swedish massage' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByLabel('Price 1 (AED)')).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Delete' })).toHaveCount(0)
    await sheet.getByLabel('Price 1 (AED)').fill('375')
    await sheet.getByRole('button', { name: 'Save service' }).click()
    await expect(page.getByText('60 min · AED 375')).toBeVisible({ timeout: 30_000 })
    const live = await page.context().newPage()
    await live.goto(site(slug))
    await expect(live.getByText('AED 375').first()).toBeVisible()
    await expect(live.getByText('AED 350')).toHaveCount(0)
    await live.close()
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

/** Page data with every bilingual text blanked: equal before/after ⇒ only texts changed (images, links, styles kept). */
const withoutTexts = (data: unknown): unknown =>
  JSON.parse(JSON.stringify(data), (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v) && typeof v.en === 'string' ? { bi: true } : v,
  )

test('Write texts: AI drafts every page in EN + AR, never publishes; a locked page is skipped; listed super-admins only', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  // SITE_AI_EDITOR_EMAILS (playwright.config.ts) lists this owner's email: owner-texts-editor@e2e.test.
  const { slug, email } = await signUpOwner(page, { spa: 'Texts Spa', slug: 'texts-editor' })
  await makeSiteAiEditor(slug)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await signInStudioOnAdmin(page, email)
  await page.goto(studioUrl(slug))
  await page.getByRole('button', { name: 'Use Nordic Clean' }).click()
  await expect(page.getByTestId('current-template')).toHaveText('Nordic Clean', { timeout: 30_000 })

  const pages = await db
    .select()
    .from(sitePages)
    .where(eq(sitePages.tenantId, seed.tenantId))
    .orderBy(asc(sitePages.sort))
  const versionsOf = (pageId: string) =>
    db
      .select()
      .from(pageVersions)
      .where(eq(pageVersions.pageId, pageId))
      .orderBy(desc(pageVersions.createdAt))
  const before = new Map<string, unknown>()
  for (const p of pages) before.set(p.id, (await versionsOf(p.id))[0]!.data)
  const home = pages.find((p) => p.slug === '')!
  const about = pages.find((p) => p.slug === 'about')!
  const heroKey = textSlots(before.get(home.id), siteEditSchema()).find(
    (s) => s.type === 'Hero' && s.prop === 'title',
  )!.key
  // One canned reply for every page call: keys of other pages (and 'nope/x') are ignored.
  const texts = [
    { key: heroKey, en: 'Quiet hours at Texts Spa', ar: 'ساعات هادئة في تكستس سبا' },
    ...pages
      .flatMap((p) => textSlots(before.get(p.id), siteEditSchema()).slice(0, 8))
      .filter((s) => s.key !== heroKey)
      .map((s, i) => ({ key: s.key, en: `Drafted text ${i}`, ar: `نص مكتوب ${i}` })),
    { key: 'nope/x', en: 'Ignored', ar: 'تجاهل' },
  ]
  await mockAiReply(slug, { texts, note: 'Calm, clear texts.' })

  // Another editor has About open: it is skipped (no tokens spent on it).
  const adminPage = await (await browser.newContext()).newPage()
  await signInPlatformAdmin(adminPage)
  const [adminUser] = await db.select({ id: user.id }).from(user).where(eq(user.email, ADMIN.email))
  await db.insert(sitePageLocks).values({
    tenantId: seed.tenantId,
    pageId: about.id,
    userId: adminUser!.id,
    holderName: 'Sara',
    expiresAt: new Date(Date.now() + 10 * 60_000),
  })
  const aboutBefore = await versionsOf(about.id)

  let call: { url: string; action: string; type: string; body: string } | undefined
  await test.step('listed super-admin: Write texts drafts every page and says what to do next', async () => {
    await page.reload()
    await page.getByRole('button', { name: 'Write texts' }).click()
    const sheet = page.getByRole('dialog')
    await sheet.getByLabel('Anything to highlight? (optional)').fill('Female therapists available')
    const sent = page.waitForRequest((r) => r.method() === 'POST' && !!r.headers()['next-action'])
    await sheet.getByRole('button', { name: 'Write texts' }).click()
    const req = await sent
    call = {
      url: req.url(),
      action: req.headers()['next-action']!,
      type: req.headers()['content-type'] ?? '',
      body: req.postData() ?? '',
    }
    const status = sheet.getByRole('status')
    await expect(status).toContainText('in English and Arabic (Home ', { timeout: 120_000 })
    await expect(status).toContainText("Skipped: About (open in Sara's editor)")
    await expect(status).toContainText('Nothing is published — read each page, adjust, then Publish.')
    const drafted = sheet.getByRole('list', { name: 'Drafted pages' })
    await expect(drafted.getByRole('listitem')).toHaveCount(pages.length - 1)
    await expect(drafted.getByRole('link', { name: 'Open editor' }).first()).toHaveAttribute(
      'href',
      new RegExp(`/websites/${slug}/editor/${home.id}$`),
    )
  })

  await test.step('drafts only: texts in EN + AR, structure and images unchanged, nothing published, audited', async () => {
    const [latest, previous] = await versionsOf(home.id)
    const hero = textSlots(latest!.data, siteEditSchema()).find((s) => s.key === heroKey)!
    expect({ en: hero.en, ar: hero.ar }).toEqual({
      en: 'Quiet hours at Texts Spa',
      ar: 'ساعات هادئة في تكستس سبا',
    })
    expect(latest!.status).toBe('draft')
    expect(withoutTexts(latest!.data)).toEqual(withoutTexts(before.get(home.id)))
    expect(designSignature(latest!.data)).toBe(designSignature(before.get(home.id)))
    // The template's draft stays restorable in the editor's Versions.
    expect(previous!.label).toMatch(/^Before Write texts \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
    for (const p of pages.filter((x) => x.id !== about.id))
      expect(JSON.stringify((await versionsOf(p.id))[0]!.data)).toContain('نص مكتوب')
    expect(await versionsOf(about.id)).toEqual(aboutBefore)
    const published = await db
      .select()
      .from(pageVersions)
      .where(
        and(
          inArray(
            pageVersions.pageId,
            pages.map((p) => p.id),
          ),
          eq(pageVersions.status, 'published'),
        ),
      )
    expect(published).toHaveLength(0)
    const [logged] = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.tenantId, seed.tenantId), eq(auditLog.action, 'site.ai_texts_written')))
    expect(logged?.data).toMatchObject({
      via: 'studio_write_texts',
      notes: true,
      skipped: [{ title: 'About', reason: "open in Sara's editor" }],
    })
    // One call per 40 texts of every page but the locked one.
    const calls = pages
      .filter((p) => p.id !== about.id)
      .reduce((n, p) => n + Math.ceil(textSlots(before.get(p.id), siteEditSchema()).length / 40), 0)
    const usage = await db.select().from(aiUsage).where(eq(aiUsage.tenantId, seed.tenantId))
    expect(usage.filter((u) => u.agentKey === 'site_editor')).toHaveLength(calls)
  })

  await test.step('a super-admin not on the list: no button, and the replayed action is refused', async () => {
    const versions = async () =>
      (
        await db
          .select({ id: pageVersions.id })
          .from(pageVersions)
          .where(
            inArray(
              pageVersions.pageId,
              pages.map((p) => p.id),
            ),
          )
      ).length
    const count = await versions()
    await adminPage.goto(studioUrl(slug))
    await expect(adminPage.getByTestId('website-status')).toBeVisible()
    await expect(adminPage.getByRole('button', { name: 'Write texts' })).toHaveCount(0)
    const text = await adminPage.evaluate(
      async ({ url, action, type, body }) => {
        const r = await fetch(url, {
          method: 'POST',
          headers: { 'next-action': action, 'content-type': type, accept: 'text/x-component' },
          body,
        })
        return r.text()
      },
      { ...call!, url: adminPage.url() },
    )
    expect(text).toContain('AI site editing isn’t enabled for your account.')
    expect(await versions()).toBe(count)
  })
})

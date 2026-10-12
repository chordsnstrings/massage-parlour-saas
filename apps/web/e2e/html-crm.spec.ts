import { readFile } from 'node:fs/promises'
import { expect, type Frame, type Page, test } from '@playwright/test'
import { addDays } from '@spa/core'
import {
  auditLog,
  branches,
  pageVersions,
  services,
  serviceVariants,
  siteEnquiries,
  sitePages,
  sites,
  staff,
  tenants,
} from '@spa/db'
import { and, desc, eq } from 'drizzle-orm'
import {
  admin,
  app,
  editorUrl,
  makeStudio,
  PORT,
  signInStudioOnAdmin,
  signUpOwner,
  site,
  studioUrl,
  testDb,
  today,
} from './helpers'

/**
 * R26 (owner 2026-10-12): an HTML design built on the "Candlelight" CRM data contract (window.CRM_DATA literal /
 * <meta name="crm-endpoint">) shows the spa's live CRM data — services, prices, durations, hours, phones, WhatsApp,
 * address, map link, staff (only with "Show on website") — and only that JSON differs from the uploaded file. Its
 * booking form creates a website enquiry. Fixture: fixtures/crm-contract.html (a tiny design with Candlelight's
 * semantics). docs/design/html-crm-contract.md.
 */
const FIXTURE = new URL('./fixtures/crm-contract.html', import.meta.url)
const LITERAL = /<script>window\.CRM_DATA = [\s\S]*?;<\/script>/
const HOURS = { open: '10:00', close: '22:00' }
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const PIN = 'https://maps.app.goo.gl/r26TestPin'

/** A request to a spa host as a browser would send it (Node can't resolve *.localhost: 127.0.0.1 + Host). */
function viaHost(
  page: Page,
  url: string,
  opts: { method?: string; headers?: Record<string, string>; data?: string } = {},
) {
  const u = new URL(url)
  return page.request.fetch(`http://127.0.0.1:${PORT}${u.pathname}${u.search}`, {
    method: opts.method ?? 'GET',
    headers: { host: u.host, ...opts.headers },
    data: opts.data,
    failOnStatusCode: false,
    maxRedirects: 0,
  })
}

const bookingBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    spa: 'x',
    service_id: 'normal-massage',
    service_name: 'Normal massage',
    duration_minutes: 60,
    guests: 1,
    date: addDays(today(), 3),
    time: '19:00',
    staff_id: null,
    name: 'Omar Test',
    phone: '050 765 4321',
    notes: '',
    source: 'website',
    submitted_at: new Date().toISOString(),
    ...over,
  })
const postEnquiry = (page: Page, slug: string, data: string, headers: Record<string, string> = {}) =>
  viaHost(page, `${site(slug)}/crm-enquiry?page=`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'null', ...headers },
    data,
  })

async function seedSpa(slug: string) {
  const db = testDb()
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const tenantId = t!.id
  await db
    .update(branches)
    .set({
      phone: '04 123 4567',
      whatsappE164: '971501112233',
      address: '12 Test Road, Al Barsha, Dubai, UAE',
      mapsUrl: PIN,
      openingHours: Object.fromEntries(DAYS.map((d) => [d, [HOURS]])),
    })
    .where(eq(branches.tenantId, tenantId))
  const [normal, stone] = await db
    .insert(services)
    .values([
      { tenantId, name: { en: 'Normal massage' }, sort: 1 },
      { tenantId, name: { en: 'Hot stone' }, sort: 2 },
    ])
    .returning()
  const variants = await db
    .insert(serviceVariants)
    .values([
      { tenantId, serviceId: normal!.id, durationMin: 90, priceAed: '350', sort: 1 },
      { tenantId, serviceId: normal!.id, durationMin: 60, priceAed: '250' },
      { tenantId, serviceId: stone!.id, durationMin: 75, priceAed: '400' },
    ])
    .returning()
  const people = await db
    .insert(staff)
    .values([
      // A photo: photo-less therapists never show on HTML designs (R28 D2).
      {
        tenantId,
        displayName: 'Maya Test',
        sort: 1,
        photoUrl: '/files/00000000-0000-4000-8000-000000000001',
      },
      { tenantId, displayName: 'Ploy Test', sort: 2 },
    ])
    .returning()
  return {
    tenantId,
    normal: normal!.id,
    stone: stone!.id,
    variants,
    maya: people[0]!.id,
    ploy: people[1]!.id,
  }
}

async function upload(page: Page, name: string, html: string) {
  await page.goto(`${admin}/templates`)
  await page.getByRole('button', { name: 'Upload HTML' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('Template name').fill(name)
  await dialog
    .getByLabel('HTML file')
    .setInputFiles({ name: 'design.html', mimeType: 'text/html', buffer: Buffer.from(html) })
  await dialog.getByRole('checkbox', { name: /Spas can pick it right away/ }).check()
  await dialog.getByRole('button', { name: 'Upload' }).click()
  await expect(
    page.getByText(new RegExp(`${name} uploaded\\. Stored exactly as the file\\. CRM data contract found`)),
  ).toBeVisible({
    timeout: 60_000,
  })
}

async function applyAndPublish(page: Page, slug: string, name: string) {
  await page.goto(studioUrl(slug))
  await page.getByRole('button', { name: `Use ${name}` }).click()
  await expect(page.getByTestId('current-template')).toHaveText(name, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Publish site' }).click()
  await page.getByRole('button', { name: 'Publish now' }).click()
  await expect(page.getByText('Published 1 page')).toBeVisible({ timeout: 30_000 })
}

async function rendered(doc: Page | Frame) {
  await expect
    .poll(() => doc.evaluate('window.__crmDone === true').catch(() => false), { timeout: 30_000 })
    .toBe(true)
}

/** The live page (the design document itself), rendered. */
async function live(page: Page, slug: string) {
  await page.goto(site(slug))
  await rendered(page)
}

const enquiries = (tenantId: string) =>
  testDb().select().from(siteEnquiries).where(eq(siteEnquiries.tenantId, tenantId))

test('R26: a contract design shows the live CRM data, and its booking form creates a website enquiry', async ({
  page,
  browser,
}) => {
  test.setTimeout(420_000)
  const fixture = await readFile(FIXTURE, 'utf8')
  const owner = await signUpOwner(page, { spa: 'CRM Feed Spa' })
  const { slug } = owner
  const seed = await seedSpa(slug)
  await makeStudio(slug)
  await signInStudioOnAdmin(page, owner.email)
  await upload(page, 'CRM Contract', fixture)
  await applyAndPublish(page, slug, 'CRM Contract')

  await test.step('live page: CRM values; the design keeps its own extras; nobody opted in → no team', async () => {
    await live(page, slug)
    await expect(page.locator('#spa')).toHaveText('CRM Feed Spa')
    const normal = page.locator(`li[data-id="${seed.normal}"]`)
    await expect(normal.locator('.name')).toHaveText('Normal massage')
    await expect(normal.locator('.price')).toHaveText('from 250 AED')
    await expect(normal.locator('.chip')).toHaveText(['60 min', '90 min'])
    // Same identity as the design's item: its note and photo stay (the CRM service has none).
    await expect(normal.locator('.note')).toHaveText('design note')
    await expect(normal.locator('img')).toHaveAttribute('alt', 'Design photo')
    await expect(page.locator(`li[data-id="${seed.stone}"] .price`)).toHaveText('from 400 AED')
    await expect(page.locator('#services').getByText('Design ritual')).toHaveCount(0)
    await expect(page.getByText(/999/)).toHaveCount(0)
    await expect(page.locator('#hours')).toContainText('mon 10:00-22:00')
    await expect(page.locator('#phone')).toHaveText('04 123 4567')
    await expect(page.locator('#wa')).toHaveAttribute('href', 'https://wa.me/971501112233')
    await expect(page.locator('#address')).toHaveText('12 Test Road, Al Barsha, Dubai, UAE')
    await expect(page.locator('#address')).toHaveAttribute('href', PIN)
    await expect(page.locator('#label')).toHaveText('Book with the design')
    // Staff only with "Show on website": the design's own people never show (not even photo-only cards).
    await expect(page.locator('#staff li')).toHaveCount(0)
  })

  await test.step('bytes: only the CRM_DATA JSON differs from the uploaded file', async () => {
    const res = await viaHost(page, `${site(slug)}/`)
    const served = await res.text()
    const body = (s: string) => s.slice(s.indexOf('<body>')).replace(LITERAL, '')
    expect(body(served)).toBe(body(fixture))
    expect(served.match(LITERAL)![0]).not.toBe(fixture.match(LITERAL)![0])
    // The page JSON can't close the script: no raw < > & inside it.
    expect(served.match(LITERAL)![0].slice(8, -9)).not.toMatch(/[<>&]/)
  })

  await test.step('"Show on website" in the CRM staff screen → that person appears (and only them)', async () => {
    await page.goto(`${app}/${slug}/staff/${seed.maya}`)
    await page.getByRole('button', { name: 'Edit profile' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('checkbox', { name: /^Show on website/ })).toBeVisible()
    await expect(sheet.getByTestId('site-photo-needed')).toHaveCount(0) // Maya has a photo
    await sheet.getByRole('checkbox', { name: /^Show on website/ }).check()
    await sheet.getByLabel('Short bio for the website (English)').fill('Thai massage specialist')
    await sheet.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByText('Therapist saved')).toBeVisible()
    await expect(page.getByText('On website', { exact: true })).toBeVisible()
    const [row] = await testDb()
      .select({ data: auditLog.data })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'staff.updated'), eq(auditLog.entityId, seed.maya)))
    expect(row?.data).toMatchObject({ showOnSite: true, bio: { en: 'Thai massage specialist' } })
    await live(page, slug)
    await expect(page.locator('#staff li.member')).toHaveCount(1)
    await expect(page.locator('#staff li.member')).toContainText('Maya Test')
    await expect(page.locator('#staff .specialty')).toHaveText('Thai massage specialist')
    await expect(page.getByText('Ploy Test')).toHaveCount(0)
    await expect(page.locator('#staff li.photo-only')).toHaveCount(0)
    // Switched on but no photo → left out (R28 D2: no empty frames).
    await testDb().update(staff).set({ showOnSite: true }).where(eq(staff.id, seed.ploy))
    await live(page, slug)
    await expect(page.locator('#staff li.member')).toHaveCount(1)
    await expect(page.getByText('Ploy Test')).toHaveCount(0)
    // …and the CRM staff sheet says why (R28 P3).
    await page.goto(`${app}/${slug}/staff/${seed.ploy}`)
    await page.getByRole('button', { name: 'Edit profile' }).click()
    await expect(page.getByRole('dialog').getByTestId('site-photo-needed')).toHaveText(
      'Add a photo to show on HTML-design websites',
    )
    await page.keyboard.press('Escape')
  })

  await test.step('a price / hours change in the CRM shows on reload, without republishing', async () => {
    const db = testDb()
    const sixty = seed.variants.find((v) => v.durationMin === 60)!
    await db.update(serviceVariants).set({ priceAed: '199' }).where(eq(serviceVariants.id, sixty.id))
    await db
      .update(branches)
      .set({ openingHours: Object.fromEntries(DAYS.map((d) => [d, [{ open: '11:00', close: '23:00' }]])) })
      .where(eq(branches.tenantId, seed.tenantId))
    await live(page, slug)
    await expect(page.locator(`li[data-id="${seed.normal}"] .price`)).toHaveText('from 199 AED')
    await expect(page.locator('#hours')).toContainText('mon 11:00-23:00')
  })

  await test.step("no website services in the CRM → none of the design's (another spa's design, R28 D1)", async () => {
    const db = testDb()
    await db.update(services).set({ onlineBookable: false }).where(eq(services.tenantId, seed.tenantId))
    await live(page, slug)
    await expect(page.locator('#services li')).toHaveCount(0)
    await expect(page.getByText(/999/)).toHaveCount(0)
    await db.update(services).set({ onlineBookable: true }).where(eq(services.tenantId, seed.tenantId))
  })

  await test.step('booking form on the live page → a website enquiry in the CRM inbox', async () => {
    await live(page, slug)
    await page.locator('#svc').selectOption(seed.normal)
    await page.locator('#who').selectOption(seed.maya)
    await page.getByRole('button', { name: 'Request booking' }).click()
    await expect(page.locator('#status')).toHaveText('ok')
    const rows = await enquiries(seed.tenantId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'Layla Test',
      phone: '+971501234567',
      message: 'Strong pressure',
      booking: {
        service: 'Normal massage',
        serviceId: seed.normal,
        durationMin: 60,
        guests: 2,
        time: '18:30',
        staff: 'Maya Test',
        staffId: seed.maya,
      },
    })
    await page.goto(`${app}/${slug}/enquiries`)
    await expect(page.getByRole('table').getByText('Booking request')).toBeVisible()
    await expect(
      page.getByRole('table').getByText(/Normal massage · 60 min · 2 guests · .+ at 18:30 · with Maya Test/),
    ).toBeVisible()
  })

  await test.step('the endpoint: CORS preflight, refuses bad bodies, other origins, honeypot; per-spa limit', async () => {
    const pre = await viaHost(page, `${site(slug)}/crm-enquiry`, {
      method: 'OPTIONS',
      headers: { origin: 'null', 'access-control-request-method': 'POST' },
    })
    expect(pre.status()).toBe(204)
    expect(pre.headers()['access-control-allow-origin']).toBe('*')
    expect(pre.headers()['access-control-allow-methods']).toContain('POST')
    expect((await postEnquiry(page, slug, bookingBody(), { 'content-type': 'text/plain' })).status()).toBe(
      415,
    )
    expect((await postEnquiry(page, slug, bookingBody({ notes: 'x'.repeat(9000) }))).status()).toBe(413)
    expect((await postEnquiry(page, slug, '{"name":')).status()).toBe(400)
    const badPhone = await postEnquiry(page, slug, bookingBody({ phone: '123' }))
    expect(badPhone.status()).toBe(400)
    expect((await badPhone.json()).fields).toEqual(['phone'])
    expect((await postEnquiry(page, slug, bookingBody({ date: '2020-01-01' }))).status()).toBe(400)
    expect((await postEnquiry(page, slug, bookingBody(), { origin: 'http://evil.test' })).status()).toBe(403)
    // Browsers always send Origin on a POST: none = a plain script.
    const bare = await viaHost(page, `${site(slug)}/crm-enquiry?page=`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      data: bookingBody(),
    })
    expect(bare.status()).toBe(403)
    const pot = await postEnquiry(page, slug, bookingBody({ company: 'Bot Inc' }))
    expect(pot.status()).toBe(200)
    expect(await enquiries(seed.tenantId)).toHaveLength(1)
    const ok = await postEnquiry(page, slug, bookingBody())
    expect(ok.status()).toBe(201)
    expect(ok.headers()['access-control-allow-origin']).toBe('*')
    expect(ok.headers()['cache-control']).toBe('no-store')
    expect(ok.headers()['content-security-policy']).toContain("default-src 'none'")
    // A design id the CRM doesn't know: the typed name is kept, no id.
    const last = (await enquiries(seed.tenantId)).find((r) => r.name === 'Omar Test')!
    expect(last.booking).toMatchObject({ service: 'Normal massage', serviceId: null, staff: null })
    // 30 an hour per spa (always on): 2 so far, 28 more pass, the next is refused.
    let accepted = 0
    for (let i = 0; i < 29; i++)
      if ((await postEnquiry(page, slug, bookingBody())).status() === 201) accepted++
    expect(accepted).toBe(28)
    const limited = await postEnquiry(page, slug, bookingBody())
    expect(limited.status()).toBe(429)
    expect((await limited.json()).error).toBe('rate_limited')
  })

  await test.step('Studio preview: CRM values, the form has no endpoint (WhatsApp fallback, nothing stored)', async () => {
    const before = (await enquiries(seed.tenantId)).length
    await page.goto(studioUrl(slug, '/preview'))
    const el = page.locator('iframe.site-html-design')
    const frame = (await (await el.elementHandle())!.contentFrame())!
    await rendered(frame)
    await expect(frame.locator('#spa')).toHaveText('CRM Feed Spa')
    await expect(frame.locator(`li[data-id="${seed.normal}"] .price`)).toHaveText('from 199 AED')
    await frame.locator('#svc').selectOption(seed.normal)
    await frame.getByRole('button', { name: 'Request booking' }).click()
    await expect(frame.locator('#status')).toHaveText('whatsapp')
    expect(await enquiries(seed.tenantId)).toHaveLength(before)
  })

  await test.step('endpoint-only design (no literal): crm-data.json feeds the live page through its own fetch', async () => {
    const ctx = await browser.newContext()
    const other = await ctx.newPage()
    const second = await signUpOwner(other, { spa: 'CRM Endpoint Spa' })
    const seed2 = await seedSpa(second.slug)
    // No contract design on its live site yet: the endpoint takes nothing (its inbox stays behind Turnstile).
    const before = await postEnquiry(page, second.slug, bookingBody())
    expect(before.status()).toBe(404)
    expect(await enquiries(seed2.tenantId)).toHaveLength(0)
    const endpointOnly = fixture.replace(LITERAL, '')
    await upload(page, 'CRM Endpoint', endpointOnly)
    await applyAndPublish(page, second.slug, 'CRM Endpoint')

    const data = await viaHost(page, `${site(second.slug)}/crm-data.json`, { headers: { origin: 'null' } })
    expect(data.status()).toBe(200)
    const h = data.headers()
    expect(h['access-control-allow-origin']).toBe('*')
    expect(h['cache-control']).toBe('no-store')
    expect(h['content-type']).toContain('application/json')
    expect(h['content-security-policy']).toContain("default-src 'none'")
    const json = await data.json()
    expect(json.spa.name).toBe('CRM Endpoint Spa')
    expect(json.services.map((s: { name: string; price: number }) => [s.name, s.price])).toEqual([
      ['Normal massage', 250],
      ['Hot stone', 400],
    ])
    expect(json.staff).toEqual([])
    // Never the automatic online booking page: the design's own Book links / form (a booking request).
    expect(json.booking.url).toBeNull()
    expect(json.booking.form_endpoint).toBe(`${site(second.slug)}/crm-enquiry?page=`)
    expect(JSON.stringify(json)).not.toContain('match')
    expect(json.spa.area_label).toBe('Dubai') // the city from the address
    expect(JSON.stringify(json)).not.toContain('area_explicit')

    // Settings → Main branch "Area shown on the website" → the contract's area label (R28 P3).
    await other.goto(`${app}/${second.slug}/settings`)
    await other.getByLabel('Area shown on the website').fill('Al Barsha, Dubai')
    await other.getByRole('button', { name: 'Save changes' }).click()
    await expect(other.getByText('Settings saved')).toBeVisible()
    const labelled = await viaHost(page, `${site(second.slug)}/crm-data.json`, {
      headers: { origin: 'null' },
    })
    expect((await labelled.json()).spa.area_label).toBe('Al Barsha, Dubai')

    // The live page is the uploaded file byte for byte (from <body>): the design fetches its data itself.
    const served = await (await viaHost(page, `${site(second.slug)}/`)).text()
    expect(served.slice(served.indexOf('<body>'))).toBe(endpointOnly.slice(endpointOnly.indexOf('<body>')))
    await live(other, second.slug)
    await expect(other.locator('#spa')).toHaveText('CRM Endpoint Spa')
    await expect(other.locator(`li[data-id="${seed2.normal}"] .price`)).toHaveText('from 250 AED')
    await other.locator('#svc').selectOption(seed2.normal)
    await other.getByRole('button', { name: 'Request booking' }).click()
    await expect(other.locator('#status')).toHaveText('ok')
    expect(await enquiries(seed2.tenantId)).toHaveLength(1)
    await ctx.close()
  })
})

test('R28: an HTML template applied over a live block site becomes a draft; the live site keeps its look', async ({
  page,
}) => {
  test.setTimeout(300_000)
  const fixture = await readFile(FIXTURE, 'utf8')
  const owner = await signUpOwner(page, { spa: 'Live Block Spa' })
  const { slug } = owner
  await makeStudio(slug)
  await signInStudioOnAdmin(page, owner.email)
  await page.goto(studioUrl(slug))
  await page.getByRole('button', { name: 'Use Zen Minimal' }).click()
  await expect(page.getByTestId('current-template')).toHaveText('Zen Minimal', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Publish site' }).click()
  await page.getByRole('button', { name: 'Publish now' }).click()
  await expect(page.getByText(/^Published \d+ pages?/)).toBeVisible({ timeout: 30_000 })
  const db = testDb()
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const [before] = await db.select().from(sites).where(eq(sites.tenantId, t!.id))

  await upload(page, 'Over Live', fixture)
  await page.goto(studioUrl(slug))
  await page
    .getByRole('article', { name: 'Over Live' })
    .getByRole('button', { name: 'Apply Over Live' })
    .click()
  const dialog = page.getByRole('dialog')
  // The design IS its page: it always replaces the page with the same address (as a draft), never only the theme.
  await expect(dialog.getByRole('checkbox')).toBeChecked()
  await expect(dialog.getByRole('checkbox')).toBeDisabled()
  await expect(
    dialog.getByText(/^Its design replaces your pages with the same address as drafts/),
  ).toBeVisible()
  await dialog.getByRole('button', { name: 'Switch to Over Live' }).click()
  await expect(page.getByTestId('current-template')).toHaveText('Over Live', { timeout: 30_000 })

  // Live: the Zen site and its theme, untouched; the design waits as the home draft. The theme is kept (an HTML
  // design ignores it), so the pages it doesn't replace keep their look once published.
  const [after] = await db.select().from(sites).where(eq(sites.tenantId, t!.id))
  expect(after!.theme).toEqual(before!.theme)
  expect(after!.themeDraft).toBeNull()
  await page.goto(site(slug))
  await expect(page.locator('#spa')).toHaveCount(0)
  // The console's home thumbnail shows the draft design right away (scripts on, a new frame after the switch).
  await page.goto(studioUrl(slug))
  const thumb = page.frameLocator('iframe[title="Home page preview"]').frameLocator('iframe.site-html-design')
  await expect(thumb.locator('#spa')).toHaveText('Live Block Spa', { timeout: 30_000 })
})

test("R28 P2: the editor's Website content field changes a design's words per spa (draft → publish); the file never", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const fixture = await readFile(FIXTURE, 'utf8')
  const owner = await signUpOwner(page, { spa: 'Content Field Spa' })
  const { slug } = owner
  await seedSpa(slug)
  await makeStudio(slug)
  await signInStudioOnAdmin(page, owner.email)
  await upload(page, 'Content Design', fixture)
  await applyAndPublish(page, slug, 'Content Design')
  const db = testDb()
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const [home] = await db
    .select({ id: sitePages.id })
    .from(sitePages)
    .where(and(eq(sitePages.tenantId, t!.id), eq(sitePages.slug, '')))

  await page.goto(editorUrl(slug, home!.id))
  // The page opens on its design block: the Website content field, grouped, the CRM's keys absent.
  // Puck keeps a hidden copy of the fields panel: the visible one.
  const field = page.locator('[data-testid="html-content"]:visible')
  await expect(field).toBeVisible({ timeout: 60_000 })
  await expect(
    field.getByText('Name, phones, address, hours, treatments, prices and team come live from the CRM'),
  ).toBeVisible()
  await expect(field.getByRole('textbox', { name: 'WhatsApp message' })).toBeVisible()
  await expect(field.getByText('Normal massage')).toHaveCount(0)
  const label = field.getByRole('textbox', { name: 'Button label' })
  await label.fill('Request a visit')
  const design = page.frameLocator('#preview-frame').first().frameLocator('iframe.site-html-design')
  await expect(design.locator('#label')).toHaveText('Request a visit', { timeout: 30_000 })
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByText('Draft saved')).toBeVisible({ timeout: 30_000 })

  // Live: unchanged until published.
  const visitor = await (await browser.newContext()).newPage()
  await live(visitor, slug)
  await expect(visitor.locator('#label')).toHaveText('Book with the design')

  await page.goto(studioUrl(slug))
  await page.getByRole('button', { name: 'Publish site' }).click()
  await page.getByRole('button', { name: 'Publish now' }).click()
  await expect(page.getByText(/^Published \d+ pages?/)).toBeVisible({ timeout: 30_000 })
  await live(visitor, slug)
  await expect(visitor.locator('#label')).toHaveText('Request a visit')
  // Only the CRM_DATA JSON differs from the uploaded file.
  const served = await (await viaHost(page, `${site(slug)}/`)).text()
  const body = (s: string) => s.slice(s.indexOf('<body>')).replace(LITERAL, '')
  expect(body(served)).toBe(body(fixture))
})

test('R28 P4: page texts, the page title and a picture per spa (draft → publish); the stored design never changes', async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000)
  const fixture = await readFile(FIXTURE, 'utf8')
  const variant = fixture.replace(
    '<h1 id="spa">Loading</h1>',
    '<h1 id="spa">Loading</h1>\n<h2>Design heading</h2>\n<img alt="Design picture" src="https://example.com/design.jpg">',
  )
  const owner = await signUpOwner(page, { spa: 'Page Texts Spa' })
  const { slug } = owner
  await seedSpa(slug)
  await makeStudio(slug)
  await signInStudioOnAdmin(page, owner.email)
  await upload(page, 'Texts Design', variant)
  await applyAndPublish(page, slug, 'Texts Design')
  const db = testDb()
  const [t] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  const [home] = await db
    .select({ id: sitePages.id })
    .from(sitePages)
    .where(and(eq(sitePages.tenantId, t!.id), eq(sitePages.slug, '')))
  /** The stored design file of the published page (its sha256). */
  const publishedDoc = async () => {
    const [v] = await db
      .select({ data: pageVersions.data })
      .from(pageVersions)
      .where(and(eq(pageVersions.pageId, home!.id), eq(pageVersions.status, 'published')))
      .orderBy(desc(pageVersions.createdAt))
      .limit(1)
    const blocks = (v!.data.content ?? []) as { type: string; props: { doc?: { sha256?: string } } }[]
    return blocks.find((b) => b.type === 'HtmlDesign')?.props.doc?.sha256
  }
  const sha0 = await publishedDoc()
  expect(sha0).toMatch(/^[0-9a-f]{64}$/)

  // The editor: page texts (the CRM-filled ones read-only), searchable; the page title; a picture per spa.
  await page.goto(editorUrl(slug, home!.id))
  const field = page.locator('[data-testid="html-content"]:visible')
  await expect(field).toBeVisible({ timeout: 60_000 })
  await field.getByText(/^Page texts \(\d+\)$/).click()
  await expect(field.getByTestId('page-text').filter({ hasText: 'Loading' })).toContainText(
    'Filled by the design from the CRM',
  )
  const search = field.getByLabel('Search page texts')
  await search.fill('Design heading')
  await field.getByRole('textbox', { name: 'Heading: Design heading' }).fill('Our rituals')
  await search.fill('')
  await field
    .getByRole('textbox', { name: 'Page title: CRM contract fixture' })
    .fill('Rituals at Page Texts Spa')
  await field.getByText(/^Pictures \(\d+\)$/).click()
  const picture = field.getByRole('textbox', { name: 'Picture 1 URL' })
  await picture.fill('https://example.com/p4.jpg')
  await picture.press('Enter')

  // The canvas: the new words and picture, replace-only (no framing hook added).
  const design = page.frameLocator('#preview-frame').first().frameLocator('iframe.site-html-design')
  await expect(design.locator('h2')).toHaveText('Our rituals', { timeout: 30_000 })
  await expect(design.locator('img[alt="Design picture"]')).toHaveAttribute(
    'src',
    'https://example.com/p4.jpg',
    { timeout: 30_000 },
  )
  await expect(design.locator('[data-spa-img]')).toHaveCount(0)
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByText('Draft saved')).toBeVisible({ timeout: 30_000 })

  // Live: unchanged until published.
  const visitor = await (await browser.newContext()).newPage()
  await live(visitor, slug)
  await expect(visitor.locator('h2')).toHaveText('Design heading')
  await expect(visitor).toHaveTitle('CRM contract fixture')
  await expect(visitor.locator('img[alt="Design picture"]')).toHaveAttribute(
    'src',
    'https://example.com/design.jpg',
  )

  await page.goto(studioUrl(slug))
  await page.getByRole('button', { name: 'Publish site' }).click()
  await page.getByRole('button', { name: 'Publish now' }).click()
  await expect(page.getByText(/^Published \d+ pages?/)).toBeVisible({ timeout: 30_000 })
  await live(visitor, slug)
  await expect(visitor.locator('h2')).toHaveText('Our rituals')
  await expect(visitor).toHaveTitle('Rituals at Page Texts Spa')
  await expect(visitor.locator('img[alt="Design picture"]')).toHaveAttribute(
    'src',
    'https://example.com/p4.jpg',
  )
  await expect(visitor.locator('style[data-spa-images]')).toHaveCount(0)

  // Only the CRM_DATA JSON and the changed values differ from the uploaded file; the stored file is the same one.
  const served = await (await viaHost(page, `${site(slug)}/`)).text()
  const body = (s: string) => s.slice(s.indexOf('<body>')).replace(LITERAL, '')
  expect(
    body(served)
      .replace('Our rituals', 'Design heading')
      .replace('https://example.com/p4.jpg', 'https://example.com/design.jpg'),
  ).toBe(body(variant))
  expect(served).toContain('<title>Rituals at Page Texts Spa</title>')
  expect(await publishedDoc()).toBe(sha0)
})

test('R28 P3: fill the CRM from the design', async ({ page }) => {
  test.setTimeout(300_000)
  const fixture = await readFile(FIXTURE, 'utf8')
  const owner = await signUpOwner(page, { spa: 'Seed Design Spa' })
  const { slug } = owner
  const seed = await seedSpa(slug)
  await makeStudio(slug)
  await signInStudioOnAdmin(page, owner.email)
  await upload(page, 'Seed Design', fixture)
  await applyAndPublish(page, slug, 'Seed Design')
  // Right after applying, the next step is offered (non-modal); a fresh visit only has the Pages row button.
  await expect(page.getByTestId('seed-offer')).toBeVisible()
  await page.goto(studioUrl(slug))
  await expect(page.getByTestId('seed-offer')).toHaveCount(0)

  await page.getByRole('button', { name: 'Fill the CRM from the design' }).click()
  const sheet = page.getByRole('dialog')
  await expect(
    sheet.getByText(
      'These change the CRM right away (treatments and therapists); the website shows them on its next load. Prices are never changed.',
    ),
  ).toBeVisible({ timeout: 30_000 })
  const row = (name: string) => sheet.getByTestId('seed-service').filter({ hasText: name })
  // The design's "Normal massage" pairs with the CRM's (same name), its own picture shown; "Design ritual" has none.
  await expect(row('Normal massage')).toContainText('CRM: Normal massage')
  await expect(row('Normal massage')).toContainText('Same name')
  // A small server-made thumbnail of the design's own picture (never the full data: URI).
  await expect(row('Normal massage').locator('img')).toHaveAttribute('src', /^data:image\/webp;base64,/)
  await expect(row('Normal massage').getByRole('combobox')).toHaveValue('fill')
  await expect(row('Design ritual')).toContainText('No match')
  await expect(row('Design ritual').getByRole('combobox')).toHaveValue('skip')
  // The design's team photo goes to Ploy (no photo yet), shown on the website.
  await sheet.getByRole('combobox', { name: 'Therapist for Photo 1' }).selectOption({ label: 'Ploy Test' })
  await sheet.getByRole('checkbox', { name: 'Show Photo 1 on website' }).check()
  await sheet.getByRole('button', { name: 'Fill the CRM', exact: true }).click()
  await expect(page.getByText(/^CRM updated: 1 treatment filled, 1 therapist photo set/)).toBeVisible({
    timeout: 30_000,
  })

  const db = testDb()
  const [normal] = await db.select().from(services).where(eq(services.id, seed.normal))
  expect(normal!.imageUrl).toMatch(/^\/files\/[0-9a-f-]{36}$/)
  // Prices and durations untouched; the skipped "Design ritual" wasn't created.
  const prices = (rows: { durationMin: number; priceAed: string | null }[]) =>
    rows.map((v) => `${v.durationMin}:${v.priceAed}`).sort()
  expect(
    prices(await db.select().from(serviceVariants).where(eq(serviceVariants.serviceId, seed.normal))),
  ).toEqual(prices(seed.variants.filter((v) => v.serviceId === seed.normal)))
  expect(await db.select().from(services).where(eq(services.tenantId, seed.tenantId))).toHaveLength(2)
  const [ploy] = await db.select().from(staff).where(eq(staff.id, seed.ploy))
  expect(ploy).toMatchObject({ photoUrl: expect.stringMatching(/^\/files\//), showOnSite: true })
  expect(
    (await db.select().from(auditLog).where(eq(auditLog.tenantId, seed.tenantId))).some(
      (a) => a.action === 'site.design_seed',
    ),
  ).toBe(true)

  // Live at once (no publish): crm-data.json carries the CRM service's new photo and the opted-in therapist.
  const res = await viaHost(page, `${site(slug)}/crm-data.json`, { headers: { origin: 'null' } })
  expect(res.status()).toBe(200)
  const json = await res.json()
  const item = json.services.find((s: { id: string }) => s.id === seed.normal)
  expect(item.image).toContain(normal!.imageUrl)
  expect(json.staff.map((s: { name: string }) => s.name)).toEqual(['Ploy Test'])
})

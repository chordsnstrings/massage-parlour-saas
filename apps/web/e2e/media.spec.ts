import { expect, test } from '@playwright/test'
import { storedFiles, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { app, PORT, screenshotAt, seedCatalog, signUpOwner, site, testDb } from './helpers'

const HERO = 'Calm, clear and restorative.'
const png = async (name: string, background: string, width: number, height: number) => ({
  name,
  mimeType: 'image/png',
  buffer: await sharp({ create: { width, height, channels: 3, background } })
    .png()
    .toBuffer(),
})
// /files is served at the root of every host (never under /app or /s/{slug}).
const appOrigin = () => new URL(app).origin
/** Node can't resolve *.localhost like Chromium does: connect to loopback and send the Host header. */
const viaHost = (origin: string, path: string) =>
  [`http://127.0.0.1:${PORT}${path}`, { host: new URL(origin).host }] as const

test('media library: upload, describe, pick in the editor, publish and serve from /files', async ({
  page,
  playwright,
}) => {
  const { slug } = await signUpOwner(page, { spa: 'Cedar Spa' })
  await seedCatalog(slug)
  const siteOrigin = new URL(site(slug)).origin
  let fileUrl = ''

  await test.step('empty library → upload two images with progress', async () => {
    await page.goto(`${app}/${slug}/media`)
    await expect(page.getByRole('heading', { name: 'Media' })).toBeVisible()
    await expect(page.getByText('Your library is empty')).toBeVisible()
    await page
      .getByLabel('Upload images', { exact: true })
      .setInputFiles([
        await png('treatment-room.png', '#7a9a83', 3000, 2000),
        await png('hot-stones.png', '#c08552', 900, 1200),
      ])
    await expect(page.getByText(/^Uploaded · /)).toHaveCount(2)
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(2)
    await expect(page.getByText('No alt text')).toHaveCount(2)
  })

  await test.step('SVG and fake images are refused', async () => {
    await page.getByLabel('Upload images', { exact: true }).setInputFiles([
      {
        name: 'logo.svg',
        mimeType: 'image/svg+xml',
        buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      },
      {
        name: 'fake.png',
        mimeType: 'image/png',
        buffer: Buffer.from('definitely not a png file, just text'),
      },
    ])
    await expect(page.getByText(/SVG isn.t supported/)).toBeVisible()
    await expect(page.getByText(/isn.t an image we can use/)).toBeVisible()
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(2)
  })

  await test.step('edit alt text (EN + AR) and tags', async () => {
    await page.getByRole('button', { name: 'Edit treatment-room.webp' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByText('2400 × 1600px')).toBeVisible()
    await sheet.getByLabel('Alt text (English)').fill('Quiet treatment room')
    await sheet.getByLabel('Alt text (Arabic)').fill('غرفة علاج هادئة')
    await expect(sheet.getByLabel('Alt text (Arabic)')).toHaveAttribute('dir', 'rtl')
    await sheet.getByLabel('Tags').fill('Rooms, interior')
    await sheet.getByRole('button', { name: 'Save details' }).click()
    await expect(page.getByText('Image details saved')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('button', { name: 'Edit Quiet treatment room' })).toBeVisible()
    await expect(page.getByText('No alt text')).toHaveCount(1)
    await page.getByRole('link', { name: '#rooms' }).click()
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(1)
    await page.getByRole('link', { name: /#rooms/ }).click() // toggles the tag off
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(2)
    fileUrl =
      (
        await page
          .getByRole('button', { name: 'Edit Quiet treatment room' })
          .locator('img')
          .getAttribute('src')
      )?.split('?')[0] ?? ''
    expect(fileUrl).toMatch(/^\/files\/[0-9a-f-]{36}$/)
    await screenshotAt(page, 'media')
  })

  await test.step('public files: optimised WebP, immutable cache, ETag, thumbnails, on every host', async () => {
    const anon = await playwright.request.newContext()
    for (const origin of [siteOrigin, appOrigin()]) {
      const [url, host] = viaHost(origin, fileUrl)
      const res = await anon.get(url, { headers: host })
      expect(res.status()).toBe(200)
      expect(res.headers()['content-type']).toBe('image/webp')
      expect(res.headers()['cache-control']).toContain('immutable')
      const meta = await sharp(await res.body()).metadata()
      expect([meta.width, meta.height]).toEqual([2400, 1600])
      const etag = res.headers().etag!
      const again = await anon.get(url, { headers: { ...host, 'if-none-match': etag } })
      expect(again.status()).toBe(304)
    }
    const [thumbUrl, siteHost] = viaHost(siteOrigin, `${fileUrl}/treatment-room.webp?w=480`)
    const thumb = await anon.get(thumbUrl, { headers: siteHost })
    expect(thumb.status()).toBe(200)
    expect((await sharp(await thumb.body()).metadata()).width).toBe(480)
    const [missing] = viaHost(siteOrigin, '/files/00000000-0000-4000-8000-000000000000')
    expect((await anon.get(missing, { headers: siteHost })).status()).toBe(404)

    // Private files: members only, never publicly cached.
    const db = testDb()
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
    const [receipt] = await db
      .insert(storedFiles)
      .values({
        tenantId: tenant!.id,
        bytes: Buffer.from('%PDF-1.4 receipt'),
        contentType: 'application/pdf',
        size: 16,
        filename: 'receipt.pdf',
        isPublic: false,
        purpose: 'receipt',
      })
      .returning({ id: storedFiles.id })
    const [privateUrl, appHost] = viaHost(appOrigin(), `/files/${receipt!.id}`)
    expect((await anon.get(privateUrl, { headers: appHost })).status()).toBe(404)
    // Signed in (same-origin fetch from the dashboard carries the session cookie).
    const own = await page.evaluate(async (u) => {
      const r = await fetch(u)
      return { status: r.status, cache: r.headers.get('cache-control') }
    }, `/files/${receipt!.id}`)
    expect(own.status).toBe(200)
    expect(own.cache).toContain('private')
    await anon.dispose()
  })

  await test.step('website editor: choose the image from the library and publish', async () => {
    await page.goto(`${app}/${slug}/website`)
    await page.getByRole('button', { name: 'Use Nordic Clean' }).click()
    await page.getByRole('link', { name: 'Edit Home' }).click()
    await page.waitForURL(/\/website\/editor\//)
    const canvas = page.frameLocator('#preview-frame')
    await expect(canvas.getByRole('heading', { name: HERO })).toBeVisible({ timeout: 30_000 })
    const choose = page.getByRole('button', { name: 'Choose from library' })
    // Clicks before the editor has hydrated don't select the block — retry until the Hero's fields show.
    await expect(async () => {
      await canvas.getByRole('heading', { name: HERO }).click()
      await expect(choose).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    await choose.click()
    const picker = page.getByRole('dialog', { name: 'Choose an image' })
    await expect(picker.getByRole('button', { name: /^Use / })).toHaveCount(2)
    await page.screenshot({ path: 'test-results/screens/media-picker-1280.png' })
    await picker.getByLabel('Search images').fill('quiet')
    await expect(picker.getByRole('button', { name: /^Use / })).toHaveCount(1)
    await picker.getByRole('button', { name: 'Use Quiet treatment room' }).click()
    await expect(picker).toBeHidden()
    await expect(page.getByRole('button', { name: 'Replace from library' })).toBeVisible()
    await expect(canvas.locator(`img[src="${fileUrl}"]`)).toBeVisible()
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await page.getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByText('Published — your page is live')).toBeVisible()
  })

  await test.step('public site shows the library image from /files', async () => {
    await page.goto(site(slug))
    const img = page.locator(`img[src="${fileUrl}"]`)
    await expect(img).toBeVisible()
    await expect
      .poll(() =>
        img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth),
      )
      .toBe(2400)
  })

  await test.step('deleting warns where an image is used', async () => {
    await page.goto(`${app}/${slug}/media`)
    await page.getByRole('button', { name: 'Edit Quiet treatment room' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText(/Used on 1 page: /)).toBeVisible()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Edit hot-stones.webp' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
    await expect(page.getByText('Not used on any website page. Delete it for good?')).toBeVisible()
    await page.getByRole('button', { name: 'Delete image' }).click()
    await expect(page.getByText('Image deleted')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(1)
  })
})

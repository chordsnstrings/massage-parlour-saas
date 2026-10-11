import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { siteTemplates, storedFiles, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { admin, base, makeStudio, signInStudioOnAdmin, signUpOwner, studioUrl, testDb } from './helpers'

/** Random noise PNG (doesn't compress): ~300 KB each. */
async function noisePng(size = 320) {
  return sharp(randomBytes(size * size * 3), { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toBuffer()
}

const font = () =>
  readFile(
    createRequire(import.meta.url).resolve('@fontsource/marcellus/files/marcellus-latin-400-normal.woff2'),
  )

test('R24 HTML upload: a > 1 MB design with embedded images and a font uploads, its files move out, it renders', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const owner = await signUpOwner(page, { spa: 'Upload Spa' })
  const { slug } = owner
  await makeStudio(slug)
  const imgs = await Promise.all([1, 2, 3].map(() => noisePng()))
  const uri = (type: string, b: Buffer) => `data:${type};base64,${b.toString('base64')}`
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Big</title><style>
@font-face{font-family:Big;src:url(${uri('font/woff2', await font())}) format("woff2")}
h1{font-family:Big,serif}.bg{height:200px;background:url("${uri('image/png', imgs[2]!)}")}
</style></head><body><h1 id="t">Big design</h1>
<img id="a" src="${uri('image/png', imgs[0]!)}" width="320" height="320" alt="a">
<img id="b" src="${uri('image/png', imgs[1]!)}" width="320" height="320" alt="b"><div class="bg"></div></body></html>`
  expect(html.length).toBeGreaterThan(1024 * 1024)

  await signInStudioOnAdmin(page, owner.email)
  const posts: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/files/templates')) posts.push(r.url())
  })

  await test.step('a file over 5 MB: a clear message at once and on submit; nothing is sent', async () => {
    await page.goto(`${admin}/templates`)
    await page.getByRole('button', { name: 'Upload HTML' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Template name').fill('Too Big')
    const huge = `<!doctype html><html><body>${'x'.repeat(Math.round(5.2 * 1024 * 1024))}</body></html>`
    await dialog
      .getByLabel('HTML file')
      .setInputFiles({ name: 'huge.html', mimeType: 'text/html', buffer: Buffer.from(huge) })
    await expect(dialog.getByTestId('html-file-too-large')).toHaveText(
      /^The file is 5\.2 MB; the limit is 5 MB\./,
    )
    await dialog.getByRole('button', { name: 'Upload' }).click()
    await expect(page.getByText(/The file is 5\.2 MB; the limit is 5 MB/).first()).toBeVisible()
    expect(posts).toEqual([])
    await page.keyboard.press('Escape')
    // Still the console page (never the generic error page).
    await expect(page.getByRole('heading', { name: 'Site templates' })).toBeVisible()
  })

  await test.step('a direct POST over the limit gets 413 JSON, never the error page', async () => {
    // (Node's request context can't resolve *.localhost: the plain host; the size check comes before the session.)
    const res = await page.request.post(`${base}/files/templates?kind=html`, {
      headers: { origin: base },
      multipart: {
        name: 'Too Big',
        file: { name: 'huge.html', mimeType: 'text/html', buffer: Buffer.alloc(5.4 * 1024 * 1024, 120) },
      },
      failOnStatusCode: false,
    })
    expect(res.status()).toBe(413)
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringMatching(/the limit is 5 MB/) })
  })

  await test.step('a template JSON over 2 MB: the client message', async () => {
    await page.getByRole('button', { name: 'Import JSON' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Template file').setInputFiles({
      name: 't.json',
      mimeType: 'application/json',
      buffer: Buffer.alloc(2.2 * 1024 * 1024, 32),
    })
    await dialog.getByRole('button', { name: 'Import' }).click()
    await expect(dialog.getByText(/^The file is 2\.2 MB; the limit is 2 MB\.$/)).toBeVisible()
    expect(posts).toEqual([])
    await page.keyboard.press('Escape')
  })

  await test.step('the 1.3 MB design uploads; its 4 files move out; the stored page is small', async () => {
    await page.getByRole('button', { name: 'Upload HTML' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Template name').fill('Big Upload')
    await dialog
      .getByLabel('HTML file')
      .setInputFiles({ name: 'big.html', mimeType: 'text/html', buffer: Buffer.from(html) })
    await dialog.getByRole('checkbox', { name: /Spas can pick it right away/ }).check()
    await dialog.getByRole('button', { name: 'Upload' }).click()
    await expect(
      page.getByText(/Big Upload uploaded\. Moved 4 embedded image\/font files \(\d\.\d MB\)/),
    ).toBeVisible({
      timeout: 60_000,
    })
    const [row] = await testDb().select().from(siteTemplates).where(eq(siteTemplates.key, 'big-upload'))
    const json = JSON.stringify(row!.pages)
    expect(json.length).toBeLessThan(500 * 1024)
    expect(json).not.toContain('data:image/png')
    expect(json.match(/\/files\/[0-9a-f-]{36}\/[0-9a-f]{16}\.(?:png|woff2)/g)).toHaveLength(4)
    expect(json).toContain('"phoneFixes":false')
  })

  await test.step('the template preview renders the moved images and font', async () => {
    const href = await page.getByRole('link', { name: 'Preview Big Upload' }).getAttribute('href')
    await page.goto(new URL(href!, page.url()).href)
    const frame = page.frameLocator('iframe.site-html-design')
    await expect(frame.locator('#t')).toHaveText('Big design', { timeout: 30_000 })
    await expect
      .poll(() =>
        frame
          .locator('#a')
          .evaluate((img: HTMLImageElement) => [img.naturalWidth, img.currentSrc.includes('/files/')]),
      )
      .toEqual([320, true])
    await expect
      .poll(() =>
        frame.locator('#t').evaluate(() => document.fonts.ready.then(() => document.fonts.check('20px Big'))),
      )
      .toBe(true)
  })

  await test.step('applied to a spa: the page uses the spa’s own files', async () => {
    await page.goto(studioUrl(slug))
    await page.getByRole('button', { name: 'Use Big Upload' }).click()
    await expect(page.getByTestId('current-template')).toHaveText('Big Upload', { timeout: 30_000 })
    const db = testDb()
    const [spa] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug))
    const files = await db
      .select({ id: storedFiles.id, purpose: storedFiles.purpose, isPublic: storedFiles.isPublic })
      .from(storedFiles)
      .where(eq(storedFiles.tenantId, spa!.id))
    const design = files.filter((f) => f.purpose === 'html_design')
    expect(design).toHaveLength(4)
    expect(design.every((f) => f.isPublic)).toBe(true)
    const preview = page.waitForResponse((r) => design.some((f) => r.url().includes(`/files/${f.id}/`)))
    await page.goto(studioUrl(slug, '/preview'))
    expect((await preview).headers()['access-control-allow-origin']).toBe('*')
  })
})

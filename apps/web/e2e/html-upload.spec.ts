import { createHash, randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { expect, test } from '@playwright/test'
import { siteTemplateFiles, siteTemplates, storedFiles, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { admin, base, makeStudio, signInStudioOnAdmin, signUpOwner, site, studioUrl, testDb } from './helpers'

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

test('R24 HTML upload: a 4.6 MB design (embedded images + font, big script, Arabic) is stored and shown byte for byte', async ({
  page,
}) => {
  test.setTimeout(300_000)
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
<img id="b" src="${uri('image/png', imgs[1]!)}" width="320" height="320" alt="b"><div class="bg"></div>
<p id="ar" dir="rtl">${'سبا هادئ في دبي '.repeat(80_000)}</p>
<script>window.__big = [${'"a \\"quoted\\" line",\n'.repeat(60_000)}].length</script></body></html>`
  const bytes = Buffer.from(html)
  // Over the old ~500 KB stored-design cap and the 1 MB server-action body, under the 5 MB upload limit.
  expect(bytes.length).toBeGreaterThan(4.5 * 1024 * 1024)
  expect(bytes.length).toBeLessThan(5 * 1024 * 1024)
  const sha = createHash('sha256').update(bytes).digest('hex')

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

  await test.step('the 4.6 MB design uploads and is stored exactly as the file; the page JSON only references it', async () => {
    await page.getByRole('button', { name: 'Upload HTML' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Template name').fill('Big Upload')
    await dialog
      .getByLabel('HTML file')
      .setInputFiles({ name: 'big.html', mimeType: 'text/html', buffer: bytes })
    await dialog.getByRole('checkbox', { name: /Spas can pick it right away/ }).check()
    await dialog.getByRole('button', { name: 'Upload' }).click()
    await expect(page.getByText(/Big Upload uploaded\. Stored exactly as the file\./)).toBeVisible({
      timeout: 60_000,
    })
    const [row] = await testDb().select().from(siteTemplates).where(eq(siteTemplates.key, 'big-upload'))
    const json = JSON.stringify(row!.pages)
    expect(json.length).toBeLessThan(4 * 1024)
    expect(json).toContain('"html":""')
    expect(json).toContain(`"sha256":"${sha}"`)
    expect(json).toContain('"phoneFixes":false')
    const [file] = await testDb().select().from(siteTemplateFiles).where(eq(siteTemplateFiles.sha256, sha))
    expect(Buffer.compare(file!.bytes!, bytes)).toBe(0)
  })

  await test.step('the template preview renders it: embedded images (still data:), font, script, Arabic', async () => {
    const href = await page.getByRole('link', { name: 'Preview Big Upload' }).getAttribute('href')
    await page.goto(new URL(href!, page.url()).href)
    const frame = page.frameLocator('iframe.site-html-design')
    await expect(frame.locator('#t')).toHaveText('Big design', { timeout: 30_000 })
    await expect
      .poll(() =>
        frame
          .locator('#a')
          .evaluate((img: HTMLImageElement) => [
            img.naturalWidth,
            img.currentSrc.startsWith('data:image/png'),
          ]),
      )
      .toEqual([320, true])
    await expect
      .poll(() =>
        frame.locator('#t').evaluate(() => document.fonts.ready.then(() => document.fonts.check('20px Big'))),
      )
      .toBe(true)
    expect(await frame.locator('#t').evaluate(() => (window as { __big?: number }).__big)).toBe(60_000)
    await expect(frame.locator('#ar')).toContainText('سبا هادئ في دبي')
  })

  await test.step('applied to a spa and published: its own private copy, the live page is the file', async () => {
    await page.goto(studioUrl(slug))
    await page.getByRole('button', { name: 'Use Big Upload' }).click()
    await expect(page.getByTestId('current-template')).toHaveText('Big Upload', { timeout: 30_000 })
    const db = testDb()
    const [spa] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug))
    const files = await db
      .select({ purpose: storedFiles.purpose, isPublic: storedFiles.isPublic, bytes: storedFiles.bytes })
      .from(storedFiles)
      .where(eq(storedFiles.tenantId, spa!.id))
    const docs = files.filter((f) => f.purpose === 'html_design_doc')
    expect(docs).toHaveLength(1)
    expect(docs[0]!.isPublic).toBe(false)
    expect(Buffer.compare(docs[0]!.bytes!, bytes)).toBe(0)
    await page.getByRole('button', { name: 'Publish site' }).click()
    await page.getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByText('Published 1 page')).toBeVisible({ timeout: 30_000 })
    const live = (await page.goto(site(slug)))!
    expect(live.status()).toBe(200)
    const body = await live.text()
    // Only invisible additions in <head>: everything from <body> on is the file, byte for byte.
    expect(body.slice(body.indexOf('<body>'))).toBe(html.slice(html.indexOf('<body>')))
  })

  await test.step('a windows-1252 file reads as the browser reads it (no replacement characters)', async () => {
    const latin = Buffer.concat([
      Buffer.from(
        '<!doctype html><html><head><meta charset="windows-1252"><title>L</title></head><body><p id="l">Caf',
      ),
      Buffer.from([0xe9, 0x20, 0x93]),
      Buffer.from('Relax'),
      Buffer.from([0x94, 0x20, 0x80]),
      Buffer.from('5</p></body></html>'),
    ])
    await page.goto(`${admin}/templates`)
    await page.getByRole('button', { name: 'Upload HTML' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Template name').fill('Latin Design')
    await dialog
      .getByLabel('HTML file')
      .setInputFiles({ name: 'latin.html', mimeType: 'text/html', buffer: latin })
    await dialog.getByRole('button', { name: 'Upload' }).click()
    await expect(page.getByText(/Latin Design uploaded.*\(read as windows-1252\)/)).toBeVisible({
      timeout: 60_000,
    })
    const href = await page.getByRole('link', { name: 'Preview Latin Design' }).getAttribute('href')
    await page.goto(new URL(href!, page.url()).href)
    await expect(page.frameLocator('iframe.site-html-design').locator('#l')).toHaveText('Café “Relax” €5', {
      timeout: 30_000,
    })
  })
})

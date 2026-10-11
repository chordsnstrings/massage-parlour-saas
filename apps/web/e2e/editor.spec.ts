import { expect, test } from '@playwright/test'
import { savedSections, sitePages, webEvents } from '@spa/db'
import { ensureSite, saveDraft } from '@spa/services'
import { eq } from 'drizzle-orm'
import QRCode from 'qrcode'
import {
  editorUrl,
  makeStudio,
  screenshotAt,
  seedCatalog,
  signInStudioOnAdmin,
  signUpOwner,
  site,
  testDb,
} from './helpers'

const HERO = 'Unwind in the heart of the city'

/** A small home page with known preflight findings: hero image without alt text, a heading without Arabic. */
const homePage = {
  root: { props: { title: { en: 'Home', ar: 'الرئيسية' }, description: { en: '' } } },
  content: [
    {
      type: 'Hero',
      props: {
        id: 'hero-1',
        variant: 'split',
        eyebrow: { en: 'Massage & wellness', ar: 'مساج وعافية' },
        title: { en: HERO, ar: 'استرخِ في قلب المدينة' },
        subtitle: { en: 'Unhurried treatments.', ar: 'جلسات هادئة.' },
        buttons: [
          { label: { en: 'Book now', ar: 'احجز الآن' }, action: 'book', target: '', style: 'primary' },
        ],
        image: '/icon.svg',
        imageAlt: { en: '' },
        background: 'none',
      },
    },
    {
      type: 'Section',
      props: {
        id: 'about-1',
        background: 'surface',
        padding: { base: 'lg' },
        width: 'contained',
        gap: 'md',
        content: [
          {
            type: 'Heading',
            props: {
              id: 'about-heading',
              eyebrow: { en: '' },
              text: { en: 'About our spa' },
              level: 'h2',
              size: 'lg',
              align: { base: 'start' },
            },
          },
        ],
      },
    },
  ],
}

test('site editor: library, saved sections, preflight, scoped CSS, analytics, versions and share link', async ({
  page,
  browser,
}) => {
  const { slug, email } = await signUpOwner(page, { spa: 'Juniper Spa' })
  await makeStudio(slug) // the website is built by the studio (super-admin, console)
  await signInStudioOnAdmin(page, email)
  const seed = await seedCatalog(slug)
  const db = testDb()
  await db.transaction((tx) =>
    ensureSite(tx, seed.tenantId, {
      key: 'nordic',
      name: 'Nordic Clean',
      theme: {},
      pages: [{ slug: '', title: { en: 'Home', ar: 'الرئيسية' }, data: homePage }],
    }),
  )
  const [home] = await db.select().from(sitePages).where(eq(sitePages.tenantId, seed.tenantId))
  const editor = editorUrl(slug, home!.id)
  const canvas = page.frameLocator('#preview-frame').first()
  const libraryNav = page.locator('[class*="NavItem-link"]', { hasText: 'Library' })
  const openLibrary = async () => {
    if (!(await page.getByRole('heading', { name: 'Library' }).isVisible())) await libraryNav.click()
    await expect(page.getByRole('heading', { name: 'Library' })).toBeVisible()
  }

  await test.step('open the editor and insert a section preset from the library', async () => {
    await page.goto(editor)
    await expect(canvas.getByRole('heading', { name: HERO })).toBeVisible({ timeout: 30_000 })
    const blocks = canvas.locator('[data-puck-component]')
    const before = await blocks.count()
    await openLibrary()
    await expect(page.getByText('Inserts at the end of the page')).toBeVisible()
    await page
      .getByRole('button', { name: /^Insert / })
      .first()
      .click()
    await expect.poll(() => blocks.count()).toBeGreaterThan(before)
    await screenshotAt(page, 'editor')
    // Library panel at phone and desktop widths (Puck folds side panels when the viewport changes).
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: width < 768 ? 780 : 900 })
      await openLibrary()
      await page.waitForTimeout(300)
      await page.screenshot({ path: `test-results/screens/editor-library-${width}.png` })
    }
    await page.setViewportSize({ width: 1280, height: 800 })
    await openLibrary()
  })

  await test.step('save the inserted section as a global section', async () => {
    await page.getByRole('tab', { name: /Saved/ }).click()
    await page.getByRole('button', { name: /^Save selected/ }).click()
    await page.getByPlaceholder('e.g. Ramadan offer band').fill('Promo band')
    await page.getByLabel(/Global section/).check()
    await page.getByRole('button', { name: 'Save section' }).click()
    await expect(page.getByText('Saved as a global section')).toBeVisible()
    await expect(page.getByText('Promo band').first()).toBeVisible()
    await expect(page.getByText('Global', { exact: true }).first()).toBeVisible()
  })

  await test.step('edit the global section in its modal editor; the page follows', async () => {
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    const modal = page.getByRole('dialog', { name: 'Edit global section Promo band' })
    await expect(modal).toBeVisible()
    const inner = page.frameLocator('#preview-frame').last()
    const heading = inner.getByRole('heading').first()
    await expect(heading).toBeVisible({ timeout: 20_000 })
    const before = (await heading.textContent())?.trim() ?? ''
    await heading.click()
    // The block's title field holds the heading text (field names differ per preset).
    const boxes = modal.getByRole('textbox')
    await expect(boxes.first()).toBeVisible()
    let filled = false
    for (let i = 0; i < (await boxes.count()) && !filled; i++) {
      if ((await boxes.nth(i).inputValue()) === before) {
        await boxes.nth(i).fill('Ready for calm?')
        filled = true
      }
    }
    expect(filled).toBe(true)
    await expect(inner.getByRole('heading', { name: 'Ready for calm?' })).toBeVisible()
    await modal.getByRole('button', { name: 'Save global section' }).click()
    await expect(page.getByText(/Global section updated/)).toBeVisible()
    await expect(modal).toHaveCount(0)
    await expect(canvas.getByRole('heading', { name: 'Ready for calm?' })).toBeVisible()
  })

  await test.step('AI assists explain when AI is not set up', async () => {
    await canvas.getByRole('heading', { name: HERO }).click()
    await page.getByRole('button', { name: 'AI assist for Headline' }).click()
    await expect(page.getByText(/AI writing help isn’t set up for this spa yet/)).toBeVisible()
    await page.keyboard.press('Escape')
  })

  await test.step('publish: preflight lists missing alt text and Arabic, publishing anyway works', async () => {
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByText('Image has no alt text', { exact: false })).toBeVisible()
    await expect(sheet.getByText('“About our spa” has no Arabic text')).toBeVisible()
    await expect(sheet.getByText('Warnings don’t block publishing.')).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Go to block' }).first()).toBeVisible()
    await page.screenshot({ path: 'test-results/screens/editor-preflight-1280.png' })
    await sheet.getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByText('Published — your page is live')).toBeVisible()
  })

  await test.step('custom CSS on a section is scoped on the public page', async () => {
    // Select the heading, then its parent Section via the block action bar.
    // The canvas re-renders after publishing, which can detach the action bar mid-click: retry until selected.
    await expect(async () => {
      await canvas.getByRole('heading', { name: 'About our spa' }).click()
      await canvas.getByRole('button', { name: 'Select parent' }).click({ timeout: 5_000 })
      await expect(page.getByRole('heading', { name: 'Section', exact: true })).toBeVisible({
        timeout: 2_000,
      })
    }).toPass({ timeout: 45_000 })
    const css = page.locator('textarea[placeholder^=":scope"]:visible')
    await expect(css).toBeVisible()
    // Schedule: an end before the start is shown, not saved; a date-only end covers that whole day.
    const from = page.locator('input[aria-label="Show from date"]:visible')
    const until = page.locator('input[aria-label="Until date"]:visible')
    await from.fill('2026-03-14')
    await until.fill('2026-03-01')
    await expect(page.getByText('“Until” must be after “Show from” — not saved yet.')).toBeVisible()
    await until.fill('2026-03-14')
    await expect(page.getByText(/must be after/)).toHaveCount(0)
    await expect(page.getByText('Ended — hidden from visitors · Dubai time')).toBeVisible()
    await until.fill('')
    await from.fill('')
    await expect(page.locator('span:visible', { hasText: 'Always shown · Dubai time' })).toBeVisible()
    await css.fill('h2 { color: rgb(200, 0, 0) }\n@import url("https://evil.test/x.css");')
    await expect(page.getByText('Ignored: @import')).toBeVisible()
    await expect(canvas.locator('[data-section-id="about-1"] h2')).toHaveCSS('color', 'rgb(200, 0, 0)')
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    await expect(page.getByRole('dialog').getByText(/Some custom CSS is ignored: @import/)).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByText('Published — your page is live')).toBeVisible()

    const visitor = await browser.newPage()
    await visitor.goto(site(slug))
    await expect(visitor.getByRole('heading', { name: 'About our spa' })).toHaveCSS('color', 'rgb(200, 0, 0)')
    await expect(visitor.getByRole('heading', { name: HERO })).not.toHaveCSS('color', 'rgb(200, 0, 0)')
    const style = await visitor.locator('[data-section-id="about-1"] > style').textContent()
    expect(style).toBe('[data-section-id="about-1"] h2{color:rgb(200, 0, 0)}')
    // The saved global section renders on the live page too.
    await expect(visitor.locator('[data-block-type="GlobalSection"]')).toBeAttached()
    await expect(visitor.getByRole('heading', { name: 'Ready for calm?' })).toBeVisible()
    await visitor.close()
  })

  await test.step('analytics overlay shows per-block reach and clicks', async () => {
    const ev = (session: string, type: string, blockId?: string) => ({
      tenantId: seed.tenantId,
      sessionHash: session,
      type,
      path: '/',
      blockId: blockId ?? null,
    })
    await db
      .insert(webEvents)
      .values([
        ev('a', 'pageview'),
        ev('b', 'pageview'),
        ev('a', 'block_view', 'hero-1'),
        ev('a', 'booking_start', 'hero-1'),
      ])
    await page.getByRole('button', { name: 'Block analytics' }).click()
    // The visitor above is tracked too, so the exact reach depends on beacon timing.
    const badge = canvas.locator('[data-insight-badge]').filter({ hasText: /^Seen by \d+% · 1 click$/ })
    await expect(badge).toBeVisible()
    await page.getByRole('button', { name: 'Block analytics' }).click()
    await expect(canvas.locator('[data-insight-badge]')).toHaveCount(0)
  })

  await test.step('versions: share a preview link and restore the previous version', async () => {
    await page.getByRole('button', { name: 'Versions and preview link' }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByText('Published', { exact: true }).first()).toBeVisible()
    await sheet.getByRole('button', { name: 'Create link' }).click()
    await expect(sheet.getByRole('img', { name: 'QR code for the preview link' })).toBeVisible()
    await page.screenshot({ path: 'test-results/screens/editor-versions-1280.png' })
    const url = await sheet.getByRole('textbox', { name: 'Preview link' }).inputValue()
    expect(url).toContain('/website/preview?token=')
    // The QR code encodes exactly that link (same modules as a reference encoding at level M).
    const modules = (svg: string) => svg.match(/<path[^>]*stroke="[^"]*"[^>]*\sd="([^"]+)"/)?.[1]
    const shown = modules(await sheet.getByRole('img', { name: 'QR code for the preview link' }).innerHTML())
    expect(shown).toBeTruthy()
    expect(shown).toBe(
      modules(await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 1 })),
    )

    // Works without signing in.
    const guest = await browser.newContext()
    const preview = await guest.newPage()
    await preview.goto(url)
    await expect(preview.getByRole('heading', { name: HERO })).toBeVisible()
    await expect(preview.getByText(/Draft preview · not live/)).toBeVisible()
    await preview.setViewportSize({ width: 360, height: 780 })
    await preview.screenshot({ path: 'test-results/screens/editor-shared-preview-360.png' })
    await preview.goto(url.replace(/token=.*/, 'token=forged.token'))
    await expect(preview.getByText('This preview link has expired')).toBeVisible()
    await guest.close()

    await sheet
      .getByRole('button', { name: /^Name version/ })
      .first()
      .click()
    await sheet.getByRole('textbox', { name: 'Version name' }).fill('With red heading')
    await sheet.getByRole('button', { name: 'Save version name' }).click()
    await expect(sheet.getByText('With red heading')).toBeVisible()

    await sheet.getByRole('button', { name: 'Restore' }).first().click()
    await sheet.getByRole('button', { name: 'Restore as draft' }).click()
    await expect(page.getByText('Restored as your draft')).toBeVisible()
    await expect(canvas.locator('[data-section-id="about-1"] style')).toHaveCount(0)
    await expect(canvas.getByRole('heading', { name: 'About our spa' })).not.toHaveCSS(
      'color',
      'rgb(200, 0, 0)',
    )
  })

  await test.step('the server refuses to publish an http image, even inside a global section', async () => {
    const [banner] = await db
      .insert(savedSections)
      .values({
        tenantId: seed.tenantId,
        name: 'Old banner',
        isGlobal: true,
        data: {
          type: 'Image',
          props: {
            id: 'image-old',
            src: 'http://127.0.0.1:9/banner.png',
            alt: { en: 'Banner' },
            caption: { en: '' },
            aspect: 'wide',
            rounded: true,
          },
        },
      })
      .returning()
    const data = {
      ...homePage,
      content: [
        ...homePage.content,
        { type: 'GlobalSection', props: { id: 'global-old', sectionId: banner!.id } },
      ],
    }
    await db.transaction((tx) => saveDraft(tx, { tenantId: seed.tenantId, pageId: home!.id, data }))
    await page.goto(editor)
    await expect(canvas.getByRole('heading', { name: HERO })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Publish', exact: true }).click()
    // The dialog only checks the page itself; the server also checks the global sections it shows.
    await page.getByRole('dialog').getByRole('button', { name: 'Publish now' }).click()
    await expect(
      page.getByText(/Image address must start with https:\/\/ \(in a global section\)/),
    ).toBeVisible()
  })
})

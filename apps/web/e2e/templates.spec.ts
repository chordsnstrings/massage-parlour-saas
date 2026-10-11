import { expect, type Frame, type Locator, test } from '@playwright/test'
import { type BlockSpec, checkNodes } from '@spa/services'
import { siteConfig } from '../src/components/site/config'
import { PAGE_TEMPLATES, SECTION_PRESETS } from '../src/components/site/presets'
import { TEMPLATES } from '../src/components/site/templates'
import {
  admin,
  makeStudio,
  screenshotAt,
  seedCatalog,
  signInStudioOnAdmin,
  signUpOwner,
  site,
  studioUrl,
} from './helpers'

const NAMES = [
  'Zen Minimal',
  'Dark Luxury',
  'Nordic Clean',
  'Thai Teak',
  'Desert Sand',
  'Tropical Bali',
  'Urban Express',
  'Hotel Spa',
  // R5 design templates
  'Signature',
  'Noir Gold',
  'Ivory Marble',
  'Navy Official',
  'Emerald Prestige',
  'Platinum Minimal',
  'Desert Night',
  'Monogram Atelier',
  'Obsidian Glass',
  'Sandstone Bronze',
  'Split Flap',
  'Aurora Glass',
  'Blueprint',
  'Sahara',
  'Clay',
]

test('presets, page templates and templates only use real blocks with their required props', () => {
  // Required = every prop a block declares a default for; slots are checked recursively.
  const spec: BlockSpec = Object.fromEntries(
    Object.entries(siteConfig.components).map(([name, c]) => [
      name,
      {
        required: Object.keys(c.defaultProps ?? {}),
        slots: Object.entries(c.fields ?? {})
          .filter(([, f]) => (f as { type: string }).type === 'slot')
          .map(([k]) => k),
      },
    ]),
  )
  expect(SECTION_PRESETS.length).toBeGreaterThanOrEqual(24)
  const perCategory: Record<string, number> = {}
  for (const p of SECTION_PRESETS) perCategory[p.category] = (perCategory[p.category] ?? 0) + 1
  expect(perCategory).toMatchObject({
    hero: 4,
    services: 3,
    about: 3,
    team: 2,
    offers: 3,
    'social-proof': 5, // + F15 Google reviews, Instagram feed
    media: 2, // F15 video, blog posts
  })
  expect(new Set(SECTION_PRESETS.map((p) => p.key)).size).toBe(SECTION_PRESETS.length)
  for (const p of SECTION_PRESETS) expect(checkNodes([p.node], spec), p.key).toEqual([])
  expect(PAGE_TEMPLATES.map((t) => t.name)).toEqual([
    'Ramadan offers',
    'Couples package',
    'Corporate wellness',
    'Gift cards',
    'Our story',
    'Team',
    'Gallery',
  ])
  for (const t of PAGE_TEMPLATES) expect(checkNodes(t.content, spec), t.key).toEqual([])
  expect(Object.values(TEMPLATES).map((t) => t.name)).toEqual(NAMES)
  for (const t of Object.values(TEMPLATES)) {
    expect(t.pages.map((p) => p.slug)).toEqual(expect.arrayContaining(['', 'services', 'about', 'contact']))
    expect(new Set(t.pages.map((p) => p.slug)).size, t.key).toBe(t.pages.length)
    for (const p of t.pages)
      expect(checkNodes(p.data.content as unknown[], spec), `${t.key}/${p.slug}`).toEqual([])
  }
})

test('design templates: tokens, hero art and a 3D scroll scene each', () => {
  const designs = Object.values(TEMPLATES).slice(8)
  expect(designs).toHaveLength(15)
  const scenes = new Set<string>()
  for (const t of designs) {
    expect(t.theme.headingFace, t.key).not.toBe('theme')
    expect(t.theme.backdrop !== 'none' || t.theme.emblem !== 'none', t.key).toBe(true)
    const home = t.pages.find((p) => p.slug === '')!.data.content as {
      type: string
      props: { scene?: string }
    }[]
    const own = home.map((n) => n.props.scene).filter((s) => s && s !== 'reveal' && s !== 'depart')
    expect(own.length, t.key).toBeGreaterThan(0)
    for (const s of own) scenes.add(s!)
  }
  expect(scenes.size).toBeGreaterThanOrEqual(12)
})

test('templates: gallery of all built-ins, side-by-side switch with undo, Desert Sand in EN + AR, page templates, studio', async ({
  page,
}) => {
  const owner = await signUpOwner(page, { spa: 'Dune Spa' })
  const { slug } = owner
  await makeStudio(slug) // the website is built by the studio (super-admin, console)
  await seedCatalog(slug)
  await signInStudioOnAdmin(page, owner.email)

  await test.step('the gallery shows every built-in template with its thumbnail', async () => {
    await page.goto(studioUrl(slug))
    for (const name of NAMES) await expect(page.getByRole('article', { name })).toBeVisible()
    const thumb = page.getByRole('img', { name: 'Desert Sand preview' })
    await thumb.scrollIntoViewIfNeeded()
    await expect.poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(640)
    await page.getByRole('button', { name: 'Use Zen Minimal' }).click()
    await expect(page.getByTestId('current-template')).toHaveText('Zen Minimal', { timeout: 30_000 })
    await expect(page.getByRole('link', { name: 'Edit About' })).toBeVisible()
  })

  await test.step('switching shows before/after side by side and can be undone', async () => {
    await page
      .getByRole('article', { name: 'Desert Sand' })
      .getByRole('button', { name: 'Apply Desert Sand' })
      .click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('iframe[title="Zen Minimal now"]')).toBeAttached()
    await expect(dialog.locator('iframe[title="Desert Sand after"]')).toBeAttached()
    // Nothing is live yet, so starting from the sample pages is pre-selected.
    await expect(dialog.getByRole('checkbox')).toBeChecked()
    await dialog.getByRole('button', { name: 'Switch to Desert Sand' }).click()
    await expect(page.getByText('Desert Sand applied')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('current-template')).toHaveText('Desert Sand', { timeout: 30_000 })
    await expect(page.getByText('Switched from Zen Minimal to Desert Sand')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Edit Offers' })).toBeVisible()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByText('Back to Zen Minimal')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('current-template')).toHaveText('Zen Minimal', { timeout: 30_000 })
    await expect(page.getByRole('link', { name: 'Edit Offers' })).toHaveCount(0)

    await page
      .getByRole('article', { name: 'Desert Sand' })
      .getByRole('button', { name: 'Apply Desert Sand' })
      .click()
    await page.getByRole('dialog').getByRole('button', { name: 'Switch to Desert Sand' }).click()
    await expect(page.getByTestId('current-template')).toHaveText('Desert Sand', { timeout: 30_000 })
  })

  await test.step('publish: the public site renders Desert Sand, and Arabic right-to-left', async () => {
    await page.getByRole('button', { name: 'Publish site' }).click()
    await page.getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByText('Published 5 pages')).toBeVisible({ timeout: 30_000 })
    await page.goto(site(slug))
    await expect(page.getByRole('heading', { name: 'Desert rituals, oasis calm' })).toBeVisible()
    await expect(page.getByText('AED 350').first()).toBeVisible()
    await page.goto(`${site(slug)}?lang=ar`)
    await expect(page.locator('.site-root')).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { name: 'طقوس الصحراء وسكينة الواحة' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'مساج سويدي' })).toBeVisible()
    // Arabic-forward typography: RTL headings use the template's Kufi face.
    const face = await page
      .getByRole('heading', { name: 'طقوس الصحراء وسكينة الواحة' })
      .evaluate((el) => getComputedStyle(el).fontFamily)
    expect(face).toContain('Kufi')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await screenshotAt(page, 'templates-desert-ar')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto(`${site(slug)}/offers?lang=ar`)
    await expect(page.getByRole('heading', { name: 'طقوس موسمية' })).toBeVisible()
  })

  await test.step('add the Ramadan offers page from a page template', async () => {
    await page.goto(studioUrl(slug))
    await page.getByRole('button', { name: 'Add page' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Ramadan offers/ }).check()
    await dialog.getByRole('button', { name: 'Add page' }).click()
    await expect(page.getByText('Ramadan offers added as a draft')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('link', { name: 'Edit Ramadan offers' })).toBeVisible()
    await expect(page.getByText('/ramadan-offers').first()).toBeVisible()
  })

  await screenshotAt(page, 'templates')

  await test.step('preview renders the new page with live data', async () => {
    await page.goto(studioUrl(slug, '/preview?page=ramadan-offers'))
    await expect(page.getByRole('heading', { name: 'Ramadan evenings of calm' })).toBeVisible()
  })

  await test.step('super-admin saves the spa site as a studio template; it shows in the gallery', async () => {
    await page.goto(`${admin}/templates`)
    await expect(page.getByRole('heading', { name: 'Site templates' })).toBeVisible()
    await page.getByRole('button', { name: "Save a spa's site" }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Spa', { exact: true }).selectOption({ label: `Dune Spa (${slug})` })
    await dialog.getByLabel('Template name').fill('Dune Signature')
    // Saved hidden from spas unless switched on (the admin reviews the copy first).
    await dialog.getByRole('checkbox', { name: /Spas can pick it right away/ }).check()
    await dialog.getByRole('button', { name: 'Save template' }).click()
    await expect(page.getByText('Dune Signature saved')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('dune-signature').first()).toBeVisible()
    await screenshotAt(page, 'templates-admin')

    await page.goto(`${admin}/templates/desert/preview?lang=ar`)
    await expect(page.getByRole('heading', { name: 'طقوس الصحراء وسكينة الواحة' })).toBeVisible()

    await page.goto(studioUrl(slug))
    const card = page.getByRole('article', { name: 'Dune Signature' })
    await expect(card).toBeVisible()
    await expect(card.getByText('Studio')).toBeVisible()
    await expect(card.locator('iframe[title="Dune Signature preview"]')).toBeAttached()
  })
})

test('HTML design upload: shown exactly as built on the spa site, with live placeholders', async ({
  page,
}) => {
  const owner = await signUpOwner(page, { spa: 'Mint Spa' })
  const { slug } = owner
  await makeStudio(slug)
  const html = `<!doctype html><html><head><title>Mint</title><style>h1{color:rgb(1, 2, 3)}</style></head>
<body><h1 id="t">Welcome to {{spa_name}}</h1><a id="book" href="{{book_url}}">Book</a>
<script>document.getElementById('t').dataset.ran = 'yes'</script></body></html>`

  await test.step('upload in the templates library', async () => {
    await signInStudioOnAdmin(page, owner.email)
    await page.goto(`${admin}/templates`)
    await page.getByRole('button', { name: 'Upload HTML' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Template name').fill('Mint Cloud')
    await dialog
      .getByLabel('HTML file')
      .setInputFiles({ name: 'mint.html', mimeType: 'text/html', buffer: Buffer.from(html) })
    await dialog.getByRole('checkbox', { name: /Spas can pick it right away/ }).check()
    await dialog.getByRole('button', { name: 'Upload' }).click()
    await expect(page.getByText('Mint Cloud uploaded')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('mint-cloud').first()).toBeVisible()
  })

  await test.step('apply and publish: the public page is the design itself, sandboxed', async () => {
    await page.goto(studioUrl(slug))
    await page.getByRole('button', { name: 'Use Mint Cloud' }).click()
    await expect(page.getByTestId('current-template')).toHaveText('Mint Cloud', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Publish site' }).click()
    await page.getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByText('Published 1 page')).toBeVisible({ timeout: 30_000 })

    await page.goto(site(slug))
    const frame = page.locator('iframe.site-html-design')
    await expect(frame).toHaveAttribute('sandbox', /allow-scripts/)
    await expect(frame).not.toHaveAttribute('sandbox', /allow-same-origin/)
    // No site header around it: the design is the whole page.
    await expect(page.locator('.site-root')).toHaveCount(0)
    const doc = page.frameLocator('iframe.site-html-design')
    await expect(doc.getByRole('heading', { name: 'Welcome to Mint Spa' })).toHaveCSS('color', 'rgb(1, 2, 3)')
    await expect(doc.locator('#t')).toHaveAttribute('data-ran', 'yes')
    await expect(doc.getByRole('link', { name: 'Book' })).toHaveAttribute('href', /\/book$/)
  })
})

test('HTML design images: kept inside the screen, focal point adjusted on upload and later', async ({
  page,
}) => {
  test.setTimeout(240_000)
  const owner = await signUpOwner(page, { spa: 'Frame Spa' })
  await makeStudio(owner.slug)
  const shots = process.env.SHOTS_DIR ?? 'test-results/screens'
  const svg = (w: number, h: number, fill: string) =>
    `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}'%3E%3Crect width='100%25' height='100%25' fill='%23${fill}'/%3E%3Ccircle cx='20%25' cy='80%25' r='40' fill='%23fff'/%3E%3C/svg%3E`
  // No viewport meta, a 1600 px image and a right-floated hero pushed past the edge: the owner's broken case.
  const html = `<!doctype html><html><head><title>Frame</title><style>
body{margin:0;font-family:sans-serif}.hero{float:right;width:900px;height:320px;margin-right:-160px}
</style></head><body><h1>Frame</h1><img id="hero" class="hero" src="${svg(1200, 800, 'c96')}">
<img id="wide" src="${svg(1600, 500, '369')}" style="width:1600px"><p style="clear:both">End</p></body></html>`
  // F10: the design arrives in its shell document after the page hydrates (and again after each adjustment), so wait
  // for it instead of reading the empty shell or a frame that is reloading.
  const inDesign = <T>(frame: Frame, read: () => T) =>
    frame
      .evaluate(`document.getElementById('hero') ? (${read})() : null`)
      .catch(() => null) as Promise<T | null>
  const frameOk = async (frame: Frame, position: string) => {
    await expect
      .poll(() => inDesign(frame, () => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0)
    await expect
      .poll(() => inDesign(frame, () => getComputedStyle(document.getElementById('hero')!).objectPosition))
      .toBe(position)
  }
  const frameOf = async (el: Locator) => (await (await el.elementHandle())!.contentFrame())!

  await test.step('before: the raw file overflows a phone screen', async () => {
    await page.setViewportSize({ width: 360, height: 780 })
    await page.setContent(html)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeGreaterThan(360)
    await page.screenshot({ path: `${shots}/before-360.png`, fullPage: true })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.screenshot({ path: `${shots}/before-1280.png`, fullPage: true })
  })

  await test.step('upload: images listed, focal point dragged, preview fits', async () => {
    await signInStudioOnAdmin(page, owner.email)
    await page.goto(`${admin}/templates`)
    await page.getByRole('button', { name: 'Upload HTML' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Template name').fill('Frame Hero')
    await dialog
      .getByLabel('HTML file')
      .setInputFiles({ name: 'frame.html', mimeType: 'text/html', buffer: Buffer.from(html) })
    await expect(dialog.getByText('Adjust images (2)')).toBeVisible()
    const dot = dialog.getByTestId('html-image-img-0').getByTestId('focal-dot')
    const thumb = dot.locator('..')
    await expect(thumb.locator('img')).toHaveJSProperty('complete', true)
    await page.waitForTimeout(500) // sheet slide-in
    const box = (await thumb.boundingBox())!
    await thumb.click({ position: { x: box.width * 0.2, y: box.height * 0.8 } })
    await expect(dot).toHaveAccessibleName(/20% across, 80% down/)
    const frame = await frameOf(dialog.getByTestId('html-images-preview'))
    await frameOk(frame, '20% 80%')
    await dialog.getByRole('button', { name: '1280px' }).click()
    await frameOk(frame, '20% 80%')
    await dialog.getByRole('checkbox', { name: /Spas can pick it right away/ }).check()
    await dialog.getByRole('button', { name: 'Upload' }).click()
    await expect(page.getByText(/Frame Hero uploaded.*Fixed for phones/)).toBeVisible({ timeout: 30_000 })
  })

  const href = await page.getByRole('link', { name: 'Preview Frame Hero' }).getAttribute('href')
  const previewUrl = new URL(href!, page.url()).href
  const checkPreview = async (position: string, name: string, centred = false) => {
    for (const width of [360, 1280]) {
      await page.setViewportSize({ width, height: width < 768 ? 780 : 900 })
      await page.goto(previewUrl)
      const el = page.locator('iframe.site-html-design')
      await expect(el).not.toHaveAttribute('sandbox', /allow-same-origin/)
      const frame = await frameOf(el)
      await frameOk(frame, position)
      if (centred) {
        // Realigned: the whole hero is on screen (no longer pushed past the right edge).
        const [left, right] = await frame.evaluate(() => {
          const r = document.getElementById('hero')!.getBoundingClientRect()
          return [r.left, window.innerWidth - r.right]
        })
        expect(left).toBeGreaterThanOrEqual(0)
        expect(right).toBeGreaterThanOrEqual(0)
      }
      await page.waitForTimeout(300)
      await page.screenshot({ path: `${shots}/${name}-${width}.png` })
    }
    await page.setViewportSize({ width: 1280, height: 800 })
  }

  await test.step('after: the template preview fits 360 and 1280 with the focal point', async () => {
    await checkPreview('20% 80%', 'after')
  })

  await test.step('re-open "Adjust images" later, nudge and save', async () => {
    await page.goto(`${admin}/templates`)
    await page.getByRole('button', { name: 'Adjust images of Frame Hero' }).click()
    const dialog = page.getByRole('dialog')
    const dot = dialog.getByTestId('html-image-img-0').getByTestId('focal-dot')
    await expect(dot).toHaveAccessibleName(/20% across, 80% down/)
    await dot.focus()
    await page.keyboard.press('Shift+ArrowRight')
    await expect(dot).toHaveAccessibleName(/30% across, 80% down/)
    await dialog.getByTestId('html-image-img-0').getByRole('button', { name: 'Centre' }).click()
    await dialog.getByTestId('html-image-img-1').getByRole('button', { name: 'Fit' }).click()
    await dialog.getByRole('button', { name: 'Save images' }).click()
    await expect(page.getByText('Images saved for Frame Hero')).toBeVisible({ timeout: 30_000 })
    await checkPreview('30% 80%', 'after-adjusted', true)
  })
})

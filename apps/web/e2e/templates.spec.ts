import { expect, test } from '@playwright/test'
import { type BlockSpec, checkNodes } from '@spa/services'
import { siteConfig } from '../src/components/site/config'
import { PAGE_TEMPLATES, SECTION_PRESETS } from '../src/components/site/presets'
import { TEMPLATES } from '../src/components/site/templates'
import { admin, app, makeStudio, PATH, screenshotAt, seedCatalog, signUpOwner, site } from './helpers'

const NAMES = [
  'Zen Minimal',
  'Dark Luxury',
  'Nordic Clean',
  'Thai Teak',
  'Desert Sand',
  'Tropical Bali',
  'Urban Express',
  'Hotel Spa',
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
  expect(perCategory).toMatchObject({ hero: 4, services: 3, about: 3, team: 2, offers: 3, 'social-proof': 3 })
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
    for (const p of t.pages)
      expect(checkNodes(p.data.content as unknown[], spec), `${t.key}/${p.slug}`).toEqual([])
  }
})

test('templates: gallery of 8, side-by-side switch with undo, Desert Sand in EN + AR, page templates, studio', async ({
  page,
}) => {
  const owner = await signUpOwner(page, { spa: 'Dune Spa' })
  const { slug } = owner
  await makeStudio(slug) // the website is built by the studio (super-admin)
  await seedCatalog(slug)

  await test.step('the gallery shows all 8 templates with live previews', async () => {
    await page.goto(`${app}/${slug}/website`)
    for (const name of NAMES) await expect(page.getByRole('article', { name })).toBeVisible()
    await expect(page.locator('iframe[title="Desert Sand preview"]')).toBeAttached()
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
    await page.goto(`${app}/${slug}/website`)
    await page.getByRole('button', { name: 'Add page' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /Ramadan offers/ }).check()
    await dialog.getByRole('button', { name: 'Add page' }).click()
    await expect(page.getByText('Ramadan offers added as a draft')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('link', { name: 'Edit Ramadan offers' })).toBeVisible()
    await expect(page.getByText('/ramadan-offers').first()).toBeVisible()
  })

  await test.step('the AI writer is reachable (and says so when AI is not set up)', async () => {
    await page.getByRole('button', { name: 'Write with AI' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: 'Write my site with AI' })).toBeVisible()
    await expect(dialog.getByText(/AI writing isn.t set up yet|Anything to highlight/).first()).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  await screenshotAt(page, 'templates')

  await test.step('preview renders the new page with live data', async () => {
    await page.goto(`${app}/${slug}/website/preview?page=ramadan-offers`)
    await expect(page.getByRole('heading', { name: 'Ramadan evenings of calm' })).toBeVisible()
  })

  await test.step('super-admin saves the spa site as a studio template; spas see it in the gallery', async () => {
    await page.goto(`${admin}/login`)
    if (!PATH) {
      await page.getByLabel('Email').fill(`owner-${slug}@e2e.test`)
      await page.getByLabel('Password').fill('correct-horse-battery')
      await page.getByRole('button', { name: 'Sign in' }).click()
      await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
    }
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

    await page.goto(`${app}/${slug}/website`)
    const card = page.getByRole('article', { name: 'Dune Signature' })
    await expect(card).toBeVisible()
    await expect(card.getByText('Studio')).toBeVisible()
    await expect(card.locator('iframe[title="Dune Signature preview"]')).toBeAttached()
  })
})

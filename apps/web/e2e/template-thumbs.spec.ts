import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { TEMPLATE_KEYS, TEMPLATES } from '../src/components/site/templates'
import { admin, app, makeStudio, seedCatalog, signInPlatformAdmin, signUpOwner, site } from './helpers'

/**
 * Tooling, not a regression test (skipped unless asked):
 * - THUMBS=1 renders every built-in template with the sample spa and writes the gallery thumbnails
 *   (public/site-templates/{key}.webp, 640×480).
 * - SCREENS=<dir> also publishes a few design templates and screenshots the public site (EN + AR, 360 + 1280,
 *   mid-scroll so the 3D scenes are in motion) into that directory.
 */
const OUT = join(import.meta.dirname, '../public/site-templates')

test('template gallery thumbnails', async ({ page }) => {
  test.skip(!process.env.THUMBS, 'set THUMBS=1 to regenerate the thumbnails')
  test.setTimeout(10 * 60_000)
  await signInPlatformAdmin(page)
  await page.setViewportSize({ width: 1280, height: 960 })
  for (const key of TEMPLATE_KEYS) {
    await page.goto(`${admin}/templates/${key}/preview`)
    await expect(page.locator('.site-root')).toBeVisible()
    await page.addStyleTag({ content: 'nav[aria-label="Template pages"]{display:none!important}' })
    await page.evaluate(() => document.fonts.ready)
    await page.waitForTimeout(300)
    const png = await page.screenshot()
    await writeFile(
      join(OUT, `${key}.webp`),
      await sharp(png).resize(640, 480).webp({ quality: 74 }).toBuffer(),
    )
  }
})

test('design templates on the public site (screens)', async ({ page }) => {
  const dir = process.env.SCREENS
  test.skip(!dir, 'set SCREENS=<dir> to take the screenshots')
  test.setTimeout(10 * 60_000)
  for (const key of ['signature', 'noir', 'flap'] as const) {
    const name = TEMPLATES[key].name
    const { slug } = await signUpOwner(page, { spa: 'Lotus Garden Spa' })
    await makeStudio(slug)
    await seedCatalog(slug)
    await page.goto(`${app}/${slug}/website`)
    await page.getByRole('button', { name: `Use ${name}` }).click()
    await expect(page.getByTestId('current-template')).toHaveText(name, { timeout: 30_000 })
    await page.getByRole('button', { name: 'Publish site' }).click()
    await page.getByRole('button', { name: 'Publish now' }).click()
    await expect(page.getByText(/Published \d+ pages/)).toBeVisible({ timeout: 30_000 })
    for (const lang of ['en', 'ar']) {
      for (const width of [360, 1280]) {
        await page.setViewportSize({ width, height: width < 768 ? 780 : 900 })
        await page.goto(`${site(slug)}${lang === 'ar' ? '?lang=ar' : ''}`)
        await expect(page.locator('.site-root')).toHaveAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr')
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(500)
        await page.screenshot({ path: `${dir}/${key}-${lang}-${width}-hero.png` })
        // Mid-way through the services band: the template's 3D scene is in progress.
        await page.locator('[data-block-type="ServicesMenu"]').first().scrollIntoViewIfNeeded()
        await page.mouse.wheel(0, -Math.round((width < 768 ? 780 : 900) * 0.45))
        await page.waitForTimeout(600)
        await page.screenshot({ path: `${dir}/${key}-${lang}-${width}-scene.png` })
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(600)
        await page.screenshot({ path: `${dir}/${key}-${lang}-${width}-full.png`, fullPage: true })
      }
    }
  }
})

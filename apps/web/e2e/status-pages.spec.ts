import { expect, type Page, test } from '@playwright/test'
import { user } from '@spa/db'
import { eq } from 'drizzle-orm'
import { admin, app, base, PATH, signUpOwner, site, testDb, uniqueSlug } from './helpers'

const html = (page: Page) => page.locator('html')
const card = (page: Page) => page.locator('[data-status-page="404"]')

// F24: every surface answers a 404 in its own look and language with a way back, and <html lang/dir> follows the
// surface: marketing + console en, dashboard en|th (member's language), spa sites en|ar (rtl).
test('F24: 404 pages per surface in the right language, with lang/dir on <html>', async ({ page }) => {
  await test.step('marketing: English, marketing look, back home', async () => {
    const res = await page.goto(`${base}/no-such-page`)
    expect(res?.status()).toBe(404)
    await expect(html(page)).toHaveAttribute('lang', 'en')
    await expect(html(page)).toHaveAttribute('dir', 'ltr')
    await expect(card(page)).toHaveAttribute('data-look', 'marketing')
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
    await page.goto(`${base}/pricing`)
    await expect(html(page)).toHaveAttribute('lang', 'en')
  })

  await test.step('console: English, console look, back to the console', async () => {
    const res = await page.goto(`${admin}/no-such-page/deeper`)
    expect(res?.status()).toBe(404)
    await expect(html(page)).toHaveAttribute('lang', 'en')
    await expect(card(page)).toHaveAttribute('data-look', 'console')
    await expect(page.getByRole('link', { name: 'Back to the console' })).toHaveAttribute(
      'href',
      PATH ? '/admin' : '/',
    )
  })

  const { slug, email } = await signUpOwner(page, { spa: 'Status Spa' })

  await test.step('dashboard (English): in-shell 404 and the unknown-spa 404', async () => {
    const res = await page.goto(`${app}/${slug}/no-such-page`)
    expect(res?.status()).toBe(404)
    await expect(html(page)).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Back to the dashboard home' })).toHaveAttribute(
      'href',
      PATH ? `/app/${slug}` : `/${slug}`,
    )
    // The spa shell stays around it.
    await expect(page.getByRole('navigation').first()).toBeVisible()
  })

  await test.step('dashboard (Thai member): <html lang="th">, Thai 404s', async () => {
    await testDb().update(user).set({ locale: 'th' }).where(eq(user.email, email))
    await page.goto(`${app}/${slug}`)
    await expect(html(page)).toHaveAttribute('lang', 'th')
    await page.goto(`${app}/${slug}/clients/00000000-0000-4000-8000-000000000000`)
    await expect(html(page)).toHaveAttribute('lang', 'th')
    await expect(page.getByRole('heading', { level: 1, name: 'ไม่พบหน้านี้' })).toBeVisible()
    const res = await page.goto(`${app}/${uniqueSlug('nobody')}`)
    expect(res?.status()).toBe(404)
    await expect(html(page)).toHaveAttribute('lang', 'th')
    await expect(card(page)).toHaveAttribute('data-look', 'crm')
    await expect(page.getByRole('heading', { level: 1, name: 'ไม่พบหน้านี้' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'ไปที่แดชบอร์ดของคุณ' })).toHaveAttribute('href', PATH ? '/app' : '/')
  })

  await test.step('spa site: English and Arabic (rtl) 404 with the spa name and a way home', async () => {
    const res = await page.goto(`${site(slug)}/no-such-page`)
    expect(res?.status()).toBe(404)
    await expect(html(page)).toHaveAttribute('lang', 'en')
    await expect(html(page)).toHaveAttribute('dir', 'ltr')
    await expect(card(page)).toHaveAttribute('data-look', 'site')
    await expect(card(page)).toContainText('Status Spa')
    await expect(page.getByRole('link', { name: 'Back to the home page' })).toHaveAttribute(
      'href',
      PATH ? `/s/${slug}` : '/',
    )
    await page.goto(`${site(slug)}/no-such-page?lang=ar`)
    await expect(html(page)).toHaveAttribute('lang', 'ar')
    await expect(html(page)).toHaveAttribute('dir', 'rtl')
    await expect(page.getByRole('heading', { level: 1, name: 'الصفحة غير موجودة' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'العودة إلى الصفحة الرئيسية' })).toHaveAttribute(
      'href',
      PATH ? `/s/${slug}?lang=ar` : '/?lang=ar',
    )
    // A normal site page follows the same rule.
    await page.goto(`${site(slug)}/?lang=ar`)
    await expect(html(page)).toHaveAttribute('dir', 'rtl')
    await page.goto(`${site(slug)}/`)
    await expect(html(page)).toHaveAttribute('lang', 'en')
    await expect(html(page)).toHaveAttribute('dir', 'ltr')
  })

  await test.step('an unknown spa address: neutral "not available" page', async () => {
    const res = await page.goto(site(uniqueSlug('ghost')))
    expect(res?.status()).toBe(404)
    await expect(card(page)).toHaveAttribute('data-look', 'site')
    await expect(page.getByText('This website isn’t available.')).toBeVisible()
  })
})

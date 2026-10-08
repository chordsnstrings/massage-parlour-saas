import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { app, uniqueSlug } from './helpers'

// Spa dashboard shell (docs/PLAN.md §14.6 Phase 1): logo at sign-up, grouped menu, section tabs, plan card,
// EN | ไทย toggle saved per user, logo managed in Settings, phone drawer.
const logo = async () => ({
  name: 'logo.png',
  mimeType: 'image/png',
  buffer: await sharp({ create: { width: 900, height: 900, channels: 3, background: '#0f3d3e' } })
    .png()
    .toBuffer(),
})

test('spa shell: logo, menu, plan card, language and drawer', async ({ page }) => {
  const slug = uniqueSlug('shell')
  const dashboard = `${app}/${slug}`

  await test.step('sign up with a logo', async () => {
    await page.goto(`${app}/signup`)
    await page.getByLabel('Your name').fill('Noor Haddad')
    await page.getByLabel('Work email').fill(`owner-${slug}@e2e.test`)
    await page.getByLabel('Password').fill('correct-horse-battery')
    await page.getByLabel('Spa name').fill('Lotus Garden Spa')
    await page.getByLabel('Web address').fill(slug)
    await expect(page.getByText(new RegExp(`${slug}.* is available`))).toBeVisible()
    await page.getByLabel('Logo (optional)').setInputFiles(await logo())
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL(dashboard)
  })

  const menu = page.getByRole('navigation', { name: 'Main menu' })
  await test.step('sidebar: logo, profile, grouped menu, plan card', async () => {
    const mark = page.getByRole('img', { name: 'Lotus Garden Spa logo' })
    await expect(mark).toBeVisible()
    await expect(mark).toHaveAttribute('src', /^\/files\/[0-9a-f-]{36}$/)
    await expect(page.getByRole('button', { name: 'Profile menu for Noor Haddad' })).toContainText(
      'Owner · Lotus Garden Spa',
    )
    for (const label of [
      'Dashboard',
      'Calendar',
      'Sales',
      'Inbox & follow-ups',
      'Clients',
      'Services & menu',
      'Team & roles',
      'Marketing',
      'Website studio',
      'Reviews',
      'Accounts',
      'VAT & payroll',
      'Billing',
      'Settings',
    ])
      await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible()
    // Pages Phase 3 builds stay out of the menu until they exist.
    for (const label of ['Bookings', 'Automations', 'Coming next'])
      await expect(menu.getByRole('link', { name: label })).toHaveCount(0)
    await expect(menu.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText('AI allowance · 0% used this month')).toBeVisible()
    await expect(page.getByText(/^Trial ends \d{1,2} \w{3} \d{4}$/)).toBeVisible()
    await expect(page.getByRole('banner')).toContainText('Workspace')
  })

  await test.step('section tabs group the pages of a menu item', async () => {
    await menu.getByRole('link', { name: 'Services & menu' }).click()
    await page.waitForURL(`${dashboard}/services`)
    const tabs = page.getByRole('navigation', { name: 'Pages in this section' })
    await expect(tabs.getByRole('link', { name: 'Services & rooms' })).toHaveAttribute('aria-current', 'page')
    await tabs.getByRole('link', { name: 'Packages & gifts' }).click()
    await page.waitForURL(`${dashboard}/packages`)
    await expect(tabs.getByRole('link', { name: 'Packages & gifts' })).toHaveAttribute('aria-current', 'page')
    await expect(menu.getByRole('link', { name: 'Services & menu' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByRole('banner')).toContainText('People')
  })

  await test.step('ไทย: the shell switches, the choice is saved for the user', async () => {
    await page.goto(`${dashboard}/settings`)
    await page.getByRole('button', { name: 'ไทย' }).click()
    const menuTh = page.getByRole('navigation', { name: 'เมนูหลัก' })
    await expect(menuTh.getByRole('link', { name: 'ปฏิทิน' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ไทย' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.crm')).toHaveAttribute('lang', 'th')
    await expect(page.getByText(/^ทดลองใช้ถึง \d{1,2} \S+ \d{4}$/)).toBeVisible() // Thai month, Gregorian year
    await page.reload()
    await expect(menuTh.getByRole('link', { name: 'ตั้งค่า' })).toHaveAttribute('aria-current', 'page')
    // Catalogue-keyed action results render in the viewer's language.
    await page.getByRole('button', { name: 'อัปโหลดโลโก้' }).click()
    await expect(page.getByText('โปรดเลือกรูปภาพที่จะอัปโหลด').first()).toBeVisible()
    await page.getByRole('button', { name: 'EN' }).click()
    await expect(menu.getByRole('link', { name: 'Calendar' })).toBeVisible()
  })

  await test.step('settings: remove and replace the logo', async () => {
    await page.getByRole('button', { name: 'Remove logo' }).click()
    await expect(page.getByText('Logo removed')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Lotus Garden Spa logo' })).toHaveCount(0)
    await expect(page.locator('.crm-mark')).toHaveText('LG')
    await page.getByLabel('Choose image').setInputFiles(await logo())
    await page.getByRole('button', { name: 'Upload logo' }).click()
    await expect(page.getByText('Logo updated')).toBeVisible()
    await expect(page.getByRole('img', { name: 'Lotus Garden Spa logo' })).toBeVisible()
  })

  await test.step('phone: the menu is a drawer that closes on navigation', async () => {
    await page.setViewportSize({ width: 360, height: 780 })
    await expect(menu).toBeHidden()
    await page.getByRole('button', { name: 'Open menu' }).click()
    await menu.getByRole('link', { name: 'Clients' }).click()
    await page.waitForURL(`${dashboard}/clients`)
    await expect(menu).toBeHidden()
    await expect(page.getByRole('banner')).toContainText('Clients')
  })
})

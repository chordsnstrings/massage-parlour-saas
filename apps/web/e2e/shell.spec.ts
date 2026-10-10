import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { app, applyForSpa, approveApplication, enableTotp, uniqueSlug } from './helpers'

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

  await test.step('apply with a logo, get accepted', async () => {
    const email = `owner-${slug}@e2e.test`
    await applyForSpa(page, { slug, email, name: 'Noor Haddad', spa: 'Lotus Garden Spa', logo: await logo() })
    await approveApplication(email) // the logo sent with the application becomes the spa's logo
    await enableTotp(email) // G23: 2FA first
    await page.goto(dashboard)
    await page.waitForURL(dashboard)
  })

  const menu = page.getByRole('navigation', { name: 'Main menu' })
  // The whole sidebar scrolls as one (PLAN §18.6): the menu never scrolls inside its own box, and the last item can be
  // scrolled into view without the plan card + badge covering it. Toasts of earlier steps float above everything
  // (phone: full width, 80 px up) and live 3.8 s, so they are waited out first.
  const lastItemReachable = async () => {
    await expect(page.getByTestId('toasts').getByRole('button')).toHaveCount(0)
    expect(await menu.evaluate((n) => n.scrollHeight - n.clientHeight)).toBeLessThanOrEqual(1)
    const last = menu.getByRole('link', { name: 'Settings', exact: true })
    await last.scrollIntoViewIfNeeded()
    await expect(last).toBeInViewport({ ratio: 1 })
    expect(
      await last.evaluate((a) => {
        const r = a.getBoundingClientRect()
        return a.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2))
      }),
    ).toBe(true)
  }
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
      'Automations',
      'Settings',
    ])
      await expect(menu.getByRole('link', { name: label, exact: true })).toBeVisible()
    // Pages Phase 3 builds stay out of the menu until they exist.
    await expect(menu.getByRole('link', { name: 'Coming next' })).toHaveCount(0)
    await expect(menu.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page')
    await expect(page.getByText('AI allowance · 0% used this month')).toBeVisible()
    // Accepted spas start on an active subscription (PLAN §18.3), not a trial; Premium is paid monthly (§18.8).
    await expect(page.getByText(/^Renews \d{1,2} \w{3} \d{4} · AED\s?3,000\/mo$/)).toBeVisible()
    await expect(page.getByRole('banner')).toContainText('Workspace')
    // Platform badge at the foot of the sidebar (PLAN §18.6): the marketing site, in a new tab.
    const platform = page.getByRole('complementary').getByRole('link', { name: 'Spa Management' })
    await expect(platform).toBeVisible()
    await expect(platform).toHaveAttribute('href', /^http:\/\/localhost:\d+\/?$/)
    await expect(platform).toHaveAttribute('target', '_blank')
    await expect(platform).toHaveAttribute('rel', /noopener/)
    await page.setViewportSize({ width: 1280, height: 800 })
    await lastItemReachable()
    // Brand fonts reach the html element too, not only body.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily)).toMatch(
      /^"DM Sans/,
    )
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
    // Form controls have a >= 3:1 edge (WCAG 1.4.11), not the soft card divider.
    await expect(page.locator('input#name')).toHaveCSS('border-top-color', 'rgb(132, 142, 136)')
    await page.getByRole('button', { name: 'ไทย' }).click()
    const menuTh = page.getByRole('navigation', { name: 'เมนูหลัก' })
    await expect(menuTh.getByRole('link', { name: 'ปฏิทิน' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ไทย' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.crm')).toHaveAttribute('lang', 'th')
    await expect(page.getByText(/^ต่ออายุ \d{1,2} \S+ \d{4} · AED\s?[\d,]+\/\S+$/)).toBeVisible() // Thai month, Gregorian year
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
    // The badge sits in the drawer, below the menu.
    await expect(page.getByRole('complementary').getByRole('link', { name: 'Spa Management' })).toBeVisible()
    await lastItemReachable()
    await menu.getByRole('link', { name: 'Clients' }).click()
    await page.waitForURL(`${dashboard}/clients`)
    await expect(menu).toBeHidden()
    await expect(page.getByRole('banner')).toContainText('Clients')
  })
})

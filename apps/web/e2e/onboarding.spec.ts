import { expect, type Page, test } from '@playwright/test'
import {
  admin,
  app,
  applyForSpa,
  approveApplication,
  base,
  enrolTwoFactor,
  enrolUrl,
  signInPlatformAdmin,
  site,
} from './helpers'

const slug = `serenity-${Date.now().toString(36)}`
const shots = (name: string) => `test-results/screens/${name}.png`

async function screenshotAt(page: Page, name: string) {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: width < 768 ? 780 : 900 })
    await page.waitForTimeout(400) // let entrance animations settle
    await page.screenshot({ path: shots(`${name}-${width}`), fullPage: true })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
}

let inviteLink = ''

test('owner signs up, gets a live site, configures and invites', async ({ page }) => {
  await test.step('marketing shows the live price', async () => {
    await page.goto(base)
    await expect(page.getByRole('heading', { name: 'More bookings. Less work.', exact: true })).toBeVisible()
    await expect(page.getByText(/AED\s?24,000/).first()).toBeVisible()
  })

  await test.step('an accepted application creates the spa and its subdomain', async () => {
    await applyForSpa(page, { slug, email: `owner-${slug}@e2e.test` })
    await approveApplication(`owner-${slug}@e2e.test`)
    // G23: "Require 2FA for owner & managers" is on for new spas — the owner enrols TOTP before the dashboard.
    await page.goto(`${app}/${slug}`)
    await page.waitForURL(enrolUrl(slug))
    await expect(page.getByText(/requires two-step verification/)).toBeVisible()
    await enrolTwoFactor(page, `owner-${slug}@e2e.test`, 'correct-horse-battery')
    await page.goto(`${app}/${slug}`)
    await page.waitForURL(`${app}/${slug}`)
    // The time-of-day greeting lives in the shell's top bar; the page heading names the spa.
    await expect(page.getByRole('banner')).toContainText('Aisha')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Serenity Spa')
    await screenshotAt(page, 'tenant-home')
  })

  await test.step('settings save a UAE WhatsApp number', async () => {
    await page.goto(`${app}/${slug}/settings`)
    await page.getByLabel('Address').fill('Marina Walk, Dubai')
    await page.getByLabel('WhatsApp number').fill('050 123 4567')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Settings saved')).toBeVisible()
  })

  await test.step('public site is live with a WhatsApp booking link', async () => {
    await page.goto(site(slug))
    await expect(page.getByRole('heading', { name: 'Serenity Spa' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Book on WhatsApp' })).toHaveAttribute(
      'href',
      /wa\.me\/971501234567/,
    )
  })

  await test.step('owner invites a receptionist', async () => {
    await page.goto(`${app}/${slug}/team`)
    await page.getByRole('button', { name: 'Invite' }).click()
    await page.getByLabel('Email').fill(`reception-${slug}@e2e.test`)
    await page.getByRole('button', { name: 'Create invitation' }).click()
    const link = page.getByText(/\/invite\//)
    await expect(link).toBeVisible()
    inviteLink = (await link.textContent()) ?? ''
    expect(inviteLink).toContain(`${app}/invite/`)
    await page.keyboard.press('Escape')
    await screenshotAt(page, 'team')
  })
})

test('invitee joins with the receptionist role and limited navigation', async ({ page }) => {
  expect(inviteLink).not.toBe('')
  await page.goto(inviteLink)
  await expect(page.getByText('as Receptionist')).toBeVisible()
  await page.getByLabel('Your name').fill('Joy Santos')
  await page.getByLabel('Password').fill('another-strong-pass')
  await page.getByRole('button', { name: 'Create account & join' }).click()
  await page.waitForURL(`${app}/${slug}`)
  const nav = page.getByRole('navigation', { name: 'Main menu' })
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toBeVisible()
  // Team access (team.manage) and Settings stay out of a receptionist's menu and section tabs.
  await expect(page.locator(`a[href$="/${slug}/team"]`)).toHaveCount(0)
  await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0)
  const res = await page.goto(`${app}/${slug}/team`)
  expect(res?.status()).toBe(404)
})

test('unknown subdomains 404', async ({ page }) => {
  const res = await page.goto(site('no-such-spa-here'))
  expect(res?.status()).toBe(404)
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()
})

test('super-admin changes the plan price and the marketing page follows', async ({ page }) => {
  await signInPlatformAdmin(page)
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  // G1: no off-site backup has run on the test database — the console says so.
  await expect(page.getByTestId('offsite-backup')).toContainText('No successful off-site backup yet')
  await expect(page.getByTestId('offsite-backup')).toContainText('missing')
  await screenshotAt(page, 'platform-overview')

  await page.goto(`${admin}/plans`)
  await page.getByRole('button', { name: 'Edit' }).first().click()
  await page.getByLabel('Price (AED)').fill('26000')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Plan saved')).toBeVisible()

  await page.goto(base)
  await expect(page.getByText(/AED\s?26,000/).first()).toBeVisible()
})

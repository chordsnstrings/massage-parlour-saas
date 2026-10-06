import { expect, type Page, test } from '@playwright/test'

const PORT = 3100
// E2E_ROUTING=path exercises single-hostname mode (/app, /admin, /s/{slug}) used on *.ondigitalocean.app.
const PATH = process.env.E2E_ROUTING === 'path'
const base = `http://localhost:${PORT}`
const app = PATH ? `${base}/app` : `http://app.localhost:${PORT}`
const admin = PATH ? `${base}/admin` : `http://admin.localhost:${PORT}`
const site = (s: string) => (PATH ? `${base}/s/${s}` : `http://${s}.localhost:${PORT}`)
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
    await expect(page.getByRole('heading', { name: 'Run a calmer, fuller spa.' })).toBeVisible()
    await expect(page.getByText(/AED\s?24,000/).first()).toBeVisible()
  })

  await test.step('sign up creates the spa and its subdomain', async () => {
    await page.goto(`${app}/signup`)
    await page.getByLabel('Your name').fill('Aisha Rahman')
    await page.getByLabel('Work email').fill(`owner-${slug}@e2e.test`)
    await page.getByLabel('Password').fill('correct-horse-battery')
    await page.getByLabel('Spa name').fill('Serenity Spa')
    await page.getByLabel('Web address').fill(slug)
    await expect(page.getByText(new RegExp(`${slug}.* is available`))).toBeVisible()
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL(`${app}/${slug}`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Aisha')
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
  const nav = page.locator('aside nav')
  await expect(nav.getByRole('link', { name: 'Home' })).toBeVisible()
  await expect(nav.getByRole('link', { name: 'Team' })).toHaveCount(0)
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
  await page.goto(`${app}/signup`)
  await page.getByLabel('Your name').fill('Platform Admin')
  await page.getByLabel('Work email').fill('admin@e2e.test')
  await page.getByLabel('Password').fill('platform-admin-pass')
  await page.getByLabel('Spa name').fill('Admin Test Spa')
  await page.getByLabel('Web address').fill(`admin-${slug}`)
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL(`${app}/admin-${slug}`)

  await page.goto(`${admin}/login`)
  if (!PATH) {
    // Separate host → separate session; on a single host the sign-up session already applies.
    await page.getByLabel('Email').fill('admin@e2e.test')
    await page.getByLabel('Password').fill('platform-admin-pass')
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
  await screenshotAt(page, 'platform-overview')

  await page.goto(`${admin}/plans`)
  await page.getByRole('button', { name: 'Edit' }).first().click()
  await page.getByLabel('Price (AED)').fill('26000')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Plan saved')).toBeVisible()

  await page.goto(base)
  await expect(page.getByText(/AED\s?26,000/).first()).toBeVisible()
})

import { expect, type Page, test } from '@playwright/test'
import { plans } from '@spa/db'
import { eq } from 'drizzle-orm'
import {
  admin,
  app,
  applyForSpa,
  enrolTwoFactor,
  enrolUrl,
  OWNER_PASSWORD,
  signInPlatformAdmin,
  testDb,
  uniqueSlug,
} from './helpers'

// Spa applications (PLAN §18.3, owner decision 2026-10-09): apply → waiting page (no dashboard, no 2FA) → the owner
// accepts in the console with a setup-fee deposit by bank transfer → the applicant signs in, enrols 2FA (G23) and
// opens the dashboard; the balance shows in the console and on the spa's billing page. Reject: login closed with
// the shared reason. A pending application holds its web address.
const tag = Date.now().toString(36)
let planId = ''

test.beforeAll(async () => {
  const [row] = await testDb()
    .insert(plans)
    .values({
      code: `setup-${tag}`,
      name: `Setup plan ${tag}`,
      priceAed: '24000',
      setupFeeAed: '5000',
      billingInterval: 'year',
      sort: 900,
    })
    .returning()
  planId = row!.id
})
test.afterAll(async () => {
  // Keep the shared plan list (pricing page, other specs) as it was.
  await testDb().update(plans).set({ active: false }).where(eq(plans.id, planId))
})

async function adminPage(page: Page) {
  const ctx = await page.context().browser()!.newContext()
  const p = await ctx.newPage()
  await signInPlatformAdmin(p)
  return p
}

test('apply, wait, accepted with a deposit by bank transfer, then 2FA and the dashboard', async ({
  page,
}) => {
  const slug = uniqueSlug('apply')
  const email = `owner-${slug}@e2e.test`

  await test.step('the applicant applies and lands on the waiting page', async () => {
    await applyForSpa(page, { slug, email, spa: 'Jasmine Spa', planId })
    await expect(page.getByRole('heading', { name: 'Application received' })).toBeVisible()
    await expect(page.getByTestId('application-status').getByRole('status')).toHaveText(
      'Waiting for approval',
    )
    const status = page.getByTestId('application-status')
    await expect(status).toContainText('Jasmine Spa')
    await expect(status).toContainText('+971501234567')
    await expect(status).toContainText('Marina Walk, Tower 2')
    await expect(status).toContainText(`Setup plan ${tag}`)
  })

  await test.step('before approval nothing else opens (and no 2FA is asked)', async () => {
    await page.goto(`${app}/`)
    await page.waitForURL(`${app}/application`)
    await page.goto(`${app}/account`)
    await page.waitForURL(`${app}/application`)
    expect((await page.goto(`${app}/${slug}`))?.status()).toBe(404)
    // The console is not theirs: signed out there (own host), and never the list.
    await page.goto(`${admin}/applications`)
    await expect(page).toHaveURL(/\/login\?next=/)
    await expect(page.getByRole('heading', { name: 'Applications' })).toHaveCount(0)
  })

  await test.step('the address is held while the application is pending', async () => {
    const other = await page.context().browser()!.newContext()
    const visitor = await other.newPage()
    await visitor.goto(`${app}/signup`)
    await visitor.getByLabel('Web address').fill(slug)
    await expect(visitor.getByText('That address is taken.')).toBeVisible()
    await other.close()
  })

  const owner = await adminPage(page)
  await test.step('the owner sees it in the console and accepts with a deposit', async () => {
    await expect(owner.getByTestId('applications-card')).toContainText('pending')
    await expect(owner.getByRole('link', { name: /^Applications\s*\d+$/ }).first()).toBeVisible()
    await owner.goto(`${admin}/applications`)
    await owner
      .getByRole('link', { name: /Jasmine Spa/ })
      .first()
      .click()
    await expect(owner.getByRole('heading', { name: 'Jasmine Spa' })).toBeVisible()
    await expect(owner.getByTestId('slug-check')).toHaveText('Available')
    await owner.getByRole('button', { name: 'Accept', exact: true }).click()
    await expect(owner.getByLabel('Plan')).toHaveValue(planId)
    await expect(owner.getByTestId('setup-fee')).toContainText('AED 5,250')
    await owner.getByLabel('Deposit', { exact: true }).check()
    await owner.getByLabel('Deposit amount (AED)').fill('2000')
    await owner.getByLabel('Method').selectOption('bank_transfer')
    await owner.getByLabel('Reference (optional)').fill('TT-123')
    await owner.getByRole('button', { name: 'Accept and create spa' }).click()
    await expect(
      owner.getByText(/Jasmine Spa is live · invoice SM-\d{4}-\d{4} · balance due AED 3250\.00/),
    ).toBeVisible()
    await expect(owner.getByTestId('setup-payment')).toContainText('deposit')
    await expect(owner.getByTestId('setup-payment')).toContainText('Bank transfer')
    await expect(owner.getByTestId('setup-payment')).toContainText('(ref TT-123)')
    await owner.getByRole('link', { name: 'Open the spa' }).click()
    await expect(owner.getByText(/Balance due: AED\s?3,250/)).toBeVisible()
    await expect(owner.getByText('part paid').first()).toBeVisible()
  })

  await test.step('the applicant signs in, enrols 2FA and opens the dashboard', async () => {
    await page.goto(`${app}/application`)
    await expect(page.getByTestId('application-status').getByRole('status')).toHaveText('Approved')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL(/\/login$/)
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(OWNER_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(enrolUrl(slug)) // G23 applies once they enter the dashboard
    await enrolTwoFactor(page, email, OWNER_PASSWORD)
    await page.goto(`${app}/${slug}`)
    await page.waitForURL(`${app}/${slug}`)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Jasmine Spa')
    await page.goto(`${app}/${slug}/billing`)
    await expect(page.getByText(/Paid AED\s?2,000 · balance due AED\s?3,250/)).toBeVisible()
  })
  await owner.context().close()
})

test('a rejected applicant is signed out and sees why', async ({ page }) => {
  const slug = uniqueSlug('nope')
  const email = `owner-${slug}@e2e.test`
  await applyForSpa(page, { slug, email, spa: 'Declined Spa' })

  const owner = await adminPage(page)
  await owner.goto(`${admin}/applications`)
  await owner
    .getByRole('link', { name: /Declined Spa/ })
    .first()
    .click()
  await owner.getByRole('button', { name: 'Reject', exact: true }).click()
  await owner.getByLabel('Reason (optional)').fill('We only serve licensed spas for now')
  await owner.getByLabel('Show reason to applicant').check()
  await owner.getByRole('button', { name: 'Reject application' }).click()
  await expect(owner.getByText('Application rejected · login closed')).toBeVisible()
  await owner.context().close()

  // Sessions are revoked and the login is disabled: back to sign-in, which refuses with the shared reason.
  await page.goto(`${app}/application`)
  await page.waitForURL(/\/login\?next=/)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(OWNER_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  const notice = page.getByTestId('account-closed')
  await expect(notice).toContainText('Application not approved')
  await expect(notice).toContainText('Reason: We only serve licensed spas for now')
  expect((await page.goto(`${app}/account`))?.url()).toMatch(/\/login\?next=/)
})

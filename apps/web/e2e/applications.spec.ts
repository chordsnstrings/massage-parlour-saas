import { expect, type Page, test } from '@playwright/test'
import { plans, spaApplications, tenants, user } from '@spa/db'
import { eq } from 'drizzle-orm'
import {
  admin,
  app,
  applyForSpa,
  base,
  enrolTwoFactor,
  enrolUrl,
  OWNER_PASSWORD,
  PATH,
  passTwoFactor,
  signInPlatformAdmin,
  signUpOwner,
  site,
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
    // The web address as chosen (host / path), not the bare slug.
    await expect(status).toContainText(site(slug).replace(/^https?:\/\//, ''))
  })

  await test.step('before approval nothing else opens (and no 2FA is asked)', async () => {
    await page.goto(`${app}/`)
    await page.waitForURL(`${app}/application`)
    await page.goto(`${app}/account`)
    await page.waitForURL(`${app}/application`)
    expect((await page.goto(`${app}/${slug}`))?.status()).toBe(404)
    // The console is not theirs: signed out there (own host) — or, with one host (path routing), not found.
    // A signed-in non-admin on the console is covered by its own test below.
    const res = await page.goto(`${admin}/applications`)
    if (PATH) expect(res?.status()).toBe(404)
    else await expect(page).toHaveURL(/\/login\?next=/)
    await expect(page.getByRole('heading', { name: 'Applications' })).toHaveCount(0)
  })

  await test.step('the address is held while the application is pending', async () => {
    const other = await page.context().browser()!.newContext()
    const visitor = await other.newPage()
    // Each pricing card applies for its own plan (?plan=), preselected on the form.
    await visitor.goto(`${base}/pricing`)
    await expect(visitor.locator(`a[href$="/signup?plan=${planId}"]`)).toHaveCount(1)
    await visitor.goto(`${app}/signup?plan=${planId}`)
    await expect(visitor.getByLabel('Plan')).toHaveValue(planId)
    await visitor.getByLabel('Web address').fill(slug)
    await expect(visitor.getByText('That address is taken.')).toBeVisible()
    // No emirate chosen (the placeholder is not sent): the translated message, not zod's default text.
    await visitor.getByRole('button', { name: 'Send application' }).click()
    await expect(visitor.locator('p.text-danger', { hasText: 'Choose an emirate' })).toBeVisible()
    await expect(visitor.getByText(/Invalid input/)).toHaveCount(0)
    await other.close()
  })

  const owner = await adminPage(page)
  await test.step('the owner sees it in the console and accepts with a deposit', async () => {
    await expect(owner.getByTestId('applications-card')).toContainText('pending')
    await expect(owner.getByRole('link', { name: /^Applications\s*\d+$/ }).first()).toBeVisible()
    // Phones: the count is on the bottom tab too.
    await owner.setViewportSize({ width: 360, height: 780 })
    await expect(
      owner.getByRole('link', { name: /^Applications\s*\d+/ }).filter({ visible: true }),
    ).toBeVisible()
    await owner.setViewportSize({ width: 1280, height: 800 })
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
    await expect(owner.getByText(/Due now: AED\s?3,250/)).toBeVisible()
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

// Spec item 9: only a super-admin reviews applications. A signed-in spa owner on the console gets 404 for the list and
// the detail page, and the accept / reject server actions — the super-admin's own calls, captured and replayed with
// the owner's session — change nothing. The same accept call replayed by the super-admin works (the replay is real).
test('a signed-in non-admin can neither open nor accept or reject an application', async ({
  page,
  browser,
}) => {
  const { email: ownerEmail } = await signUpOwner(page)
  if (!PATH) {
    // Cookies are per host: sign the owner in on the console host too (2FA is on for owners, G23).
    await page.goto(`${admin}/login`)
    await page.getByLabel('Email').fill(ownerEmail)
    await page.getByLabel('Password').fill(OWNER_PASSWORD)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForURL(/\/two-factor/)
    await passTwoFactor(page, ownerEmail)
    await page.waitForURL((url) => !url.pathname.includes('two-factor'))
  }

  const slug = uniqueSlug('guard')
  const email = `owner-${slug}@e2e.test`
  const applicantCtx = await browser.newContext()
  await applyForSpa(await applicantCtx.newPage(), { slug, email, spa: 'Guarded Spa' })
  await applicantCtx.close()
  const db = testDb()
  const [row] = await db.select().from(spaApplications).where(eq(spaApplications.email, email))
  const detail = `${admin}/applications/${row!.id}`

  await test.step('the pages are not found for a non-admin', async () => {
    expect((await page.goto(`${admin}/applications`))?.status()).toBe(404)
    expect((await page.goto(detail))?.status()).toBe(404)
    await expect(page.getByText('Guarded Spa')).toHaveCount(0)
  })

  // The super-admin's accept and reject calls, captured on their way out (and not sent).
  const ops = await adminPage(page)
  type Call = { url: string; headers: Record<string, string>; body: string }
  const calls: Call[] = []
  await ops.route('**/*', (route) => {
    const req = route.request()
    if (req.method() !== 'POST' || !req.headers()['next-action']) return route.continue()
    calls.push({ url: req.url(), headers: req.headers(), body: req.postData() ?? '' })
    return route.abort()
  })
  await test.step('capture the accept and reject calls', async () => {
    await ops.goto(detail)
    await ops.getByRole('button', { name: 'Accept', exact: true }).click()
    await ops.getByRole('button', { name: 'Accept and create spa' }).click()
    await expect.poll(() => calls.length).toBe(1)
    await ops.goto(detail)
    await ops.getByRole('button', { name: 'Reject', exact: true }).click()
    await ops.getByRole('button', { name: 'Reject application' }).click()
    await expect.poll(() => calls.length).toBe(2)
    await ops.unrouteAll()
  })

  const replay = (p: Page, call: Call) =>
    p.evaluate(async (c) => {
      const skip = ['cookie', 'content-length', 'host', 'origin', 'referer', 'user-agent']
      const headers = Object.fromEntries(Object.entries(c.headers).filter(([k]) => !skip.includes(k)))
      const r = await fetch(c.url, { method: 'POST', headers, body: c.body, redirect: 'manual' })
      return { status: r.status, text: await r.text() }
    }, call)

  await test.step('the non-admin replaying them changes nothing', async () => {
    await page.goto(detail) // on the console origin (its 404 page)
    for (const call of calls) {
      const res = await replay(page, call)
      expect(res.text).not.toMatch(/is live|Application rejected/)
    }
    const [after] = await db.select().from(spaApplications).where(eq(spaApplications.id, row!.id))
    expect(after).toMatchObject({ status: 'pending', reviewedBy: null, createdTenantId: null })
    expect(await db.select().from(tenants).where(eq(tenants.slug, slug))).toHaveLength(0)
    const [login] = await db.select().from(user).where(eq(user.email, email))
    expect(login?.disabledAt).toBeNull()
  })

  await test.step('the same accept call by the super-admin goes through', async () => {
    await ops.goto(detail)
    const res = await replay(ops, calls[0]!)
    expect(res.status).toBe(200)
    await expect
      .poll(
        async () =>
          (await db.select().from(spaApplications).where(eq(spaApplications.id, row!.id)))[0]?.status,
      )
      .toBe('approved')
  })
  await ops.context().close()
})

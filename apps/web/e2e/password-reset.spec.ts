// F14 (PLAN §17, gap G13): password reset end to end. The link arrives through the e2e mail outbox (a console Resend
// key routes staff email there, see helpers.consoleEmailKey), works once, expires, signs the login out everywhere, and
// never opens a closed (rejected-applicant) login. An unknown email gets exactly the same answer and no mail.
// Better Auth's per-IP limits are off on the e2e server (AUTH_RATE_LIMIT=off): packages/auth/test/rate-limit.test.ts.
import { expect, type Page, test } from '@playwright/test'
import { spaApplications, user, verification } from '@spa/db'
import { rejectApplication } from '@spa/services'
import { count, eq, like } from 'drizzle-orm'
import {
  ADMIN,
  app,
  applyForSpa,
  consoleEmailKey,
  OWNER_PASSWORD,
  outboxMails,
  passTwoFactor,
  signInPlatformAdmin,
  signUpOwner,
  testDb,
  uniqueSlug,
} from './helpers'

const SUBJECT = 'Reset your spamanagement.co password'
const NEW_PASSWORD = 'brand-new-password-42'

const resetMails = async (email: string) =>
  (await outboxMails()).filter((m) => m.to === email && m.subject === SUBJECT)

/** "Forgot password?" from the sign-in page, as a visitor would. */
async function requestReset(page: Page, email: string) {
  await page.goto(`${app}/login`)
  await page.getByRole('link', { name: 'Forgot password?' }).click()
  await page.waitForURL(/\/forgot-password$/)
  await page.getByLabel('Email').fill(email)
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByText('If that email has an account, a reset link is on its way.')).toBeVisible()
}

/** The link in the next reset mail to `email` (the `seen`+1-th). */
async function nextResetLink(email: string, seen: number) {
  await expect.poll(async () => (await resetMails(email)).length).toBe(seen + 1)
  const link = (await resetMails(email)).at(-1)!.text.match(/https?:\/\/\S+/)![0]
  expect(new URL(link).origin).toBe(new URL(app).origin) // the domain it was asked on, never a spa's
  expect(new URL(link).pathname).toMatch(/\/api\/auth\/reset-password\/[\w-]+$/)
  return { link, token: new URL(link).pathname.split('/').at(-1)! }
}

async function passwordSignIn(page: Page, email: string, password: string) {
  await page.goto(`${app}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** After a good code the two-step page navigates on its own: wait for it before going anywhere else. */
const leftTwoFactor = (page: Page) => page.waitForURL((u) => !u.pathname.endsWith('/two-factor'))

/** POST /api/auth/reset-password straight from the page (what a replayed or forged request would do). */
const postReset = (page: Page, token: string, newPassword: string) =>
  page.evaluate(
    async (b) => {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(b),
      })
      return { status: r.status, code: ((await r.json()) as { code?: string }).code }
    },
    { token, newPassword },
  )

const resetRows = async () =>
  (
    await testDb()
      .select({ n: count() })
      .from(verification)
      .where(like(verification.identifier, 'reset-password:%'))
  )[0]!.n

test.describe.configure({ mode: 'serial' })

let ops: Page
test.beforeAll(async ({ browser }) => {
  ops = await (await browser.newContext()).newPage()
  await signInPlatformAdmin(ops)
  await consoleEmailKey(ops, 're_e2eResetKey_RST1')
})
test.afterAll(async () => {
  await consoleEmailKey(ops, null) // later specs expect no stored key
  await ops.context().close()
})

test('reset: the emailed link sets a new password once, signs out elsewhere; expired links are refused', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000)
  const { email, dashboard } = await signUpOwner(page)
  const nav = page.getByRole('navigation', { name: 'Main menu' })
  // The same login, signed in on another device.
  const elsewhere = await (await browser.newContext()).newPage()
  await passwordSignIn(elsewhere, email, OWNER_PASSWORD)
  await elsewhere.waitForURL(/\/two-factor/)
  await passTwoFactor(elsewhere, email)
  await leftTwoFactor(elsewhere)
  await elsewhere.goto(dashboard)
  await expect(elsewhere.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
  await page.context().clearCookies()
  let first = { link: '', token: '' }

  await test.step('request → mail → new password; the old one stops working, the new one signs in', async () => {
    await requestReset(page, email)
    first = await nextResetLink(email, 0)
    await page.goto(first.link)
    await page.waitForURL(/\/reset-password\?token=/)
    await page.getByLabel('New password').fill(NEW_PASSWORD)
    await page.getByRole('button', { name: 'Set password' }).click()
    await page.waitForURL(/\/login$/)
    await passwordSignIn(page, email, OWNER_PASSWORD)
    await expect(page.getByText('Wrong email or password.')).toBeVisible()
    await passwordSignIn(page, email, NEW_PASSWORD)
    await page.waitForURL(/\/two-factor/) // 2FA still applies after a reset
    await passTwoFactor(page, email)
    await leftTwoFactor(page)
    await page.goto(dashboard)
    await expect(nav).toBeVisible()
  })

  await test.step('the reset signed the other device out', async () => {
    await elsewhere.goto(dashboard)
    await elsewhere.waitForURL(/\/login\?next=/)
    await elsewhere.context().close()
  })

  await test.step('the link works once: reopened it is invalid, replayed to the API it is refused', async () => {
    await page.goto(first.link)
    await page.waitForURL(/\/reset-password\?error=INVALID_TOKEN/)
    await expect(page.getByText('This link is invalid or has expired.')).toBeVisible()
    expect(await postReset(page, first.token, 'attacker-password-1')).toEqual({
      status: 400,
      code: 'INVALID_TOKEN',
    })
  })

  await test.step('an expired link is refused on the page and by the API; the password stays', async () => {
    await page.context().clearCookies()
    await requestReset(page, email)
    const second = await nextResetLink(email, 1)
    await testDb()
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(verification.identifier, `reset-password:${second.token}`))
    await page.goto(second.link)
    await page.waitForURL(/\/reset-password\?error=INVALID_TOKEN/)
    await expect(page.getByText('This link is invalid or has expired.')).toBeVisible()
    expect(await postReset(page, second.token, 'attacker-password-2')).toEqual({
      status: 400,
      code: 'INVALID_TOKEN',
    })
    await passwordSignIn(page, email, NEW_PASSWORD)
    await page.waitForURL(/\/two-factor/)
  })
})

test('reset: an unknown email gets the same answer and nothing is sent or stored', async ({ page }) => {
  const known = ADMIN.email
  const unknown = `nobody-${Date.now().toString(36)}@e2e.test`
  const rowsBefore = await resetRows()
  await requestReset(page, unknown)
  // Same status and body as for a real login (mail is sent before the reply, so its absence is final).
  const ask = (email: string) =>
    page.evaluate(async (e) => {
      const r = await fetch('/api/auth/request-password-reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: e, redirectTo: '/reset-password' }),
      })
      return { status: r.status, body: await r.text() }
    }, email)
  const sentBefore = (await resetMails(known)).length
  expect(await ask(unknown)).toEqual(await ask(known))
  expect(await resetMails(unknown)).toEqual([])
  expect((await resetMails(known)).length).toBe(sentBefore + 1)
  expect(await resetRows()).toBe(rowsBefore + 1) // only the known login's token
})

test('reset: a closed (rejected-applicant) login cannot reset its way back in', async ({ page }) => {
  const slug = uniqueSlug('closed')
  const email = `owner-${slug}@e2e.test`
  await applyForSpa(page, { slug, email, spa: 'Closed Spa' })
  const db = testDb()
  const [application] = await db.select().from(spaApplications).where(eq(spaApplications.email, email))
  const [reviewer] = await db.select({ id: user.id }).from(user).where(eq(user.email, ADMIN.email))
  const { disabled } = await rejectApplication(db, {
    applicationId: application!.id,
    reviewerId: reviewer!.id,
  })
  expect(disabled).toBe(true)

  await page.context().clearCookies()
  const seen = (await resetMails(email)).length
  await requestReset(page, email)
  const { link } = await nextResetLink(email, seen)
  await page.goto(link)
  await page.getByLabel('New password').fill(NEW_PASSWORD)
  await page.getByRole('button', { name: 'Set password' }).click()
  await page.waitForURL(/\/login$/)
  // The password changed, but a closed login still gets no session.
  await passwordSignIn(page, email, NEW_PASSWORD)
  await expect(page.getByTestId('account-closed')).toContainText('Application not approved')
  expect((await page.goto(`${app}/account`))?.url()).toMatch(/\/login\?next=/)
  const [row] = await db.select({ disabledAt: user.disabledAt }).from(user).where(eq(user.email, email))
  expect(row?.disabledAt).toBeTruthy()
})

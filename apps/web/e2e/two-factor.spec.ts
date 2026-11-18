// F14 (PLAN §17, gap G13): TOTP two-step verification end to end — enrolment on the account page, the sign-in step
// (wrong codes, the per-challenge attempt cap, backup codes once each), turning it off, the spa "Require 2FA" policy
// for a manager, and super-admin powers (console, impersonation, private files) only with 2FA. The policy toggle and
// the owner redirect are search-security.spec; the console enrolment of a new super-admin is admin-join.spec.
import { expect, type Page, test } from '@playwright/test'
import { platformAdmins, storedFiles, tenants, user } from '@spa/db'
import { putFile } from '@spa/services'
import { eq } from 'drizzle-orm'
import {
  addMember,
  admin,
  app,
  applyForSpa,
  approveApplication,
  createLogin,
  enrolTwoFactor,
  enrolUrl,
  OWNER_PASSWORD,
  PATH,
  PNG,
  signUpOwner,
  testDb,
  totpCode,
  uniqueSlug,
} from './helpers'

/** A code that is not the current one (nor, with any real chance, a neighbouring window's). */
const wrongCode = async (email: string) =>
  String((Number(await totpCode(email)) + 500_017) % 1_000_000).padStart(6, '0')

const isOn = async (email: string) =>
  (await testDb().select({ on: user.twoFactorEnabled }).from(user).where(eq(user.email, email)))[0]?.on

async function passwordSignIn(page: Page, email: string, password: string, root = app) {
  await page.goto(`${root}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

/** After a good code the two-step page navigates on its own: wait for it before going anywhere else. */
const leftTwoFactor = (page: Page) => page.waitForURL((u) => !u.pathname.endsWith('/two-factor'))

/** Submits a code on the two-step page and waits for the server's answer (no timing guesses). */
async function submitCode(page: Page, code: string, backup = false) {
  await page.getByLabel(backup ? 'Backup code' : '6-digit code').fill(code)
  await Promise.all([
    page.waitForResponse((r) => r.url().includes(backup ? '/verify-backup-code' : '/verify-totp')),
    page.getByRole('button', { name: 'Verify', exact: true }).click(),
  ])
}

test('owner: enrol on the account page, sign-in asks for the code, backup codes work once, off needs the password', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const slug = uniqueSlug('tfa')
  const email = `owner-${slug}@e2e.test`
  const dashboard = `${app}/${slug}`
  const nav = page.getByRole('navigation', { name: 'Main menu' })
  await applyForSpa(page, { slug, email, spa: 'Two Step Spa' })
  await approveApplication(email)
  let backupCodes: string[] = []

  await test.step('the spa policy sends the new owner to the account page to enrol', async () => {
    await page.goto(dashboard)
    await page.waitForURL(enrolUrl(slug))
    await expect(page.getByText(/Your spa requires two-step verification for your role/)).toBeVisible()
  })

  await test.step('set up: wrong password refused, QR shown, wrong code refused, right code turns it on', async () => {
    await page.getByLabel('Confirm your password').fill('not-my-password')
    await page.getByRole('button', { name: 'Set up' }).click()
    await expect(page.getByText('That password is not correct.')).toBeVisible()
    await page.getByLabel('Confirm your password').fill(OWNER_PASSWORD)
    await page.getByRole('button', { name: 'Set up' }).click()
    const qr = page.getByAltText('Scan with your authenticator app')
    await expect(qr).toHaveAttribute('src', /^data:image\/png;base64,/)
    await page.getByLabel('6-digit code').fill(await wrongCode(email))
    await page.getByRole('button', { name: 'Verify & turn on' }).click()
    await expect(page.getByText('That code is not correct.')).toBeVisible()
    expect(await isOn(email)).toBe(false)
    await page.getByLabel('6-digit code').fill(await totpCode(email))
    await page.getByRole('button', { name: 'Verify & turn on' }).click()
    await expect(page.getByText('Two-step verification is on')).toBeVisible()
    await expect(page.getByText('Save these backup codes somewhere safe. Each works once.')).toBeVisible()
    const codes = page.getByText(/^[A-Za-z0-9]{5}-[A-Za-z0-9]{5}$/)
    await expect(codes).toHaveCount(10)
    backupCodes = await codes.allTextContents()
    await page.getByRole('button', { name: 'Done' }).click()
    expect(await isOn(email)).toBe(true)
    await page.getByRole('link', { name: 'Back to the spa' }).click()
    await page.waitForURL(dashboard)
    await expect(nav).toBeVisible()
  })

  await test.step('signed out, the password alone does not sign in: a wrong code is refused, the right one opens', async () => {
    await page.getByRole('button', { name: /^Profile menu for / }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await page.waitForURL(/\/login$/)
    await passwordSignIn(page, email, OWNER_PASSWORD)
    await page.waitForURL(/\/two-factor/)
    await page.goto(dashboard) // no session yet: back to sign-in
    await page.waitForURL(/\/login\?next=/)
    await passwordSignIn(page, email, OWNER_PASSWORD)
    await page.waitForURL(/\/two-factor/)
    await submitCode(page, await wrongCode(email))
    await expect(page.getByText('That code is not correct.')).toBeVisible()
    await expect(page).toHaveURL(/\/two-factor/)
    await submitCode(page, await totpCode(email))
    await leftTwoFactor(page)
    await page.goto(dashboard)
    await expect(nav).toBeVisible()
  })

  await test.step('five wrong codes end the sign-in attempt; a new sign-in starts over', async () => {
    await page.context().clearCookies()
    await passwordSignIn(page, email, OWNER_PASSWORD)
    await page.waitForURL(/\/two-factor/)
    for (let i = 0; i < 5; i++) await submitCode(page, await wrongCode(email))
    await submitCode(page, await totpCode(email)) // even the right code: this challenge is spent
    await expect(page.getByText('Too many attempts. Please request a new code.')).toBeVisible()
    await page.goto(dashboard)
    await page.waitForURL(/\/login\?next=/)
    await passwordSignIn(page, email, OWNER_PASSWORD)
    await page.waitForURL(/\/two-factor/)
    await submitCode(page, await totpCode(email))
    await leftTwoFactor(page)
    await page.goto(dashboard)
    await expect(nav).toBeVisible()
  })

  await test.step('a backup code signs in once; the same code is refused the next time', async () => {
    for (const attempt of ['first', 'reuse'] as const) {
      await page.context().clearCookies()
      await passwordSignIn(page, email, OWNER_PASSWORD)
      await page.waitForURL(/\/two-factor/)
      await page.getByRole('button', { name: 'Use a backup code' }).click()
      await submitCode(page, backupCodes[0]!, true)
      if (attempt === 'first') {
        await leftTwoFactor(page)
        await page.goto(dashboard)
        await expect(nav).toBeVisible()
      } else {
        await expect(page.getByText('That backup code is not correct.')).toBeVisible()
        // Another unused code still works.
        await submitCode(page, backupCodes[1]!, true)
        await leftTwoFactor(page)
      }
    }
  })

  await test.step('turning it off needs the password; with the policy on the dashboard then asks to enrol again', async () => {
    await page.goto(`${app}/account`)
    await page.getByLabel('Confirm your password').fill('not-my-password')
    await page.getByRole('button', { name: 'Turn off' }).click()
    await expect(page.getByText('That password is not correct.')).toBeVisible()
    expect(await isOn(email)).toBe(true)
    await page.getByLabel('Confirm your password').fill(OWNER_PASSWORD)
    await page.getByRole('button', { name: 'Turn off' }).click()
    await expect(page.getByText('Two-step verification is off')).toBeVisible()
    expect(await isOn(email)).toBe(false)
    await page.goto(dashboard)
    await page.waitForURL(enrolUrl(slug))
    // Without 2FA the password signs straight in again (no two-step page).
    await page.context().clearCookies()
    await passwordSignIn(page, email, OWNER_PASSWORD)
    await page.waitForURL((u) => !u.pathname.endsWith('/login'))
    expect(page.url()).not.toContain('/two-factor')
  })
})

test('"Require 2FA" holds a manager without 2FA (not a receptionist) until it is on', async ({
  page,
  browser,
}) => {
  const { slug, dashboard } = await signUpOwner(page)
  const tag = slug.slice(-6)
  const people = {
    manager: `manager-${tag}@e2e.test`,
    receptionist: `reception-${tag}@e2e.test`,
  } as const
  for (const [role, email] of Object.entries(people) as [keyof typeof people, string][]) {
    const ctx = await browser.newContext()
    const p = await ctx.newPage()
    await createLogin(p, { name: `Test ${role}`, email, password: OWNER_PASSWORD })
    await addMember(slug, email, role)
    await p.goto(dashboard)
    if (role === 'manager') {
      await p.waitForURL(enrolUrl(slug))
      await expect(p.getByText(/Your spa requires two-step verification for your role/)).toBeVisible()
      await enrolTwoFactor(p, email, OWNER_PASSWORD)
      await p.getByRole('link', { name: 'Back to the spa' }).click()
    }
    await p.waitForURL(dashboard)
    await expect(p.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
    await ctx.close()
  }
})

test('a super-admin without 2FA has no powers: console, impersonation and private files wait for it', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000)
  // Someone else's spa with a private receipt (accounting) on it.
  const ownerCtx = await browser.newContext()
  const { slug, dashboard } = await signUpOwner(await ownerCtx.newPage())
  await ownerCtx.close()
  const db = testDb()
  const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug))
  const receipt = await db.transaction((tx) =>
    putFile(tx, {
      tenantId: tenant!.id,
      bytes: PNG,
      contentType: 'image/png',
      filename: 'receipt.png',
      isPublic: false,
      purpose: 'receipt',
    }),
  )
  const fileUrl = `${app}/files/${receipt.id}`

  // A promoted super-admin (verified, platform_admins row) that has not set up 2FA yet.
  const email = `ops-${slug.slice(-6)}@e2e.test`
  const password = 'ops-admin-password'
  await createLogin(page, { name: 'Ops Admin', email, password })
  const [login] = await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.email, email))
    .returning({ id: user.id })
  await db.insert(platformAdmins).values({ userId: login!.id })
  const consoleHome = page.getByRole('heading', { name: 'Overview' })

  await test.step('without 2FA: the console, the spa and its private file are all closed', async () => {
    await page.goto(dashboard)
    await page.waitForURL(/\/account\?admin2fa=1$/)
    await expect(page.getByText(/Super-admin access needs two-step verification/)).toBeVisible()
    expect((await page.goto(fileUrl))?.status()).toBe(404)
    if (!PATH) {
      // Cookies are per host: sign in on the console host too (no two-step page: 2FA is off).
      await passwordSignIn(page, email, password, admin)
      await page.waitForURL(/\/account\?admin2fa=1$/)
    }
    await page.goto(`${admin}/`)
    await page.waitForURL(/\/account\?admin2fa=1$/)
    expect(new URL(page.url()).origin).toBe(new URL(admin).origin)
    await expect(consoleHome).toHaveCount(0)
  })

  await test.step('after enrolling: console, impersonation and the file open', async () => {
    await enrolTwoFactor(page, email, password)
    await page.goto(`${admin}/`)
    await expect(consoleHome).toBeVisible()
    // The app-host session (signed in before 2FA) gets the powers too: they are read from the row, not the cookie.
    await page.goto(dashboard)
    await expect(page.getByRole('navigation', { name: 'Main menu' })).toBeVisible()
    expect((await page.goto(fileUrl))?.status()).toBe(200)
  })

  await test.step('turning 2FA off takes the powers away again at once', async () => {
    await page.goto(`${admin}/account`)
    await page.getByLabel('Confirm your password').fill(password)
    await page.getByRole('button', { name: 'Turn off' }).click()
    await expect(page.getByText('Two-step verification is off')).toBeVisible()
    await page.goto(`${admin}/`)
    await page.waitForURL(/\/account\?admin2fa=1$/)
    expect((await page.goto(fileUrl))?.status()).toBe(404)
    await page.goto(dashboard)
    await page.waitForURL(/\/account\?admin2fa=1$/)
  })
  await db.delete(storedFiles).where(eq(storedFiles.id, receipt.id))
})

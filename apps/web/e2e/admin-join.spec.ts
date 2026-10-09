// Super-admin join + bootstrap without email (owner, 2026-10-09; PLAN §18.3): a PLATFORM_ADMIN_EMAILS address creates
// its login on the admin host (no spa, no application); an existing super-admin with 2FA marks it verified (or it opens
// the emailed link) → console → 2FA enrolment → console. Unlisted emails are refused; the spa application form
// refuses listed ones. Listed in playwright.config.ts: join-confirm@, join-link@, listed-apply@e2e.test.
import { expect, type Page, test } from '@playwright/test'
import { auditLog, platformAdmins, spaApplications, user } from '@spa/db'
import { createEmailVerificationToken } from 'better-auth/api'
import { and, eq } from 'drizzle-orm'
import {
  AUTH_SECRET,
  admin,
  app,
  base,
  enrolTwoFactor,
  OWNER_PASSWORD,
  PATH,
  signInPlatformAdmin,
  testDb,
} from './helpers'

const PASSWORD = 'listed-admin-pass'

async function join(page: Page, email: string, name = 'Listed Admin') {
  await page.goto(`${admin}/login`)
  await page.getByRole('link', { name: 'Create a super-admin account' }).click()
  await expect(page.getByRole('heading', { name: 'Create a super-admin account' })).toBeVisible()
  await page.getByLabel('Your name').fill(name)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Create super-admin account' }).click()
}

const login = async (email: string) => {
  const [row] = await testDb()
    .select({ id: user.id, verified: user.emailVerified })
    .from(user)
    .where(eq(user.email, email))
  return row
}
const isSuperAdmin = async (userId: string) =>
  (await testDb().select().from(platformAdmins).where(eq(platformAdmins.userId, userId))).length === 1

async function expectConsoleAfterEnrol(page: Page, email: string) {
  await expect(page).toHaveURL(/admin2fa=1/)
  await expect(page.getByText('Super-admin access needs two-step verification')).toBeVisible()
  await enrolTwoFactor(page, email, PASSWORD)
  await page.goto(`${admin}/`)
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible()
}

test('admin join: a listed email joins, an existing super-admin marks it verified, 2FA, console', async ({
  page,
  browser,
}) => {
  const email = 'join-confirm@e2e.test'
  await join(page, email)
  // Signed in, not verified: the join page says how to finish; the console sends it back there (no 404).
  const pending = page.getByTestId('admin-join-pending')
  await expect(pending).toContainText(email)
  await pending.getByRole('link', { name: 'Open the console' }).click()
  await expect(page).toHaveURL(`${admin}/join`)
  await expect(pending).toBeVisible()
  const joined = await login(email)
  expect(joined?.verified).toBe(false)
  expect(await isSuperAdmin(joined!.id)).toBe(false)
  // No spa application came with it.
  expect(await testDb().select().from(spaApplications).where(eq(spaApplications.userId, joined!.id))).toEqual(
    [],
  )

  // The existing super-admin (2FA) confirms it in Company → Super-admins.
  const ctx = await browser.newContext()
  const boss = await ctx.newPage()
  await signInPlatformAdmin(boss)
  await boss.goto(`${admin}/settings`)
  const card = boss.getByTestId('super-admins')
  await expect(card).toContainText('admin@e2e.test')
  const row = card.getByTestId('listed-admin').filter({ hasText: email })
  await expect(row).toContainText('Email not verified')
  // Listed addresses without a login show up too, without a button.
  await expect(card.getByTestId('listed-admin').filter({ hasText: 'listed-apply@e2e.test' })).toContainText(
    'No login yet',
  )
  await row.getByRole('button', { name: 'Mark email verified' }).click()
  await expect(boss.getByText(`${email} is a super-admin now`)).toBeVisible()
  await boss.reload()
  await expect(card.getByTestId('listed-admin').filter({ hasText: email })).toHaveCount(0)
  await expect(card).toContainText(email)
  await expect(card).toContainText('2FA off')
  expect((await login(email))?.verified).toBe(true)
  expect(await isSuperAdmin(joined!.id)).toBe(true)
  const [entry] = await testDb()
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.action, 'platform.admin.email_verified'), eq(auditLog.entityId, joined!.id)))
  expect(entry?.data).toMatchObject({ email, markedVerified: true, promoted: true })
  await ctx.close()

  // The new super-admin opens the console → 2FA enrolment first → then the console.
  await page.goto(`${admin}/`)
  await expectConsoleAfterEnrol(page, email)
})

test('admin join: the verification link lands in the console; the app home sends the login there too', async ({
  page,
}) => {
  const email = 'join-link@e2e.test'
  await join(page, email, 'Link Admin')
  await expect(page.getByTestId('admin-join-pending')).toBeVisible()
  // The emailed link (same token Better Auth sends; callback = the console on this admin host).
  const token = await createEmailVerificationToken(AUTH_SECRET, email)
  const api = PATH ? base : admin
  await page.goto(
    `${api}/api/auth/verify-email?token=${token}&callbackURL=${encodeURIComponent(PATH ? '/admin' : '/')}`,
  )
  await expect(page).toHaveURL(/admin2fa=1/)
  const joined = await login(email)
  expect(joined?.verified).toBe(true)
  expect(await isSuperAdmin(joined!.id)).toBe(true)

  // Signed in on the app host with no spa: the dashboard home sends it to the console, never to the application form.
  await page.goto(`${app}/login`)
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expectConsoleAfterEnrol(page, email)
  expect(page.url().startsWith(admin)).toBe(true)
})

test('admin join refuses an unlisted email; the spa application form refuses a listed one', async ({
  page,
}) => {
  const stranger = 'not-listed@e2e.test'
  await join(page, stranger)
  await expect(
    page.getByText('This email address cannot create a super-admin account.').first(),
  ).toBeVisible()
  await expect(page).toHaveURL(`${admin}/join`)
  expect(await login(stranger)).toBeUndefined()

  const listed = 'listed-apply@e2e.test'
  await page.goto(`${app}/signup`)
  await page.getByLabel('Your name').fill('Listed Applicant')
  await page.getByLabel('Work email').fill(listed)
  await page.getByLabel('Password').fill(OWNER_PASSWORD)
  await page.getByLabel('Mobile number').fill('050 123 4567')
  await page.getByLabel('Spa name').fill('Admin Spa')
  await page.getByLabel('Web address').fill('listed-admin-spa')
  await expect(page.getByText(/listed-admin-spa.* is available/)).toBeVisible()
  await page.getByLabel('Emirate').selectOption('dubai')
  await page.getByLabel('Street address').fill('Marina Walk, Tower 2')
  await page.getByRole('button', { name: 'Send application' }).click()
  await expect(page.getByText(/Create its login on the admin join page instead: .*\/join/)).toBeVisible()
  await expect(page.getByText('Super-admin address: use the admin join page instead')).toBeVisible()
  await expect(page).toHaveURL(`${app}/signup`)
  // Refused before anything was created: no login, no application holding the address.
  expect(await login(listed)).toBeUndefined()
  expect(
    await testDb().select().from(spaApplications).where(eq(spaApplications.slug, 'listed-admin-spa')),
  ).toEqual([])
})

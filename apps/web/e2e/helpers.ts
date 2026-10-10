import { createHmac } from 'node:crypto'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { businessDateOf, dubaiInstant, type SystemRoleKey } from '@spa/core'
import {
  branches,
  clients,
  createDb,
  members,
  plans,
  platformAdmins,
  roles,
  rooms,
  services,
  serviceVariants,
  shifts,
  spaApplications,
  staff,
  staffServices,
  tenants,
  twoFactor,
  user,
} from '@spa/db'
import { testUrls } from '@spa/db/testing'
import { acceptApplication, createBooking } from '@spa/services'
import { createEmailVerificationToken } from 'better-auth/api'
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'
import { and, eq } from 'drizzle-orm'
import type ExcelJSType from 'exceljs'

/** URL helpers that work in both routing modes (E2E_ROUTING=path → single host). */
export const PORT = Number(process.env.E2E_PORT ?? 3100)
export const PATH = process.env.E2E_ROUTING === 'path'
export const base = `http://localhost:${PORT}`
export const app = PATH ? `${base}/app` : `http://app.localhost:${PORT}`
export const admin = PATH ? `${base}/admin` : `http://admin.localhost:${PORT}`
/** The same platform on its second domain (EXTRA_ROOT_DOMAINS in playwright.config.ts). */
export const altBase = `http://alt.localhost:${PORT}`
export const altApp = PATH ? `${altBase}/app` : `http://app.alt.localhost:${PORT}`
export const site = (slug: string) => (PATH ? `${base}/s/${slug}` : `http://${slug}.localhost:${PORT}`)
export const uniqueSlug = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`

/** Where an owner's first dashboard visit lands: G23 makes new owners enrol 2FA first (`/account?require2fa=<slug>`). */
export const enrolUrl = (slug: string) => new RegExp(`/account\\?require2fa=${slug}$`)

export const OWNER_PASSWORD = 'correct-horse-battery'

/** A 1×1 PNG (stored-file fixtures: images open inline in the browser, unlike a PDF, which downloads). */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * Fills and sends "Apply for your spa" (PLAN §18.3) and lands on the applicant's waiting page. Signed out: creates the
 * login too. `base` = the app origin to use (the second platform domain in platform-domains.spec).
 */
export async function applyForSpa(
  page: Page,
  opts: {
    slug: string
    email: string
    name?: string
    spa?: string
    password?: string
    planId?: string
    logo?: { name: string; mimeType: string; buffer: Buffer }
    base?: string
  },
) {
  const root = opts.base ?? app
  await page.goto(`${root}/signup`)
  await page.getByLabel('Your name').fill(opts.name ?? 'Aisha Rahman')
  await page.getByLabel('Work email').fill(opts.email)
  await page.getByLabel('Password').fill(opts.password ?? OWNER_PASSWORD)
  await page.getByLabel('Mobile number').fill('050 123 4567')
  await page.getByLabel('Spa name').fill(opts.spa ?? 'Serenity Spa')
  await page.getByLabel('Web address').fill(opts.slug)
  await expect(page.getByText(new RegExp(`${opts.slug}.* is available`))).toBeVisible()
  await page.getByLabel('Emirate').selectOption('dubai')
  await page.getByLabel('Street address').fill('Marina Walk, Tower 2')
  if (opts.logo) await page.getByLabel('Logo (optional)').setInputFiles(opts.logo)
  if (opts.planId) await page.getByLabel('Plan').selectOption(opts.planId)
  await page.getByRole('button', { name: 'Send application' }).click()
  await page.waitForURL(`${root}/application`)
}

/** A seeded plan's id by code (PLAN §18.8: premium / standard / legacy-yearly). */
export async function planIdOf(code: string) {
  const [row] = await testDb().select({ id: plans.id }).from(plans).where(eq(plans.code, code))
  if (!row) throw new Error(`no plan ${code}`)
  return row.id
}

/**
 * Fast path for specs that just need a spa: accepts the applicant's pending application server-side with the same
 * service the console uses (setup fee, if any, recorded as paid in full by bank transfer). The console flow itself
 * (deposit, reject) is covered by applications.spec.
 */
export async function approveApplication(email: string) {
  const db = testDb()
  const [row] = await db
    .select()
    .from(spaApplications)
    .where(and(eq(spaApplications.email, email), eq(spaApplications.status, 'pending')))
  if (!row) throw new Error(`no pending application for ${email}`)
  const [plan] = row.planId
    ? await db.select().from(plans).where(eq(plans.id, row.planId))
    : await db.select().from(plans).where(eq(plans.active, true)).orderBy(plans.sort)
  if (!plan) throw new Error('no plan')
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
  return acceptApplication(db, {
    applicationId: row.id,
    reviewerId: row.userId,
    planId: plan.id,
    startDate: row.preferredStart,
    today,
    payment: Number(plan.setupFeeAed) > 0 ? { kind: 'full', paidOn: today, method: 'bank_transfer' } : null,
  })
}

/**
 * Applies for a new owner + spa, has it accepted (fast path) and lands on its dashboard. "Require 2FA for owner &
 * managers" is on for new spas (G23), so a verified TOTP secret is stored directly (`enableTotp`; the UI enrolment
 * is covered in onboarding.spec / applications.spec) and a later password sign-in passes with
 * `passTwoFactor(page, email)`.
 */
export async function signUpOwner(
  page: Page,
  opts: { slug?: string; name?: string; spa?: string; plan?: 'premium' | 'standard' } = {},
) {
  const slug = opts.slug ?? uniqueSlug('spa')
  const email = `owner-${slug}@e2e.test`
  // PLAN §18.8: the form preselects Premium (first plan); `plan: 'standard'` applies for Standard.
  const planId = opts.plan ? await planIdOf(opts.plan) : undefined
  await applyForSpa(page, { slug, email, name: opts.name, spa: opts.spa, planId })
  await approveApplication(email)
  await enableTotp(email)
  await page.goto(`${app}/${slug}`)
  await page.waitForURL(`${app}/${slug}`)
  return { slug, dashboard: `${app}/${slug}`, email }
}

/** BETTER_AUTH_SECRET of the e2e server (playwright.config.ts). */
export const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-e2e'
export const ADMIN = { email: 'admin@e2e.test', password: 'platform-admin-pass' }

/** The current TOTP code of a user with 2FA set up: decrypts the stored secret the way Better Auth does. */
export async function totpCode(email: string) {
  const [row] = await testDb()
    .select({ secret: twoFactor.secret })
    .from(twoFactor)
    .innerJoin(user, eq(user.id, twoFactor.userId))
    .where(eq(user.email, email))
  if (!row) throw new Error(`no 2FA secret for ${email}`)
  const secret = await symmetricDecrypt({ key: AUTH_SECRET, data: row.secret.replace(/^\$ba\$\d+\$/, '') })
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)))
  const h = createHmac('sha1', secret).update(counter).digest()
  return String((h.readUInt32BE(h[h.length - 1]! & 15) & 0x7fffffff) % 1_000_000).padStart(6, '0')
}

/** On the two-step page after a password sign-in: enters the authenticator code. */
export async function passTwoFactor(page: Page, email = ADMIN.email) {
  await page.getByLabel('6-digit code').fill(await totpCode(email))
  await page.getByRole('button', { name: 'Verify', exact: true }).click()
}

/** Turns on TOTP 2FA from the account page the browser is on (Set up → password → code from the app). */
export async function enrolTwoFactor(page: Page, email: string, password: string) {
  await page.getByLabel('Confirm your password').fill(password)
  await page.getByRole('button', { name: 'Set up' }).click()
  const code = page.getByLabel('6-digit code')
  await expect(code).toBeVisible()
  await code.fill(await totpCode(email))
  await page.getByRole('button', { name: 'Verify & turn on' }).click()
  await expect(page.getByText('Two-step verification is on')).toBeVisible()
}

/** Where a password sign-in landed: the console, the 2FA step, the 2FA enrolment page, or nowhere (bad login). */
async function signInOutcome(page: Page) {
  const overview = page.getByRole('heading', { name: 'Overview' })
  for (let i = 0; i < 60; i++) {
    const url = page.url()
    if (url.includes('admin2fa=1')) return 'enrol' as const
    if (url.includes('/two-factor')) return 'twoFactor' as const
    if (await overview.isVisible()) return 'in' as const
    await page.waitForTimeout(250)
  }
  return 'failed' as const
}

/**
 * Signs the page in as the e2e super-admin (admin@e2e.test, in PLATFORM_ADMIN_EMAILS), creating the login (no spa —
 * spas now come from accepted applications) the first time any spec needs it. G2/G3: the address is promoted only
 * once verified (the spec opens the real verification link) and the console demands TOTP 2FA, which the first
 * sign-in enrols.
 */
export async function signInPlatformAdmin(page: Page) {
  const { email, password } = ADMIN
  const overview = page.getByRole('heading', { name: 'Overview' })
  const signIn = async () => {
    await page.goto(`${admin}/login`)
    if (await overview.isVisible()) return 'in' as const
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: 'Sign in' }).click()
    return signInOutcome(page)
  }
  let outcome = await signIn()
  if (outcome === 'failed') {
    await createLogin(page, { name: 'Platform Admin', email, password })
    // Unverified: the listed email is not a super-admin yet (G2).
    await page.goto(`${admin}/`)
    await expect(overview).toHaveCount(0)
    // Open the emailed verification link (same token Better Auth sends).
    const token = await createEmailVerificationToken(AUTH_SECRET, email)
    // The API lives on the bare host with path routing (`/app/api/…` would be a dashboard path).
    await page.goto(
      `${PATH ? base : app}/api/auth/verify-email?token=${token}&callbackURL=${encodeURIComponent('/')}`,
    )
    outcome = await signIn()
  }
  if (outcome === 'enrol') {
    // G3: a super-admin without 2FA is sent to set it up; the console opens afterwards.
    await expect(page.getByText('Super-admin access needs two-step verification')).toBeVisible()
    await enrolTwoFactor(page, email, password)
    await page.goto(`${admin}/`)
  } else if (outcome === 'twoFactor') {
    await passTwoFactor(page, email)
  }
  await expect(overview).toBeVisible()
}

/**
 * Creates a login only (Better Auth's sign-up endpoint, which the apply form uses too; no spa, no application), from
 * the browser so the session cookie lands in this context on the app host (Node can't resolve *.localhost hosts).
 */
export async function createLogin(page: Page, body: { name: string; email: string; password: string }) {
  await page.goto(`${app}/login`)
  const res = await page.evaluate(async (b) => {
    const r = await fetch('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(b),
    })
    return { ok: r.ok, text: await r.text() }
  }, body)
  expect(res.ok, res.text).toBe(true)
}

/** Makes an existing login an active member of a spa with a system role (DB; the invitation flow is onboarding.spec). */
export async function addMember(slug: string, email: string, roleKey: SystemRoleKey) {
  const db = testDb()
  const [t] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, slug))
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
  const [r] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.tenantId, t!.id), eq(roles.key, roleKey)))
  await db.insert(members).values({ tenantId: t!.id, userId: u!.id, roleId: r!.id })
}

/**
 * Saves (or removes, `null`) a console Resend key on a signed-in super-admin page: staff email (password reset,
 * enquiries) then lands in the e2e outbox as JSON files, no Resend call. Remove it again so later specs see no key.
 */
export async function consoleEmailKey(page: Page, key: string | null) {
  await page.goto(`${admin}/settings`)
  const card = page.getByTestId('email-settings')
  if (key) await card.getByLabel('Resend API key').fill(key)
  else await card.getByLabel('Remove the stored key').check()
  await card.getByRole('button', { name: 'Save email settings' }).click()
  await expect(page.getByText('Email settings saved')).toBeVisible()
}

export type OutboxMail = { to: string; from: string; subject: string; text: string; replyTo?: string }

/** Every mail in the e2e outbox (EMAIL_E2E_OUTBOX_DIR, see playwright.config.ts), oldest first. */
export async function outboxMails(): Promise<OutboxMail[]> {
  const dir = process.env.EMAIL_E2E_OUTBOX_DIR as string
  const files = (await readdir(dir).catch(() => [] as string[])).sort()
  return Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(dir, f), 'utf8'))))
}

/** Screenshots a view at phone, tablet and desktop widths into test-results/screens. */
export async function screenshotAt(page: Page, name: string) {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: width < 768 ? 780 : 900 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `test-results/screens/${name}-${width}.png`, fullPage: true })
  }
  await page.setViewportSize({ width: 1280, height: 800 })
}

// ---------------------------------------------------------------------------
// Test data seeding (direct DB access with the platform role; tests only).
// ---------------------------------------------------------------------------

export const testDb = () => createDb(testUrls.platform, 3)

/** Writes the canned AI reply the server returns for this spa (AI_E2E_FIXTURE_DIR, see playwright.config). */
export async function mockAiReply(slug: string, reply: unknown) {
  const dir = path.join(tmpdir(), `spa-e2e-ai-${PORT}`)
  await mkdir(dir, { recursive: true })
  await writeFile(path.join(dir, `${slug}.json`), JSON.stringify(reply))
}

/**
 * Turns TOTP 2FA on for a user by storing a verified secret directly (as Better Auth would), so a later password
 * sign-in passes with passTwoFactor(page, email). The UI enrolment is covered by onboarding.spec / signInPlatformAdmin.
 */
export async function enableTotp(email: string) {
  const db = testDb()
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email))
  if (!row) throw new Error(`no user ${email}`)
  const enc = (data: string) => symmetricEncrypt({ key: AUTH_SECRET, data })
  await db
    .insert(twoFactor)
    .values({
      id: `tf-${row.id}`,
      userId: row.id,
      secret: await enc(`e2e-totp-${row.id}`),
      backupCodes: await enc('[]'),
      verified: true,
    })
    .onConflictDoNothing()
  await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, row.id))
}

/** Makes a signed-up owner a super-admin too, so the Website Studio (super-admin only) opens on their spa. */
export async function makeStudio(slug: string) {
  const db = testDb()
  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, `owner-${slug}@e2e.test`))
  await db.insert(platformAdmins).values({ userId: owner!.id }).onConflictDoNothing()
  // Super-admin powers need 2FA (G3): signUpOwner already enrolled it (G23); kept for owners created otherwise.
  await enableTotp(`owner-${slug}@e2e.test`)
}

/**
 * Studio super-admin whose email counts for SITE_AI_EDITOR_EMAILS (prompt site editing: Studio Ask AI, Claude MCP):
 * the allow-list only matches verified emails. Listed in playwright.config.ts: slugs `ai-editor`, `mcp-editor`.
 */
export async function makeSiteAiEditor(slug: string) {
  await makeStudio(slug)
  await testDb()
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.email, `owner-${slug}@e2e.test`))
}

/** Today's business date in Dubai (05:00 cutoff). */
export const today = () => businessDateOf(new Date(), '05:00')

/**
 * `hours` for seedBooking that keep the booking on today's calendar: ahead of now, or as far behind when ahead
 * would cross the 05:00 business-day cutoff (a run between 03:00 and 05:00 Dubai put it on tomorrow's calendar).
 */
export const hoursOnToday = (hours: number) =>
  businessDateOf(new Date(Date.now() + hours * 3600_000 + 900_000), '05:00') === today() ? hours : -hours

/**
 * Gives a freshly signed-up spa a small menu, two therapists on shift all of today's and tomorrow's
 * business day (05:00–05:00, so walk-in/rotation specs don't depend on the clock),
 * two rooms and one client. Returns the ids tests need.
 */
export async function seedCatalog(slug: string) {
  const db = testDb()
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug))
  if (!tenant) throw new Error(`no tenant ${slug}`)
  const [branch] = await db.select().from(branches).where(eq(branches.tenantId, tenant.id))
  const allDay = { open: '09:00', close: '23:00' }
  await db
    .update(branches)
    .set({
      whatsappE164: '971501112233',
      openingHours: Object.fromEntries(
        ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [allDay]]),
      ),
    })
    .where(eq(branches.id, branch!.id))
  const [swedish] = await db
    .insert(services)
    .values({ tenantId: tenant.id, name: { en: 'Swedish massage', ar: 'مساج سويدي' }, bufferAfterMin: 15 })
    .returning()
  const variants = await db
    .insert(serviceVariants)
    .values([
      { tenantId: tenant.id, serviceId: swedish!.id, durationMin: 60, priceAed: '350' },
      { tenantId: tenant.id, serviceId: swedish!.id, durationMin: 90, priceAed: '480', sort: 1 },
    ])
    .returning()
  const people = await db
    .insert(staff)
    .values([
      {
        tenantId: tenant.id,
        displayName: 'Maya',
        gender: 'female',
        color: '#5e7d6b',
        sort: 1,
        commissionPct: '10',
      },
      {
        tenantId: tenant.id,
        displayName: 'Ploy',
        gender: 'female',
        color: '#3d5a80',
        sort: 2,
        commissionPct: '10',
      },
    ])
    .returning()
  const days = [today(), businessDateOf(new Date(Date.now() + 24 * 3600_000), '05:00')]
  for (const p of people) {
    await db.insert(staffServices).values({ tenantId: tenant.id, staffId: p.id, serviceId: swedish!.id })
    for (const d of days) {
      await db.insert(shifts).values({
        tenantId: tenant.id,
        staffId: p.id,
        branchId: branch!.id,
        startsAt: dubaiInstant(d, 5 * 60),
        endsAt: dubaiInstant(d, 29 * 60),
      })
    }
  }
  const roomRows = await db
    .insert(rooms)
    .values([
      { tenantId: tenant.id, branchId: branch!.id, name: 'Room 1' },
      { tenantId: tenant.id, branchId: branch!.id, name: 'Room 2', sort: 1 },
    ])
    .returning()
  const [client] = await db
    .insert(clients)
    .values({ tenantId: tenant.id, name: 'Fatima Al Mansoori', phoneE164: '971501234567' })
    .returning()
  return {
    tenantId: tenant.id,
    branchId: branch!.id,
    serviceId: swedish!.id,
    variantIds: variants.map((v) => v.id),
    staffIds: people.map((p) => p.id),
    roomIds: roomRows.map((r) => r.id),
    clientId: client!.id,
  }
}

/** Creates a confirmed booking for the seeded client, `hoursFromNow` ahead (rounded to the quarter hour). */
/**
 * Seeds a confirmed booking for Fatima with Maya. `when` is either hours from now (rounded up to 15 min) or a
 * fixed Dubai time today ('HH:MM') — use the latter whenever the test depends on clock positions.
 */
export async function seedBooking(seed: Awaited<ReturnType<typeof seedCatalog>>, when: number | string = 2) {
  const start =
    typeof when === 'string'
      ? dubaiInstant(today(), Number(when.slice(0, 2)) * 60 + Number(when.slice(3, 5)))
      : new Date(Math.ceil((Date.now() + when * 3600_000) / 900_000) * 900_000)
  return testDb().transaction((tx) =>
    createBooking(tx, {
      tenantId: seed.tenantId,
      branchId: seed.branchId,
      clientId: seed.clientId,
      source: 'phone',
      status: 'confirmed',
      allowOffShift: true,
      items: [
        {
          serviceVariantId: seed.variantIds[0]!,
          start,
          staffIds: [seed.staffIds[0]!],
          roomId: seed.roomIds[0]!,
        },
      ],
    }),
  )
}

/** A downloaded .xlsx workbook (R10: every export is Excel). */
// Plain CommonJS require: Playwright's ESM loader cannot link exceljs' dependency tree.
export const ExcelJS = createRequire(import.meta.url)('exceljs') as typeof ExcelJSType

export async function openXlsx(bytes: Buffer) {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(bytes as unknown as ExcelJSType.Buffer)
  return wb
}

/** A sheet's rows as plain values (index 0 = row 1; cell values as exceljs reads them). */
export const sheetRows = (ws: ExcelJSType.Worksheet) =>
  Array.from({ length: ws.rowCount }, (_, i) => (ws.getRow(i + 1).values as unknown[]).slice(1))

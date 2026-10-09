import { createHmac } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { businessDateOf, dubaiInstant } from '@spa/core'
import {
  branches,
  clients,
  createDb,
  platformAdmins,
  rooms,
  services,
  serviceVariants,
  shifts,
  staff,
  staffServices,
  tenants,
  twoFactor,
  user,
} from '@spa/db'
import { testUrls } from '@spa/db/testing'
import { createBooking } from '@spa/services'
import { createEmailVerificationToken } from 'better-auth/api'
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
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

/** Signs up a new owner + spa and lands on its dashboard. */
export async function signUpOwner(page: Page, opts: { slug?: string; name?: string; spa?: string } = {}) {
  const slug = opts.slug ?? uniqueSlug('spa')
  await page.goto(`${app}/signup`)
  await page.getByLabel('Your name').fill(opts.name ?? 'Aisha Rahman')
  await page.getByLabel('Work email').fill(`owner-${slug}@e2e.test`)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByLabel('Spa name').fill(opts.spa ?? 'Serenity Spa')
  await page.getByLabel('Web address').fill(slug)
  await expect(page.getByText(new RegExp(`${slug}.* is available`))).toBeVisible()
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL(`${app}/${slug}`)
  return { slug, dashboard: `${app}/${slug}` }
}

/** BETTER_AUTH_SECRET of the e2e server (playwright.config.ts). */
const AUTH_SECRET = 'e2e-secret-e2e-secret-e2e-secret-e2e'
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
 * Signs the page in as the e2e super-admin (admin@e2e.test, in PLATFORM_ADMIN_EMAILS), creating the account through
 * spa sign-up the first time any spec needs it. G2/G3: the address is promoted only once verified (the spec opens
 * the real verification link) and the console demands TOTP 2FA, which the first sign-in enrols.
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
    const slug = uniqueSlug('admin')
    await page.goto(`${app}/signup`)
    await page.getByLabel('Your name').fill('Platform Admin')
    await page.getByLabel('Work email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByLabel('Spa name').fill('Admin Test Spa')
    await page.getByLabel('Web address').fill(slug)
    await page.getByRole('button', { name: 'Create account' }).click()
    await page.waitForURL(`${app}/${slug}`)
    // Unverified: the listed email is not a super-admin yet (G2).
    await page.goto(`${admin}/`)
    await expect(overview).toHaveCount(0)
    // Open the emailed verification link (same token Better Auth sends).
    const token = await createEmailVerificationToken(AUTH_SECRET, email)
    await page.goto(`${app}/api/auth/verify-email?token=${token}&callbackURL=${encodeURIComponent('/')}`)
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

/** Makes a signed-up owner a super-admin too, so the Website Studio (super-admin only) opens on their spa. */
export async function makeStudio(slug: string) {
  const db = testDb()
  const [owner] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, `owner-${slug}@e2e.test`))
  await db.insert(platformAdmins).values({ userId: owner!.id }).onConflictDoNothing()
  // Super-admin powers need 2FA (G3); the UI enrolment is covered by signInPlatformAdmin. Here a verified TOTP
  // secret is stored directly (as Better Auth would), so a later sign-in passes with passTwoFactor().
  const enc = (data: string) => symmetricEncrypt({ key: AUTH_SECRET, data })
  await db
    .insert(twoFactor)
    .values({
      id: `tf-${owner!.id}`,
      userId: owner!.id,
      secret: await enc(`e2e-totp-${owner!.id}`),
      backupCodes: await enc('[]'),
      verified: true,
    })
    .onConflictDoNothing()
  await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, owner!.id))
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

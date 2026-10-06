import { expect, type Page } from '@playwright/test'
import { businessDateOf, dubaiInstant } from '@spa/core'
import {
  branches,
  clients,
  createDb,
  rooms,
  services,
  serviceVariants,
  shifts,
  staff,
  staffServices,
  tenants,
} from '@spa/db'
import { testUrls } from '@spa/db/testing'
import { createBooking } from '@spa/services'
import { eq } from 'drizzle-orm'

/** URL helpers that work in both routing modes (E2E_ROUTING=path → single host). */
export const PORT = Number(process.env.E2E_PORT ?? 3100)
export const PATH = process.env.E2E_ROUTING === 'path'
export const base = `http://localhost:${PORT}`
export const app = PATH ? `${base}/app` : `http://app.localhost:${PORT}`
export const admin = PATH ? `${base}/admin` : `http://admin.localhost:${PORT}`
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

/** Today's business date in Dubai (05:00 cutoff). */
export const today = () => businessDateOf(new Date(), '05:00')

/**
 * Gives a freshly signed-up spa a small menu, two therapists on shift today + tomorrow (09:00–23:00),
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
        startsAt: dubaiInstant(d, 9 * 60),
        endsAt: dubaiInstant(d, 23 * 60),
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

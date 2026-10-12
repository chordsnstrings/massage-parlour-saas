// R26: the CRM feed of HTML designs (website services + staff, contract facts) and booking requests from a design's form.
import { addDays, dubaiParts } from '@spa/core'
import { branches, closeAllDbs, services, serviceVariants, staff, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  crmFeedFacts,
  DESIGN_ENQUIRY_TENANT_LIMITS,
  designEnquirySchema,
  listSiteEnquiries,
  siteEnquiryReplyText,
  submitSiteEnquiry,
  websiteServices,
  websiteStaff,
  withinRateLimits,
} from '../src'

const { platform, app } = testDbs()
let tenantId = ''
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(tenantId, fn, app)

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'crm-feed', name: 'Feed Spa' }).returning()
  tenantId = t!.id
  await tx(async (db) => {
    await db.insert(branches).values([
      { tenantId, name: 'Main', isDefault: true, phone: '02 557 6533', whatsappE164: '971525108633' },
      { tenantId, name: 'Closed', active: false, phone: '04 111 2222' },
    ])
    const rows = await db
      .insert(services)
      .values([
        { tenantId, name: { en: 'Normal massage' }, imageUrl: '/files/x/a.webp', sort: 1 },
        { tenantId, name: { en: 'Hidden' }, showPrice: false, sort: 2 },
        { tenantId, name: { en: 'Not online' }, onlineBookable: false },
        { tenantId, name: { en: 'Inactive' }, active: false },
        { tenantId, name: { en: 'No variants' } },
      ])
      .returning({ id: services.id, name: services.name })
    const id = (n: string) => rows.find((r) => r.name.en === n)!.id
    await db.insert(serviceVariants).values([
      { tenantId, serviceId: id('Normal massage'), durationMin: 90, priceAed: '350' },
      { tenantId, serviceId: id('Normal massage'), durationMin: 60, priceAed: '250' },
      { tenantId, serviceId: id('Normal massage'), durationMin: 30, priceAed: '99', active: false },
      { tenantId, serviceId: id('Hidden'), durationMin: 45, priceAed: '200' },
      { tenantId, serviceId: id('Not online'), durationMin: 60, priceAed: '100' },
      { tenantId, serviceId: id('Inactive'), durationMin: 60, priceAed: '100' },
    ])
    await db.insert(staff).values([
      { tenantId, displayName: 'Maya', showOnSite: true, bio: { en: 'Thai massage' }, sort: 2 },
      { tenantId, displayName: 'Ana', showOnSite: true, sort: 1 },
      { tenantId, displayName: 'Hidden person' },
      { tenantId, displayName: 'Gone', showOnSite: true, active: false },
    ])
  })
})
afterAll(closeAllDbs)

describe('CRM feed facts', () => {
  it('website services follow the "On the website" rule; prices public-filtered', async () => {
    const list = await tx((db) => websiteServices(db, tenantId))
    expect(list.map((s) => s.name.en)).toEqual(['Normal massage', 'Hidden'])
    expect(list[0]).toMatchObject({ imageUrl: '/files/x/a.webp' })
    expect(list[0]!.variants.map((v) => v.durationMin).sort()).toEqual([60, 90])
    expect(list[1]!.variants[0]!.priceAed).toBeNull()
    await platform
      .update(tenants)
      .set({ settings: { hidePrices: true } })
      .where(eq(tenants.id, tenantId))
    const hidden = await tx((db) => websiteServices(db, tenantId))
    expect(hidden[0]!.variants.every((v) => v.priceAed === null)).toBe(true)
    await platform.update(tenants).set({ settings: {} }).where(eq(tenants.id, tenantId))
  })

  it('website staff = active + Show on website, by sort; facts list active branches', async () => {
    expect((await tx((db) => websiteStaff(db))).map((s) => s.name)).toEqual(['Ana', 'Maya'])
    const facts = await tx((db) => crmFeedFacts(db, tenantId))
    expect(facts).toMatchObject({ name: 'Feed Spa', status: 'trial', logoFileId: null })
    expect(facts.branches.map((b) => b.name)).toEqual(['Main'])
    expect(facts.staff).toHaveLength(2)
    expect(JSON.stringify(facts)).not.toContain('phone_e164')
  })
})

describe('booking requests from a design form', () => {
  const today = dubaiParts(new Date()).date
  const body = (over: Record<string, unknown> = {}) => ({
    spa: 'Feed Spa',
    service_id: 'normal-massage',
    service_name: 'Normal massage',
    duration_minutes: 60,
    guests: 2,
    date: addDays(today, 3),
    time: '18:30',
    staff_id: null,
    name: ' Layla ',
    phone: '050 123 4567',
    notes: 'Strong pressure',
    source: 'website',
    submitted_at: new Date().toISOString(),
    extra: 'dropped',
    ...over,
  })

  it('validates the documented body', () => {
    const ok = designEnquirySchema.parse(body())
    expect(ok).toEqual({
      name: 'Layla',
      phone: '+971501234567',
      service_id: 'normal-massage',
      service_name: 'Normal massage',
      duration_minutes: 60,
      guests: 2,
      date: addDays(today, 3),
      time: '18:30',
      staff_id: null,
      notes: 'Strong pressure',
    })
    expect(designEnquirySchema.parse(body({ guests: undefined, notes: undefined })).guests).toBe(1)
    const codes = (o: Record<string, unknown>) => {
      const r = designEnquirySchema.safeParse(body(o))
      return r.success ? [] : r.error.issues.map((i) => i.message)
    }
    expect(codes({ phone: '123' })).toContain('phone')
    expect(codes({ date: '2026-02-30' })).toContain('date')
    expect(codes({ date: addDays(today, 200) })).toContain('date')
    expect(codes({ date: addDays(today, -3) })).toContain('date')
    expect(codes({ time: '25:00' })).toContain('time')
    expect(codes({ guests: 11 })).toContain('guests')
    expect(codes({ duration_minutes: 2 })).toContain('duration')
    expect(codes({ service_id: '', service_name: '' })).toContain('required:service')
    expect(codes({ name: 'x'.repeat(81) })).toContain('long:name')
    expect(codes({ notes: 'x'.repeat(1001) })).toContain('long:notes')
  })

  it('stores the booking with the enquiry, searchable by service; reply text names it', async () => {
    const booking = {
      service: 'Normal massage',
      serviceId: null,
      durationMin: 60,
      date: addDays(today, 3),
      time: '18:30',
      guests: 2,
      staff: 'Maya',
      staffId: null,
    }
    const row = await tx((db) =>
      submitSiteEnquiry(
        db,
        tenantId,
        { name: 'Layla', phone: '+971501234567', message: '', locale: 'en', page: '', booking },
        { ipHash: null },
      ),
    )
    expect(row.booking).toEqual(booking)
    expect((await tx((db) => listSiteEnquiries(db, { q: 'normal mass' }))).rows).toHaveLength(1)
    expect(siteEnquiryReplyText(row, 'Feed Spa')).toBe(
      `Hi Layla, thank you for your booking request at Feed Spa for Normal massage on ${booking.date} at 18:30. `,
    )
  })

  it('per-spa limit: 30 an hour', async () => {
    const hit = () =>
      withinRateLimits(platform, 'site-enquiry-tenant', tenantId, DESIGN_ENQUIRY_TENANT_LIMITS)
    for (let i = 0; i < 30; i++) expect(await hit()).toBe(true)
    expect(await hit()).toBe(false)
  })
})

// R26: the CRM feed of HTML designs (website services + staff, contract facts) and booking requests from a design's form.
import { addDays, dubaiInstant, dubaiParts } from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  closeAllDbs,
  type SiteEnquiryBooking,
  services,
  serviceVariants,
  sitePages,
  staff,
  type Tx,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  crmFeedFacts,
  DESIGN_ENQUIRY_TENANT_LIMITS,
  designEnquirySchema,
  enquiryNight,
  ensureSite,
  getSiteEnquiry,
  linkSiteEnquiryBooking,
  listSiteEnquiries,
  liveHtmlDesignVersionIds,
  lockSiteEnquiryForBooking,
  pageVersionsData,
  publishPage,
  siteEnquiryBookings,
  siteEnquiryReplyText,
  submitSiteEnquiry,
  websiteHours,
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
    expect(facts.branches[0]).toHaveProperty('areaLabel', null)
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
    // Typed in Arabic-Indic / Persian digits (QA M3): accepted and stored as ASCII E.164.
    expect(designEnquirySchema.parse(body({ phone: '٠٥٠ ١٢٣ ٤٥٦٧' })).phone).toBe('+971501234567')
    expect(designEnquirySchema.parse(body({ phone: '+۹۷۱ ۵۰ ۱۲۳ ۴۵۶۷' })).phone).toBe('+971501234567')
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
    // The typed service (no CRM id) never goes into the spa's WhatsApp message; a CRM-resolved one does.
    expect(siteEnquiryReplyText(row, 'Feed Spa')).toBe(
      `Hi Layla, thank you for your booking request at Feed Spa on ${booking.date} at 18:30. `,
    )
    const named = { ...booking, serviceId: '00000000-0000-4000-8000-000000000001' }
    expect(siteEnquiryReplyText({ ...row, booking: named }, 'Feed Spa')).toBe(
      `Hi Layla, thank you for your booking request at Feed Spa for Normal massage on ${booking.date} at 18:30. `,
    )
    expect(siteEnquiryReplyText({ ...row, booking: named, locale: 'ar' }, 'Feed Spa')).toContain(
      'لـ Normal massage',
    )
  })

  it('reply text: free text that is not a name or a CRM service stays out', () => {
    const lure = {
      service: 'massage. URGENT: confirm at https://evil.example',
      serviceId: null,
      durationMin: null,
      date: '2026-11-01',
      time: '10:00',
      guests: 1,
      staff: null,
      staffId: null,
    }
    const text = siteEnquiryReplyText(
      { name: 'https://evil.example now', locale: 'en', booking: lure },
      'Feed Spa',
    )
    expect(text).toBe('Hi, thank you for your booking request at Feed Spa on 2026-11-01 at 10:00. ')
    expect(
      siteEnquiryReplyText({ name: 'ليلى أحمد', locale: 'ar', booking: lure }, 'Feed Spa'),
    ).not.toContain('evil')
    expect(siteEnquiryReplyText({ name: "O'Neil-Smith", locale: 'en' }, 'Feed Spa')).toBe(
      "Hi O'Neil-Smith, thank you for your message to Feed Spa. ",
    )
  })

  it('live HTML design versions: only published, visible pages with an HtmlDesign block', async () => {
    expect(await tx((db) => liveHtmlDesignVersionIds(db, tenantId))).toEqual([])
    const design = {
      root: { props: { htmlDesign: true } },
      content: [{ type: 'HtmlDesign', props: { id: 'h', html: '<p>x</p>', phoneFixes: false } }],
    }
    await tx((db) =>
      ensureSite(db, tenantId, {
        key: 'zen',
        name: 'Zen',
        theme: { accent: '#111111' },
        pages: [
          { slug: '', title: { en: 'Home' }, data: { root: { props: {} }, content: [] } },
          { slug: 'design', title: { en: 'Design' }, data: design },
          { slug: 'hidden', title: { en: 'Hidden' }, data: design },
        ],
      }),
    )
    const pages = await tx((db) => db.select().from(sitePages))
    const page = (slug: string) => pages.find((p) => p.slug === slug)!.id
    // Drafts only: nothing live yet.
    expect(await tx((db) => liveHtmlDesignVersionIds(db, tenantId))).toEqual([])
    for (const slug of ['', 'design', 'hidden'])
      await tx((db) => publishPage(db, { tenantId, pageId: page(slug) }))
    await tx((db) => db.update(sitePages).set({ visible: false }).where(eq(sitePages.slug, 'hidden')))
    const ids = await tx((db) => liveHtmlDesignVersionIds(db, tenantId))
    expect(ids).toHaveLength(1)
    const [v] = await tx((db) => pageVersionsData(db, ids))
    expect(v?.data).toMatchObject({ content: [{ type: 'HtmlDesign' }] })
    // A new publish of the design page = a new live version id (the cache key moves on).
    await tx((db) => publishPage(db, { tenantId, pageId: page('design') }))
    const next = await tx((db) => liveHtmlDesignVersionIds(db, tenantId))
    expect(next).toHaveLength(1)
    expect(next[0]).not.toBe(ids[0])
  })

  it('per-spa limit: 30 an hour', async () => {
    const hit = () =>
      withinRateLimits(platform, 'site-enquiry-tenant', tenantId, DESIGN_ENQUIRY_TENANT_LIMITS)
    for (let i = 0; i < 30; i++) expect(await hit()).toBe(true)
    expect(await hit()).toBe(false)
  })
})

// Owner 2026-10-13: Inbox → Enquiries "Make booking" links the booking to the request; small-hours requests are dated.
describe('booking a booking request', () => {
  let otherId = ''
  const other = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(otherId, fn, app)
  // Fri 2026-10-16 night, 00:30 → Sat 2026-10-17 (Be Relax: 11:00–02:00).
  const late = { fri: [{ open: '11:00', close: '02:00' }] }
  const request = {
    service: 'Normal massage',
    serviceId: '00000000-0000-4000-8000-000000000001',
    durationMin: 60,
    date: '2026-10-16',
    time: '00:30',
    guests: 1,
    staff: null,
    staffId: null,
  }
  const enquiry = (db: Tx, tenant: string, booking: SiteEnquiryBooking | null) =>
    submitSiteEnquiry(
      db,
      tenant,
      { name: 'Layla', phone: '+971501234567', message: 'Strong pressure', locale: 'en', page: '', booking },
      { ipHash: null },
    )
  const booking = async (db: Tx, tenant: string, ref: string) => {
    const [branch] = await db.select().from(branches).limit(1)
    const [variant] = await db.select().from(serviceVariants).limit(1)
    const startsAt = dubaiInstant('2026-10-17', 30)
    const [b] = await db
      .insert(bookings)
      .values({
        tenantId: tenant,
        branchId: branch!.id,
        refCode: ref,
        source: 'online',
        status: 'confirmed',
        businessDate: '2026-10-16',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3600_000),
      })
      .returning()
    await db.insert(bookingItems).values({
      tenantId: tenant,
      bookingId: b!.id,
      serviceVariantId: variant?.id ?? null,
      serviceName: 'Normal massage',
      durationMin: 60,
      startsAt,
      endsAt: b!.endsAt,
    })
    return b!
  }

  beforeAll(async () => {
    const [t] = await platform.insert(tenants).values({ slug: 'crm-feed-2', name: 'Other Spa' }).returning()
    otherId = t!.id
    await other((db) => db.insert(branches).values({ tenantId: otherId, name: 'Other', isDefault: true }))
  })

  it('the main branch hours date small-hours requests; stored flags win', async () => {
    await tx((db) => db.update(branches).set({ openingHours: late }).where(eq(branches.name, 'Main')))
    expect(await tx((db) => websiteHours(db))).toEqual({ openingHours: late, cutoff: '05:00' })
    const unset = await other((db) => websiteHours(db))
    expect(unset).toEqual({ openingHours: {}, cutoff: '05:00' })
    expect(enquiryNight(request, { openingHours: late })).toEqual({
      afterMidnight: true,
      calendarDate: '2026-10-17',
    })
    expect(enquiryNight(request, null)).toEqual({ afterMidnight: false, calendarDate: '2026-10-16' })
    // Hours not set up (the design shows its own): the branch cutoff dates the small hours.
    expect(enquiryNight(request, unset)).toEqual({ afterMidnight: true, calendarDate: '2026-10-17' })
    expect(enquiryNight({ ...request, time: '19:00' }, unset).afterMidnight).toBe(false)
    const stored = { ...request, afterMidnight: false, calendarDate: '2026-10-16' }
    expect(enquiryNight(stored, { openingHours: late }).afterMidnight).toBe(false)
  })

  it('locks and links only this spa’s booking requests; one live booking each', async () => {
    const mine = await tx((db) => enquiry(db, tenantId, request))
    const plain = await tx((db) => enquiry(db, tenantId, null))
    const theirs = await other((db) => enquiry(db, otherId, request))
    const b = await tx((db) => booking(db, tenantId, 'R30A'))
    const theirBooking = await other((db) => booking(db, otherId, 'R30B'))

    expect((await tx((db) => lockSiteEnquiryForBooking(db, mine.id))).booking).toEqual(request)
    const notRequest = { message: 'Booking request not found', code: 'not_found' }
    await expect(tx((db) => lockSiteEnquiryForBooking(db, plain.id))).rejects.toMatchObject(notRequest)
    // Another spa's request reads as not found (RLS), and so does another spa's booking.
    await expect(tx((db) => lockSiteEnquiryForBooking(db, theirs.id))).rejects.toMatchObject(notRequest)
    await expect(tx((db) => linkSiteEnquiryBooking(db, theirs.id, b.id, null))).rejects.toMatchObject(
      notRequest,
    )
    await expect(tx((db) => linkSiteEnquiryBooking(db, mine.id, theirBooking.id, null))).rejects.toThrow(
      'Booking not found',
    )
    await expect(tx((db) => linkSiteEnquiryBooking(db, plain.id, b.id, null))).rejects.toMatchObject(
      notRequest,
    )

    const linked = await tx((db) => linkSiteEnquiryBooking(db, mine.id, b.id, null))
    expect(linked.booking).toMatchObject({ ...request, bookingId: b.id, bookedBy: null })
    expect(Date.parse(linked.booking!.bookedAt!)).not.toBeNaN()
    await expect(tx((db) => lockSiteEnquiryForBooking(db, mine.id))).rejects.toThrow(
      'Booking request already booked',
    )
    expect((await other((db) => getSiteEnquiry(db, theirs.id)))!.booking).toEqual(request)

    // The inbox's view of it: Dubai date + time, the night (business date); never from another spa.
    const made = await tx((db) => siteEnquiryBookings(db, [linked, plain]))
    expect(made.get(b.id)).toMatchObject({
      status: 'confirmed',
      businessDate: '2026-10-16',
      date: '2026-10-17',
      time: '00:30',
      service: { en: 'Normal massage' },
    })
    expect((await other((db) => siteEnquiryBookings(db, [linked]))).size).toBe(0)

    // Cancelled → the request can be booked again.
    await tx((db) => db.update(bookings).set({ status: 'cancelled' }).where(eq(bookings.id, b.id)))
    expect((await tx((db) => lockSiteEnquiryForBooking(db, mine.id))).id).toBe(mine.id)
  })

  it('reply texts: the night in both, the booked service in the confirmation; never the typed text', () => {
    const e = { name: 'Layla', locale: 'en', booking: request }
    const night = 'on the night of 2026-10-16 at 00:30 (after midnight, 2026-10-17)'
    expect(siteEnquiryReplyText(e, 'Feed Spa', { hours: { openingHours: late } })).toBe(
      `Hi Layla, thank you for your booking request at Feed Spa for Normal massage ${night}. `,
    )
    // Stored since 2026-10-13: the flag, whatever the hours are now.
    const stored = { ...request, afterMidnight: true, calendarDate: '2026-10-17' }
    expect(siteEnquiryReplyText({ ...e, booking: stored }, 'Feed Spa')).toContain(night)
    expect(siteEnquiryReplyText(e, 'Feed Spa')).toContain('on 2026-10-16 at 00:30. ')
    const booked = {
      id: '00000000-0000-4000-8000-000000000002',
      status: 'confirmed' as const,
      branchId: '00000000-0000-4000-8000-000000000003',
      businessDate: '2026-10-16',
      date: '2026-10-17',
      time: '00:30',
      service: { en: 'Swedish massage', ar: 'مساج سويدي' },
    }
    expect(siteEnquiryReplyText(e, 'Feed Spa', { booked })).toBe(
      `Hi Layla, your booking at Feed Spa is confirmed for Swedish massage ${night}. `,
    )
    const evening = { ...booked, businessDate: '2026-10-17', time: '19:00' }
    expect(
      siteEnquiryReplyText({ ...e, name: 'https://evil.example' }, 'Feed Spa', { booked: evening }),
    ).toBe('Hi, your booking at Feed Spa is confirmed for Swedish massage on 2026-10-17 at 19:00. ')
    const ar = siteEnquiryReplyText({ ...e, locale: 'ar' }, 'Feed Spa', { booked })
    expect(ar).toContain('تم تأكيد حجزك في Feed Spa لـ مساج سويدي')
    expect(ar).toContain('ليلة 2026-10-16 الساعة 00:30 (بعد منتصف الليل، 2026-10-17)')
    expect(
      siteEnquiryReplyText({ ...e, locale: 'ar' }, 'Feed Spa', { hours: { openingHours: late } }),
    ).toContain('ليلة 2026-10-16')
    // A plain message never turns into a confirmation.
    expect(siteEnquiryReplyText({ name: 'Layla', locale: 'en' }, 'Feed Spa', { booked })).toBe(
      'Hi Layla, thank you for your message to Feed Spa. ',
    )
  })
})

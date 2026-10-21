// R36 dashboard home: "Today's bookings & sales" (todayOrders), "From the website" (websiteInbox) and the poll
// fingerprint (dashboardPulse), through the real booking → Finish → sale flow on the 13-10-26 sheet fixture.
import { dubaiInstant } from '@spa/core'
import { bookingItems, bookings, branches, closeAllDbs, siteEnquiries, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createBooking,
  createSale,
  dashboardPulse,
  daySheet,
  finishBooking,
  kpis,
  linkSiteEnquiryBooking,
  refundSale,
  setBookingStatus,
  setSiteEnquiryStatus,
  submitSiteEnquiry,
  todayOrders,
  todayStage,
  voidSale,
  websiteInbox,
} from '../src'
import { SHEET_TOTALS, seedDaySheetDay } from './fixtures/day-sheet-13-10-26'

const { platform, app } = testDbs()
const D = '2026-10-13'
const E = '2026-10-11'
const F = '2026-10-12'
const NOW = dubaiInstant(D, 23 * 60 + 30)
const ids = {} as Record<string, string>
let fx: Awaited<ReturnType<typeof seedDaySheetDay>>
const run = <T>(fn: (tx: Parameters<Parameters<typeof withTenant<T>>[1]>[0]) => Promise<T>) =>
  withTenant(ids.tenant!, fn, app)

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'berelax', name: 'BE RELAX Spa' }).returning()
  ids.tenant = t!.id
  await run(async (tx) => {
    const [b] = await tx
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Main', isDefault: true })
      .returning()
    ids.branch = b!.id
    const [b2] = await tx.insert(branches).values({ tenantId: ids.tenant!, name: 'Marina' }).returning()
    ids.branch2 = b2!.id
  })
  fx = await seedDaySheetDay(run, {
    tenantId: ids.tenant!,
    branchId: ids.branch!,
    date: D,
    now: NOW,
    expense: true,
    tips: true,
  })
})
afterAll(closeAllDbs)

type Status = 'confirmed' | 'pending'
/** A one-treatment (60 min, fee 100) booking on `date` at `hm` (Dubai) for a fixture therapist in room 8. */
async function bookOn(
  date: string,
  hm: string,
  therapist: string,
  o: { status?: Status; source?: 'walk_in' | 'online'; client?: boolean } = {},
) {
  return run((tx) =>
    createBooking(tx, {
      tenantId: ids.tenant!,
      branchId: ids.branch!,
      clientId: o.client === false ? null : fx.client,
      source: o.source ?? 'walk_in',
      status: o.status ?? 'confirmed',
      allowOffShift: true,
      items: [
        {
          serviceVariantId: fx.variant.get(60)!,
          start: dubaiInstant(date, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))),
          staffIds: [fx.staff.get(therapist)!],
          roomId: fx.room.get('8')!,
          feeAed: 100,
          commissionAed: 30,
        },
      ],
    }),
  )
}
const finish = (bookingId: string, now: Date, method: 'cash' | 'card_terminal' | 'bank_transfer' = 'cash') =>
  run(async (tx) => {
    const [item] = await tx.select().from(bookingItems).where(eq(bookingItems.bookingId, bookingId))
    return finishBooking(tx, {
      tenantId: ids.tenant!,
      branchId: ids.branch!,
      bookingId,
      lines: [
        {
          kind: 'service',
          refId: item!.serviceVariantId,
          description: 'Thai massage 60 min',
          qty: 1,
          unitPriceAed: 100,
          staffId: item!.staffIds[0],
        },
      ],
      payments: [{ method, amountAed: 100 }],
      now,
    })
  })
const orders = (date: string, branchIds: string[] | null = null, money = true) =>
  run((tx) => todayOrders(tx, { branchIds, date, now: NOW, money }))
const revenue = (date: string, branchId?: string) =>
  run(async (tx) => (await kpis(tx, { from: date, to: date, branchId })).revenue)

describe('R36 todayOrders — a full paid day (13-10-26 sheet)', () => {
  it('lists every booking as paid here; Paid = the Revenue KPI, split like the day sheet', async () => {
    const day = await orders(D)
    expect(day.rows).toHaveLength(13)
    for (const r of day.rows)
      expect(r).toMatchObject({ kind: 'booking', stage: 'paid', sale: { paidOn: 'here', status: 'paid' } })
    expect(day.rows.map((r) => r.startsAt.getTime())).toEqual(
      [...day.rows].map((r) => r.startsAt.getTime()).sort((a, b) => a - b),
    )
    expect(day.counts).toEqual({ all: 13, to_confirm: 0, to_finish: 0, not_paid: 0, paid: 13, cancelled: 0 })
    expect(day.totals.paid.aed).toBe(await revenue(D))
    expect(day.totals.paid).toMatchObject({ cash: SHEET_TOTALS.cash, card: SHEET_TOTALS.card, other: 0 })
    const sheet = await run((tx) => daySheet(tx, ids.branch!, D))
    expect(day.totals.paid.cash + day.totals.paid.card + day.totals.paid.other).toBe(
      sheet.totals.cashAed + sheet.totals.cardAed + sheet.totals.otherAed,
    )
    expect(day.totals.booked.count).toBe(13)
    expect(day.totals.notPaid).toEqual({ aed: 0, count: 0 })
    expect(day.totals.toFinish).toEqual({ aed: 0, count: 0 })
    // Row details: first name, items with minutes, therapist names, fee = sum of the items' fees.
    const first = day.rows[0]!
    expect(first.services[0]).toMatchObject({ minutes: expect.any(Number) })
    expect(first.staff.length).toBeGreaterThan(0)
    expect(first.feeAed).toBe(first.sale!.totalAed)
  })
})

describe('R36 todayOrders — stages, sale rows, other days, branches', () => {
  const b = {} as Record<string, string>
  const sale = {} as Record<string, string>
  beforeAll(async () => {
    const evening = dubaiInstant(E, 23 * 60)
    b.pending = (await bookOn(E, '10:00', 'Linda', { status: 'pending', source: 'online' })).id
    b.confirmed = (await bookOn(E, '11:00', 'Linda', { client: false })).id
    b.completed = (await bookOn(E, '12:00', 'Linda')).id
    await run((tx) => setBookingStatus(tx, b.completed!, 'completed'))
    b.cancelled = (await bookOn(E, '13:00', 'Linda')).id
    await run((tx) => setBookingStatus(tx, b.cancelled!, 'cancelled', 'Cancelled by client'))
    b.noShow = (await bookOn(E, '14:00', 'Linda')).id
    await run((tx) => setBookingStatus(tx, b.noShow!, 'no_show'))
    b.paid = (await bookOn(E, '15:00', 'Linda')).id
    sale.paid = (await finish(b.paid, evening, 'card_terminal')).sale.id
    b.refunded = (await bookOn(E, '16:00', 'Linda')).id
    const r = await finish(b.refunded, evening)
    sale.refunded = r.sale.id
    await run((tx) =>
      refundSale(tx, {
        saleId: r.sale.id,
        lines: [{ saleLineId: r.lines[0]!.id, qty: 1 }],
        method: 'cash',
        reason: 'Client unhappy',
        now: evening,
      }),
    )
    b.voided = (await bookOn(E, '17:00', 'Linda')).id
    const v = await finish(b.voided, evening)
    await run((tx) => voidSale(tx, { saleId: v.sale.id, reason: 'Wrong client' }))
    // A retail sale with no booking, and a booking of the 12th paid on the 11th (its day had not started).
    sale.retail = (
      await run((tx) =>
        createSale(tx, {
          tenantId: ids.tenant!,
          branchId: ids.branch!,
          lines: [{ kind: 'other', description: 'Massage oil', qty: 1, unitPriceAed: 45 }],
          payments: [{ method: 'bank_transfer', amountAed: 45 }],
          now: dubaiInstant(E, 23 * 60 + 5),
        }),
      )
    ).sale.id
    b.early = (await bookOn(F, '13:00', 'Miney')).id
    sale.early = (await finish(b.early, dubaiInstant(E, 23 * 60 + 10))).sale.id
    // Marina: a booking (written directly, no reservation needed for reading) and a cash sale on the 11th.
    await run(async (tx) => {
      const start = dubaiInstant(E, 18 * 60)
      const end = dubaiInstant(E, 19 * 60)
      const [mb] = await tx
        .insert(bookings)
        .values({
          tenantId: ids.tenant!,
          branchId: ids.branch2!,
          refCode: 'MAR-1',
          source: 'phone',
          status: 'confirmed',
          businessDate: E,
          startsAt: start,
          endsAt: end,
        })
        .returning()
      b.marina = mb!.id
      await tx.insert(bookingItems).values({
        tenantId: ids.tenant!,
        bookingId: mb!.id,
        serviceName: 'Foot massage',
        durationMin: 60,
        priceAed: '80',
        startsAt: start,
        endsAt: end,
      })
    })
    sale.marina = (
      await run((tx) =>
        createSale(tx, {
          tenantId: ids.tenant!,
          branchId: ids.branch2!,
          lines: [{ kind: 'other', description: 'Gift box', qty: 1, unitPriceAed: 60 }],
          payments: [{ method: 'cash', amountAed: 60 }],
          now: dubaiInstant(E, 20 * 60),
        }),
      )
    ).sale.id
  })

  const rowOf = (day: Awaited<ReturnType<typeof orders>>, key: string) => day.rows.find((r) => r.key === key)!

  it('derives each stage from the booking status and its live sale', async () => {
    const day = await orders(E, [ids.branch!])
    const stage = (id: string) => rowOf(day, `b:${id}`).stage
    expect(stage(b.pending!)).toBe('to_confirm')
    expect(stage(b.confirmed!)).toBe('to_finish')
    expect(stage(b.completed!)).toBe('not_paid')
    expect(stage(b.cancelled!)).toBe('cancelled')
    expect(stage(b.noShow!)).toBe('cancelled')
    expect(stage(b.paid!)).toBe('paid')
    // Refunded: settled (paid stage, sale marked refunded), but out of the Paid total like the Revenue KPI.
    expect(rowOf(day, `b:${b.refunded}`)).toMatchObject({ stage: 'paid', sale: { status: 'refunded' } })
    // Voided sale: the booking is back to having no sale.
    const voided = rowOf(day, `b:${b.voided}`)
    expect(voided.sale).toBeNull()
    expect(voided.stage).toBe(todayStage(voided.status, null))
    expect(rowOf(day, `b:${b.pending}`)).toMatchObject({
      source: 'online',
      clientFirstName: expect.any(String),
    })
    expect(rowOf(day, `b:${b.confirmed}`).clientFirstName).toBeNull()
    expect(rowOf(day, `b:${b.cancelled}`).cancelReason).toBe('Cancelled by client')
    expect(rowOf(day, `b:${b.paid}`).sale).toMatchObject({
      id: sale.paid,
      paidOn: 'here',
      totalAed: 100,
      methods: { cash: 0, card: 100, other: 0 },
    })
  })

  it('adds sale rows for a shop sale and another day’s booking; Paid = the Revenue KPI (branch too)', async () => {
    const day = await orders(E, [ids.branch!])
    expect(rowOf(day, `s:${sale.retail}`)).toMatchObject({
      kind: 'sale',
      bookingId: null,
      stage: 'paid',
      feeAed: 45,
      services: [{ name: 'Massage oil', minutes: null }],
      sale: { paidOn: 'here', methods: { cash: 0, card: 0, other: 45 } },
    })
    expect(rowOf(day, `s:${sale.early}`)).toMatchObject({
      kind: 'sale',
      bookingId: b.early,
      bookingDate: F,
      refCode: expect.any(String),
      stage: 'paid',
      staff: ['Miney'],
      sale: { paidOn: 'here', methods: { cash: 100 } },
    })
    expect(day.rows.some((r) => r.key === `b:${b.early}`)).toBe(false)
    // card 100 (paid) + oil 45 + early 100; the refunded and voided sales stay out.
    expect(day.totals.paid).toEqual({ aed: 245, cash: 100, card: 100, other: 45 })
    expect(day.totals.paid.aed).toBe(await revenue(E, ids.branch!))
    // Booked = not cancelled / no-show bookings of the day (pending, confirmed, completed, paid, refunded, voided).
    expect(day.totals.booked).toEqual({ aed: 600, count: 6 })
    expect(day.totals.toFinish).toEqual({ aed: 200, count: 2 })
    const notPaid = day.rows.filter((r) => r.stage === 'not_paid')
    expect(day.totals.notPaid).toEqual({ aed: notPaid.length * 100, count: notPaid.length })
    expect(day.counts).toMatchObject({
      all: day.rows.length,
      to_confirm: 1,
      cancelled: 2,
      paid: 4,
    })
    expect(Object.values(day.counts).reduce((s, n) => s + n, 0)).toBe(day.rows.length * 2)
  })

  it('shows the other day’s booking on its own date as paid on another day, not in that day’s Paid', async () => {
    const day = await orders(F, [ids.branch!])
    expect(day.rows).toHaveLength(1)
    expect(day.rows[0]).toMatchObject({
      key: `b:${b.early}`,
      stage: 'paid',
      sale: { id: sale.early, paidOn: 'other_day', businessDate: E },
    })
    expect(day.totals.paid.aed).toBe(0)
    expect(day.totals.paid.aed).toBe(await revenue(F, ids.branch!))
  })

  it('filters branches like the KPI: null = whole spa, [] = nothing', async () => {
    const all = await orders(E, null)
    expect(all.rows.some((r) => r.key === `b:${b.marina}`)).toBe(true)
    expect(all.rows.some((r) => r.key === `s:${sale.marina}`)).toBe(true)
    expect(all.totals.paid.aed).toBe(await revenue(E))
    expect(all.totals.paid.aed).toBe(305)
    const marina = await orders(E, [ids.branch2!])
    expect(marina.rows.map((r) => r.key).sort()).toEqual([`b:${b.marina}`, `s:${sale.marina}`].sort())
    expect(marina.rows.find((r) => r.kind === 'booking')).toMatchObject({
      feeAed: 80,
      services: [{ name: 'Foot massage', minutes: 60 }],
    })
    expect(marina.totals.paid.aed).toBe(await revenue(E, ids.branch2!))
    const main = await orders(E, [ids.branch!])
    expect(main.rows.some((r) => r.branchId === ids.branch2)).toBe(false)
    const none = await orders(E, [])
    expect(none.rows).toEqual([])
    expect(none.totals.paid.aed).toBe(0)
  })

  it('money: false leaves out sale rows, fees, sales and money totals (counts stay)', async () => {
    const day = await orders(E, [ids.branch!], false)
    expect(day.rows.every((r) => r.kind === 'booking' && r.sale === null && r.feeAed === 0)).toBe(true)
    expect(day.rows.every((r) => r.saleId === null)).toBe(true)
    expect(day.totals.paid).toEqual({ aed: 0, cash: 0, card: 0, other: 0 })
    expect(day.totals.booked).toEqual({ aed: 0, count: 6 })
    expect(day.counts).toMatchObject({ all: 8, paid: 2, to_confirm: 1 })
  })

  it('pulse changes with bookings, fees, sales and enquiries, and only then', async () => {
    const pulse = () => run((tx) => dashboardPulse(tx, { branchIds: [ids.branch!], date: E }))
    const p0 = await pulse()
    expect(p0).toMatch(/^[0-9a-f]{32}$/)
    expect(await pulse()).toBe(p0)
    // Another branch's booking day stays out.
    const marinaOnly = await run((tx) => dashboardPulse(tx, { branchIds: [ids.branch2!], date: E }))
    expect(marinaOnly).not.toBe(p0)
    await run((tx) => setBookingStatus(tx, b.pending!, 'confirmed'))
    const p1 = await pulse()
    expect(p1).not.toBe(p0)
    await run((tx) =>
      tx.update(bookingItems).set({ priceAed: '120' }).where(eq(bookingItems.bookingId, b.confirmed!)),
    )
    const p2 = await pulse()
    expect(p2).not.toBe(p1)
    await run((tx) => voidSale(tx, { saleId: sale.paid!, reason: 'Wrong method' }))
    const p3 = await pulse()
    expect(p3).not.toBe(p2)
    await run((tx) =>
      submitSiteEnquiry(
        tx,
        ids.tenant!,
        { name: 'Pulse Test', phone: '+971501234567', message: 'Hello', locale: 'en', page: '' },
        { ipHash: null },
      ),
    )
    expect(await pulse()).not.toBe(p3)
  })
})

describe('R36 websiteInbox', () => {
  const G = '2026-10-20'
  const online = [] as string[]
  const enquiry = [] as string[]
  beforeAll(async () => {
    // 7 pending online bookings from G on (2 on G, 5 later), plus ones that must stay out.
    const plan: [string, string][] = [
      [G, '15:00'],
      [G, '11:00'],
      ['2026-10-21', '12:00'],
      ['2026-10-22', '12:00'],
      ['2026-10-23', '12:00'],
      ['2026-10-24', '12:00'],
      ['2026-10-25', '12:00'],
    ]
    for (const [date, hm] of plan)
      online.push((await bookOn(date, hm, 'Bella', { status: 'pending', source: 'online' })).id)
    await bookOn('2026-10-19', '12:00', 'Bella', { status: 'pending', source: 'online' }) // yesterday
    await bookOn(G, '17:00', 'Bella', { status: 'pending' }) // not online
    await bookOn(G, '19:00', 'Bella', { source: 'online' }) // confirmed
    // 7 new enquiries (one a booking request, booked) + 1 replied.
    for (let i = 0; i < 8; i++) {
      const e = await run((tx) =>
        submitSiteEnquiry(
          tx,
          ids.tenant!,
          {
            name: `Guest ${i}`,
            phone: '+971501234567',
            message: `Message ${i}`,
            locale: 'en',
            page: '',
            booking:
              i === 6
                ? {
                    service: 'Thai massage',
                    serviceId: null,
                    durationMin: 60,
                    date: G,
                    time: '20:00',
                    guests: 1,
                    staff: null,
                    staffId: null,
                  }
                : null,
          },
          { ipHash: null },
        ),
      )
      enquiry.push(e.id)
      // Distinct created times, newest last.
      await run((tx) =>
        tx
          .update(siteEnquiries)
          .set({ createdAt: new Date(Date.now() + (i + 1) * 60_000) })
          .where(eq(siteEnquiries.id, e.id)),
      )
    }
    await run((tx) => setSiteEnquiryStatus(tx, enquiry[7]!, 'replied', null))
    await run((tx) => linkSiteEnquiryBooking(tx, enquiry[6]!, online[0]!, null))
  })

  it('lists the 5 soonest pending online bookings from today on, with the total', async () => {
    const inbox = await run((tx) => websiteInbox(tx, { branchIds: [ids.branch!], today: G }))
    expect(inbox.pendingOnlineCount).toBe(7)
    expect(inbox.pendingOnline.map((p) => p.bookingId)).toEqual([
      online[1],
      online[0],
      online[2],
      online[3],
      online[4],
    ])
    expect(inbox.pendingOnline[0]).toMatchObject({
      businessDate: G,
      feeAed: 100,
      services: [{ minutes: 60 }],
      staff: ['Bella'],
      bookedAt: expect.any(Date),
    })
    const marina = await run((tx) => websiteInbox(tx, { branchIds: [ids.branch2!], today: G }))
    expect(marina).toMatchObject({ pendingOnline: [], pendingOnlineCount: 0 })
    const two = await run((tx) => websiteInbox(tx, { branchIds: null, today: G, limit: 2 }))
    expect(two.pendingOnline).toHaveLength(2)
    expect(two.pendingOnlineCount).toBe(7)
  })

  it('lists the 5 newest new enquiries with the new count and the booking made from a request', async () => {
    const inbox = await run((tx) => websiteInbox(tx, { branchIds: [ids.branch!], today: G }))
    // 7 new here + the one the pulse test added.
    expect(inbox.enquiriesNewCount).toBe(8)
    expect(inbox.enquiries).toHaveLength(5)
    expect(inbox.enquiries.map((e) => e.id).slice(0, 2)).toEqual([enquiry[6], enquiry[5]])
    expect(inbox.enquiries.every((e) => e.status === 'new')).toBe(true)
    expect(inbox.enquiries[0]!.booked).toMatchObject({ id: online[0], businessDate: G, time: '15:00' })
    expect(inbox.enquiries[1]!.booked).toBeNull()
    expect(inbox.hours).toHaveProperty('cutoff')
    const skip = await run((tx) =>
      websiteInbox(tx, { branchIds: null, today: G, online: false, enquiries: false }),
    )
    expect(skip).toMatchObject({
      pendingOnline: [],
      pendingOnlineCount: 0,
      enquiries: [],
      enquiriesNewCount: 0,
    })
  })
})

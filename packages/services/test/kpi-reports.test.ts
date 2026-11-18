// F31 extra KPIs: rebooking rate, retention cohorts, RevPATH, room utilisation and prepaid liability (with the
// ledger cross-check). Bookings / sales for the first four are seeded directly; liability runs through POS.
import { dubaiInstant } from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  clientMemberships,
  clientPackages,
  clients,
  closeAllDbs,
  giftCards,
  giftCardTxns,
  membershipPlans,
  packageDefinitions,
  packageRedemptions,
  refundLines,
  refunds,
  rooms,
  saleLines,
  sales,
  services,
  serviceVariants,
  shifts,
  staff,
  tenants,
  timeEntries,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createSale,
  expirePackages,
  openMinutes,
  prepaidLiability,
  rebookingRate,
  refundSale,
  retentionCohorts,
  revPath,
  roomUtilisation,
  runMembershipRenewals,
  tenantOperations,
  voidSale,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06' // Tuesday
const D1 = '2026-10-07'
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const allWeek = (open: string, close: string) =>
  Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ open, close }]]))
let ref = 0
let saleNo = 1000 // direct inserts stay clear of the POS counter

type Visit = {
  date: string
  client?: string
  staff?: string[]
  room?: string
  status?: 'completed' | 'confirmed' | 'cancelled' | 'no_show'
  minutes?: number
  start?: number
  branch?: string
}
const visit = (v: Visit) =>
  tx(async (db) => {
    const startsAt = dubaiInstant(v.date, v.start ?? 12 * 60)
    const endsAt = new Date(startsAt.getTime() + (v.minutes ?? 60) * 60_000)
    const [b] = await db
      .insert(bookings)
      .values({
        tenantId: ids.tenant!,
        branchId: v.branch ?? ids.marina!,
        clientId: v.client ?? null,
        refCode: `R${++ref}`,
        source: 'phone',
        status: v.status ?? 'completed',
        businessDate: v.date,
        startsAt,
        endsAt,
      })
      .returning()
    await db.insert(bookingItems).values({
      tenantId: ids.tenant!,
      bookingId: b!.id,
      serviceName: 'Swedish',
      durationMin: v.minutes ?? 60,
      startsAt,
      endsAt,
      roomId: v.room ?? null,
      staffIds: v.staff ?? [],
    })
    return b!
  })

/** A sale with one line (VAT 5 % included), inserted directly. */
const sale = (s: {
  date: string
  total: number
  staffId?: string | null
  kind?: 'service' | 'product'
  status?: 'paid' | 'void' | 'refunded'
  branch?: string
}) =>
  tx(async (db) => {
    const [row] = await db
      .insert(sales)
      .values({
        tenantId: ids.tenant!,
        branchId: s.branch ?? ids.marina!,
        number: ++saleNo,
        businessDate: s.date,
        subtotalAed: String(s.total),
        totalAed: String(s.total),
        status: s.status ?? 'paid',
      })
      .returning()
    const [line] = await db
      .insert(saleLines)
      .values({
        tenantId: ids.tenant!,
        saleId: row!.id,
        kind: s.kind ?? 'service',
        refId: s.kind === 'product' ? null : ids.variant!,
        description: 'Swedish 60',
        unitPriceAed: String(s.total),
        lineTotalAed: String(s.total),
        staffId: s.staffId ?? null,
      })
      .returning()
    return { sale: row!, line: line! }
  })

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'kpi-x', name: 'KPI Extra Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const tenantId = ids.tenant!
    const [marina, jbr] = await db
      .insert(branches)
      .values([
        // Open 10:00–02:00 every day (past midnight) = 960 min a day.
        {
          tenantId,
          name: 'Marina',
          isDefault: true,
          businessDayCutoff: '05:00',
          openingHours: allWeek('10:00', '02:00'),
        },
        // No hours set → default 10:00–24:00 = 840 min a day.
        { tenantId, name: 'JBR', businessDayCutoff: '05:00' },
      ])
      .returning()
    ids.marina = marina!.id
    ids.jbr = jbr!.id
    const rs = await db
      .insert(rooms)
      .values([
        { tenantId, branchId: marina!.id, name: 'Room 1', sort: 1 },
        { tenantId, branchId: marina!.id, name: 'Room 2', sort: 2 },
        { tenantId, branchId: marina!.id, name: 'Old room', sort: 3, active: false },
        { tenantId, branchId: marina!.id, name: 'Closed room', sort: 4, active: false },
        { tenantId, branchId: jbr!.id, name: 'Room A', sort: 1 },
      ])
      .returning()
    ids.room1 = rs[0]!.id
    ids.room2 = rs[1]!.id
    ids.oldRoom = rs[2]!.id
    ids.roomA = rs[4]!.id
    const [s] = await db
      .insert(services)
      .values({ tenantId, name: { en: 'Swedish massage' } })
      .returning()
    ids.service = s!.id
    const [v] = await db
      .insert(serviceVariants)
      .values({ tenantId, serviceId: s!.id, durationMin: 60, priceAed: '315' })
      .returning()
    ids.variant = v!.id
    const people = await db
      .insert(staff)
      .values([
        { tenantId, displayName: 'Maya', sort: 1 },
        { tenantId, displayName: 'Ploy', sort: 2 },
        { tenantId, displayName: 'Lina', sort: 3 },
        { tenantId, displayName: 'Rania (reception)', sort: 4, bookable: false },
      ])
      .returning()
    ids.maya = people[0]!.id
    ids.ploy = people[1]!.id
    ids.lina = people[2]!.id
    ids.rania = people[3]!.id
    const cls = await db
      .insert(clients)
      .values(
        ['Fatima', 'Noor', 'Sara', 'Eman', 'Farah', 'Ghada', 'Hessa', 'Jamila', 'Khalid'].map((name) => ({
          tenantId,
          name,
        })),
      )
      .returning()
    for (const c of cls) ids[c.name] = c.id
    // Hessa's history was imported: first visit in March, before any booking in the system.
    await db
      .update(clients)
      .set({ firstVisitAt: dubaiInstant('2026-03-01', 12 * 60) })
      .where(eq(clients.id, ids.Hessa!))
    // Jamila first came at 02:00 on 1 July → business date 30 June (cutoff 05:00).
    await db
      .update(clients)
      .set({ firstVisitAt: dubaiInstant('2026-07-01', 2 * 60) })
      .where(eq(clients.id, ids.Jamila!))
  })
})
afterAll(closeAllDbs)

describe('rebooking rate', () => {
  beforeAll(async () => {
    // September visits. Fatima rebooks 19 days later; Noor 50 days later; Sara's next booking was cancelled.
    await visit({ date: '2026-09-01', client: ids.Fatima, staff: [ids.maya!] })
    await visit({ date: '2026-09-20', client: ids.Fatima, staff: [ids.ploy!] })
    await visit({ date: '2026-09-05', client: ids.Noor, staff: [ids.maya!] })
    await visit({ date: '2026-10-25', client: ids.Noor, staff: [ids.maya!], status: 'confirmed' })
    await visit({ date: '2026-09-10', client: ids.Sara, staff: [ids.ploy!] })
    await visit({ date: '2026-09-15', client: ids.Sara, staff: [ids.ploy!], status: 'cancelled' })
    await visit({ date: '2026-09-12', staff: [ids.maya!] }) // walk-in without a client: not a visit
    await visit({ date: '2026-09-14', client: ids.Khalid, staff: [ids.maya!], status: 'no_show' })
  })
  const range = { from: '2026-09-01', to: '2026-09-30', today: '2026-10-10' }

  it('30 days: only rebookings dated within the window count; cancelled ones never do', async () => {
    const r = await tx((db) => rebookingRate(db, { ...range, windowDays: 30 }))
    expect(r).toMatchObject({ windowDays: 30, visits: 4, rebooked: 1, rate: 0.25 })
    // Fatima's 20 Sep visit can still be rebooked until 20 Oct; the others' windows closed.
    expect(r.pending).toBe(1)
    expect(r.byTherapist).toEqual([
      expect.objectContaining({ name: 'Maya', visits: 2, rebooked: 1, rate: 0.5 }),
      expect.objectContaining({ name: 'Ploy', visits: 2, rebooked: 0, rate: 0 }),
    ])
  })

  it('60 / 90 days take the later rebooking; unknown windows fall back to 30', async () => {
    const r60 = await tx((db) => rebookingRate(db, { ...range, windowDays: 60 }))
    expect(r60).toMatchObject({ visits: 4, rebooked: 2, rate: 0.5 })
    const odd = await tx((db) => rebookingRate(db, { ...range, windowDays: 45 }))
    expect(odd.windowDays).toBe(30)
  })

  it('branch filter and empty periods', async () => {
    const jbr = await tx((db) => rebookingRate(db, { ...range, branchId: ids.jbr }))
    expect(jbr).toMatchObject({ visits: 0, rebooked: 0, rate: null, byTherapist: [] })
  })
})

describe('retention cohorts', () => {
  beforeAll(async () => {
    // July cohort: Eman returns in Aug (twice) and Oct; Farah in Sep; Ghada never.
    await visit({ date: '2026-07-15', client: ids.Eman })
    await visit({ date: '2026-08-03', client: ids.Eman })
    await visit({ date: '2026-08-20', client: ids.Eman })
    await visit({ date: '2026-10-01', client: ids.Eman })
    await visit({ date: '2026-07-31', client: ids.Farah })
    await visit({ date: '2026-09-02', client: ids.Farah })
    await visit({ date: '2026-07-10', client: ids.Ghada })
    await visit({ date: '2026-08-12', client: ids.Ghada, status: 'cancelled' })
    // Imported first visit (March); first booking in the system in August, at JBR.
    await visit({ date: '2026-08-05', client: ids.Hessa, branch: ids.jbr })
    await visit({ date: '2026-07-20', client: ids.Jamila })
  })
  const month = async (m: string, branchId?: string) =>
    (await tx((db) => retentionCohorts(db, { to: '2026-10-06', today: '2026-10-10', branchId }))).find(
      (c) => c.month === m,
    )

  it('12 monthly cohorts ending with the period month; future months are null', async () => {
    const all = await tx((db) => retentionCohorts(db, { to: '2026-10-06', today: '2026-10-10' }))
    expect(all.map((c) => c.month)).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ])
    expect(await month('2026-07')).toEqual({
      month: '2026-07',
      size: 3,
      returning: [1, 1, 1, null, null, null],
    })
    // September: Fatima, Noor, Sara (no completed visit in October yet).
    expect(await month('2026-09')).toEqual({
      month: '2026-09',
      size: 3,
      returning: [0, null, null, null, null, null],
    })
    expect((await month('2025-11'))?.size).toBe(0)
  })

  it('imported first visits and the overnight cutoff place clients in earlier cohorts', async () => {
    // Hessa: March (imported), returns in August = month 5. Not an August newcomer.
    expect(await month('2026-03')).toEqual({ month: '2026-03', size: 1, returning: [0, 0, 0, 0, 1, 0] })
    expect((await month('2026-08'))?.size).toBe(0)
    // Jamila: 02:00 on 1 July belongs to 30 June, so she is June's cohort and returns in July.
    expect(await month('2026-06')).toEqual({ month: '2026-06', size: 1, returning: [1, 0, 0, 0, null, null] })
  })

  it('a branch uses its own first visits', async () => {
    expect(await month('2026-08', ids.jbr)).toEqual({
      month: '2026-08',
      size: 1,
      returning: [0, 0, null, null, null, null],
    })
    expect((await month('2026-07', ids.jbr))?.size).toBe(0)
  })
})

describe('revenue per available treatment hour', () => {
  beforeAll(async () => {
    await tx(async (db) => {
      const tenantId = ids.tenant!
      const shift = (staffId: string, date: string, start: number, end: number, branchId = ids.marina!) => ({
        tenantId,
        staffId,
        branchId,
        startsAt: dubaiInstant(date, start),
        endsAt: dubaiInstant(date, end),
      })
      await db.insert(shifts).values([
        shift(ids.maya!, D, 10 * 60, 18 * 60), // 8 h
        shift(ids.maya!, '2026-10-05', 22 * 60, 30 * 60), // 22:00–06:00: 1 h falls on D (after the 05:00 cutoff)
        shift(ids.ploy!, D, 20 * 60, 27 * 60), // 20:00–03:00: all 7 h on D
        shift(ids.maya!, D1, 6 * 60, 10 * 60), // 4 h on D+1
        shift(ids.rania!, D, 9 * 60, 17 * 60), // reception: not treatment hours
      ])
      // Lina has no shifts: her clocked hours count instead (6 h on D).
      await db.insert(timeEntries).values({
        tenantId,
        staffId: ids.lina!,
        branchId: ids.marina!,
        clockIn: dubaiInstant(D, 12 * 60),
        clockOut: dubaiInstant(D, 18 * 60),
        businessDate: D,
      })
    })
    await sale({ date: D, total: 315, staffId: ids.maya }) // 300 ex VAT
    await sale({ date: D, total: 315, staffId: ids.ploy }) // rung up at 02:00 → still D
    await sale({ date: D, total: 315, staffId: ids.ploy, status: 'void' })
    await sale({ date: D, total: 120, staffId: ids.maya, kind: 'product' }) // retail: not treatment revenue
    await sale({ date: D, total: 210 }) // no therapist on the line: 200 unassigned
    const { sale: refunded, line } = await sale({
      date: D,
      total: 315,
      staffId: ids.maya,
      status: 'refunded',
    })
    // Refunded the next business day: counts against D+1.
    await tx(async (db) => {
      const [r] = await db
        .insert(refunds)
        .values({
          tenantId: ids.tenant!,
          saleId: refunded.id,
          branchId: ids.marina!,
          amountAed: '315',
          method: 'cash',
          reason: 'Unhappy',
          businessDate: D1,
        })
        .returning()
      await db.insert(refundLines).values({
        tenantId: ids.tenant!,
        refundId: r!.id,
        saleLineId: line.id,
        qty: 1,
        amountAed: '315',
        vatAed: '15',
      })
    })
    // A package session (line priced 0) worth 105 → 100 ex VAT for Lina.
    const { sale: session } = await sale({ date: D, total: 0, staffId: ids.lina })
    await tx(async (db) => {
      const [pkg] = await db
        .insert(clientPackages)
        .values({
          tenantId: ids.tenant!,
          clientId: ids.Khalid!,
          // Fully used by this session, so it never shows in the liability tests below.
          name: 'Seeded',
          pricePaidAed: '105',
          balances: { [ids.service!]: 0 },
          remainingValueAed: '0',
          purchasedAt: dubaiInstant('2026-09-01', 12 * 60),
          expiresAt: dubaiInstant('2027-01-01', 0),
          status: 'used_up',
        })
        .returning()
      await db.insert(packageRedemptions).values({
        tenantId: ids.tenant!,
        clientPackageId: pkg!.id,
        serviceId: ids.service!,
        saleId: session.id,
        valueAed: '105',
      })
    })
  })

  it('one day: shifts clipped to the business day, time clock without shifts, reception left out', async () => {
    const r = await tx((db) => revPath(db, { from: D, to: D }, dubaiInstant(D1, 12 * 60)))
    expect(r).toMatchObject({ revenue: 1200, hours: 22, revPath: 54.55, unassigned: 200 })
    const by = Object.fromEntries(r.byTherapist.map((s) => [s.name, s]))
    expect(by.Maya).toMatchObject({ revenue: 600, hours: 9, revPath: 66.67, source: 'shifts' })
    expect(by.Ploy).toMatchObject({ revenue: 300, hours: 7, revPath: 42.86, source: 'shifts' })
    expect(by.Lina).toMatchObject({ revenue: 100, hours: 6, revPath: 16.67, source: 'timeclock' })
    expect(by['Rania (reception)']).toBeUndefined()
  })

  it('refunds count on the refund date', async () => {
    const r = await tx((db) => revPath(db, { from: D, to: D1 }, dubaiInstant(D1, 12 * 60)))
    const maya = r.byTherapist.find((s) => s.name === 'Maya')
    expect(maya).toMatchObject({ revenue: 300, hours: 13 })
    expect(r).toMatchObject({ revenue: 900, hours: 26, revPath: 34.62 })
  })

  it('no shifts or clocked hours → no RevPATH', async () => {
    const r = await tx((db) => revPath(db, { from: D, to: D, branchId: ids.jbr }))
    expect(r).toMatchObject({ revenue: 0, hours: 0, revPath: null, byTherapist: [] })
  })
})

describe('room utilisation', () => {
  beforeAll(async () => {
    await visit({ date: D, room: ids.room1, minutes: 60 })
    await visit({ date: D, room: ids.room1, minutes: 90, status: 'confirmed', start: 14 * 60 })
    await visit({ date: D, room: ids.room1, status: 'cancelled', start: 16 * 60 })
    await visit({ date: D, room: ids.room1, status: 'no_show', start: 18 * 60 })
    await visit({ date: D, room: ids.room2, minutes: 120, start: 25 * 60 }) // 01:00 → business date D
    await visit({ date: D, room: ids.oldRoom, minutes: 30 }) // inactive room, still used
    await visit({ date: D1, room: ids.roomA, branch: ids.jbr })
  })

  it('opening hours past midnight and the default hours', () => {
    expect(openMinutes({ tue: [{ open: '10:00', close: '02:00' }] }, D, D)).toBe(960)
    expect(openMinutes({}, D, D1)).toBe(1680)
  })

  it('per room and per branch; cancelled / no-show left out; inactive rooms only when used', async () => {
    const u = await tx((db) => roomUtilisation(db, { from: D, to: D }))
    const marina = u.branches.find((b) => b.name === 'Marina')!
    expect(marina.rooms.map((r) => [r.name, r.bookedMinutes, r.openMinutes])).toEqual([
      ['Room 1', 150, 960],
      ['Room 2', 120, 960],
      ['Old room', 30, 960],
    ])
    expect(marina).toMatchObject({ openMinutes: 2880, bookedMinutes: 300 })
    expect(marina.utilisation).toBeCloseTo(300 / 2880)
    const jbr = u.branches.find((b) => b.name === 'JBR')!
    expect(jbr).toMatchObject({ openMinutes: 840, bookedMinutes: 0, utilisation: 0 })
    expect(u).toMatchObject({ openMinutes: 3720, bookedMinutes: 300 })
  })

  it('branch filter', async () => {
    const u = await tx((db) => roomUtilisation(db, { from: D, to: D1, branchId: ids.jbr }))
    expect(u.branches.map((b) => b.name)).toEqual(['JBR'])
    expect(u).toMatchObject({ openMinutes: 1680, bookedMinutes: 60 })
  })
})

describe('prepaid liability', () => {
  const L = '2026-11-02'
  const noon = (date: string) => dubaiInstant(date, 12 * 60)
  const at = (date: string) => tx((db) => prepaidLiability(db, date))

  beforeAll(async () => {
    const tenantId = ids.tenant!
    const { defId, planId } = await tx(async (db) => {
      const [d] = await db
        .insert(packageDefinitions)
        .values({
          tenantId,
          name: { en: '5 × Swedish' },
          priceAed: '1000',
          validityDays: 365,
          items: [{ serviceId: ids.service!, quantity: 5 }],
        })
        .returning()
      const [p] = await db
        .insert(membershipPlans)
        .values({
          tenantId,
          name: { en: 'Gold' },
          monthlyAed: '600',
          benefits: { includedSessions: [{ serviceId: ids.service!, quantity: 2 }] },
        })
        .returning()
      return { defId: d!.id, planId: p!.id }
    })
    const base = { tenantId, branchId: ids.marina!, clientId: ids.Khalid! }
    const swedish = {
      kind: 'service' as const,
      refId: ids.variant!,
      description: 'Swedish',
      qty: 1,
      staffId: ids.maya,
    }
    const { sale: sold, lines } = await tx((db) =>
      createSale(db, {
        ...base,
        lines: [
          { kind: 'gift_card', description: 'Gift card — Sara', qty: 1, unitPriceAed: 500 },
          { kind: 'package', refId: defId, description: '5 × Swedish', qty: 1, unitPriceAed: 1000 },
          { kind: 'membership', refId: planId, description: 'Gold', qty: 1, unitPriceAed: 600 },
        ],
        payments: [{ method: 'card_terminal', amountAed: 2100 }],
        now: noon(L),
      }),
    )
    ids.giftLine = lines.find((l) => l.kind === 'gift_card')!.id
    const [card] = await tx((db) => db.select().from(giftCards).where(eq(giftCards.saleId, sold.id)))
    const [pkg] = await tx((db) => db.select().from(clientPackages).where(eq(clientPackages.saleId, sold.id)))
    const [period] = await tx((db) =>
      db.select().from(clientMemberships).where(eq(clientMemberships.saleId, sold.id)),
    )
    ids.giftSale = sold.id
    ids.pkg = pkg!.id
    // 02:00 on 3 Nov (business date 2 Nov): a package session and a treatment paid by gift card.
    await tx((db) =>
      createSale(db, {
        ...base,
        lines: [
          { ...swedish, unitPriceAed: 0, clientPackageId: pkg!.id },
          { ...swedish, unitPriceAed: 315 },
        ],
        payments: [{ method: 'gift_card', amountAed: 315, reference: card!.code }],
        now: dubaiInstant('2026-11-03', 2 * 60),
      }),
    )
    // A voided cash treatment changes nothing.
    await tx(async (db) => {
      const { sale: v } = await createSale(db, {
        ...base,
        lines: [{ ...swedish, unitPriceAed: 315 }],
        payments: [{ method: 'cash', amountAed: 315 }],
        now: noon(L),
      })
      await voidSale(db, { saleId: v.id, reason: 'Wrong client' })
    })
    // An imported gift card: no sale, no ledger entry → shows up as a difference.
    await tx(async (db) => {
      const [g] = await db
        .insert(giftCards)
        .values({
          tenantId,
          code: 'IMPO-RT01',
          initialAed: '50',
          balanceAed: '50',
          expiresAt: noon('2026-11-01'),
        })
        .returning()
      await db.insert(giftCardTxns).values({
        tenantId,
        giftCardId: g!.id,
        kind: 'issue',
        amountAed: '50',
        createdAt: dubaiInstant(L, 3 * 60), // 03:00 on 2 Nov → business date 1 Nov
      })
    })
    // 4 Nov: the rest of the gift card refunded; one included membership session used.
    await tx((db) =>
      refundSale(db, {
        saleId: sold.id,
        lines: [{ saleLineId: ids.giftLine!, qty: 1 }],
        method: 'cash',
        reason: 'Not needed',
        now: noon('2026-11-04'),
      }),
    )
    await tx((db) =>
      createSale(db, {
        ...base,
        lines: [{ ...swedish, unitPriceAed: 0, membership: { id: period!.id, use: 'session' } }],
        payments: [],
        now: noon('2026-11-04'),
      }),
    )
    // The membership period (2 Nov – 1 Dec) ends; the package expires on 2 Dec and is written off on 5 Dec.
    await tx((db) => runMembershipRenewals(db, tenantId, noon('2026-12-03')))
    await tx(async (db) => {
      await db
        .update(clientPackages)
        .set({ expiresAt: noon('2026-12-02') })
        .where(eq(clientPackages.id, pkg!.id))
      await expirePackages(db, tenantId, noon('2026-12-05'))
    })
  })

  it('before anything was sold: only the imported card', async () => {
    const r = await at('2026-11-01')
    expect(r).toMatchObject({
      giftCards: { count: 1, value: 50, pastExpiry: 50 },
      packages: { count: 0, value: 0 },
      memberships: { count: 0, value: 0 },
      ledger: { giftCards: 0, packagesMemberships: 0, total: 0 },
      difference: { giftCards: -50, packagesMemberships: 0, total: -50 },
    })
  })

  it('end of the sale day (overnight sale included) matches 2100 / 2110 apart from the import', async () => {
    const r = await at(L)
    expect(r).toMatchObject({
      giftCards: { count: 2, value: 235 },
      packages: { count: 1, value: 800 },
      memberships: { count: 1, value: 600 },
      total: 1635,
      ledger: { giftCards: 185, packagesMemberships: 1400, total: 1585 },
      difference: { giftCards: -50, packagesMemberships: 0, total: -50 },
    })
  })

  it('refunds, sessions, membership expiry and package write-off on their own dates', async () => {
    const nov4 = await at('2026-11-04')
    expect(nov4).toMatchObject({
      giftCards: { count: 1, value: 50 },
      memberships: { value: 300 },
      ledger: { giftCards: 0, packagesMemberships: 1100 },
      difference: { packagesMemberships: 0 },
    })
    expect((await at('2026-11-03')).giftCards.value).toBe(235)
    const dec2 = await at('2026-12-02')
    expect(dec2).toMatchObject({ memberships: { count: 1, value: 300 }, packages: { value: 800 } })
    const dec3 = await at('2026-12-03')
    expect(dec3).toMatchObject({ memberships: { count: 0, value: 0 }, packages: { value: 800 } })
    expect(dec3.difference.packagesMemberships).toBe(0)
    const dec5 = await at('2026-12-05')
    expect(dec5).toMatchObject({
      packages: { count: 0, value: 0 },
      ledger: { packagesMemberships: 0 },
      difference: { giftCards: -50, packagesMemberships: 0 },
    })
  })
})

describe('console aggregates', () => {
  it('whole-spa figures only', async () => {
    const r = await tx((db) =>
      tenantOperations(db, { from: D, to: D, today: '2026-10-10' }, dubaiInstant(D1, 12 * 60)),
    )
    expect(r.revPath).toEqual({ revenue: 1200, hours: 22, revPath: 54.55 })
    expect(r.rooms).toMatchObject({ openMinutes: 3720, bookedMinutes: 300 })
    expect(r.rebooking).toMatchObject({ windowDays: 30, visits: 0, rate: null })
    expect(r.liability).toMatchObject({ asOf: D, total: 0, difference: { total: 0 } })
    expect(JSON.stringify(r)).not.toContain('Maya')
  })
})

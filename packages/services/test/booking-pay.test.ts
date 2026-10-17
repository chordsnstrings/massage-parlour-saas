// PLAN §14.8 R2: booking marks, therapist commission per booking, pay types and payroll from them.
import { dubaiInstant } from '@spa/core'
import {
  bookingCommissions,
  bookingItems,
  bookings,
  branches,
  closeAllDbs,
  payrollLines,
  saleLines,
  sales,
  staff,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  accountTotals,
  accrueCommissions,
  bookingDetail,
  buildPayroll,
  completeBooking,
  finalisePayroll,
  listBookings,
  recordBookingCommissions,
  setBookingStatus,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06'
const NOW = dubaiInstant(D, 20 * 60)
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const bal = async (code: string) =>
  (await tx((db) => accountTotals(db, ids.tenant!, null, '2030-01-01'))).find((a) => a.code === code)
    ?.balance ?? 0

let refN = 0
/** A booking with two treatments: Maya alone, then Maya + Lina (four hands). */
async function newBooking(date = D) {
  return tx(async (db) => {
    const start = dubaiInstant(date, 14 * 60)
    const [b] = await db
      .insert(bookings)
      .values({
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        refCode: `R${++refN}`,
        source: refN % 2 ? 'walk_in' : 'online',
        status: 'confirmed',
        businessDate: date,
        startsAt: start,
        endsAt: new Date(start.getTime() + 2 * 3600_000),
      })
      .returning()
    const items = await db
      .insert(bookingItems)
      .values([
        {
          tenantId: ids.tenant!,
          bookingId: b!.id,
          serviceName: 'Swedish',
          durationMin: 60,
          priceAed: '300',
          startsAt: start,
          endsAt: new Date(start.getTime() + 3600_000),
          staffIds: [ids.maya!],
        },
        {
          tenantId: ids.tenant!,
          bookingId: b!.id,
          serviceName: 'Four hands',
          durationMin: 60,
          priceAed: '500',
          startsAt: new Date(start.getTime() + 3600_000),
          endsAt: new Date(start.getTime() + 2 * 3600_000),
          staffIds: [ids.maya!, ids.lina!],
        },
      ])
      .returning()
    return { id: b!.id, one: items[0]!.id, two: items[1]!.id }
  })
}
const amounts = (b: { one: string; two: string }, a: number, c: number, d: number) => [
  { bookingItemId: b.one, staffId: ids.maya!, amountAed: a },
  { bookingItemId: b.two, staffId: ids.maya!, amountAed: c },
  { bookingItemId: b.two, staffId: ids.lina!, amountAed: d },
]
const owed = async (staffId: string) =>
  (await tx((db) => db.select().from(bookingCommissions).where(eq(bookingCommissions.staffId, staffId))))
    .filter((r) => !r.payrollRunId)
    .reduce((s, r) => s + Number(r.amountAed), 0)

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'pay', name: 'Pay Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Main', isDefault: true })
      .returning()
    ids.branch = b!.id
    const people = await db
      .insert(staff)
      .values([
        // Therapists: the old % and base no longer pay them (PLAN §14.8 R2).
        { tenantId: ids.tenant!, displayName: 'Maya', commissionPct: '10', baseSalaryAed: '3000' },
        { tenantId: ids.tenant!, displayName: 'Lina' },
        {
          tenantId: ids.tenant!,
          displayName: 'Rita',
          bookable: false,
          payType: 'salary',
          baseSalaryAed: '4000',
          commissionPct: '5',
        },
        {
          tenantId: ids.tenant!,
          displayName: 'Omar',
          bookable: false,
          payType: 'sales_commission',
          commissionPct: '10',
        },
      ])
      .returning()
    ;[ids.maya, ids.lina, ids.rita, ids.omar] = people.map((p) => p.id)
  })
})
afterAll(closeAllDbs)

describe('booking commission', () => {
  it('completes with a commission for every therapist and posts 6010/2300', async () => {
    const b = await newBooking()
    await expect(
      tx((db) =>
        completeBooking(db, { bookingId: b.id, amounts: amounts(b, 40, 30, 30).slice(0, 2), now: NOW }),
      ),
    ).rejects.toThrow('Enter the commission for every therapist')
    await expect(
      tx((db) =>
        completeBooking(db, {
          bookingId: b.id,
          amounts: [
            ...amounts(b, 40, 30, 30).slice(0, 2),
            { bookingItemId: b.one, staffId: ids.lina!, amountAed: 1 },
          ],
          now: NOW,
        }),
      ),
    ).rejects.toThrow('Therapist not found')
    await expect(
      tx((db) => completeBooking(db, { bookingId: b.id, amounts: amounts(b, -1, 30, 30), now: NOW })),
    ).rejects.toThrow('Enter a commission between 0 and 100,000 AED')
    // The failed attempts rolled back: still confirmed, nothing recorded.
    expect((await tx((db) => bookingDetail(db, b.id)))!.status).toBe('confirmed')

    await tx((db) => completeBooking(db, { bookingId: b.id, amounts: amounts(b, 40, 30, 25), now: NOW }))
    const d = (await tx((db) => bookingDetail(db, b.id)))!
    expect(d.status).toBe('completed')
    expect(d.items.flatMap((i) => i.therapists.map((t) => t.commissionAed))).toEqual([40, 30, 25])
    expect(await bal('6010')).toBe(95)
    expect(await bal('2300')).toBe(95) // payable

    // Edits insert the difference only (append-only) and post the net change.
    await tx((db) =>
      recordBookingCommissions(db, { bookingId: b.id, amounts: amounts(b, 40, 35, 20), now: NOW }),
    )
    expect(await bal('6010')).toBe(95)
    await tx((db) =>
      recordBookingCommissions(db, { bookingId: b.id, amounts: amounts(b, 50, 35, 20), now: NOW }),
    )
    expect(await bal('6010')).toBe(105)
    const rows = await tx((db) =>
      db.select().from(bookingCommissions).where(eq(bookingCommissions.bookingId, b.id)),
    )
    expect(rows.map((r) => r.amountAed).sort()).toEqual(['-5.00', '10.00', '25.00', '30.00', '40.00', '5.00'])

    // Re-opening reverses everything; re-completing records again.
    await tx((db) => setBookingStatus(db, b.id, 'pending', undefined, { now: NOW }))
    expect(await bal('6010')).toBe(0)
    expect((await tx((db) => bookingDetail(db, b.id)))!.items[0]!.therapists[0]!.commissionAed).toBe(0)
    await expect(
      tx((db) => recordBookingCommissions(db, { bookingId: b.id, amounts: amounts(b, 1, 1, 1) })),
    ).rejects.toThrow('Mark the booking completed first')
    await tx((db) => completeBooking(db, { bookingId: b.id, amounts: amounts(b, 10, 10, 10), now: NOW }))
    expect(await bal('6010')).toBe(30)
    await tx((db) => setBookingStatus(db, b.id, 'cancelled', 'Client complaint', { now: NOW }))
    expect(await bal('6010')).toBe(0)
    expect(await bal('2300')).toBe(0)
    await expect(tx((db) => setBookingStatus(db, b.id, 'completed'))).rejects.toThrow(
      "Can't change a cancelled booking to completed",
    )
  })

  it('keeps a checked-out booking completed until the sale is voided or refunded', async () => {
    const b = await newBooking()
    await tx((db) => completeBooking(db, { bookingId: b.id, amounts: amounts(b, 0, 0, 0), now: NOW }))
    await tx((db) =>
      db.insert(sales).values({
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        bookingId: b.id,
        number: 900,
        businessDate: D,
        subtotalAed: '800',
        totalAed: '800',
        status: 'paid',
      }),
    )
    await expect(tx((db) => setBookingStatus(db, b.id, 'pending'))).rejects.toThrow(
      'This booking was checked out — void or refund the sale first',
    )
  })

  it('rows are append-only for the app role', async () => {
    const b = await newBooking()
    await tx((db) => completeBooking(db, { bookingId: b.id, amounts: amounts(b, 5, 5, 5), now: NOW }))
    await expect(
      tx((db) =>
        db.update(bookingCommissions).set({ amountAed: '99' }).where(eq(bookingCommissions.bookingId, b.id)),
      ),
    ).rejects.toThrow()
    await expect(
      tx((db) => db.delete(bookingCommissions).where(eq(bookingCommissions.bookingId, b.id))),
    ).rejects.toThrow()
    await tx((db) => setBookingStatus(db, b.id, 'cancelled', 'test', { now: NOW }))
  })

  it('serialises concurrent entries on one booking (no double posting)', async () => {
    const b = await newBooking()
    await tx((db) => setBookingStatus(db, b.id, 'completed'))
    await Promise.all(
      [1, 2, 3].map(() =>
        tx((db) =>
          recordBookingCommissions(db, { bookingId: b.id, amounts: amounts(b, 20, 20, 20), now: NOW }),
        ),
      ),
    )
    const d = (await tx((db) => bookingDetail(db, b.id)))!
    expect(d.items.flatMap((i) => i.therapists.map((t) => t.commissionAed))).toEqual([20, 20, 20])
    expect(await bal('6010')).toBe(60)
    await tx((db) => setBookingStatus(db, b.id, 'cancelled', 'test', { now: NOW }))
    expect(await bal('6010')).toBe(0)
  })
})

describe('bookings list', () => {
  it('filters by mark, source, therapist and missing commission, with paging', async () => {
    const done = await newBooking('2026-10-07')
    await tx((db) => setBookingStatus(db, done.id, 'completed')) // e.g. by a POS checkout: no commission yet
    const open = await newBooking('2026-10-07')
    const q = (f: Partial<Parameters<typeof listBookings>[1]>) =>
      tx((db) => listBookings(db, { from: '2026-10-07', to: '2026-10-07', branchIds: [ids.branch!], ...f }))
    expect((await q({})).total).toBe(2)
    expect((await q({ branchIds: [] })).total).toBe(0)
    const missing = await q({ commissionMissing: true })
    expect(missing.rows.map((r) => r.id)).toEqual([done.id])
    expect(missing.rows[0]!.commissionMissing).toBe(true)
    expect(missing.rows[0]!.services).toEqual(['Swedish', 'Four hands'])
    expect(missing.rows[0]!.totalAed).toBe('800.00')
    expect((await q({ statuses: ['pending', 'confirmed'] })).rows.map((r) => r.id)).toEqual([open.id])
    expect((await q({ source: 'walk_in' })).total + (await q({ source: 'online' })).total).toBe(2)
    expect((await q({ staffId: ids.lina! })).total).toBe(2)
    expect((await q({ staffId: ids.rita! })).total).toBe(0)
    const page2 = await q({ pageSize: 1, page: 2 })
    expect([page2.rows.length, page2.total]).toEqual([1, 2])
    await tx((db) =>
      recordBookingCommissions(db, { bookingId: done.id, amounts: amounts(done, 15, 10, 10), now: NOW }),
    )
    expect((await q({ commissionMissing: true })).total).toBe(0)
  })
})

describe('pay types and payroll', () => {
  it('pays therapists only their booking commissions, salaried staff their base, % staff their sales', async () => {
    // A paid sale with lines by Maya (therapist) and Omar (% of sales): only Omar accrues.
    const saleId = await tx(async (db) => {
      const [s] = await db
        .insert(sales)
        .values({
          tenantId: ids.tenant!,
          branchId: ids.branch!,
          number: 1,
          businessDate: D,
          subtotalAed: '420',
          totalAed: '420',
          status: 'paid',
        })
        .returning()
      await db.insert(saleLines).values([
        {
          tenantId: ids.tenant!,
          saleId: s!.id,
          kind: 'service',
          description: 'Swedish',
          unitPriceAed: '315',
          lineTotalAed: '315',
          staffId: ids.maya!,
        },
        {
          tenantId: ids.tenant!,
          saleId: s!.id,
          kind: 'product',
          description: 'Oil',
          unitPriceAed: '105',
          lineTotalAed: '105',
          staffId: ids.omar!,
        },
      ])
      return s!.id
    })
    const accrued = await tx((db) => accrueCommissions(db, saleId))
    expect(accrued.map((e) => [e.staffId, e.amountAed])).toEqual([[ids.omar, '10.00']])

    const mayaOwed = await owed(ids.maya!)
    const linaOwed = await owed(ids.lina!)
    expect([mayaOwed, linaOwed]).toEqual([25, 10]) // from the bookings list test above
    const run = await tx((db) =>
      buildPayroll(db, { tenantId: ids.tenant!, periodStart: '2026-10-01', periodEnd: '2026-10-31' }),
    )
    const lines = await tx((db) => db.select().from(payrollLines).where(eq(payrollLines.runId, run.id)))
    const by = (id: string) => {
      const l = lines.find((x) => x.staffId === id)
      return l && [l.baseAed, l.commissionAed, l.netAed]
    }
    expect(by(ids.maya!)).toEqual(['0.00', '25.00', '25.00'])
    expect(by(ids.lina!)).toEqual(['0.00', '10.00', '10.00'])
    expect(by(ids.rita!)).toEqual(['4000.00', '0.00', '4000.00'])
    expect(by(ids.omar!)).toEqual(['0.00', '10.00', '10.00'])
    await tx((db) => finalisePayroll(db, run.id, '2026-10-31'))
    expect(await owed(ids.maya!)).toBe(0)
    expect(await bal('2300')).toBe(0)

    // A correction after payroll is a new unpaid row: it lands in the next run.
    const [last] = await tx((db) =>
      db.select().from(bookings).where(eq(bookings.businessDate, '2026-10-07')).orderBy(bookings.refCode),
    )
    const items = await tx((db) => db.select().from(bookingItems).where(eq(bookingItems.bookingId, last!.id)))
    const b = {
      id: last!.id,
      one: items.find((i) => i.serviceName === 'Swedish')!.id,
      two: items.find((i) => i.serviceName === 'Four hands')!.id,
    }
    await tx((db) =>
      recordBookingCommissions(db, { bookingId: b.id, amounts: amounts(b, 15, 10, 4), now: NOW }),
    )
    expect(await owed(ids.lina!)).toBe(-6)
  })
})

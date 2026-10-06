import { dubaiInstant } from '@spa/core'
import {
  branches,
  clients,
  closeAllDbs,
  rooms,
  saleLines,
  sales,
  services,
  serviceVariants,
  shifts,
  staff,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBooking, kpis, setBookingStatus, upcomingItems } from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06' // Tuesday
const D2 = '2026-10-07'
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'kpi', name: 'KPI Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const tenantId = ids.tenant!
    const [b] = await db
      .insert(branches)
      .values({ tenantId, name: 'Marina', isDefault: true, businessDayCutoff: '05:00' })
      .returning()
    ids.branch = b!.id
    const [room] = await db.insert(rooms).values({ tenantId, branchId: b!.id, name: 'Room 1' }).returning()
    const [s] = await db
      .insert(services)
      .values({ tenantId, name: { en: 'Swedish massage' }, bufferAfterMin: 0 })
      .returning()
    const [v] = await db
      .insert(serviceVariants)
      .values({ tenantId, serviceId: s!.id, durationMin: 60, priceAed: '300' })
      .returning()
    ids.variant = v!.id
    const people = await db
      .insert(staff)
      .values([
        { tenantId, displayName: 'Maya', sort: 1 },
        { tenantId, displayName: 'Ploy', sort: 2 },
      ])
      .returning()
    ids.maya = people[0]!.id
    ids.ploy = people[1]!.id
    // Two 10-hour shifts on D = 1200 shift minutes; Ploy's shift runs past midnight.
    await db.insert(shifts).values([
      {
        tenantId,
        staffId: ids.maya!,
        branchId: b!.id,
        startsAt: dubaiInstant(D, 10 * 60),
        endsAt: dubaiInstant(D, 20 * 60),
      },
      {
        tenantId,
        staffId: ids.ploy!,
        branchId: b!.id,
        startsAt: dubaiInstant(D, 16 * 60),
        endsAt: dubaiInstant(D, 26 * 60),
      },
    ])
    const cls = await db
      .insert(clients)
      .values([
        { tenantId, name: 'Fatima Al Mansoori', firstVisitAt: dubaiInstant(D, 11 * 60) },
        { tenantId, name: 'Noor', firstVisitAt: dubaiInstant(D, 25 * 60) }, // 01:00 next day → still D
        { tenantId, name: 'Old friend', firstVisitAt: dubaiInstant('2026-09-01', 12 * 60) },
      ])
      .returning()
    ids.fatima = cls[0]!.id
    ids.noor = cls[1]!.id

    const book = (start: number, staffId: string, clientId: string, source: 'phone' | 'online') =>
      createBooking(db, {
        tenantId,
        branchId: b!.id,
        clientId,
        source,
        status: 'confirmed',
        items: [
          { serviceVariantId: v!.id, start: dubaiInstant(D, start), staffIds: [staffId], roomId: room!.id },
        ],
      })
    const b1 = await book(11 * 60, ids.maya!, ids.fatima!, 'phone')
    const b2 = await book(14 * 60, ids.maya!, ids.noor!, 'online')
    const b3 = await book(17 * 60, ids.ploy!, ids.fatima!, 'online')
    const b4 = await book(24 * 60 + 30, ids.ploy!, ids.noor!, 'phone') // 00:30 → business date D
    ids.b4 = b4.id
    await setBookingStatus(db, b1.id, 'checked_in')
    await setBookingStatus(db, b1.id, 'in_service')
    await setBookingStatus(db, b1.id, 'completed')
    await setBookingStatus(db, b2.id, 'no_show')
    await setBookingStatus(db, b3.id, 'cancelled')

    let number = 0
    const sale = async (
      date: string,
      total: number,
      tip: number,
      staffId: string,
      status = 'paid' as const,
    ) => {
      const [row] = await db
        .insert(sales)
        .values({
          tenantId,
          branchId: b!.id,
          number: ++number,
          businessDate: date,
          subtotalAed: String(total),
          totalAed: String(total),
          tipsAed: String(tip),
          status,
        })
        .returning()
      await db.insert(saleLines).values({
        tenantId,
        saleId: row!.id,
        kind: 'service',
        refId: v!.id,
        description: 'Swedish 60',
        unitPriceAed: String(total),
        lineTotalAed: String(total),
        staffId,
      })
    }
    await sale(D, 300, 20, ids.maya!)
    await sale(D, 500, 0, ids.ploy!)
    await sale(D2, 200, 10, ids.ploy!)
    const [voided] = await db
      .insert(sales)
      .values({
        tenantId,
        branchId: b!.id,
        number: ++number,
        businessDate: D,
        subtotalAed: '999',
        totalAed: '999',
        status: 'void',
      })
      .returning()
    ids.voided = voided!.id
  })
})
afterAll(closeAllDbs)

describe('kpis', () => {
  it('aggregates revenue, bookings, utilisation and rankings for one business date', async () => {
    const k = await tx((db) => kpis(db, { from: D, to: D }))
    expect(k.revenue).toBe(800)
    expect(k.salesCount).toBe(2)
    expect(k.averageTicket).toBe(400)
    expect(k.tips).toBe(20)
    expect(k.bookings).toBe(4)
    expect(k.byStatus).toMatchObject({ completed: 1, no_show: 1, cancelled: 1, confirmed: 1 })
    expect(k.bySource).toEqual([
      { source: 'phone', count: 2 },
      { source: 'online', count: 1 },
    ])
    expect(k.newClients).toBe(2)
    expect(k.noShowRate).toBe(0.5)
    // Live bookings: b1 (completed) + b4 (confirmed) = 120 booked of 1200 shift minutes.
    expect(k.bookedMinutes).toBe(120)
    expect(k.shiftMinutes).toBe(1200)
    expect(k.utilisation).toBeCloseTo(0.1)
    expect(k.revenuePerAvailableHour).toBe(40)
    expect(k.topServices).toEqual([{ name: 'Swedish massage', revenue: 800, count: 2 }])
    expect(k.topTherapists.map((t) => [t.name, t.revenue])).toEqual([
      ['Ploy', 500],
      ['Maya', 300],
    ])
    expect(k.byHour[11]).toBe(1)
    expect(k.byHour[0]).toBe(1)
    expect(k.byHour[17]).toBe(0) // cancelled
    expect(k.heatmap[2]![14]).toBe(1) // Tuesday 14:00 (no-show still occupied a slot)
    expect(k.daily).toEqual([{ date: D, revenue: 800, bookings: 3 }])
  })

  it('fills the daily series across a range and filters by branch', async () => {
    const k = await tx((db) => kpis(db, { from: '2026-10-05', to: D2, branchId: ids.branch }))
    expect(k.revenue).toBe(1000)
    expect(k.daily.map((d) => d.revenue)).toEqual([0, 800, 200])
    const other = await tx(async (db) => {
      const [b] = await db.insert(branches).values({ tenantId: ids.tenant!, name: 'JLT' }).returning()
      return kpis(db, { from: D, to: D, branchId: b!.id })
    })
    expect(other.revenue).toBe(0)
    expect(other.bookings).toBe(0)
    expect(other.utilisation).toBeNull()
    expect(other.noShowRate).toBeNull()
  })

  it('lists the upcoming agenda, optionally for one therapist', async () => {
    const all = await tx((db) => upcomingItems(db, { date: D, after: dubaiInstant(D, 12 * 60) }))
    expect(all.map((i) => i.bookingId)).toEqual([ids.b4])
    expect(all[0]!.clientName).toBe('Noor')
    expect(all[0]!.therapists).toEqual(['Ploy'])
    expect(all[0]!.startsAt.getTime()).toBe(dubaiInstant(D, 24 * 60 + 30).getTime())
    const maya = await tx((db) =>
      upcomingItems(db, { date: D, after: dubaiInstant(D, 0), staffId: ids.maya }),
    )
    expect(maya).toEqual([])
  })
})

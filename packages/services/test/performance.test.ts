import { dubaiInstant } from '@spa/core'
import {
  aiUsage,
  branches,
  campaigns,
  clients,
  closeAllDbs,
  refunds,
  rooms,
  sales,
  services,
  serviceVariants,
  socialPosts,
  staff,
  tenants,
  webEvents,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createBooking,
  performanceRange,
  setBookingStatus,
  tenantPerformance,
  tenantPerformanceDetail,
  weeklySeries,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06'
const D2 = '2026-10-07'
const NOW = new Date('2026-10-08T08:00:00Z')
const ids = {} as Record<string, string>

beforeAll(async () => {
  await resetTestDatabase()
  const [a, other] = await platform
    .insert(tenants)
    .values([
      { slug: 'perf', name: 'Perf Spa' },
      { slug: 'perf-other', name: 'Other Spa' },
    ])
    .returning()
  ids.a = a!.id
  ids.other = other!.id
  await withTenant(
    ids.a,
    async (db) => {
      const tenantId = ids.a!
      const [b] = await db
        .insert(branches)
        .values({ tenantId, name: 'Main', isDefault: true, businessDayCutoff: '05:00' })
        .returning()
      const [room] = await db.insert(rooms).values({ tenantId, branchId: b!.id, name: 'R1' }).returning()
      const [s] = await db
        .insert(services)
        .values({ tenantId, name: { en: 'Thai' }, bufferAfterMin: 0 })
        .returning()
      const [v] = await db
        .insert(serviceVariants)
        .values({ tenantId, serviceId: s!.id, durationMin: 60, priceAed: '200' })
        .returning()
      const [st] = await db.insert(staff).values({ tenantId, displayName: 'Maya' }).returning()
      const [c1, c2] = await db
        .insert(clients)
        .values([
          { tenantId, name: 'A', firstVisitAt: dubaiInstant(D, 12 * 60) },
          { tenantId, name: 'B', firstVisitAt: dubaiInstant('2026-09-01', 12 * 60) },
        ])
        .returning()
      const book = (start: number, clientId: string, source: 'online' | 'walk_in' | 'ai_agent') =>
        createBooking(db, {
          tenantId,
          branchId: b!.id,
          clientId,
          source,
          // F13: the first online booking came from Instagram (the other one is cancelled below).
          attribution: source === 'online' && start === 11 * 60 ? 'instagram' : undefined,
          status: 'confirmed',
          items: [
            { serviceVariantId: v!.id, start: dubaiInstant(D, start), staffIds: [st!.id], roomId: room!.id },
          ],
        })
      const b1 = await book(11 * 60, c1!.id, 'online')
      const b2 = await book(13 * 60, c2!.id, 'walk_in')
      const b3 = await book(15 * 60, c1!.id, 'online')
      await book(17 * 60, c2!.id, 'ai_agent')
      await setBookingStatus(db, b1.id, 'checked_in')
      await setBookingStatus(db, b1.id, 'in_service')
      await setBookingStatus(db, b1.id, 'completed')
      await setBookingStatus(db, b2.id, 'no_show')
      await setBookingStatus(db, b3.id, 'cancelled')
      const [s1] = await db
        .insert(sales)
        .values([
          {
            tenantId,
            branchId: b!.id,
            number: 1,
            businessDate: D,
            subtotalAed: '400',
            totalAed: '400',
            status: 'paid',
          },
          {
            tenantId,
            branchId: b!.id,
            number: 2,
            businessDate: D,
            subtotalAed: '100',
            totalAed: '100',
            status: 'refunded',
          },
          {
            tenantId,
            branchId: b!.id,
            number: 3,
            businessDate: D,
            subtotalAed: '999',
            totalAed: '999',
            status: 'void',
          },
        ])
        .returning()
      await db.insert(refunds).values({
        tenantId,
        saleId: s1!.id,
        branchId: b!.id,
        amountAed: '150',
        method: 'cash',
        reason: 'test',
        businessDate: D2,
      })
      const ev = (session: string, type: string, source: string, hour = 10) => ({
        tenantId,
        sessionHash: session,
        type,
        path: '/',
        source,
        ts: dubaiInstant(D, hour * 60),
      })
      await db
        .insert(webEvents)
        .values([
          ev('s1', 'pageview', 'ig'),
          ev('s1', 'booking_start', 'ig', 11),
          ev('s1', 'booking_complete', 'ig', 12),
          ev('s2', 'pageview', 'qr'),
          ev('s2', 'booking_start', 'qr', 11),
          ev('s3', 'pageview', 'direct'),
          { ...ev('s4', 'pageview', 'gbp'), ts: dubaiInstant('2026-09-01', 600) },
        ])
      await db.insert(aiUsage).values([
        {
          tenantId,
          agentKey: 'x',
          modelId: 'm',
          costUsd: '1.25',
          createdAt: new Date('2026-10-02T08:00:00Z'),
        },
        { tenantId, agentKey: 'x', modelId: 'm', costUsd: '9', createdAt: new Date('2026-09-20T08:00:00Z') },
      ])
      await db.insert(socialPosts).values([
        {
          tenantId,
          platform: 'instagram',
          caption: 'a',
          status: 'published',
          publishedAt: dubaiInstant(D, 600),
        },
        { tenantId, platform: 'gbp', caption: 'b', status: 'draft' },
      ])
      await db.insert(campaigns).values({
        tenantId,
        name: 'Autumn',
        body: { en: 'Hi' },
        status: 'done',
        queuedAt: dubaiInstant(D, 600),
      })
    },
    app,
  )
})
afterAll(closeAllDbs)

describe('performance', () => {
  it('resolves picker ranges in Dubai business dates', () => {
    expect(performanceRange('7', '2026-10-09')).toMatchObject({
      from: '2026-10-03',
      to: '2026-10-09',
      days: 7,
    })
    expect(performanceRange('month', '2026-10-09')).toMatchObject({ from: '2026-10-01', to: '2026-10-09' })
    expect(performanceRange('last-month', '2026-10-09')).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
    })
    expect(performanceRange('bogus', '2026-10-09').key).toBe('30')
  })

  it('aggregates one spa: net revenue, bookings, new clients, web funnel, sources and AI spend', async () => {
    const p = await withTenant(ids.a!, (db) => tenantPerformance(db, { from: D, to: D2 }, NOW), app)
    expect(p.grossSales).toBe(500)
    expect(p.refunds).toBe(150)
    expect(p.revenue).toBe(350)
    expect(p).toMatchObject({ bookings: 4, completed: 1, cancelled: 1, noShow: 1, newClients: 1 })
    expect(p).toMatchObject({ visits: 3, bookingStarts: 2, bookedSessions: 1 })
    expect(p.conversion).toBeCloseTo(1 / 3)
    expect(p.bookingSources).toEqual([
      { source: 'ai_agent', count: 1 },
      { source: 'online', count: 1 },
      { source: 'walk_in', count: 1 },
    ])
    expect(p.onlineSources).toEqual([{ source: 'instagram', count: 1 }])
    expect(p.webSources).toEqual([
      { source: 'direct', sessions: 1, booked: 0 },
      { source: 'ig', sessions: 1, booked: 1 },
      { source: 'qr', sessions: 1, booked: 0 },
    ])
    expect(p.aiSpendUsd).toBe(1.25)
  })

  it('keeps spas apart (RLS) and returns zeros for an empty spa', async () => {
    const p = await withTenant(ids.other!, (db) => tenantPerformance(db, { from: D, to: D2 }, NOW), app)
    expect(p).toMatchObject({ revenue: 0, bookings: 0, visits: 0, conversion: null, aiSpendUsd: 0 })
    expect(p.bookingSources).toEqual([])
  })

  it('returns daily trends, campaigns and social activity', async () => {
    const d = await withTenant(ids.a!, (db) => tenantPerformanceDetail(db, { from: D, to: D2 }), app)
    expect(d.daily).toEqual([
      { date: D, revenue: 500, bookings: 3, visits: 3 },
      { date: D2, revenue: -150, bookings: 0, visits: 0 },
    ])
    expect(d.campaigns).toEqual([expect.objectContaining({ name: 'Autumn', reached: 0, bookings: 0 })])
    expect(d.posts).toEqual([{ source: 'instagram', count: 1 }])
    expect(weeklySeries(d.daily)).toEqual([{ date: D, revenue: 350, bookings: 3, visits: 3 }])
  })
})

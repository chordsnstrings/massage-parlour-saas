import { dubaiInstant } from '@spa/core'
import {
  branches,
  closeAllDbs,
  conversations,
  outbox,
  rooms,
  services,
  serviceVariants,
  shifts,
  staff,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createBooking, loadCalendarRange, navCounts, setBookingStatus } from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const book = (date: string, min: number, staffId: string, status: 'pending' | 'confirmed' = 'confirmed') =>
  tx((db) =>
    createBooking(db, {
      tenantId: ids.tenant!,
      branchId: ids.branch!,
      source: 'phone',
      status,
      allowOffShift: true,
      items: [{ serviceVariantId: ids.variant!, start: dubaiInstant(date, min), staffIds: [staffId] }],
    }),
  )

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'cal', name: 'Cal Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Main', isDefault: true, businessDayCutoff: '05:00' })
      .returning()
    const [b2] = await db.insert(branches).values({ tenantId: ids.tenant!, name: 'Other' }).returning()
    ids.branch = b!.id
    ids.other = b2!.id
    const [s] = await db
      .insert(services)
      .values({ tenantId: ids.tenant!, name: { en: 'Thai massage' } })
      .returning()
    const [v] = await db
      .insert(serviceVariants)
      .values({ tenantId: ids.tenant!, serviceId: s!.id, durationMin: 60, priceAed: '300' })
      .returning()
    ids.variant = v!.id
    await db.insert(rooms).values([
      { tenantId: ids.tenant!, branchId: b!.id, name: 'Room 1', type: 'single' },
      { tenantId: ids.tenant!, branchId: b!.id, name: 'Room 2', type: 'single' },
    ])
    const people = await db
      .insert(staff)
      .values([
        { tenantId: ids.tenant!, displayName: 'Maya' },
        { tenantId: ids.tenant!, displayName: 'Ploy' },
      ])
      .returning()
    ids.maya = people[0]!.id
    ids.ploy = people[1]!.id
    await db.insert(shifts).values({
      tenantId: ids.tenant!,
      staffId: ids.maya!,
      branchId: b!.id,
      startsAt: dubaiInstant('2026-10-06', 10 * 60),
      endsAt: dubaiInstant('2026-10-06', 22 * 60),
    })
  })
  await book('2026-10-06', 20 * 60, ids.maya!)
  // 01:00 on the 7th is before the 05:00 cutoff → business date 6 Oct.
  await book('2026-10-07', 60, ids.ploy!, 'pending')
  const cancelled = await book('2026-10-07', 11 * 60, ids.maya!)
  await tx((db) => setBookingStatus(db, cancelled.id, 'cancelled', 'Client asked'))
  await book('2026-10-08', 6 * 60, ids.maya!)
})
afterAll(closeAllDbs)

describe('calendar range (Week / Month)', () => {
  it('groups by business date across the cutoff with per-day totals', async () => {
    const r = await tx((db) =>
      loadCalendarRange(db, { branchId: ids.branch!, from: '2026-10-06', to: '2026-10-08' }),
    )
    expect(r.items).toHaveLength(4)
    const day = Object.fromEntries(r.days.map((d) => [d.date, d]))
    expect(day['2026-10-06']).toMatchObject({ bookings: 2, pending: 1, revenueAed: 600, bookedMin: 120 })
    expect(day['2026-10-06']!.shiftMin).toBe(720)
    expect(day['2026-10-07']).toMatchObject({ bookings: 0, revenueAed: 0 })
    expect(day['2026-10-08']).toMatchObject({ bookings: 1 })
    const late = r.items.find((i) => i.status === 'pending')!
    expect(late.businessDate).toBe('2026-10-06')
  })

  it('limits to one therapist and rejects overlong ranges', async () => {
    const r = await tx((db) =>
      loadCalendarRange(db, {
        branchId: ids.branch!,
        from: '2026-10-06',
        to: '2026-10-08',
        staffId: ids.ploy!,
      }),
    )
    expect(r.items.map((i) => i.businessDate)).toEqual(['2026-10-06'])
    expect(r.days.find((d) => d.date === '2026-10-06')!.shiftMin).toBe(0)
    await expect(
      tx((db) => loadCalendarRange(db, { branchId: ids.branch!, from: '2026-01-01', to: '2026-06-01' })),
    ).rejects.toThrow('Invalid date range')
  })
})

describe('sidebar badge counts', () => {
  it('counts today per branch cutoff, due WhatsApp messages and unread Instagram threads', async () => {
    const now = dubaiInstant('2026-10-07', 2 * 60) // 02:00 on the 7th = business day 6 Oct
    await tx(async (db) => {
      const base = { tenantId: ids.tenant!, kind: 'reminder' as const, phoneE164: '971501234567', text: 'Hi' }
      await db.insert(outbox).values([
        { ...base, branchId: ids.branch!, dueAt: new Date(now.getTime() - 60_000) },
        { ...base, branchId: ids.branch!, dueAt: new Date(now.getTime() + 3600_000) },
        { ...base, branchId: ids.other!, dueAt: new Date(now.getTime() - 60_000) },
        { ...base, branchId: ids.branch!, status: 'sent', dueAt: new Date(now.getTime() - 60_000) },
      ])
      await db.insert(conversations).values([
        { tenantId: ids.tenant!, channel: 'instagram_dm', externalThreadId: 'a', lastCustomerMsgAt: now },
        {
          tenantId: ids.tenant!,
          channel: 'instagram_dm',
          externalThreadId: 'b',
          lastCustomerMsgAt: new Date(now.getTime() - 3600_000),
          readAt: now,
        },
      ])
    })
    const all = await tx((db) =>
      navCounts(db, { now, branchIds: null, calendar: true, outbox: true, instagram: true }),
    )
    expect(all).toEqual({ today: 2, pending: 1, outboxDue: 2, igUnread: 1, outboxMine: 0 })
    const scoped = await tx((db) =>
      navCounts(db, { now, branchIds: [ids.branch!], calendar: true, outbox: true, instagram: false }),
    )
    expect(scoped).toEqual({ today: 2, pending: 1, outboxDue: 1, igUnread: 0, outboxMine: 0 })
    const none = await tx((db) =>
      navCounts(db, { now, branchIds: [], calendar: true, outbox: false, instagram: false }),
    )
    expect(none).toEqual({ today: 0, pending: 0, outboxDue: 0, igUnread: 0, outboxMine: 0 })
  })
})

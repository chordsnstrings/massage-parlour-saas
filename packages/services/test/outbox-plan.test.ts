// G4: confirmation + day-before + 2-hour reminders are (re)planned from the booking's status and time.
import { dubaiInstant } from '@spa/core'
import {
  bookingItems,
  branches,
  clients,
  closeAllDbs,
  outbox,
  rooms,
  sales,
  services,
  serviceVariants,
  staff,
  staffServices,
  tenants,
  tips,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { and, asc, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  completeBooking,
  createBooking,
  markOutbox,
  type OwnStatusTarget,
  outboxBookingLive,
  planBookingMessages,
  rescheduleItem,
  selfBookingStatus,
  setAutomation,
  setBookingStatus,
  setOwnBookingStatus,
  staffEarnings,
} from '../src'

const { platform, app } = testDbs()
const HOUR = 3_600_000
// Five days ahead (Dubai business date), so every reminder is still in the future.
const D = new Date(Date.now() + 5 * 24 * HOUR).toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
const at = (hhmm: string, date = D) => {
  const [h, m] = hhmm.split(':').map(Number)
  return dubaiInstant(date, h! * 60 + m!)
}
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
let seq = 0
const newClient = (phone: string | null = `9715001${String(++seq).padStart(5, '0')}`) =>
  tx(async (db) => {
    const [c] = await db
      .insert(clients)
      .values({ tenantId: ids.tenant!, name: `Client ${seq} Test`, phoneE164: phone })
      .returning()
    return c!
  })
const book = (clientId: string, start: Date, status: 'pending' | 'confirmed', source = 'phone' as const) =>
  tx((db) =>
    createBooking(db, {
      tenantId: ids.tenant!,
      branchId: ids.branch!,
      clientId,
      source,
      status,
      allowOffShift: true,
      items: [{ serviceVariantId: ids.variant!, start, staffIds: [ids.maya!] }],
    }),
  )
const msgs = (bookingId: string) =>
  tx((db) => db.select().from(outbox).where(eq(outbox.bookingId, bookingId)).orderBy(asc(outbox.dueAt)))
const byKind = async (bookingId: string) =>
  Object.fromEntries((await msgs(bookingId)).map((r) => [r.kind, r])) as Record<
    string,
    typeof outbox.$inferSelect
  >

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'plan', name: 'Plan Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Marina', isDefault: true })
      .returning()
    ids.branch = b!.id
    const [s] = await db
      .insert(services)
      .values({ tenantId: ids.tenant!, name: { en: 'Swedish massage' }, bufferAfterMin: 0 })
      .returning()
    const [v] = await db
      .insert(serviceVariants)
      .values({ tenantId: ids.tenant!, serviceId: s!.id, durationMin: 60, priceAed: '350' })
      .returning()
    ids.variant = v!.id
    const [m] = await db.insert(staff).values({ tenantId: ids.tenant!, displayName: 'Maya' }).returning()
    ids.maya = m!.id
    await db.insert(staffServices).values({ tenantId: ids.tenant!, staffId: m!.id, serviceId: s!.id })
    await db.insert(rooms).values({ tenantId: ids.tenant!, branchId: b!.id, name: 'Room 1', type: 'single' })
  })
})
afterAll(closeAllDbs)

describe('booking message plan (G4)', () => {
  it('an online request queues nothing until confirmed, then confirmation + both reminders', async () => {
    const c = await newClient()
    const start = at('15:00')
    const b = await book(c.id, start, 'pending', 'online')
    expect(await msgs(b.id)).toEqual([])

    await tx((db) => setBookingStatus(db, b.id, 'confirmed'))
    const rows = await byKind(b.id)
    expect(Object.keys(rows).sort()).toEqual(['booking_confirmation', 'reminder', 'reminder_2h'])
    expect(rows.reminder!.dueAt.getTime()).toBe(start.getTime() - 24 * HOUR)
    expect(rows.reminder_2h!.dueAt.getTime()).toBe(start.getTime() - 2 * HOUR)
    expect(rows.booking_confirmation!.dueAt.getTime()).toBeLessThanOrEqual(Date.now())
    expect(Object.values(rows).every((r) => r.status === 'queued')).toBe(true)
    expect(rows.reminder_2h!.text).toMatch(/Swedish massage at Plan Spa is today at 15:00/)

    // Idempotent: planning again (any path) never duplicates.
    await tx((db) => planBookingMessages(db, b.id))
    await tx((db) => planBookingMessages(db, b.id))
    expect(await msgs(b.id)).toHaveLength(3)
  })

  it('a staff booking is planned on creation; a reschedule moves the reminders and re-queues a sent confirmation', async () => {
    const c = await newClient()
    const b = await book(c.id, at('11:00'), 'confirmed')
    const before = await byKind(b.id)
    expect(Object.keys(before)).toHaveLength(3)
    await tx((db) => markOutbox(db, before.booking_confirmation!.id, 'sent', null as unknown as string))

    const [item] = await tx((db) => db.select().from(bookingItems).where(eq(bookingItems.bookingId, b.id)))
    const moved = at('18:30')
    await tx((db) => rescheduleItem(db, item!.id, { start: moved }))
    const after = await byKind(b.id)
    expect(await msgs(b.id)).toHaveLength(3)
    expect(after.reminder!.dueAt.getTime()).toBe(moved.getTime() - 24 * HOUR)
    expect(after.reminder_2h!.dueAt.getTime()).toBe(moved.getTime() - 2 * HOUR)
    expect(after.reminder_2h!.text).toMatch(/18:30/)
    expect(after.booking_confirmation!.status).toBe('queued')
    expect(after.booking_confirmation!.text).toMatch(/18:30/)

    // Moved to a time whose day-before moment has already passed: that reminder is skipped, the 2 h one stays.
    await tx((db) =>
      rescheduleItem(
        db,
        item!.id,
        { start: at('19:00') },
        { now: new Date(at('19:00').getTime() - 5 * HOUR) },
      ),
    )
    const late = await byKind(b.id)
    expect(late.reminder!.status).toBe('skipped')
    expect(late.reminder_2h!.status).toBe('queued')
    expect(late.reminder_2h!.dueAt.getTime()).toBe(at('19:00').getTime() - 2 * HOUR)
  })

  it('cancel / no-show skip every unsent message; the outbox no longer lists them', async () => {
    const c = await newClient()
    const b = await book(c.id, at('13:00'), 'confirmed')
    const n = await book(c.id, at('16:00'), 'confirmed')
    await tx((db) => setBookingStatus(db, b.id, 'cancelled', 'client called'))
    expect((await msgs(b.id)).map((r) => r.status)).toEqual(['skipped', 'skipped', 'skipped'])
    // Even a row still queued by older code is hidden once its booking is cancelled.
    await tx((db) => db.update(outbox).set({ status: 'queued' }).where(eq(outbox.bookingId, b.id)))
    const live = await tx((db) =>
      db
        .select({ id: outbox.id })
        .from(outbox)
        .where(and(eq(outbox.bookingId, b.id), outboxBookingLive())),
    )
    expect(live).toEqual([])
    await tx((db) => setBookingStatus(db, n.id, 'checked_in'))
    expect((await msgs(n.id)).map((r) => r.status)).toEqual(['skipped', 'skipped', 'skipped'])
  })

  it('skips reminders whose time has passed, clients without a mobile, and switched-off automation', async () => {
    const soon = new Date(Math.ceil((Date.now() + 90 * 60_000) / 900_000) * 900_000)
    const c = await newClient()
    const b = await book(c.id, soon, 'confirmed')
    expect((await msgs(b.id)).map((r) => r.kind)).toEqual(['booking_confirmation'])

    const noPhone = await newClient(null)
    expect(await msgs((await book(noPhone.id, at('20:00'), 'confirmed')).id)).toEqual([])

    await tx((db) => setAutomation(db, ids.tenant!, 'bookingMessages', false))
    const off = await newClient()
    expect(await msgs((await book(off.id, at('21:00'), 'confirmed')).id)).toEqual([])
    await tx((db) => setAutomation(db, ids.tenant!, 'bookingMessages', true))
  })
})

describe('auto-confirm returning clients (G21)', () => {
  const setRule = (rule: { autoConfirmReturning?: boolean; autoConfirmAfterVisits?: number }) =>
    platform
      .update(tenants)
      .set({ settings: { onlineBooking: rule } })
      .where(eq(tenants.id, ids.tenant!))
  const status = (clientId: string) => tx((db) => selfBookingStatus(db, ids.tenant!, clientId))

  it('stays pending when off (default) or the client has too few completed visits', async () => {
    const c = await newClient()
    const first = await book(c.id, at('10:00'), 'confirmed')
    await tx((db) => setBookingStatus(db, first.id, 'completed'))
    expect(await status(c.id)).toBe('pending') // setting off
    await setRule({ autoConfirmReturning: true, autoConfirmAfterVisits: 2 })
    expect(await status(c.id)).toBe('pending') // 1 of 2 visits
    expect(await status((await newClient()).id)).toBe('pending') // new client
  })

  it('confirms a qualifying client and the outbox plans the confirmation + reminders', async () => {
    await setRule({ autoConfirmReturning: true }) // default: after 1 completed visit
    const c = await newClient()
    const first = await book(c.id, at('09:00'), 'confirmed')
    await tx((db) => setBookingStatus(db, first.id, 'completed'))
    expect(await status(c.id)).toBe('confirmed')
    const b = await book(c.id, at('17:00'), await status(c.id), 'online')
    expect(b.status).toBe('confirmed')
    const rows = await byKind(b.id)
    expect(Object.keys(rows).sort()).toEqual(['booking_confirmation', 'reminder', 'reminder_2h'])
    await setRule({})
  })
})

describe('therapist own bookings + earnings (G14)', () => {
  it('a therapist checks in, starts and completes only bookings they are on', async () => {
    const other = await tx(async (db) => {
      const [s] = await db.insert(staff).values({ tenantId: ids.tenant!, displayName: 'Lina' }).returning()
      return s!.id
    })
    const c = await newClient()
    const b = await book(c.id, at('12:00'), 'confirmed')
    const own = (to: OwnStatusTarget, staffId = ids.maya!) =>
      tx((db) => setOwnBookingStatus(db, { bookingId: b.id, staffId, to }))
    await expect(own('checked_in', other)).rejects.toThrow('Booking not found')
    await expect(
      tx((db) =>
        setOwnBookingStatus(db, { bookingId: b.id, staffId: ids.maya!, to: 'cancelled' as OwnStatusTarget }),
      ),
    ).rejects.toThrow('Booking not found')
    expect((await own('checked_in')).status).toBe('checked_in')
    expect((await own('in_service')).status).toBe('in_service')
    expect((await own('completed')).status).toBe('completed')
    // Re-opening a completed booking (commission reversal) stays with the front desk.
    await expect(own('checked_in')).rejects.toThrow(/Can't change a completed booking/)
    const pending = await book(c.id, at('22:30'), 'pending')
    await expect(
      tx((db) => setOwnBookingStatus(db, { bookingId: pending.id, staffId: ids.maya!, to: 'checked_in' })),
    ).rejects.toThrow(/Can't change a pending booking/)
  })

  it('earnings: own commission and tips on paid sales, per range', async () => {
    const c = await newClient()
    const b = await book(c.id, at('14:00'), 'confirmed')
    const [item] = await tx((db) => db.select().from(bookingItems).where(eq(bookingItems.bookingId, b.id)))
    await tx((db) =>
      completeBooking(db, {
        bookingId: b.id,
        amounts: [{ bookingItemId: item!.id, staffId: ids.maya!, amountAed: 40 }],
      }),
    )
    await tx(async (db) => {
      const [paid, voided] = await db
        .insert(sales)
        .values([
          {
            tenantId: ids.tenant!,
            branchId: ids.branch!,
            number: 901,
            businessDate: D,
            subtotalAed: '0',
            totalAed: '0',
            status: 'paid',
          },
          {
            tenantId: ids.tenant!,
            branchId: ids.branch!,
            number: 902,
            businessDate: D,
            subtotalAed: '0',
            totalAed: '0',
            status: 'void',
          },
        ])
        .returning()
      await db.insert(tips).values([
        { tenantId: ids.tenant!, saleId: paid!.id, staffId: ids.maya!, amountAed: '25', method: 'cash' },
        { tenantId: ids.tenant!, saleId: voided!.id, staffId: ids.maya!, amountAed: '99', method: 'cash' },
      ])
    })
    const e = await tx((db) =>
      staffEarnings(db, ids.maya!, {
        day: { from: D, to: D },
        before: { from: '2000-01-01', to: '2000-01-02' },
      }),
    )
    expect(e.day).toEqual({ commissionAed: 40, tipsAed: 25 })
    expect(e.before).toEqual({ commissionAed: 0, tipsAed: 0 })
  })
})

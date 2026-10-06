import { dubaiInstant } from '@spa/core'
import {
  branches,
  clients,
  closeAllDbs,
  reservations,
  rooms,
  services,
  serviceVariants,
  shifts,
  staff,
  staffServices,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  availableSlots,
  createBooking,
  DomainError,
  rescheduleItem,
  rotationFor,
  setBookingStatus,
  takeTurn,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06'
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return dubaiInstant(D, h! * 60 + m!)
}
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'calm', name: 'Calm Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({
        tenantId: ids.tenant!,
        name: 'Marina',
        isDefault: true,
        openingHours: { tue: [{ open: '10:00', close: '22:00' }] },
      })
      .returning()
    ids.branch = b!.id
    const [s] = await db
      .insert(services)
      .values({ tenantId: ids.tenant!, name: { en: 'Swedish massage' }, bufferAfterMin: 15 })
      .returning()
    const [c] = await db
      .insert(services)
      .values({
        tenantId: ids.tenant!,
        name: { en: 'Couples massage' },
        therapistsRequired: 2,
        roomTypes: ['couple'],
      })
      .returning()
    ids.service = s!.id
    ids.couples = c!.id
    const [v] = await db
      .insert(serviceVariants)
      .values({ tenantId: ids.tenant!, serviceId: s!.id, durationMin: 60, priceAed: '350' })
      .returning()
    const [cv] = await db
      .insert(serviceVariants)
      .values({ tenantId: ids.tenant!, serviceId: c!.id, durationMin: 60, priceAed: '650' })
      .returning()
    ids.variant = v!.id
    ids.couplesVariant = cv!.id
    const people = await db
      .insert(staff)
      .values([
        { tenantId: ids.tenant!, displayName: 'Maya', sort: 1 },
        { tenantId: ids.tenant!, displayName: 'Ploy', sort: 2 },
      ])
      .returning()
    ids.maya = people[0]!.id
    ids.ploy = people[1]!.id
    for (const p of people) {
      await db.insert(staffServices).values([
        { tenantId: ids.tenant!, staffId: p.id, serviceId: s!.id },
        { tenantId: ids.tenant!, staffId: p.id, serviceId: c!.id },
      ])
      await db.insert(shifts).values({
        tenantId: ids.tenant!,
        staffId: p.id,
        branchId: b!.id,
        startsAt: at('10:00'),
        endsAt: at('22:00'),
      })
    }
    const rs = await db
      .insert(rooms)
      .values([
        { tenantId: ids.tenant!, branchId: b!.id, name: 'Room 1', type: 'single' },
        { tenantId: ids.tenant!, branchId: b!.id, name: 'Suite', type: 'couple' },
      ])
      .returning()
    ids.room1 = rs[0]!.id
    ids.suite = rs[1]!.id
    const [cl] = await db
      .insert(clients)
      .values({ tenantId: ids.tenant!, name: 'Fatima', phoneE164: '971501234567' })
      .returning()
    ids.client = cl!.id
  })
})
afterAll(closeAllDbs)

describe('booking service', () => {
  it('lists slots and books, assigning a therapist and room automatically', async () => {
    const slots = await tx((db) =>
      availableSlots(db, { branchId: ids.branch!, date: D, serviceVariantId: ids.variant!, stepMin: 60 }),
    )
    expect(slots[0]!.start.getTime()).toBe(at('10:00').getTime())
    const b = await tx((db) =>
      createBooking(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        clientId: ids.client,
        source: 'online',
        items: [{ serviceVariantId: ids.variant!, start: at('10:00') }],
      }),
    )
    expect(b.refCode).toMatch(/^[A-Z2-9]{5}$/)
    expect(b.businessDate).toBe(D)
    const held = await tx((db) => db.select().from(reservations))
    expect(held.map((r) => r.resourceKind).sort()).toEqual(['room', 'staff'])
  })

  it('never double-books the same therapist (database constraint)', async () => {
    const b = () =>
      tx((db) =>
        createBooking(db, {
          tenantId: ids.tenant!,
          branchId: ids.branch!,
          source: 'walk_in',
          items: [
            { serviceVariantId: ids.variant!, start: at('14:00'), staffIds: [ids.maya!], roomId: ids.room1! },
          ],
        }),
      )
    await b()
    await expect(b()).rejects.toMatchObject({ code: 'slot_taken' })
    // the 10-minute later start still overlaps the 15-minute cleanup buffer
    await expect(
      tx((db) =>
        createBooking(db, {
          tenantId: ids.tenant!,
          branchId: ids.branch!,
          source: 'walk_in',
          items: [
            { serviceVariantId: ids.variant!, start: at('15:10'), staffIds: [ids.maya!], roomId: ids.suite! },
          ],
        }),
      ),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('books couples treatments with two therapists in a couples room', async () => {
    const b = await tx((db) =>
      createBooking(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        source: 'phone',
        items: [{ serviceVariantId: ids.couplesVariant!, start: at('18:00') }],
      }),
    )
    const held = await tx((db) => db.select().from(reservations))
    const mine = held.filter((r) => r.period.includes('14:00:00'))
    expect(mine.filter((r) => r.resourceKind === 'staff')).toHaveLength(2)
    expect(mine.find((r) => r.resourceKind === 'room')?.resourceId).toBe(ids.suite)
    expect(b.status).toBe('pending')
  })

  it('cancelling releases the time; no-shows are counted', async () => {
    const b = await tx((db) =>
      createBooking(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        clientId: ids.client,
        source: 'online',
        items: [{ serviceVariantId: ids.variant!, start: at('20:00'), staffIds: [ids.ploy!] }],
      }),
    )
    await tx((db) => setBookingStatus(db, b.id, 'cancelled', 'client asked'))
    const again = await tx((db) =>
      createBooking(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        clientId: ids.client,
        source: 'online',
        items: [{ serviceVariantId: ids.variant!, start: at('20:00'), staffIds: [ids.ploy!] }],
      }),
    )
    await tx((db) => setBookingStatus(db, again.id, 'no_show'))
    const [c] = await tx((db) => db.select().from(clients).where(eq(clients.id, ids.client!)))
    expect(c!.noShowCount).toBe(1)
    await expect(tx((db) => setBookingStatus(db, again.id, 'completed'))).rejects.toBeInstanceOf(DomainError)
  })

  it('reschedules atomically', async () => {
    const b = await tx((db) =>
      createBooking(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        source: 'phone',
        items: [
          { serviceVariantId: ids.variant!, start: at('12:00'), staffIds: [ids.ploy!], roomId: ids.room1! },
        ],
      }),
    )
    const [item] = await tx((db) =>
      db.query.bookingItems.findMany({ where: (bi, { eq }) => eq(bi.bookingId, b.id) }),
    )
    // moving onto Maya's 14:00 booking fails and leaves the original untouched
    await expect(
      tx((db) => rescheduleItem(db, item!.id, { start: at('14:00'), staffIds: [ids.maya!] })),
    ).rejects.toMatchObject({ code: 'slot_taken' })
    await tx((db) => rescheduleItem(db, item!.id, { start: at('16:30') }))
    const [moved] = await tx((db) =>
      db.query.bookingItems.findMany({ where: (bi, { eq }) => eq(bi.id, item!.id) }),
    )
    expect(moved!.startsAt.getTime()).toBe(at('16:30').getTime())
  })

  it('rotates walk-in turns', async () => {
    const first = await tx((db) => rotationFor(db, ids.tenant!, ids.branch!, D))
    expect(first.map((r) => r.staffId)).toEqual([ids.maya, ids.ploy])
    await tx((db) => takeTurn(db, ids.branch!, D, ids.maya!))
    const next = await tx((db) => rotationFor(db, ids.tenant!, ids.branch!, D))
    expect(next.map((r) => r.staffId)).toEqual([ids.ploy, ids.maya])
  })
})

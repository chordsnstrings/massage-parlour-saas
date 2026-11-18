// B5.3 equipment as a bookable resource + B5.4 time clock, leave and payroll (PLAN §14.7).
import { dubaiInstant } from '@spa/core'
import {
  branches,
  closeAllDbs,
  equipment,
  reservations,
  rooms,
  services,
  serviceVariants,
  shifts,
  staff,
  staffServices,
  tenants,
  timeEntries,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  adjustTimeEntry,
  availableSlots,
  buildPayroll,
  cancelLeave,
  createBooking,
  DomainError,
  decideLeave,
  deleteEquipment,
  equipmentStatus,
  punch,
  requestLeave,
  rescheduleItem,
  saveEquipment,
  setStaffPin,
  timesheet,
  verifyPin,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06' // Tuesday
const at = (hhmm: string, date = D) => {
  const [h, m] = hhmm.split(':').map(Number)
  return dubaiInstant(date, h! * 60 + m!)
}
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'stone', name: 'Stone Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Marina', isDefault: true })
      .returning()
    ids.branch = b!.id
    const [s] = await db
      .insert(services)
      .values({
        tenantId: ids.tenant!,
        name: { en: 'Hot stone' },
        bufferAfterMin: 0,
        equipmentTypes: ['Stones'],
      })
      .returning()
    ids.service = s!.id
    const [v] = await db
      .insert(serviceVariants)
      .values({ tenantId: ids.tenant!, serviceId: s!.id, durationMin: 60, priceAed: '400' })
      .returning()
    ids.variant = v!.id
    const people = await db
      .insert(staff)
      .values([
        { tenantId: ids.tenant!, displayName: 'Maya', payType: 'salary', baseSalaryAed: '3100' },
        { tenantId: ids.tenant!, displayName: 'Ploy' },
        { tenantId: ids.tenant!, displayName: 'Nok' },
      ])
      .returning()
    ;[ids.maya, ids.ploy, ids.nok] = people.map((p) => p.id)
    for (const p of people) {
      await db.insert(staffServices).values({ tenantId: ids.tenant!, staffId: p.id, serviceId: s!.id })
      for (const d of [D, '2026-10-07'])
        await db.insert(shifts).values({
          tenantId: ids.tenant!,
          staffId: p.id,
          branchId: b!.id,
          startsAt: at('10:00', d),
          endsAt: at('22:00', d),
        })
    }
    const rs = await db
      .insert(rooms)
      .values([1, 2, 3].map((n) => ({ tenantId: ids.tenant!, branchId: b!.id, name: `Room ${n}` })))
      .returning()
    ;[ids.r1, ids.r2, ids.r3] = rs.map((r) => r.id)
  })
})
afterAll(closeAllDbs)

describe('equipment (B5.3)', () => {
  it('without a unit of the required type, no slot is offered and booking fails', async () => {
    const slots = await tx((db) =>
      availableSlots(db, { branchId: ids.branch!, date: D, serviceVariantId: ids.variant!, stepMin: 60 }),
    )
    expect(slots).toEqual([])
    await expect(
      tx((db) =>
        createBooking(db, {
          tenantId: ids.tenant!,
          branchId: ids.branch!,
          source: 'phone',
          items: [{ serviceVariantId: ids.variant!, start: at('10:00') }],
        }),
      ),
    ).rejects.toMatchObject({ code: 'no_equipment' })
  })

  it('reserves the unit like a room; concurrent bookings of the last unit cannot double-book', async () => {
    const kit = await tx((db) =>
      saveEquipment(db, ids.tenant!, {
        branchId: ids.branch!,
        name: 'Kit A',
        type: ' Stones ',
        active: true,
      }),
    )
    ids.kitA = kit.id
    expect(kit.type).toBe('Stones')
    const slots = await tx((db) =>
      availableSlots(db, { branchId: ids.branch!, date: D, serviceVariantId: ids.variant!, stepMin: 60 }),
    )
    expect(slots[0]!.equipmentIds).toEqual([kit.id])
    // Different therapist + room each: only the single kit is contended.
    const book = (staffId: string, roomId: string) =>
      tx((db) =>
        createBooking(db, {
          tenantId: ids.tenant!,
          branchId: ids.branch!,
          source: 'phone',
          items: [{ serviceVariantId: ids.variant!, start: at('12:00'), staffIds: [staffId], roomId }],
        }),
      )
    const results = await Promise.allSettled([
      book(ids.maya!, ids.r1!),
      book(ids.ploy!, ids.r2!),
      book(ids.nok!, ids.r3!),
    ])
    const won = results.filter((r) => r.status === 'fulfilled')
    expect(won).toHaveLength(1)
    for (const r of results.filter((r) => r.status === 'rejected'))
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(DomainError)
    const held = await tx((db) =>
      db.select().from(reservations).where(eq(reservations.resourceKind, 'equipment')),
    )
    expect(held).toHaveLength(1)
    expect(held[0]!.resourceId).toBe(kit.id)
    // The 12:00 slot is gone for everyone; 13:00 is free again.
    const after = await tx((db) =>
      availableSlots(db, { branchId: ids.branch!, date: D, serviceVariantId: ids.variant!, stepMin: 60 }),
    )
    expect(after.map((s) => s.start.getTime())).not.toContain(at('12:00').getTime())
    expect(after.map((s) => s.start.getTime())).toContain(at('13:00').getTime())
    ids.stoneBooking = (won[0] as PromiseFulfilledResult<{ id: string }>).value.id
  })

  it('reschedule re-reserves the unit and rejects a clash; delete is refused while booked', async () => {
    const [item] = await tx((db) =>
      db.query.bookingItems.findMany({ where: (b, { eq }) => eq(b.bookingId, ids.stoneBooking!) }),
    )
    const other = await tx((db) =>
      createBooking(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        source: 'phone',
        items: [{ serviceVariantId: ids.variant!, start: at('15:00') }],
      }),
    )
    expect(other.id).toBeTruthy()
    await expect(tx((db) => rescheduleItem(db, item!.id, { start: at('15:30') }))).rejects.toMatchObject({
      code: 'no_equipment',
    })
    await tx((db) => rescheduleItem(db, item!.id, { start: at('17:00') }))
    const held = await tx((db) =>
      db.select().from(reservations).where(eq(reservations.bookingItemId, item!.id)),
    )
    expect(held.filter((h) => h.resourceKind === 'equipment').map((h) => h.resourceId)).toEqual([ids.kitA])
    await expect(tx((db) => deleteEquipment(db, ids.kitA!, at('09:00')))).rejects.toThrow(/upcoming bookings/)
  })

  it('flags items whose required equipment is not covered (conflict on the calendar)', async () => {
    const [item] = await tx((db) =>
      db.query.bookingItems.findMany({ where: (b, { eq }) => eq(b.bookingId, ids.stoneBooking!) }),
    )
    await tx((db) => db.update(equipment).set({ active: false }).where(eq(equipment.id, ids.kitA!)))
    const st = await tx((db) => equipmentStatus(db, [item!]))
    expect(st.get(item!.id)).toEqual({ names: ['Kit A'], missing: ['Stones'] })
    await tx((db) => db.update(equipment).set({ active: true }).where(eq(equipment.id, ids.kitA!)))
    expect((await tx((db) => equipmentStatus(db, [item!]))).get(item!.id)?.missing).toEqual([])
  })
})

describe('time clock (B5.4)', () => {
  it('hashes PINs, clocks in/out and locks after five wrong PINs', async () => {
    await expect(tx((db) => setStaffPin(db, ids.nok!, '12'))).rejects.toThrow(/4 to 8 digits/)
    await tx((db) => setStaffPin(db, ids.nok!, '2468'))
    const [row] = await tx((db) => db.select().from(staff).where(eq(staff.id, ids.nok!)))
    expect(row!.pinHash).not.toContain('2468')
    expect(verifyPin('2468', row!.pinHash)).toBe(true)
    const p = (pin: string, now: Date) =>
      tx((db) => punch(db, { tenantId: ids.tenant!, branchId: ids.branch!, staffId: ids.nok!, pin, now }))
    expect(await p('2468', at('09:55'))).toMatchObject({ ok: true, action: 'in' })
    expect(await p('2468', at('18:10'))).toMatchObject({ ok: true, action: 'out', workedMin: 495 })
    for (let i = 0; i < 4; i++)
      expect(await p('0000', at('19:00'))).toEqual({ ok: false, reason: 'wrong_pin' })
    expect(await p('0000', at('19:00'))).toMatchObject({ ok: false, reason: 'locked', minutes: 5 })
    expect(await p('2468', at('19:02'))).toMatchObject({ ok: false, reason: 'locked', minutes: 3 })
    expect(await p('2468', at('19:06'))).toMatchObject({ ok: true, action: 'in' })
    // Forgotten clock-out fixed by a manager; overlapping fixes are refused.
    const entries = await tx((db) => db.select().from(timeEntries).where(eq(timeEntries.staffId, ids.nok!)))
    const second = entries.find((e) => !e.clockOut)!
    await expect(
      tx((db) => adjustTimeEntry(db, second.id, { clockIn: at('18:00'), clockOut: at('20:00') })),
    ).rejects.toThrow(/overlaps/)
    await tx((db) => adjustTimeEntry(db, second.id, { clockIn: at('19:06'), clockOut: at('21:06') }))
    const sheet = await tx((db) => timesheet(db, { branchId: ids.branch!, from: D, to: D, now: at('23:00') }))
    expect(sheet.find((r) => r.staffId === ids.nok)).toMatchObject({
      plannedMin: 720,
      workedMin: 495 + 120,
      open: false,
    })
  })

  it('two kiosks punching at once create one open entry', async () => {
    await tx((db) => setStaffPin(db, ids.ploy!, '1357'))
    const now = at('10:00', '2026-10-07')
    const r = await Promise.allSettled(
      [0, 1].map(() =>
        tx((db) =>
          punch(db, { tenantId: ids.tenant!, branchId: ids.branch!, staffId: ids.ploy!, pin: '1357', now }),
        ),
      ),
    )
    // The staff row lock serialises them: one clocks in, the double tap is refused (not a clock-out).
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1)
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(
      DomainError,
    )
    const rows = await tx((db) => db.select().from(timeEntries).where(eq(timeEntries.staffId, ids.ploy!)))
    expect(rows).toHaveLength(1)
    expect(rows[0]!.clockOut).toBeNull()
  })
})

describe('leave (B5.4)', () => {
  it('approved leave blocks slots and explicit bookings; pending does not', async () => {
    const date = '2026-10-07'
    const slotsFor = () =>
      tx((db) =>
        availableSlots(db, { branchId: ids.branch!, date, serviceVariantId: ids.variant!, stepMin: 60 }),
      )
    expect((await slotsFor())[0]!.staffIds).toContain(ids.maya)
    const req = await tx((db) =>
      requestLeave(db, {
        tenantId: ids.tenant!,
        staffId: ids.maya!,
        type: 'annual',
        startDate: date,
        endDate: date,
      }),
    )
    await expect(
      tx((db) =>
        requestLeave(db, {
          tenantId: ids.tenant!,
          staffId: ids.maya!,
          type: 'sick',
          startDate: date,
          endDate: date,
        }),
      ),
    ).rejects.toThrow(/overlap another leave/)
    expect((await slotsFor())[0]!.staffIds).toContain(ids.maya)
    const decided = await tx((db) => decideLeave(db, { id: req.id, status: 'approved' }))
    expect(decided.clashes).toBe(0)
    await expect(tx((db) => decideLeave(db, { id: req.id, status: 'rejected' }))).rejects.toThrow(
      /already decided/,
    )
    for (const s of await slotsFor()) expect(s.staffIds).not.toContain(ids.maya)
    await expect(
      tx((db) =>
        createBooking(db, {
          tenantId: ids.tenant!,
          branchId: ids.branch!,
          source: 'phone',
          allowOffShift: true,
          items: [{ serviceVariantId: ids.variant!, start: at('14:00', date), staffIds: [ids.maya!] }],
        }),
      ),
    ).rejects.toThrow(/on leave/)
    // An approved request can be withdrawn by a manager before it starts.
    await tx((db) => cancelLeave(db, req.id, { allowApproved: true, today: D }))
    expect((await slotsFor())[0]!.staffIds).toContain(ids.maya)
  })

  it('payroll deducts unpaid leave days from salaried staff and shows worked hours', async () => {
    const req = await tx((db) =>
      requestLeave(db, {
        tenantId: ids.tenant!,
        staffId: ids.maya!,
        type: 'unpaid',
        startDate: '2026-10-30',
        endDate: '2026-11-02', // 2 days fall in October
      }),
    )
    await tx((db) => decideLeave(db, { id: req.id, status: 'approved' }))
    await tx((db) =>
      db.insert(timeEntries).values({
        tenantId: ids.tenant!,
        staffId: ids.maya!,
        branchId: ids.branch!,
        clockIn: at('10:00'),
        clockOut: at('18:30'),
        businessDate: D,
      }),
    )
    const run = await tx((db) =>
      buildPayroll(db, { tenantId: ids.tenant!, periodStart: '2026-10-01', periodEnd: '2026-10-31' }),
    )
    const lines = await tx((db) =>
      db.query.payrollLines.findMany({ where: (l, { eq }) => eq(l.runId, run.id) }),
    )
    const maya = lines.find((l) => l.staffId === ids.maya)!
    expect(maya).toMatchObject({
      baseAed: '3100.00',
      deductionsAed: '200.00', // 3100 / 31 × 2
      unpaidLeaveDays: 2,
      workedMinutes: 510,
      netAed: '2900.00',
    })
  })
})

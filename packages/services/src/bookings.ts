import {
  businessDateOf,
  businessDayWindow,
  canTransition,
  type EquipmentAvailability,
  findSlots,
  holdInterval,
  type Interval,
  newRefCode,
  type OpeningHours,
  onLeave,
  overlaps,
  pickEquipment,
  pickStaff,
  type RoomAvailability,
  type Slot,
  type StaffAvailability,
  toRange,
} from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  clients,
  equipment,
  leaveRequests,
  reservations,
  rooms,
  rotationEntries,
  sales,
  services,
  serviceVariants,
  shifts,
  staff,
  staffServices,
  type Tx,
  tenants,
} from '@spa/db'
import { and, asc, eq, gt, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm'
import {
  type CommissionInput,
  recordBookingCommissions,
  reverseBookingCommissions,
} from './booking-commissions'
import { DomainError, pgCode, pgConstraint } from './errors'
import { consumeForBooking } from './inventory'
import { planBookingMessages } from './outbox'
import { notifyWaitlistForFreedSlot } from './waitlist'

const DAY = 24 * 3600_000

export type DayContext = {
  branch: typeof branches.$inferSelect
  date: string
  window: Interval
  staff: (StaffAvailability & { name: string; color: string })[]
  rooms: (RoomAvailability & { name: string })[]
  equipment: (EquipmentAvailability & { name: string })[]
}

/** Approved leave as instants: [first date's cutoff, day after the last date's cutoff), per staff id. */
export async function approvedLeave(
  tx: Tx,
  staffIds: string[],
  fromDate: string,
  toDate: string,
  cutoff = '05:00',
) {
  const out = new Map<string, Interval[]>()
  if (!staffIds.length) return out
  const rows = await tx
    .select()
    .from(leaveRequests)
    .where(
      and(
        inArray(leaveRequests.staffId, staffIds),
        eq(leaveRequests.status, 'approved'),
        lte(leaveRequests.startDate, toDate),
        gte(leaveRequests.endDate, fromDate),
      ),
    )
  for (const r of rows)
    out.set(r.staffId, [
      ...(out.get(r.staffId) ?? []),
      { start: businessDayWindow(r.startDate, cutoff).start, end: businessDayWindow(r.endDate, cutoff).end },
    ])
  return out
}

/** Everything needed to compute availability for one branch and business date. */
export async function loadDay(tx: Tx, branchId: string, date: string): Promise<DayContext> {
  const [branch] = await tx.select().from(branches).where(eq(branches.id, branchId))
  if (!branch) throw new DomainError('Branch not found', 'not_found')
  const cutoff = branch.businessDayCutoff.slice(0, 5)
  const window = businessDayWindow(date, cutoff)
  const from = new Date(window.start.getTime() - DAY)
  const to = new Date(window.end.getTime() + DAY)
  const staffRows = (
    await tx
      .select()
      .from(staff)
      .where(and(eq(staff.active, true), eq(staff.bookable, true)))
      .orderBy(asc(staff.sort), asc(staff.displayName))
  ).filter((s) => s.branchIds.length === 0 || s.branchIds.includes(branchId))
  const ids = staffRows.map((s) => s.id)
  const skills = ids.length
    ? await tx.select().from(staffServices).where(inArray(staffServices.staffId, ids))
    : []
  const shiftRows = ids.length
    ? await tx
        .select()
        .from(shifts)
        .where(
          and(
            inArray(shifts.staffId, ids),
            eq(shifts.branchId, branchId),
            lt(shifts.startsAt, to),
            gt(shifts.endsAt, from),
          ),
        )
    : []
  const roomRows = await tx
    .select()
    .from(rooms)
    .where(and(eq(rooms.branchId, branchId), eq(rooms.active, true)))
    .orderBy(asc(rooms.sort), asc(rooms.name))
  const equipmentRows = await tx
    .select()
    .from(equipment)
    .where(and(eq(equipment.branchId, branchId), eq(equipment.active, true)))
    .orderBy(asc(equipment.sort), asc(equipment.name))
  const leave = await approvedLeave(tx, ids, addDay(date, -1), addDay(date, 1), cutoff)
  const held = await tx
    .select({
      kind: reservations.resourceKind,
      resourceId: reservations.resourceId,
      start: sql<Date>`lower(${reservations.period})`,
      end: sql<Date>`upper(${reservations.period})`,
    })
    .from(reservations)
    .where(
      sql`${reservations.period} && tstzrange(${from.toISOString()}::timestamptz, ${to.toISOString()}::timestamptz)`,
    )
  const busyOf = (kind: 'staff' | 'room' | 'equipment', id: string) =>
    held
      .filter((h) => h.kind === kind && h.resourceId === id)
      .map((h) => ({ start: new Date(h.start), end: new Date(h.end) }))
  return {
    branch,
    date,
    window,
    staff: staffRows.map((s) => ({
      id: s.id,
      name: s.displayName,
      color: s.color,
      skills: skills.filter((k) => k.staffId === s.id).map((k) => k.serviceId),
      shifts: shiftRows
        .filter((sh) => sh.staffId === s.id)
        .map((sh) => ({ start: sh.startsAt, end: sh.endsAt })),
      busy: busyOf('staff', s.id),
      leave: leave.get(s.id) ?? [],
    })),
    rooms: roomRows.map((r) => ({ id: r.id, name: r.name, type: r.type, busy: busyOf('room', r.id) })),
    equipment: equipmentRows.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      busy: busyOf('equipment', e.id),
    })),
  }
}

const addDay = (date: string, days: number) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const NO_EQUIPMENT = 'The equipment this treatment needs is not free at that time'
const ON_LEAVE = 'A chosen therapist is on leave at that time'

async function loadVariant(tx: Tx, variantId: string) {
  const [row] = await tx
    .select({ variant: serviceVariants, service: services })
    .from(serviceVariants)
    .innerJoin(services, eq(services.id, serviceVariants.serviceId))
    .where(eq(serviceVariants.id, variantId))
  if (!row) throw new DomainError('Service not found', 'not_found')
  return row
}

export async function availableSlots(
  tx: Tx,
  q: {
    branchId: string
    date: string
    serviceVariantId: string
    preferredStaffIds?: string[]
    notBefore?: Date
    stepMin?: number
  },
): Promise<Slot[]> {
  const day = await loadDay(tx, q.branchId, q.date)
  const { variant, service } = await loadVariant(tx, q.serviceVariantId)
  return findSlots({
    date: q.date,
    cutoff: day.branch.businessDayCutoff.slice(0, 5),
    hours: day.branch.openingHours as OpeningHours,
    serviceId: service.id,
    durationMin: variant.durationMin,
    bufferBeforeMin: service.bufferBeforeMin,
    bufferAfterMin: service.bufferAfterMin,
    therapistsRequired: service.therapistsRequired,
    roomTypes: service.roomTypes,
    staff: day.staff,
    rooms: day.rooms,
    equipmentTypes: service.equipmentTypes,
    equipment: day.equipment,
    preferredStaffIds: q.preferredStaffIds,
    notBefore: q.notBefore,
    stepMin: q.stepMin,
  })
}

export type NewBookingItem = { serviceVariantId: string; start: Date; staffIds?: string[]; roomId?: string }
export type NewBooking = {
  tenantId: string
  branchId: string
  clientId?: string | null
  source: (typeof bookings.$inferInsert)['source']
  status?: (typeof bookings.$inferInsert)['status']
  notes?: string | null
  createdBy?: string | null
  items: NewBookingItem[]
  /** Reception may book outside shifts/hours; overlaps are still impossible (DB constraint). */
  allowOffShift?: boolean
}

/**
 * Creates a booking and reserves therapists + room for each item (hold = service + buffers).
 * Overlaps are rejected by the reservations EXCLUDE constraint, so concurrent requests can't double-book.
 */
export async function createBooking(tx: Tx, input: NewBooking) {
  if (!input.items.length) throw new DomainError('Add at least one service')
  const [branch] = await tx.select().from(branches).where(eq(branches.id, input.branchId))
  if (!branch) throw new DomainError('Branch not found', 'not_found')
  const cutoff = branch.businessDayCutoff.slice(0, 5)
  const prepared: {
    item: NewBookingItem
    name: string
    duration: number
    price: string | null
    hold: Interval
    staffIds: string[]
    roomId: string
    equipmentIds: string[]
  }[] = []
  const days = new Map<string, DayContext>()
  for (const item of input.items) {
    const { variant, service } = await loadVariant(tx, item.serviceVariantId)
    const date = businessDateOf(item.start, cutoff)
    if (!days.has(date)) days.set(date, await loadDay(tx, input.branchId, date))
    const day = days.get(date)!
    const hold = holdInterval(
      item.start,
      variant.durationMin,
      service.bufferBeforeMin,
      service.bufferAfterMin,
    )
    const need = service.therapistsRequired
    let staffIds = item.staffIds?.filter(Boolean) ?? []
    let roomId = item.roomId
    if (staffIds.some((id) => day.staff.find((s) => s.id === id && onLeave(s, hold))))
      throw new DomainError(ON_LEAVE, 'no_staff')
    if (staffIds.length < need || !roomId) {
      const slot = findSlots({
        date,
        cutoff,
        hours: input.allowOffShift
          ? { [dayKey(item.start)]: [{ open: '00:00', close: '23:59' }] }
          : (branch.openingHours as OpeningHours),
        serviceId: service.id,
        durationMin: variant.durationMin,
        bufferBeforeMin: service.bufferBeforeMin,
        bufferAfterMin: service.bufferAfterMin,
        therapistsRequired: need,
        roomTypes: service.roomTypes,
        staff: input.allowOffShift ? day.staff.map((s) => ({ ...s, shifts: [day.window] })) : day.staff,
        rooms: day.rooms,
        stepMin: 1,
      }).find((s) => s.start.getTime() === item.start.getTime())
      if (staffIds.length < need) {
        const pool = (slot?.staffIds ?? []).filter((id) => !staffIds.includes(id))
        if (staffIds.length + pool.length < need)
          throw new DomainError('No therapist is free at that time', 'no_staff')
        staffIds = [...staffIds, ...pickStaff(pool, need - staffIds.length)]
      }
      if (!roomId) {
        roomId =
          slot?.roomIds[0] ??
          day.rooms.find((r) => !r.busy.some((b) => b.start < hold.end && hold.start < b.end))?.id
        if (!roomId) throw new DomainError('No room is free at that time', 'no_room')
      }
    }
    // Units already taken by earlier items of this booking count as busy (the DB would reject them anyway).
    const units = day.equipment.map((u) => ({
      ...u,
      busy: [...u.busy, ...prepared.filter((p) => p.equipmentIds.includes(u.id)).map((p) => p.hold)],
    }))
    const equipmentIds = pickEquipment(units, service.equipmentTypes, hold)
    if (!equipmentIds) throw new DomainError(NO_EQUIPMENT, 'no_equipment')
    prepared.push({
      item,
      name: service.name.en,
      duration: variant.durationMin,
      price: variant.priceAed,
      hold,
      staffIds,
      roomId,
      equipmentIds,
    })
  }
  const startsAt = new Date(Math.min(...prepared.map((p) => p.item.start.getTime())))
  const endsAt = new Date(Math.max(...prepared.map((p) => p.item.start.getTime() + p.duration * 60_000)))
  // The unique `bookings_tenant_ref` index decides; a taken code (even by a concurrent insert) just retries.
  for (let attempt = 1; ; attempt++) {
    const refCode = newRefCode()
    try {
      return await tx.transaction(async (sp) => {
        const [booking] = await sp
          .insert(bookings)
          .values({
            tenantId: input.tenantId,
            branchId: input.branchId,
            clientId: input.clientId ?? null,
            refCode,
            source: input.source,
            status: input.status ?? 'pending',
            businessDate: businessDateOf(startsAt, cutoff),
            startsAt,
            endsAt,
            notes: input.notes ?? null,
            createdBy: input.createdBy ?? null,
          })
          .returning()
        for (const p of prepared) {
          const [row] = await sp
            .insert(bookingItems)
            .values({
              tenantId: input.tenantId,
              bookingId: booking!.id,
              serviceVariantId: p.item.serviceVariantId,
              serviceName: p.name,
              durationMin: p.duration,
              priceAed: p.price,
              startsAt: p.item.start,
              endsAt: new Date(p.item.start.getTime() + p.duration * 60_000),
              roomId: p.roomId,
              staffIds: p.staffIds,
              equipmentIds: p.equipmentIds,
            })
            .returning({ id: bookingItems.id })
          await sp.insert(reservations).values([
            ...p.staffIds.map((sid) => ({
              tenantId: input.tenantId,
              bookingItemId: row!.id,
              resourceKind: 'staff' as const,
              resourceId: sid,
              period: toRange(p.hold),
            })),
            {
              tenantId: input.tenantId,
              bookingItemId: row!.id,
              resourceKind: 'room' as const,
              resourceId: p.roomId,
              period: toRange(p.hold),
            },
            ...p.equipmentIds.map((eid) => ({
              tenantId: input.tenantId,
              bookingItemId: row!.id,
              resourceKind: 'equipment' as const,
              resourceId: eid,
              period: toRange(p.hold),
            })),
          ])
        }
        // Confirmed on creation (staff, waitlist, walk-in): confirmation + reminders go to the outbox (G4).
        if (booking!.status === 'confirmed') await planBookingMessages(sp, booking!.id)
        return booking!
      })
    } catch (e) {
      if (pgCode(e) === '23P01')
        throw new DomainError('That time was just taken — please pick another slot', 'slot_taken')
      if (pgCode(e) === '23505' && pgConstraint(e) === 'bookings_tenant_ref') {
        if (attempt < 5) continue
        throw new DomainError('Could not allocate a booking reference — please try again', 'invalid')
      }
      throw e
    }
  }
}

const dayKey = (d: Date) =>
  (['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const)[
    new Date(d.getTime() + 4 * 3600_000).getUTCDay()
  ]!

/**
 * Free units for a hold (the item being moved doesn't block itself); keeps its current units when they are
 * still free. Throws when a required type has no free unit.
 */
async function equipmentFor(
  tx: Tx,
  q: { branchId: string; types: string[]; hold: Interval; exceptItemId: string; prefer: string[] },
) {
  if (!q.types.length) return []
  const units = await tx
    .select()
    .from(equipment)
    .where(
      and(
        eq(equipment.branchId, q.branchId),
        eq(equipment.active, true),
        inArray(equipment.type, [...new Set(q.types)]),
      ),
    )
    .orderBy(asc(equipment.sort), asc(equipment.name))
  const held = units.length
    ? await tx
        .select({ id: reservations.resourceId })
        .from(reservations)
        .where(
          and(
            eq(reservations.resourceKind, 'equipment'),
            inArray(
              reservations.resourceId,
              units.map((u) => u.id),
            ),
            ne(reservations.bookingItemId, q.exceptItemId),
            sql`${reservations.period} && ${toRange(q.hold)}::tstzrange`,
          ),
        )
    : []
  const busy = new Set(held.map((h) => h.id))
  const ordered = [
    ...units.filter((u) => q.prefer.includes(u.id)),
    ...units.filter((u) => !q.prefer.includes(u.id)),
  ]
  const picked = pickEquipment(
    ordered.map((u) => ({ id: u.id, type: u.type, busy: busy.has(u.id) ? [q.hold] : [] })),
    q.types,
    q.hold,
  )
  if (!picked) throw new DomainError(NO_EQUIPMENT, 'no_equipment')
  return picked
}

/** Moves one booking item (time / therapists / room), re-reserving atomically. */
export async function rescheduleItem(
  tx: Tx,
  itemId: string,
  to: { start: Date; staffIds?: string[]; roomId?: string },
  opts: { now?: Date; notifyWaitlist?: boolean } = {},
) {
  const [item] = await tx.select().from(bookingItems).where(eq(bookingItems.id, itemId))
  if (!item) throw new DomainError('Booking not found', 'not_found')
  const [booking] = await tx.select().from(bookings).where(eq(bookings.id, item.bookingId))
  if (!booking || booking.status === 'cancelled' || booking.status === 'completed')
    throw new DomainError('This booking can no longer be moved')
  const svc = item.serviceVariantId ? await loadVariant(tx, item.serviceVariantId) : null
  const hold = holdInterval(
    to.start,
    item.durationMin,
    svc?.service.bufferBeforeMin ?? 0,
    svc?.service.bufferAfterMin ?? 0,
  )
  const staffIds = to.staffIds?.length ? to.staffIds : item.staffIds
  const roomId = to.roomId ?? item.roomId
  if (!roomId) throw new DomainError('Choose a room', 'no_room')
  const [branch] = await tx.select().from(branches).where(eq(branches.id, booking.branchId))
  const cutoff = branch?.businessDayCutoff.slice(0, 5)
  const date = businessDateOf(to.start, cutoff)
  const leave = await approvedLeave(tx, staffIds, date, date, cutoff)
  if (staffIds.some((id) => (leave.get(id) ?? []).some((l) => overlaps(l, hold))))
    throw new DomainError(ON_LEAVE, 'no_staff')
  const equipmentIds = await equipmentFor(tx, {
    branchId: booking.branchId,
    types: svc?.service.equipmentTypes ?? [],
    hold,
    exceptItemId: itemId,
    prefer: item.equipmentIds,
  })
  let movedTo = booking.startsAt
  try {
    await tx.transaction(async (sp) => {
      await sp.delete(reservations).where(eq(reservations.bookingItemId, itemId))
      await sp
        .update(bookingItems)
        .set({
          startsAt: to.start,
          endsAt: new Date(to.start.getTime() + item.durationMin * 60_000),
          staffIds,
          roomId,
          equipmentIds,
        })
        .where(eq(bookingItems.id, itemId))
      await sp.insert(reservations).values([
        ...staffIds.map((sid) => ({
          tenantId: item.tenantId,
          bookingItemId: itemId,
          resourceKind: 'staff' as const,
          resourceId: sid,
          period: toRange(hold),
        })),
        {
          tenantId: item.tenantId,
          bookingItemId: itemId,
          resourceKind: 'room' as const,
          resourceId: roomId,
          period: toRange(hold),
        },
        ...equipmentIds.map((eid) => ({
          tenantId: item.tenantId,
          bookingItemId: itemId,
          resourceKind: 'equipment' as const,
          resourceId: eid,
          period: toRange(hold),
        })),
      ])
      const all = await sp.select().from(bookingItems).where(eq(bookingItems.bookingId, item.bookingId))
      const startsAt = new Date(Math.min(...all.map((i) => i.startsAt.getTime())))
      const endsAt = new Date(Math.max(...all.map((i) => i.endsAt.getTime())))
      movedTo = startsAt
      await sp
        .update(bookings)
        .set({
          startsAt,
          endsAt,
          businessDate: businessDateOf(startsAt, branch?.businessDayCutoff.slice(0, 5)),
        })
        .where(eq(bookings.id, item.bookingId))
    })
  } catch (e) {
    if (pgCode(e) === '23P01') throw new DomainError('That time clashes with another booking', 'slot_taken')
    throw e
  }
  // Pending confirmation / reminders follow the booking to its new time (G4).
  if (movedTo.getTime() !== booking.startsAt.getTime())
    await planBookingMessages(tx, item.bookingId, { now: opts.now, rescheduled: true })
  // The old time is free now: offer it to the waitlist (B5.1).
  if (opts.notifyWaitlist !== false && to.start.getTime() !== item.startsAt.getTime())
    await notifyWaitlistForFreedSlot(
      tx,
      {
        tenantId: item.tenantId,
        branchId: booking.branchId,
        businessDate: booking.businessDate,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        serviceIds: svc ? [svc.service.id] : [],
      },
      opts.now,
    )
}

/**
 * Status changes; cancelling or no-show releases the reserved time. Leaving `completed` (re-open or cancel)
 * reverses the booking's therapist commission; a checked-out booking must have its sale voided/refunded first.
 */
export async function setBookingStatus(
  tx: Tx,
  bookingId: string,
  to: (typeof bookings.$inferSelect)['status'],
  reason?: string,
  opts: { userId?: string | null; now?: Date; notifyWaitlist?: boolean } = {},
) {
  const [b] = await tx.select().from(bookings).where(eq(bookings.id, bookingId)).for('update')
  if (!b) throw new DomainError('Booking not found', 'not_found')
  if (b.status === to) return b
  if (!canTransition(b.status, to))
    throw new DomainError(`Can't change a ${b.status.replace('_', ' ')} booking to ${to.replace('_', ' ')}`)
  if (b.status === 'completed') {
    const [paid] = await tx
      .select({ id: sales.id })
      .from(sales)
      .where(and(eq(sales.bookingId, bookingId), eq(sales.status, 'paid')))
    if (paid) throw new DomainError('This booking was checked out — void or refund the sale first')
    await reverseBookingCommissions(tx, b, opts)
  }
  if (to === 'cancelled' || to === 'no_show') {
    const items = await tx
      .select({ id: bookingItems.id, serviceId: serviceVariants.serviceId })
      .from(bookingItems)
      .leftJoin(serviceVariants, eq(serviceVariants.id, bookingItems.serviceVariantId))
      .where(eq(bookingItems.bookingId, bookingId))
    if (items.length)
      await tx.delete(reservations).where(
        inArray(
          reservations.bookingItemId,
          items.map((i) => i.id),
        ),
      )
    // The freed time goes to the waitlist (B5.1) unless the booking had already released it.
    if (opts.notifyWaitlist !== false && b.status !== 'cancelled' && b.status !== 'no_show')
      await notifyWaitlistForFreedSlot(
        tx,
        {
          tenantId: b.tenantId,
          branchId: b.branchId,
          businessDate: b.businessDate,
          startsAt: b.startsAt,
          endsAt: b.endsAt,
          serviceIds: [...new Set(items.map((i) => i.serviceId).filter((x): x is string => Boolean(x)))],
        },
        opts.now,
      )
  }
  if ((b.status === 'cancelled' || b.status === 'no_show') && to === 'confirmed') {
    throw new DomainError('Re-book a cancelled appointment as a new booking so its time is checked again')
  }
  if (to === 'no_show' && b.clientId) {
    await tx
      .update(clients)
      .set({ noShowCount: sql`${clients.noShowCount} + 1` })
      .where(eq(clients.id, b.clientId))
  }
  if (to === 'completed' && b.clientId) {
    await tx
      .update(clients)
      .set({
        lastVisitAt: b.startsAt,
        firstVisitAt: sql`coalesce(${clients.firstVisitAt}, ${b.startsAt.toISOString()}::timestamptz)`,
      })
      .where(eq(clients.id, b.clientId))
  }
  // Oils, towels etc. linked to the treatments are drawn from stock once (idempotent per booking).
  if (to === 'completed')
    await consumeForBooking(tx, {
      tenantId: b.tenantId,
      branchId: b.branchId,
      bookingId,
      date: b.businessDate,
    })
  const [updated] = await tx
    .update(bookings)
    .set({ status: to, cancelReason: to === 'cancelled' ? (reason ?? null) : b.cancelReason })
    .where(eq(bookings.id, bookingId))
    .returning()
  // Confirming (e.g. an online / AI / Instagram request) queues its messages; cancel / no-show / arrival
  // takes the unsent ones out of the outbox (G4).
  await planBookingMessages(tx, bookingId, { now: opts.now })
  return updated!
}

/** What a therapist may do to their own booking (G14): check in, start, complete — never confirm, cancel or move. */
export const OWN_STATUS_TARGETS = ['checked_in', 'in_service', 'completed'] as const
export type OwnStatusTarget = (typeof OWN_STATUS_TARGETS)[number]
const OWN_STATUS_FROM: readonly string[] = ['confirmed', 'checked_in', 'in_service']

/**
 * A therapist moves a booking they are assigned to (any item) along check-in → in service → completed. Someone
 * else's booking reads as not found. Completing records no commission: the front desk enters it on the booking page.
 */
export async function setOwnBookingStatus(
  tx: Tx,
  input: { bookingId: string; staffId: string; to: OwnStatusTarget; userId?: string | null; now?: Date },
) {
  if (!(OWN_STATUS_TARGETS as readonly string[]).includes(input.to))
    throw new DomainError('Booking not found', 'not_found')
  const [b] = await tx
    .select({ status: bookings.status })
    .from(bookings)
    .where(eq(bookings.id, input.bookingId))
  const [mine] = b
    ? await tx
        .select({ id: bookingItems.id })
        .from(bookingItems)
        .where(
          and(
            eq(bookingItems.bookingId, input.bookingId),
            sql`${input.staffId}::uuid = any(${bookingItems.staffIds})`,
          ),
        )
        .limit(1)
    : []
  if (!b || !mine) throw new DomainError('Booking not found', 'not_found')
  if (!OWN_STATUS_FROM.includes(b.status))
    throw new DomainError(
      `Can't change a ${b.status.replace('_', ' ')} booking to ${input.to.replace('_', ' ')}`,
    )
  return setBookingStatus(tx, input.bookingId, input.to, undefined, { userId: input.userId, now: input.now })
}

/**
 * Status for a booking the client made themselves (website, Instagram, AI): `confirmed` when the spa turned on
 * "Auto-confirm returning clients" (G21) and the client has at least N completed visits, else `pending`.
 */
export async function selfBookingStatus(tx: Tx, tenantId: string, clientId: string) {
  const [t] = await tx.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId))
  const rule = t?.s.onlineBooking
  if (!rule?.autoConfirmReturning) return 'pending' as const
  const needed = Math.max(1, rule.autoConfirmAfterVisits ?? 1)
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(and(eq(bookings.clientId, clientId), eq(bookings.status, 'completed')))
  return Number(row?.n ?? 0) >= needed ? ('confirmed' as const) : ('pending' as const)
}

/** Walk-in turn list for a business day; created on first use from therapists on shift. */
export async function rotationFor(tx: Tx, tenantId: string, branchId: string, date: string) {
  const existing = await tx
    .select()
    .from(rotationEntries)
    .where(and(eq(rotationEntries.branchId, branchId), eq(rotationEntries.businessDate, date)))
    .orderBy(asc(rotationEntries.position))
  if (existing.length) return existing
  const day = await loadDay(tx, branchId, date)
  const onShift = day.staff.filter((s) =>
    s.shifts.some((sh) => sh.start < day.window.end && day.window.start < sh.end),
  )
  if (!onShift.length) return []
  await tx
    .insert(rotationEntries)
    .values(onShift.map((s, i) => ({ tenantId, branchId, businessDate: date, staffId: s.id, position: i })))
    .onConflictDoNothing()
  return tx
    .select()
    .from(rotationEntries)
    .where(and(eq(rotationEntries.branchId, branchId), eq(rotationEntries.businessDate, date)))
    .orderBy(asc(rotationEntries.position))
}

/** After a walk-in, the therapist moves to the back of the line. */
export async function takeTurn(tx: Tx, branchId: string, date: string, staffId: string) {
  const [{ max }] = (await tx
    .select({ max: sql<number>`coalesce(max(${rotationEntries.position}), 0)` })
    .from(rotationEntries)
    .where(and(eq(rotationEntries.branchId, branchId), eq(rotationEntries.businessDate, date)))) as [
    { max: number },
  ]
  await tx
    .update(rotationEntries)
    .set({ position: Number(max) + 1, turns: sql`${rotationEntries.turns} + 1` })
    .where(
      and(
        eq(rotationEntries.branchId, branchId),
        eq(rotationEntries.businessDate, date),
        eq(rotationEntries.staffId, staffId),
      ),
    )
}

/** Marks a booking completed and records its therapist commission in the same transaction. */
export async function completeBooking(
  tx: Tx,
  input: { bookingId: string; amounts: CommissionInput[]; userId?: string | null; now?: Date },
) {
  const updated = await setBookingStatus(tx, input.bookingId, 'completed', undefined, input)
  await recordBookingCommissions(tx, input)
  return updated
}

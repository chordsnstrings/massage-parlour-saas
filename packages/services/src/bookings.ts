import {
  businessDateOf,
  businessDayWindow,
  canTransition,
  findSlots,
  holdInterval,
  type Interval,
  newRefCode,
  type OpeningHours,
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
} from '@spa/db'
import { and, asc, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import {
  type CommissionInput,
  recordBookingCommissions,
  reverseBookingCommissions,
} from './booking-commissions'
import { DomainError, pgCode, pgConstraint } from './errors'
import { consumeForBooking } from './inventory'
import { notifyWaitlistForFreedSlot } from './waitlist'

const DAY = 24 * 3600_000

export type DayContext = {
  branch: typeof branches.$inferSelect
  date: string
  window: Interval
  staff: (StaffAvailability & { name: string; color: string })[]
  rooms: (RoomAvailability & { name: string })[]
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
  const busyOf = (kind: 'staff' | 'room', id: string) =>
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
    })),
    rooms: roomRows.map((r) => ({ id: r.id, name: r.name, type: r.type, busy: busyOf('room', r.id) })),
  }
}

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
    prepared.push({
      item,
      name: service.name.en,
      duration: variant.durationMin,
      price: variant.priceAed,
      hold,
      staffIds,
      roomId,
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
          ])
        }
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
      ])
      const all = await sp.select().from(bookingItems).where(eq(bookingItems.bookingId, item.bookingId))
      const [branch] = await sp.select().from(branches).where(eq(branches.id, booking.branchId))
      const startsAt = new Date(Math.min(...all.map((i) => i.startsAt.getTime())))
      const endsAt = new Date(Math.max(...all.map((i) => i.endsAt.getTime())))
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
  return updated!
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

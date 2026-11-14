// R46 (owner 2026-11-03): booking lookups and changes shared by the calendar's Move form and the Ask AI assistant's
// prepared actions (the assistant only prepares; a person confirms in the drawer and the web action runs these).
// No permission checks here, as everywhere in services.
import { dubaiInstant } from '@spa/core'
import { bookingItems, bookings, branches, clients, rooms, services, serviceVariants, type Tx } from '@spa/db'
import { and, asc, eq, sql } from 'drizzle-orm'
import { liveSale } from './booking-order'
import { rescheduleItem } from './bookings'
import { DomainError } from './errors'

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** Start instant from a business date + "HH:MM" (times before the branch cutoff belong to the next calendar day). */
export function businessStart(date: string, hhmm: string, cutoff: string) {
  const min = toMin(hhmm)
  return dubaiInstant(date, min < toMin(cutoff) ? min + 1440 : min)
}

/** A booking by its reference code (case-insensitive) with items, client name and live sale; null = none. */
export async function bookingByRef(tx: Tx, ref: string) {
  const code = ref.trim().toUpperCase()
  if (!/^[A-Z0-9-]{3,20}$/.test(code)) return null
  const [row] = await tx
    .select({ booking: bookings, clientName: clients.name, cutoff: branches.businessDayCutoff })
    .from(bookings)
    .innerJoin(branches, eq(branches.id, bookings.branchId))
    .leftJoin(clients, eq(clients.id, bookings.clientId))
    .where(sql`upper(${bookings.refCode}) = ${code}`)
  if (!row) return null
  const items = await tx
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, row.booking.id))
    .orderBy(asc(bookingItems.startsAt))
  const sale = await liveSale(tx, row.booking.id)
  return {
    ...row.booking,
    clientName: row.clientName,
    cutoff: row.cutoff.slice(0, 5),
    items,
    sale,
  }
}

/**
 * Moves one booking item (time / therapists / room). Without a chosen room, a clash in the current room tries the
 * branch's other active rooms of the right type (the calendar Move form's rule), so a therapist clash still fails.
 */
export async function moveBookingItem(
  tx: Tx,
  i: { itemId: string; start: Date; staffIds?: string[]; roomId?: string },
) {
  try {
    await tx.transaction((sp) => rescheduleItem(sp, i.itemId, i))
    return
  } catch (e) {
    if (!(e instanceof DomainError) || e.code !== 'slot_taken' || i.roomId) throw e
  }
  const [row] = await tx
    .select({ branchId: bookings.branchId, roomId: bookingItems.roomId, types: services.roomTypes })
    .from(bookingItems)
    .innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
    .leftJoin(serviceVariants, eq(serviceVariants.id, bookingItems.serviceVariantId))
    .leftJoin(services, eq(services.id, serviceVariants.serviceId))
    .where(eq(bookingItems.id, i.itemId))
  const types = row?.types ?? []
  const others = row
    ? (
        await tx
          .select({ id: rooms.id, type: rooms.type })
          .from(rooms)
          .where(and(eq(rooms.branchId, row.branchId), eq(rooms.active, true)))
          .orderBy(asc(rooms.sort), asc(rooms.name))
      ).filter((r) => r.id !== row.roomId && (types.length === 0 || types.includes(r.type)))
    : []
  for (const room of others) {
    try {
      await tx.transaction((sp) => rescheduleItem(sp, i.itemId, { ...i, roomId: room.id }))
      return
    } catch (e) {
      if (!(e instanceof DomainError) || e.code !== 'slot_taken') throw e
    }
  }
  throw new DomainError('That time clashes with another booking', 'slot_taken')
}

const DRY = Symbol('dry-run')

/** Runs `fn` in a savepoint and always rolls it back: the checks of a change without the change. */
export async function dryRun(tx: Tx, fn: (sp: Tx) => Promise<unknown>) {
  try {
    await tx.transaction(async (sp) => {
      await fn(sp)
      throw DRY
    })
  } catch (e) {
    if (e !== DRY) throw e
  }
}

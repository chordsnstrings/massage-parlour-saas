// B5.3 — bookable equipment units (PLAN §14.7). Reservation logic lives in bookings.ts.
import { bookingItems, branches, equipment, reservations, services, serviceVariants, type Tx } from '@spa/db'
import { and, count, eq, gt, inArray, sql } from 'drizzle-orm'
import { DomainError } from './errors'

export type EquipmentInput = { branchId: string; name: string; type: string; active: boolean }

/** Creates or updates a unit. Types are typed by the spa and matched case-sensitively after trimming. */
export async function saveEquipment(tx: Tx, tenantId: string, input: EquipmentInput & { id?: string }) {
  const values = { ...input, name: input.name.trim(), type: input.type.trim() }
  if (!values.name || !values.type) throw new DomainError('Give the equipment a name and a type')
  const [branch] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, values.branchId))
  if (!branch) throw new DomainError('Branch not found', 'not_found')
  const { id, ...rest } = values
  if (id) {
    const [row] = await tx.update(equipment).set(rest).where(eq(equipment.id, id)).returning()
    if (!row) throw new DomainError('Equipment not found', 'not_found')
    return row
  }
  const [{ n } = { n: 0 }] = await tx
    .select({ n: count() })
    .from(equipment)
    .where(eq(equipment.branchId, rest.branchId))
  const [row] = await tx
    .insert(equipment)
    .values({ tenantId, ...rest, sort: n })
    .returning()
  return row!
}

/** Deletes a unit that holds no upcoming reservations (otherwise mark it inactive). */
export async function deleteEquipment(tx: Tx, id: string, now = new Date()) {
  const [held] = await tx
    .select({ id: reservations.id })
    .from(reservations)
    .where(
      and(
        eq(reservations.resourceKind, 'equipment'),
        eq(reservations.resourceId, id),
        sql`upper(${reservations.period}) > ${now.toISOString()}::timestamptz`,
      ),
    )
    .limit(1)
  if (held) throw new DomainError('This equipment has upcoming bookings — mark it inactive instead')
  const [row] = await tx.delete(equipment).where(eq(equipment.id, id)).returning({ id: equipment.id })
  if (!row) throw new DomainError('Equipment not found', 'not_found')
}

/**
 * Equipment per booking item: the reserved units' names and the required types not covered by an active reserved
 * unit (e.g. booked before the service needed it, or the unit was deactivated) — shown as conflicts on the
 * calendar.
 */
export async function equipmentStatus(
  tx: Tx,
  items: { id: string; serviceVariantId: string | null; equipmentIds: string[] }[],
) {
  const out = new Map<string, { names: string[]; missing: string[] }>()
  if (!items.length) return out
  const variantIds = [...new Set(items.map((i) => i.serviceVariantId).filter((v): v is string => !!v))]
  const need = variantIds.length
    ? await tx
        .select({ variantId: serviceVariants.id, types: services.equipmentTypes })
        .from(serviceVariants)
        .innerJoin(services, eq(services.id, serviceVariants.serviceId))
        .where(inArray(serviceVariants.id, variantIds))
    : []
  const unitIds = [...new Set(items.flatMap((i) => i.equipmentIds))]
  const units = unitIds.length ? await tx.select().from(equipment).where(inArray(equipment.id, unitIds)) : []
  const typesOf = new Map(need.map((n) => [n.variantId, n.types]))
  for (const item of items) {
    const mine = units.filter((u) => item.equipmentIds.includes(u.id))
    const pool = mine.filter((u) => u.active).map((u) => u.type)
    const missing: string[] = []
    for (const type of typesOf.get(item.serviceVariantId ?? '') ?? []) {
      const i = pool.indexOf(type)
      if (i === -1) missing.push(type)
      else pool.splice(i, 1)
    }
    if (mine.length || missing.length) out.set(item.id, { names: mine.map((u) => u.name), missing })
  }
  return out
}

/** Booking items that already hold a unit (for the equipment list's "in use" hint). */
export async function equipmentUse(tx: Tx, ids: string[], from: Date) {
  if (!ids.length) return new Map<string, number>()
  const rows = await tx
    .select({ id: reservations.resourceId, n: count() })
    .from(reservations)
    .innerJoin(bookingItems, eq(bookingItems.id, reservations.bookingItemId))
    .where(
      and(
        eq(reservations.resourceKind, 'equipment'),
        inArray(reservations.resourceId, ids),
        gt(bookingItems.startsAt, from),
      ),
    )
    .groupBy(reservations.resourceId)
  return new Map(rows.map((r) => [r.id, Number(r.n)]))
}

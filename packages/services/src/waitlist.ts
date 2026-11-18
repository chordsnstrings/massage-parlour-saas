// Waitlist (PLAN §14.7 B5.1): clients waiting for a service on a business date. A freed slot (cancel / no-show /
// reschedule, see bookings.ts) marks matching entries `notified` and queues a `waitlist_slot` WhatsApp message
// (click-to-send outbox). Staff turn an entry into a booking through the normal createBooking path.
import {
  bookings,
  branches,
  clients,
  outbox,
  services,
  serviceVariants,
  type Tx,
  tenants,
  waitlistEntries,
} from '@spa/db'
import { and, asc, eq, gte, inArray, type SQL, sql } from 'drizzle-orm'
import { createBooking, type NewBooking } from './bookings'
import { DomainError } from './errors'
import { fmtDay, fmtTime, renderTemplate, templateFor } from './outbox'

export type WaitlistStatus = (typeof waitlistEntries.$inferSelect)['status']
export const OPEN_WAITLIST: WaitlistStatus[] = ['waiting', 'notified']
/** At most this many entries are offered one freed slot (oldest first). */
export const WAITLIST_OFFERS_PER_SLOT = 5

export type NewWaitlistEntry = {
  tenantId: string
  branchId: string
  clientId: string
  serviceId?: string | null
  serviceVariantId?: string | null
  businessDate: string
  fromAt?: Date | null
  untilAt?: Date | null
  notes?: string | null
  createdBy?: string | null
}

export async function addToWaitlist(tx: Tx, input: NewWaitlistEntry) {
  const [branch] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, input.branchId))
  if (!branch) throw new DomainError('Branch not found', 'not_found')
  const [client] = await tx.select({ id: clients.id }).from(clients).where(eq(clients.id, input.clientId))
  if (!client) throw new DomainError('Client not found', 'not_found')
  let serviceId = input.serviceId ?? null
  if (input.serviceVariantId) {
    const [v] = await tx
      .select({ serviceId: serviceVariants.serviceId })
      .from(serviceVariants)
      .where(eq(serviceVariants.id, input.serviceVariantId))
    if (!v || (serviceId && v.serviceId !== serviceId))
      throw new DomainError('Service not found', 'not_found')
    serviceId = v.serviceId
  } else if (serviceId) {
    const [s] = await tx.select({ id: services.id }).from(services).where(eq(services.id, serviceId))
    if (!s) throw new DomainError('Service not found', 'not_found')
  }
  if (input.fromAt && input.untilAt && input.fromAt >= input.untilAt)
    throw new DomainError('The time window must end after it starts')
  const [row] = await tx
    .insert(waitlistEntries)
    .values({
      tenantId: input.tenantId,
      branchId: input.branchId,
      clientId: input.clientId,
      serviceId,
      serviceVariantId: input.serviceVariantId ?? null,
      businessDate: input.businessDate,
      fromAt: input.fromAt ?? null,
      untilAt: input.untilAt ?? null,
      notes: input.notes ?? null,
      createdBy: input.createdBy ?? null,
    })
    .returning()
  return row!
}

/** Closes an open entry (client no longer waiting). */
export async function cancelWaitlistEntry(tx: Tx, entryId: string) {
  const [row] = await tx
    .update(waitlistEntries)
    .set({ status: 'cancelled' })
    .where(and(eq(waitlistEntries.id, entryId), inArray(waitlistEntries.status, OPEN_WAITLIST)))
    .returning()
  if (!row) throw new DomainError('This waitlist entry is already closed', 'not_found')
  return row
}

export async function listWaitlist(
  tx: Tx,
  f: {
    branchIds?: string[]
    date?: string
    fromDate?: string
    statuses?: WaitlistStatus[]
    limit?: number
  } = {},
) {
  const where: SQL[] = []
  if (f.branchIds) where.push(inArray(waitlistEntries.branchId, f.branchIds))
  if (f.date) where.push(eq(waitlistEntries.businessDate, f.date))
  if (f.fromDate) where.push(gte(waitlistEntries.businessDate, f.fromDate))
  if (f.statuses?.length) where.push(inArray(waitlistEntries.status, f.statuses))
  return tx
    .select({
      entry: waitlistEntries,
      clientName: clients.name,
      clientPhone: clients.phoneE164,
      serviceName: services.name,
      durationMin: serviceVariants.durationMin,
      branchName: branches.name,
      bookingRef: bookings.refCode,
    })
    .from(waitlistEntries)
    .innerJoin(clients, eq(clients.id, waitlistEntries.clientId))
    .innerJoin(branches, eq(branches.id, waitlistEntries.branchId))
    .leftJoin(services, eq(services.id, waitlistEntries.serviceId))
    .leftJoin(serviceVariants, eq(serviceVariants.id, waitlistEntries.serviceVariantId))
    .leftJoin(bookings, eq(bookings.id, waitlistEntries.bookingId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(asc(waitlistEntries.businessDate), asc(waitlistEntries.createdAt))
    .limit(f.limit ?? 300)
}

export type FreedSlot = {
  tenantId: string
  branchId: string
  businessDate: string
  startsAt: Date
  endsAt: Date
  /** Services of the freed booking items; entries for any of these (or for no particular service) match. */
  serviceIds: string[]
}

/**
 * A slot freed up: claims the oldest matching `waiting` entries (same branch + business date, service matches or
 * is open, time window overlaps, client has a mobile) and queues one `waitlist_slot` message for each. Claiming
 * uses `FOR UPDATE SKIP LOCKED` + the status flip, so concurrent cancellations never message an entry twice.
 * Past slots are ignored. Returns the queued outbox rows.
 */
export async function notifyWaitlistForFreedSlot(tx: Tx, slot: FreedSlot, now = new Date()) {
  if (slot.endsAt <= now) return []
  const serviceMatch = slot.serviceIds.length
    ? sql`(${waitlistEntries.serviceId} is null or ${inArray(waitlistEntries.serviceId, slot.serviceIds)})`
    : sql`${waitlistEntries.serviceId} is null`
  const candidates = tx
    .select({ id: waitlistEntries.id })
    .from(waitlistEntries)
    .innerJoin(clients, eq(clients.id, waitlistEntries.clientId))
    .where(
      and(
        eq(waitlistEntries.branchId, slot.branchId),
        eq(waitlistEntries.businessDate, slot.businessDate),
        eq(waitlistEntries.status, 'waiting'),
        serviceMatch,
        sql`(${waitlistEntries.fromAt} is null or ${waitlistEntries.fromAt} < ${slot.endsAt.toISOString()}::timestamptz)`,
        sql`(${waitlistEntries.untilAt} is null or ${waitlistEntries.untilAt} > ${slot.startsAt.toISOString()}::timestamptz)`,
        sql`${clients.phoneE164} is not null`,
      ),
    )
    .orderBy(asc(waitlistEntries.createdAt))
    .limit(WAITLIST_OFFERS_PER_SLOT)
    .for('update', { of: waitlistEntries, skipLocked: true })
  const claimed = await tx
    .update(waitlistEntries)
    .set({ status: 'notified', notifiedAt: now })
    .where(inArray(waitlistEntries.id, candidates))
    .returning()
  if (!claimed.length) return []
  const [spa] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, slot.tenantId))
  const people = await tx
    .select()
    .from(clients)
    .where(
      inArray(
        clients.id,
        claimed.map((c) => c.clientId),
      ),
    )
  const svcIds = [...new Set(claimed.map((c) => c.serviceId).concat(slot.serviceIds[0] ?? null))].filter(
    (x): x is string => Boolean(x),
  )
  const svcNames = new Map(
    svcIds.length
      ? (
          await tx
            .select({ id: services.id, name: services.name })
            .from(services)
            .where(inArray(services.id, svcIds))
        ).map((s) => [s.id, s.name])
      : [],
  )
  const rows: (typeof outbox.$inferInsert)[] = []
  for (const entry of claimed) {
    const client = people.find((p) => p.id === entry.clientId)
    if (!client?.phoneE164) continue
    const lang = client.language === 'ar' ? 'ar' : 'en'
    const name = svcNames.get(entry.serviceId ?? slot.serviceIds[0] ?? '')
    rows.push({
      tenantId: slot.tenantId,
      branchId: slot.branchId,
      clientId: client.id,
      kind: 'waitlist_slot',
      phoneE164: client.phoneE164,
      text: renderTemplate(await templateFor(tx, 'waitlist_slot', lang), {
        first_name: client.name.split(' ')[0] ?? client.name,
        name: client.name,
        spa: spa?.name ?? '',
        service: (lang === 'ar' ? name?.ar : undefined) || name?.en || '',
        day: fmtDay(slot.startsAt, lang),
        time: fmtTime(slot.startsAt, lang),
      }),
      dueAt: now,
    })
  }
  return rows.length ? tx.insert(outbox).values(rows).returning() : []
}

/**
 * Books an open waitlist entry for its client through the normal createBooking path (reservations EXCLUDE
 * still decides) and marks it `booked`. The entry row is locked so it can only be converted once.
 */
export async function bookFromWaitlist(
  tx: Tx,
  entryId: string,
  input: Omit<NewBooking, 'tenantId' | 'branchId' | 'clientId'>,
) {
  const [entry] = await tx.select().from(waitlistEntries).where(eq(waitlistEntries.id, entryId)).for('update')
  if (!entry) throw new DomainError('Waitlist entry not found', 'not_found')
  if (!OPEN_WAITLIST.includes(entry.status))
    throw new DomainError('This waitlist entry is already closed', 'not_found')
  const booking = await createBooking(tx, {
    ...input,
    tenantId: entry.tenantId,
    branchId: entry.branchId,
    clientId: entry.clientId,
  })
  const [updated] = await tx
    .update(waitlistEntries)
    .set({ status: 'booked', bookingId: booking.id })
    .where(eq(waitlistEntries.id, entryId))
    .returning()
  return { booking, entry: updated! }
}

// Read-only lookups for the dashboard "Ask AI" assistant (F30, packages/ai agents/assistant.ts). Callers pass the
// branches the member may see and check permissions themselves (services never do); everything runs in withTenant.
import { businessDayWindow } from '@spa/core'
import { bookingItems, bookings, branches, clients, shifts, staff, type Tx } from '@spa/db'
import { and, asc, eq, gt, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { NO_MARKETING_TAG } from './growth'

type BookingStatus = (typeof bookings.$inferSelect)['status']

/** A uuid[] parameter (ids come from the member's scope, already uuids). */
const uuids = (ids: string[]) => sql`${`{${ids.join(',')}}`}::uuid[]`

/** Bookings per status in a business-date range across `branchIds` (optionally one therapist's only). */
export async function bookingStatusCounts(
  tx: Tx,
  f: { from: string; to: string; branchIds: string[]; staffId?: string },
): Promise<Partial<Record<BookingStatus, number>>> {
  if (!f.branchIds.length) return {}
  const rows = await tx
    .select({ status: bookings.status, n: sql<number>`count(*)::int` })
    .from(bookings)
    .where(
      and(
        inArray(bookings.branchId, f.branchIds),
        sql`${bookings.businessDate} between ${f.from} and ${f.to}`,
        f.staffId
          ? sql`exists (select 1 from ${bookingItems} bi where bi.booking_id = ${bookings.id} and ${f.staffId}::uuid = any(bi.staff_ids))`
          : undefined,
      ),
    )
    .groupBy(bookings.status)
  return Object.fromEntries(rows.map((r) => [r.status, r.n]))
}

/** Display names for staff ids (typed names, never translated). */
export async function staffNames(tx: Tx, ids: string[]) {
  if (!ids.length) return new Map<string, string>()
  const rows = await tx
    .select({ id: staff.id, name: staff.displayName })
    .from(staff)
    .where(inArray(staff.id, ids))
  return new Map(rows.map((r) => [r.id, r.name]))
}

/**
 * Clients whose last visit is more than `days` ago and who have nothing booked ahead, most recent lapses first (the
 * easiest to win back). Erased and blocklisted clients are left out. `branchIds` (branch-limited members) keeps
 * clients who have booked at one of those branches.
 */
export async function lapsedClients(
  tx: Tx,
  f: { days: number; limit: number; branchIds?: string[] | null; now?: Date },
) {
  const now = f.now ?? new Date()
  const before = new Date(now.getTime() - f.days * 86_400_000)
  const where = and(
    isNotNull(clients.lastVisitAt),
    lt(clients.lastVisitAt, before),
    isNull(clients.erasedAt),
    eq(clients.blocklisted, false),
    sql`not exists (select 1 from ${bookings} b where b.client_id = ${clients.id}
      and b.status in ('pending', 'confirmed') and b.starts_at >= ${now.toISOString()}::timestamptz)`,
    f.branchIds
      ? f.branchIds.length
        ? sql`exists (select 1 from ${bookings} b where b.client_id = ${clients.id} and b.branch_id = any(${uuids(f.branchIds)}))`
        : sql`false`
      : undefined,
  )
  const [count] = await tx.select({ n: sql<number>`count(*)::int` }).from(clients).where(where)
  const rows = await tx
    .select({
      id: clients.id,
      name: clients.name,
      lastVisitAt: clients.lastVisitAt,
      visits: sql<number>`(select count(*)::int from ${bookings} b where b.client_id = ${clients.id} and b.status = 'completed')`,
    })
    .from(clients)
    .where(where)
    .orderBy(sql`${clients.lastVisitAt} desc`, asc(clients.name), asc(clients.id))
    .limit(f.limit)
  return { total: count?.n ?? 0, rows }
}

/** Shifts overlapping each branch's business day `date` (its own cutoff), earliest first. */
export async function shiftsOnDate(tx: Tx, f: { date: string; branchIds: string[] }) {
  if (!f.branchIds.length) return []
  const branchRows = await tx
    .select({ id: branches.id, name: branches.name, cutoff: branches.businessDayCutoff })
    .from(branches)
    .where(inArray(branches.id, f.branchIds))
    .orderBy(asc(branches.name))
  const out: { staffId: string; staffName: string; branchName: string; startsAt: Date; endsAt: Date }[] = []
  for (const b of branchRows) {
    const day = businessDayWindow(f.date, b.cutoff.slice(0, 5))
    const rows = await tx
      .select({
        staffId: shifts.staffId,
        staffName: staff.displayName,
        startsAt: shifts.startsAt,
        endsAt: shifts.endsAt,
      })
      .from(shifts)
      .innerJoin(staff, eq(staff.id, shifts.staffId))
      .where(and(eq(shifts.branchId, b.id), lt(shifts.startsAt, day.end), gt(shifts.endsAt, day.start)))
      .orderBy(asc(shifts.startsAt), asc(staff.displayName))
    out.push(...rows.map((r) => ({ ...r, branchName: b.name })))
  }
  return out
}

/**
 * One client for a WhatsApp click-to-send draft: name + mobile, and whether they accept marketing messages (same
 * guardrails as campaigns: not opted out, not blocklisted, no `no-marketing` tag, not erased).
 */
export async function assistantDraftTarget(tx: Tx, clientId: string, branchIds?: string[] | null) {
  const [c] = await tx
    .select({
      id: clients.id,
      name: clients.name,
      phone: clients.phoneE164,
      language: clients.language,
      consent: sql<boolean>`(${clients.marketingOptOutAt} is null and not ${clients.blocklisted}
        and ${clients.erasedAt} is null and not (${NO_MARKETING_TAG} = any(${clients.tags})))`,
      visible: branchIds
        ? branchIds.length
          ? sql<boolean>`exists (select 1 from ${bookings} b where b.client_id = ${clients.id} and b.branch_id = any(${uuids(branchIds)}))`
          : sql<boolean>`false`
        : sql<boolean>`true`,
    })
    .from(clients)
    .where(eq(clients.id, clientId))
  return c && c.visible ? c : null
}

/** The staff profile linked to a member (therapist-style roles see only their own bookings). */
export async function staffIdForMember(tx: Tx, memberId: string | null) {
  if (!memberId) return null
  const [row] = await tx.select({ id: staff.id }).from(staff).where(eq(staff.memberId, memberId))
  return row?.id ?? null
}

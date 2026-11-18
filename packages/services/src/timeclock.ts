// B5.4 — staff time clock (PIN kiosk), timesheets (actual vs planned) and leave requests (PLAN §14.7).
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { businessDateOf, businessDayWindow } from '@spa/core'
import { bookingItems, bookings, branches, leaveRequests, shifts, staff, type Tx, timeEntries } from '@spa/db'
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, sql } from 'drizzle-orm'
import { DomainError, pgCode } from './errors'

const MIN = 60_000
export const PIN_PATTERN = /^\d{4,8}$/
export const PIN_MAX_FAILURES = 5
export const PIN_LOCK_MIN = 5

/** scrypt hash of a PIN: `v1.<salt>.<hash>` (base64url). */
export function hashPin(pin: string) {
  const salt = randomBytes(16)
  return `v1.${salt.toString('base64url')}.${scryptSync(pin, salt, 32).toString('base64url')}`
}

export function verifyPin(pin: string, stored: string | null | undefined) {
  const [v, salt, hash] = (stored ?? '').split('.')
  if (v !== 'v1' || !salt || !hash) return false
  const want = Buffer.from(hash, 'base64url')
  const got = scryptSync(pin, Buffer.from(salt, 'base64url'), want.length)
  return timingSafeEqual(want, got)
}

/** Sets (or clears, with null) a person's kiosk PIN. Resets the lockout. */
export async function setStaffPin(tx: Tx, staffId: string, pin: string | null) {
  if (pin !== null && !PIN_PATTERN.test(pin)) throw new DomainError('A PIN is 4 to 8 digits')
  const [row] = await tx
    .update(staff)
    .set({ pinHash: pin === null ? null : hashPin(pin), pinFailures: 0, pinLockedUntil: null })
    .where(eq(staff.id, staffId))
    .returning({ id: staff.id })
  if (!row) throw new DomainError('Staff member not found', 'not_found')
}

export type PunchResult =
  | { ok: true; action: 'in' | 'out'; name: string; at: Date; workedMin?: number }
  | { ok: false; reason: 'wrong_pin' | 'locked'; minutes?: number }

/**
 * Kiosk clock in / out with a PIN. Wrong PINs are counted (returned, not thrown, so the count commits); five in a
 * row lock the person for five minutes. One open entry per person is enforced by a unique index, so two kiosks
 * punching at once can't create two.
 */
export async function punch(
  tx: Tx,
  input: { tenantId: string; branchId: string; staffId: string; pin: string; now?: Date },
): Promise<PunchResult> {
  const now = input.now ?? new Date()
  const [person] = await tx.select().from(staff).where(eq(staff.id, input.staffId)).for('update')
  if (!person?.active) throw new DomainError('Staff member not found', 'not_found')
  if (!person.pinHash) throw new DomainError('No PIN is set for this person yet — ask a manager')
  if (person.pinLockedUntil && person.pinLockedUntil > now)
    return {
      ok: false,
      reason: 'locked',
      minutes: Math.ceil((person.pinLockedUntil.getTime() - now.getTime()) / MIN),
    }
  if (!verifyPin(input.pin, person.pinHash)) {
    const failures = person.pinFailures + 1
    const lock = failures >= PIN_MAX_FAILURES
    await tx
      .update(staff)
      .set({
        pinFailures: lock ? 0 : failures,
        pinLockedUntil: lock ? new Date(now.getTime() + PIN_LOCK_MIN * MIN) : null,
      })
      .where(eq(staff.id, person.id))
    return lock ? { ok: false, reason: 'locked', minutes: PIN_LOCK_MIN } : { ok: false, reason: 'wrong_pin' }
  }
  if (person.pinFailures || person.pinLockedUntil)
    await tx.update(staff).set({ pinFailures: 0, pinLockedUntil: null }).where(eq(staff.id, person.id))
  const [open] = await tx
    .select()
    .from(timeEntries)
    .where(and(eq(timeEntries.staffId, person.id), isNull(timeEntries.clockOut)))
    .for('update')
  if (open) {
    // A double tap (or two kiosks at once) must not clock straight back out.
    if (now.getTime() - open.clockIn.getTime() < MIN)
      throw new DomainError('You clocked in less than a minute ago', 'slot_taken')
    const out = new Date(Math.max(now.getTime(), open.clockIn.getTime() + 1000))
    await tx.update(timeEntries).set({ clockOut: out }).where(eq(timeEntries.id, open.id))
    return {
      ok: true,
      action: 'out',
      name: person.displayName,
      at: out,
      workedMin: Math.round((out.getTime() - open.clockIn.getTime()) / MIN),
    }
  }
  const [branch] = await tx.select().from(branches).where(eq(branches.id, input.branchId))
  if (!branch) throw new DomainError('Branch not found', 'not_found')
  try {
    await tx.transaction((sp) =>
      sp.insert(timeEntries).values({
        tenantId: input.tenantId,
        staffId: person.id,
        branchId: branch.id,
        clockIn: now,
        businessDate: businessDateOf(now, branch.businessDayCutoff.slice(0, 5)),
      }),
    )
  } catch (e) {
    if (pgCode(e) === '23505' || pgCode(e) === '23P01')
      throw new DomainError('Already clocked in — try again', 'slot_taken')
    throw e
  }
  return { ok: true, action: 'in', name: person.displayName, at: now }
}

/** Manager fix of one entry (forgotten clock-out, wrong time). Overlaps with the person's other entries fail. */
export async function adjustTimeEntry(tx: Tx, entryId: string, to: { clockIn: Date; clockOut: Date | null }) {
  if (to.clockOut && to.clockOut <= to.clockIn) throw new DomainError('Clock-out must be after clock-in')
  const [entry] = await tx.select().from(timeEntries).where(eq(timeEntries.id, entryId)).for('update')
  if (!entry) throw new DomainError('Time entry not found', 'not_found')
  const [branch] = await tx.select().from(branches).where(eq(branches.id, entry.branchId))
  try {
    await tx.transaction((sp) =>
      sp
        .update(timeEntries)
        .set({
          clockIn: to.clockIn,
          clockOut: to.clockOut,
          businessDate: businessDateOf(to.clockIn, branch?.businessDayCutoff.slice(0, 5)),
          source: 'manual',
        })
        .where(eq(timeEntries.id, entryId)),
    )
  } catch (e) {
    if (pgCode(e) === '23P01' || pgCode(e) === '23505')
      throw new DomainError('That time overlaps another clock entry')
    throw e
  }
}

/** Who is clocked in right now (open entries), oldest first. */
export async function clockedIn(tx: Tx) {
  return tx
    .select({ entryId: timeEntries.id, staffId: timeEntries.staffId, since: timeEntries.clockIn })
    .from(timeEntries)
    .where(isNull(timeEntries.clockOut))
    .orderBy(asc(timeEntries.clockIn))
}

export type TimesheetRow = {
  staffId: string
  date: string
  plannedMin: number
  workedMin: number
  open: boolean
  entries: { id: string; clockIn: Date; clockOut: Date | null }[]
  leave: (typeof leaveRequests.$inferSelect)['type'] | null
}

/**
 * Planned (shifts clipped to each business day) vs actual (clock entries by business date) minutes per person and
 * business date of one branch, plus approved leave. Open entries count up to `now`.
 */
export async function timesheet(
  tx: Tx,
  q: { branchId: string; from: string; to: string; now?: Date },
): Promise<TimesheetRow[]> {
  const now = q.now ?? new Date()
  const [branch] = await tx.select().from(branches).where(eq(branches.id, q.branchId))
  if (!branch) throw new DomainError('Branch not found', 'not_found')
  const cutoff = branch.businessDayCutoff.slice(0, 5)
  const lo = businessDayWindow(q.from, cutoff).start
  const hi = businessDayWindow(q.to, cutoff).end
  const shiftRows = await tx
    .select()
    .from(shifts)
    .where(and(eq(shifts.branchId, q.branchId), lt(shifts.startsAt, hi), sql`${shifts.endsAt} > ${lo}`))
  const entries = await tx
    .select()
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.branchId, q.branchId),
        gte(timeEntries.businessDate, q.from),
        lte(timeEntries.businessDate, q.to),
      ),
    )
    .orderBy(asc(timeEntries.clockIn))
  const leave = await tx
    .select()
    .from(leaveRequests)
    .where(
      and(
        eq(leaveRequests.status, 'approved'),
        lte(leaveRequests.startDate, q.to),
        gte(leaveRequests.endDate, q.from),
      ),
    )
  const rows = new Map<string, TimesheetRow>()
  const row = (staffId: string, date: string) => {
    const key = `${staffId}|${date}`
    let r = rows.get(key)
    if (!r) {
      r = { staffId, date, plannedMin: 0, workedMin: 0, open: false, entries: [], leave: null }
      rows.set(key, r)
    }
    return r
  }
  for (const sh of shiftRows) {
    // Split across business days (a shift can run past the cutoff).
    for (let d = businessDateOf(sh.startsAt, cutoff); ; d = nextDay(d)) {
      const w = businessDayWindow(d, cutoff)
      if (w.start >= sh.endsAt || d > q.to) break
      if (d < q.from) continue
      const s = Math.max(w.start.getTime(), sh.startsAt.getTime())
      const e = Math.min(w.end.getTime(), sh.endsAt.getTime())
      if (e > s) row(sh.staffId, d).plannedMin += Math.round((e - s) / MIN)
    }
  }
  for (const en of entries) {
    const r = row(en.staffId, en.businessDate)
    const end = en.clockOut ?? now
    r.workedMin += Math.max(0, Math.round((end.getTime() - en.clockIn.getTime()) / MIN))
    r.open ||= !en.clockOut
    r.entries.push({ id: en.id, clockIn: en.clockIn, clockOut: en.clockOut })
  }
  for (const l of leave)
    for (let d = l.startDate < q.from ? q.from : l.startDate; d <= l.endDate && d <= q.to; d = nextDay(d))
      row(l.staffId, d).leave = l.type
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.staffId.localeCompare(b.staffId))
}

const nextDay = (date: string) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}
const DATE = /^\d{4}-\d{2}-\d{2}$/
/** Whole days of [a1, a2] ∩ [b1, b2] (inclusive dates). */
export const overlapDays = (a1: string, a2: string, b1: string, b2: string) => {
  const s = Math.max(Date.parse(a1), Date.parse(b1))
  const e = Math.min(Date.parse(a2), Date.parse(b2))
  return e < s ? 0 : Math.round((e - s) / 86_400_000) + 1
}

/** A leave request (pending). Overlapping live requests of the same person are rejected by the DB. */
export async function requestLeave(
  tx: Tx,
  input: {
    tenantId: string
    staffId: string
    type: (typeof leaveRequests.$inferInsert)['type']
    startDate: string
    endDate: string
    note?: string | null
    requestedBy?: string | null
  },
) {
  if (!DATE.test(input.startDate) || !DATE.test(input.endDate))
    throw new DomainError('Choose the leave dates')
  if (input.endDate < input.startDate) throw new DomainError('The last day of leave is before the first')
  if (overlapDays(input.startDate, input.endDate, input.startDate, input.endDate) > 90)
    throw new DomainError('Leave can be at most 90 days per request')
  const [person] = await tx.select({ id: staff.id }).from(staff).where(eq(staff.id, input.staffId))
  if (!person) throw new DomainError('Staff member not found', 'not_found')
  try {
    return await tx.transaction(async (sp) => {
      const [row] = await sp
        .insert(leaveRequests)
        .values({
          tenantId: input.tenantId,
          staffId: input.staffId,
          type: input.type,
          startDate: input.startDate,
          endDate: input.endDate,
          note: input.note ?? null,
          requestedBy: input.requestedBy ?? null,
        })
        .returning()
      return row!
    })
  } catch (e) {
    if (pgCode(e) === '23P01') throw new DomainError('These dates overlap another leave request')
    throw e
  }
}

/**
 * Approves or rejects a pending request. Approval returns how many of the person's live bookings fall in the leave
 * (they keep their reservations — reception reassigns them; new bookings can't pick this person).
 */
export async function decideLeave(
  tx: Tx,
  input: { id: string; status: 'approved' | 'rejected'; userId?: string | null; now?: Date },
) {
  const [req] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, input.id)).for('update')
  if (!req) throw new DomainError('Leave request not found', 'not_found')
  if (req.status !== 'pending') throw new DomainError('This leave request was already decided')
  await tx
    .update(leaveRequests)
    .set({ status: input.status, decidedBy: input.userId ?? null, decidedAt: input.now ?? new Date() })
    .where(eq(leaveRequests.id, input.id))
  if (input.status === 'rejected') return { request: { ...req, status: input.status }, clashes: 0 }
  const clashes = await bookingsDuringLeave(tx, req)
  return { request: { ...req, status: input.status }, clashes: clashes.length }
}

/** Live bookings (not cancelled / no-show / completed) of the person within the leave's business days. */
export async function bookingsDuringLeave(
  tx: Tx,
  req: Pick<typeof leaveRequests.$inferSelect, 'staffId' | 'startDate' | 'endDate'>,
) {
  return tx
    .selectDistinct({ id: bookings.id, refCode: bookings.refCode, startsAt: bookings.startsAt })
    .from(bookingItems)
    .innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
    .where(
      and(
        sql`${req.staffId}::uuid = any(${bookingItems.staffIds})`,
        gte(bookings.businessDate, req.startDate),
        lte(bookings.businessDate, req.endDate),
        notInArray(bookings.status, ['cancelled', 'no_show', 'completed']),
      ),
    )
}

/** Withdraws a request that is still pending (or an approved one before it starts — managers only). */
export async function cancelLeave(
  tx: Tx,
  id: string,
  opts: { allowApproved?: boolean; today?: string } = {},
) {
  const [req] = await tx.select().from(leaveRequests).where(eq(leaveRequests.id, id)).for('update')
  if (!req) throw new DomainError('Leave request not found', 'not_found')
  const ok =
    req.status === 'pending' ||
    (req.status === 'approved' && opts.allowApproved && (!opts.today || req.startDate > opts.today))
  if (!ok) throw new DomainError('This leave request can no longer be withdrawn')
  await tx.delete(leaveRequests).where(eq(leaveRequests.id, id))
  return req
}

/** Unpaid approved leave days within the period, per staff id (payroll). */
export async function unpaidLeaveDays(
  tx: Tx,
  p: { staffIds: string[]; periodStart: string; periodEnd: string },
) {
  const out = new Map<string, number>()
  if (!p.staffIds.length) return out
  const rows = await tx
    .select()
    .from(leaveRequests)
    .where(
      and(
        inArray(leaveRequests.staffId, p.staffIds),
        eq(leaveRequests.status, 'approved'),
        eq(leaveRequests.type, 'unpaid'),
        lte(leaveRequests.startDate, p.periodEnd),
        gte(leaveRequests.endDate, p.periodStart),
      ),
    )
  for (const r of rows)
    out.set(
      r.staffId,
      (out.get(r.staffId) ?? 0) + overlapDays(r.startDate, r.endDate, p.periodStart, p.periodEnd),
    )
  return out
}

/** Clocked minutes (closed entries) with a business date in the period, per staff id (payroll). */
export async function workedMinutes(
  tx: Tx,
  p: { staffIds: string[]; periodStart: string; periodEnd: string },
) {
  if (!p.staffIds.length) return new Map<string, number>()
  const rows = await tx
    .select({
      staffId: timeEntries.staffId,
      min: sql<number>`coalesce(round(sum(extract(epoch from ${timeEntries.clockOut} - ${timeEntries.clockIn})) / 60), 0)::int`,
    })
    .from(timeEntries)
    .where(
      and(
        inArray(timeEntries.staffId, p.staffIds),
        isNotNull(timeEntries.clockOut),
        gte(timeEntries.businessDate, p.periodStart),
        lte(timeEntries.businessDate, p.periodEnd),
      ),
    )
    .groupBy(timeEntries.staffId)
  return new Map(rows.map((r) => [r.staffId, Number(r.min)]))
}

/** Leave requests overlapping a date range (all statuses unless filtered), newest first. */
export async function listLeave(
  tx: Tx,
  q: { from?: string; to?: string; staffId?: string; excludeRejected?: boolean } = {},
) {
  return tx
    .select()
    .from(leaveRequests)
    .where(
      and(
        q.from ? gte(leaveRequests.endDate, q.from) : undefined,
        q.to ? lte(leaveRequests.startDate, q.to) : undefined,
        q.staffId ? eq(leaveRequests.staffId, q.staffId) : undefined,
        q.excludeRejected ? ne(leaveRequests.status, 'rejected') : undefined,
      ),
    )
    .orderBy(sql`${leaveRequests.status} = 'pending' desc`, asc(leaveRequests.startDate))
}

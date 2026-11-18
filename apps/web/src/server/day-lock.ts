// R32 (D6) day lock for the spa dashboard: reception may change anything on an open business day; a closed day
// (a `day_closes` row) changes only with `pos.correct` (owners and managers). Every write that touches a day's money
// or orders calls `assertDayEditable` inside its withTenant (it takes the day's advisory lock, shared with closeDay),
// passes `allowClosedDay: closed` to the services, stamps `markDayAmended` when closed, and after commit audits and
// calls `afterDayChange`.
import type { Tx } from '@spa/db'
import { DAY_CLOSED, DomainError, isDayClosed, markDayAmended } from '@spa/services'
import { can, type MemberContext } from './access'
import { dayCloseId, storeDaySheetPdf } from './day-sheet'

/** Throws DAY_CLOSED (DomainError) when the day is closed and the member lacks pos.correct; returns { closed }. */
export async function assertDayEditable(
  tx: Tx,
  ctx: MemberContext,
  branchId: string,
  date: string,
): Promise<{ closed: boolean }> {
  const closed = await isDayClosed(tx, branchId, date, { lock: true })
  if (closed && !can(ctx, 'pos.correct')) throw new DomainError(DAY_CLOSED)
  return { closed }
}

/** assertDayEditable + markDayAmended when that day is closed (the change is made by an owner/manager). */
export async function editDay(tx: Tx, ctx: MemberContext, branchId: string, date: string) {
  const r = await assertDayEditable(tx, ctx, branchId, date)
  if (r.closed) await markDayAmended(tx, branchId, date, ctx.user.id)
  return { branchId, date, closed: r.closed }
}

/** A Postgres period-lock refusal (accounts closed through a date) → callers map it to accounts.result.lockedDate. */
export const periodLocked = (e: unknown) => {
  const msg = `${e instanceof Error ? e.message : ''} ${(e as { cause?: Error })?.cause?.message ?? ''}`
  return /locked/i.test(msg)
}

/**
 * After the transaction: when `closed`, regenerate the day's stored sales-sheet PDF (R32; best effort, never fails
 * the change). The new file replaces the old one and prints "Amended after close"; `day_closes.totals` and the
 * counted cash stay as closed (the audit log keeps before/after).
 */
export async function afterDayChange(
  ctx: MemberContext,
  r: { branchId: string; date: string; closed: boolean },
): Promise<void> {
  if (!r.closed) return
  const id = await dayCloseId(ctx.tenant.id, r.branchId, r.date).catch(() => null)
  if (id) await storeDaySheetPdf(ctx.tenant.id, id, { createdBy: ctx.user.id })
}

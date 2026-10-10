// WhatsApp outbox assignment (F28): who on the team sends which message. Click-to-send is unchanged — an assignee
// still opens the wa.me link and presses send. Callers run these inside withTenant() and check marketing.send.
import { resolvePermissions } from '@spa/core'
import { memberBranches, members, outbox, roles, shifts, staff, type Tx } from '@spa/db'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { isAutomationOn } from './automations'
import { DomainError } from './errors'
import { campaignConsentWithdrawn } from './growth'
import { outboxBookingLive } from './outbox'

export const OUTBOX_ASSIGNEE_FILTERS = ['all', 'mine', 'unassigned'] as const
export type OutboxAssigneeFilter = (typeof OUTBOX_ASSIGNEE_FILTERS)[number]

const UNSENT = ['queued', 'opened'] as const

/** Unsent rows that are still offered for sending (consent kept, booking live). */
export const outboxPending = () =>
  and(inArray(outbox.status, [...UNSENT]), sql`not ${campaignConsentWithdrawn()}`, outboxBookingLive())!

/** "Mine" / "Unassigned" / "All" as a where-condition (`memberId` null: nobody's, so Mine matches nothing). */
export function outboxAssigneeWhere(filter: OutboxAssigneeFilter, memberId: string | null) {
  if (filter === 'unassigned') return isNull(outbox.assignedTo)
  if (filter === 'mine') return memberId ? eq(outbox.assignedTo, memberId) : sql`false`
  return undefined
}

export type AssignableMember = {
  memberId: string
  userId: string
  roleKey: string
  /** null = every branch. */
  branchIds: string[] | null
}

/** Active members whose role can send WhatsApp messages (marketing.send) — the people a message can go to. */
export async function assignableMembers(tx: Tx): Promise<AssignableMember[]> {
  const rows = await tx
    .select({
      memberId: members.id,
      userId: members.userId,
      allBranches: members.allBranches,
      roleKey: roles.key,
      rolePerms: roles.permissions,
    })
    .from(members)
    .innerJoin(roles, eq(roles.id, members.roleId))
    .where(eq(members.status, 'active'))
    .orderBy(asc(members.createdAt), asc(members.id))
  const allowed = rows.filter((r) =>
    resolvePermissions({ key: r.roleKey, permissions: r.rolePerms }).has('marketing.send'),
  )
  const limited = allowed.filter((r) => !r.allBranches).map((r) => r.memberId)
  const links = limited.length
    ? await tx
        .select({ memberId: memberBranches.memberId, branchId: memberBranches.branchId })
        .from(memberBranches)
        .where(inArray(memberBranches.memberId, limited))
    : []
  return allowed.map((r) => ({
    memberId: r.memberId,
    userId: r.userId,
    roleKey: r.roleKey,
    branchIds: r.allBranches ? null : links.filter((l) => l.memberId === r.memberId).map((l) => l.branchId),
  }))
}

const seesBranch = (m: Pick<AssignableMember, 'branchIds'>, branchId: string | null) =>
  m.branchIds === null || branchId === null || m.branchIds.includes(branchId)

/**
 * Assigns unsent messages to a member (or clears it with `memberId: null`). The member must be active with
 * marketing.send; messages of a branch the member can't see, already handled or not found are skipped.
 * Returns the changed rows with their previous assignee (for the audit log).
 */
export async function assignOutbox(
  tx: Tx,
  input: { ids: string[]; memberId: string | null; byUserId: string; now?: Date },
) {
  const ids = [...new Set(input.ids)]
  if (!ids.length) return { changed: [] as { id: string; from: string | null }[], skipped: 0 }
  let target: AssignableMember | null = null
  if (input.memberId) {
    target = (await assignableMembers(tx)).find((m) => m.memberId === input.memberId) ?? null
    if (!target)
      throw new DomainError('That team member cannot send WhatsApp messages', 'invalid', {
        key: 'messages.assign.notAssignable',
      })
  }
  const rows = await tx
    .select({ id: outbox.id, branchId: outbox.branchId, assignedTo: outbox.assignedTo })
    .from(outbox)
    .where(and(inArray(outbox.id, ids), inArray(outbox.status, [...UNSENT])))
    .for('update')
  const take = rows.filter(
    (r) => (!target || seesBranch(target, r.branchId)) && r.assignedTo !== (input.memberId ?? null),
  )
  if (take.length)
    await tx
      .update(outbox)
      .set({
        assignedTo: input.memberId,
        assignedAt: input.memberId ? (input.now ?? new Date()) : null,
        assignedBy: input.memberId ? input.byUserId : null,
      })
      .where(
        inArray(
          outbox.id,
          take.map((r) => r.id),
        ),
      )
  const unchanged = rows.filter((r) => r.assignedTo === (input.memberId ?? null)).length
  return {
    changed: take.map((r) => ({ id: r.id, from: r.assignedTo })),
    skipped: ids.length - take.length - unchanged,
  }
}

/** Receptionists (system role) with marketing.send whose shift covers `now`, with the shift's branches. */
export async function receptionistsOnShift(tx: Tx, now: Date) {
  const people = (await assignableMembers(tx)).filter((m) => m.roleKey === 'receptionist')
  if (!people.length) return []
  const on = await tx
    .select({ memberId: staff.memberId, branchId: shifts.branchId })
    .from(shifts)
    .innerJoin(staff, eq(staff.id, shifts.staffId))
    .where(
      and(
        inArray(
          staff.memberId,
          people.map((p) => p.memberId),
        ),
        lte(shifts.startsAt, now),
        gt(shifts.endsAt, now),
      ),
    )
  return people
    .map((p) => ({
      memberId: p.memberId,
      branches: new Set(on.filter((s) => s.memberId === p.memberId).map((s) => s.branchId)),
    }))
    .filter((p) => p.branches.size > 0)
    .sort((a, b) => (a.memberId < b.memberId ? -1 : 1))
}

/**
 * Auto-assign rule (automation `outboxAutoAssign`, off by default): due, unsent, unassigned messages go
 * round-robin to the receptionists on shift now in the message's branch (any shift for branch-less messages),
 * continuing after the member the rule picked last. Nobody on shift → the message stays unassigned.
 * One run at a time per spa (advisory lock). Returns how many were assigned.
 */
export async function autoAssignDueOutbox(tx: Tx, tenantId: string, now = new Date()) {
  if (!(await isAutomationOn(tx, tenantId, 'outboxAutoAssign'))) return 0
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('outbox-auto-assign'), hashtext(${tenantId}))`)
  const due = await tx
    .select({ id: outbox.id, branchId: outbox.branchId })
    .from(outbox)
    .where(and(isNull(outbox.assignedTo), lte(outbox.dueAt, now), outboxPending()))
    .orderBy(asc(outbox.dueAt), asc(outbox.id))
    .limit(500)
    .for('update', { skipLocked: true })
  if (!due.length) return 0
  const team = await receptionistsOnShift(tx, now)
  if (!team.length) return 0
  const [lastRow] = await tx
    .select({ memberId: outbox.assignedTo })
    .from(outbox)
    .where(and(isNotNull(outbox.assignedTo), isNull(outbox.assignedBy)))
    .orderBy(desc(outbox.assignedAt), desc(outbox.id))
    .limit(1)
  let last = lastRow?.memberId ?? null
  let n = 0
  for (const row of due) {
    const eligible = team.filter((m) => row.branchId === null || m.branches.has(row.branchId))
    if (!eligible.length) continue
    const pick = (last && eligible.find((m) => m.memberId > last!)) || eligible[0]!
    await tx
      .update(outbox)
      .set({ assignedTo: pick.memberId, assignedAt: now, assignedBy: null })
      .where(eq(outbox.id, row.id))
    last = pick.memberId
    n++
  }
  return n
}

/** Due-now counts for the messages page filter (Mine / Unassigned / All), inside the viewer's branch scope. */
export async function outboxAssigneeCounts(
  tx: Tx,
  q: { memberId: string | null; where?: ReturnType<typeof and> },
) {
  const [row] = await tx
    .select({
      all: sql<number>`count(*)::int`,
      mine: q.memberId
        ? sql<number>`(count(*) filter (where ${eq(outbox.assignedTo, q.memberId)}))::int`
        : sql<number>`0`,
      unassigned: sql<number>`(count(*) filter (where ${isNull(outbox.assignedTo)}))::int`,
    })
    .from(outbox)
    .where(q.where)
  return {
    all: Number(row?.all ?? 0),
    mine: Number(row?.mine ?? 0),
    unassigned: Number(row?.unassigned ?? 0),
  }
}

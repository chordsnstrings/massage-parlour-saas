// Multi-branch management (PLAN §18 G22): add / edit / archive branches and scope members to branches.
// Times stay Asia/Dubai (UAE only); each branch has its own business-day cutoff and opening hours.
import { SINGLE_BRANCH_LIMIT } from '@spa/core'
import { branches, memberBranches, members, type Tx } from '@spa/db'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { featureError } from './entitlements'
import { DomainError } from './errors'

export type BranchInput = {
  name: string
  address?: string | null
  /** Exact Google Maps pin (validated by the caller); undefined leaves it unchanged on update. */
  mapsUrl?: string | null
  phone?: string | null
  whatsappE164?: string | null
  /** HH:MM — the business day ends here (late-night shops), e.g. 05:00. */
  businessDayCutoff: string
}

/** Plan `limits.branches` (a number) → the cap, or null when the plan sets none. */
export function branchLimit(limits: Record<string, number | boolean> | null | undefined) {
  const v = limits?.branches
  return typeof v === 'number' && v > 0 ? v : null
}

export async function listBranches(tx: Tx, opts: { includeArchived?: boolean } = {}) {
  return tx
    .select()
    .from(branches)
    .where(opts.includeArchived ? undefined : eq(branches.active, true))
    .orderBy(desc(branches.active), desc(branches.isDefault), asc(branches.createdAt))
}

async function activeCount(tx: Tx) {
  return (await tx.select({ id: branches.id }).from(branches).where(eq(branches.active, true))).length
}

/** `opts.limit` = the active-branch cap (`Entitlements.branchCap`); `multiBranch: false` = Standard's single branch. */
type LimitOpts = { limit?: number | null; multiBranch?: boolean }

function checkLimit(count: number, { limit, multiBranch = true }: LimitOpts) {
  // PLAN §18.8: without the multiBranch feature the refusal is the Premium upsell, not a count.
  if (!multiBranch && count >= SINGLE_BRANCH_LIMIT) throw featureError('multiBranch')
  if (limit && count >= limit)
    throw new DomainError(`Your plan includes ${limit} branches`, 'invalid', {
      key: 'settings.branches.errors.limit',
      params: { count: limit },
    })
}

/** New branch; opening hours start as a copy of the main branch's (edit them under Settings → Opening hours). */
export async function createBranch(
  tx: Tx,
  tenantId: string,
  input: BranchInput,
  opts: LimitOpts = {},
) {
  checkLimit(await activeCount(tx), opts)
  const [main] = await tx
    .select({ hours: branches.openingHours })
    .from(branches)
    .where(eq(branches.isDefault, true))
  const [row] = await tx
    .insert(branches)
    .values({
      tenantId,
      name: input.name.trim(),
      address: input.address?.trim() || null,
      mapsUrl: input.mapsUrl?.trim() || null,
      phone: input.phone?.trim() || null,
      whatsappE164: input.whatsappE164 || null,
      businessDayCutoff: input.businessDayCutoff,
      openingHours: main?.hours ?? {},
      isDefault: false,
    })
    .returning()
  return row!
}

const notFound = () =>
  new DomainError('Branch not found', 'not_found', { key: 'settings.branches.errors.notFound' })

export async function updateBranch(tx: Tx, branchId: string, input: BranchInput) {
  const [row] = await tx
    .update(branches)
    .set({
      name: input.name.trim(),
      address: input.address?.trim() || null,
      ...(input.mapsUrl !== undefined && { mapsUrl: input.mapsUrl?.trim() || null }),
      phone: input.phone?.trim() || null,
      whatsappE164: input.whatsappE164 || null,
      businessDayCutoff: input.businessDayCutoff,
    })
    .where(eq(branches.id, branchId))
    .returning()
  if (!row) throw notFound()
  return row
}

/**
 * Archive (active=false) or restore a branch. Archived branches leave pickers, online booking and member scopes,
 * but their history (sales, bookings, ledger) stays. The main branch can't be archived.
 */
export async function setBranchActive(
  tx: Tx,
  branchId: string,
  active: boolean,
  opts: LimitOpts = {},
) {
  const [row] = await tx.select().from(branches).where(eq(branches.id, branchId))
  if (!row) throw notFound()
  if (row.active === active) return row
  if (!active && row.isDefault)
    throw new DomainError("The main branch can't be archived", 'invalid', {
      key: 'settings.branches.errors.archiveMain',
    })
  if (active) checkLimit(await activeCount(tx), opts)
  const [updated] = await tx.update(branches).set({ active }).where(eq(branches.id, branchId)).returning()
  return updated!
}

/**
 * Which branches a member works in: `'all'` (every branch, today's and future ones) or a list. Replaces the
 * member's assignment; the list must name at least one active branch of this spa.
 */
export async function setMemberBranches(tx: Tx, tenantId: string, memberId: string, scope: 'all' | string[]) {
  const [m] = await tx.select({ id: members.id }).from(members).where(eq(members.id, memberId))
  if (!m) throw new DomainError('Member not found', 'not_found', { key: 'team.result.notFound' })
  const ids = scope === 'all' ? [] : [...new Set(scope)]
  if (scope !== 'all') {
    const found = ids.length
      ? await tx
          .select({ id: branches.id })
          .from(branches)
          .where(and(inArray(branches.id, ids), eq(branches.active, true)))
      : []
    if (!ids.length || found.length !== ids.length)
      throw new DomainError('Choose at least one branch', 'invalid', {
        key: 'team.edit.branchesRequired',
      })
  }
  await tx.delete(memberBranches).where(eq(memberBranches.memberId, memberId))
  if (ids.length)
    await tx.insert(memberBranches).values(ids.map((branchId) => ({ tenantId, memberId, branchId })))
  await tx
    .update(members)
    .set({ allBranches: scope === 'all' })
    .where(eq(members.id, memberId))
}

/** Branch ids a member is limited to, or null when they work in every branch. */
export async function memberBranchIds(tx: Tx, memberId: string): Promise<string[] | null> {
  const [m] = await tx.select({ all: members.allBranches }).from(members).where(eq(members.id, memberId))
  if (!m || m.all) return null
  const rows = await tx
    .select({ id: memberBranches.branchId })
    .from(memberBranches)
    .where(eq(memberBranches.memberId, memberId))
  return rows.map((r) => r.id)
}

/** Active branches a member may work in (all of them for unrestricted members). */
export async function branchesForMember(tx: Tx, memberId: string | null) {
  const rows = await listBranches(tx)
  if (!memberId) return rows
  const scope = await memberBranchIds(tx, memberId)
  return scope ? rows.filter((b) => scope.includes(b.id)) : rows
}

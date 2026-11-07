// Dashboard home: branch scope and business dates, shared by the page and its 30 s refresh (R36) so both always
// read the same branches and day.
import { addDays, businessDateOf } from '@spa/core'
import { branches, type Tx } from '@spa/db'
import { eq } from 'drizzle-orm'
import type { MemberContext } from '@/server/access'
import { allowedBranches } from './calendar/data'

/** Matches no branch: a member scoped to branches that are all archived sees empty figures, not the whole spa. */
export const NO_BRANCH = '00000000-0000-0000-0000-000000000000'

const DAY = /^\d{4}-\d{2}-\d{2}$/

/** `?day=`: a real date within a year of today, else today. */
export function pickDay(value: string | undefined, today: string) {
  if (!value || !DAY.test(value)) return today
  const d = new Date(`${value}T12:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) return today
  return value >= addDays(today, -366) && value <= addDays(today, 366) ? value : today
}

/**
 * Branch picker (G22): members scoped to branches pick one of theirs (first by default); everyone else sees the whole
 * spa or picks a branch. A scoped member without an open branch sees nothing. `today` = the business date by the
 * branch's cutoff (the default branch's for the whole spa); `day` = the R36 card's day (`?day=`, default today).
 */
export async function homeScope(tx: Tx, ctx: MemberContext, o: { branch?: string; day?: string; now: Date }) {
  const scoped = Boolean(ctx.member && !ctx.member.allBranches)
  const allowed = await allowedBranches(tx, ctx)
  const picked = allowed.find((b) => b.id === o.branch) ?? (scoped ? allowed[0] : undefined)
  const branchId = picked?.id ?? (scoped ? NO_BRANCH : undefined)
  const branch =
    picked ?? (await tx.select().from(branches).where(eq(branches.isDefault, true)).limit(1))[0] ?? allowed[0]
  const cutoff = branch?.businessDayCutoff.slice(0, 5) ?? '05:00'
  const today = businessDateOf(o.now, cutoff)
  return {
    scoped,
    allowed,
    picked,
    branchId,
    /** R36 services: null = the whole spa (as kpis() without a branch). */
    branchIds: branchId ? [branchId] : null,
    branch,
    cutoff,
    today,
    day: pickDay(o.day, today),
  }
}

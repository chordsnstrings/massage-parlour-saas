import { businessDateOf } from '@spa/core'
import type { branches, Tx } from '@spa/db'
import { allowedBranches } from '@/app/dashboard/[tenant]/calendar/data'
import type { MemberContext } from '@/server/access'

export const DATE = /^\d{4}-\d{2}-\d{2}$/

/** The branch to work in (?branch=…, else the default) plus its current business date. */
export async function pickBranch(tx: Tx, ctx: MemberContext, branchId?: string) {
  const rows = await allowedBranches(tx, ctx)
  const branch = rows.find((b) => b.id === branchId) ?? rows[0]
  if (!branch) return null
  return { branch, branches: rows, today: businessDateOf(new Date(), cutoffOf(branch)) }
}

export const cutoffOf = (b: Pick<typeof branches.$inferSelect, 'businessDayCutoff'>) =>
  b.businessDayCutoff.slice(0, 5)

/** A business date (YYYY-MM-DD) as a Date at midday UTC — same calendar day in Asia/Dubai, for `fmt`. */
export const dayDate = (date: string) => new Date(`${date}T12:00:00Z`)

// F22 automatic billing transitions for platform invoices (PLAN §14.3, §18.8, §17). Manual billing: nothing here
// moves money. An unpaid invoice is *late* `overdueAfterDays` after its due date. The first day a spa is found late
// it enters `overdue` (the grace clock starts: `overdueSince`), the next day `grace`, and `graceDays` after
// `overdueSince` the dashboard becomes `read_only`. Paying every late invoice lifts it. A spa moves up at most one
// stage at a time (R37: missed runs never skip a stage). Pure rules only; the worker job and the payment paths apply
// them (services billing-transitions.ts).
import { addDays } from './booking'

export const BILLING_STAGES = ['overdue', 'grace', 'read_only'] as const
export type BillingStage = (typeof BILLING_STAGES)[number]

export type BillingRules = { overdueAfterDays: number; graceDays: number }
/** Owner defaults (2026-10-10 brief): overdue the day after the due date; 7 days' grace; then read-only. */
export const DEFAULT_BILLING_RULES: BillingRules = { overdueAfterDays: 1, graceDays: 7 }
/** Console bounds for the two settings. */
export const BILLING_RULE_LIMITS = {
  overdueAfterDays: { min: 1, max: 60 },
  graceDays: { min: 0, max: 90 },
} as const

const RANK: Record<BillingStage, number> = { overdue: 1, grace: 2, read_only: 3 }
export const billingStageRank = (s: BillingStage | null | undefined) => (s ? RANK[s] : 0)

/** First Dubai date on which an unpaid invoice counts as late. */
export const lateFrom = (dueDate: string, rules: BillingRules) => addDays(dueDate, rules.overdueAfterDays)
export const isLate = (dueDate: string, today: string, rules: BillingRules) =>
  today >= lateFrom(dueDate, rules)
/** First read-only day for a spa first found late on `overdueSince`. */
export const readOnlyFrom = (overdueSince: string, rules: BillingRules) =>
  addDays(overdueSince, rules.graceDays)

/** Where a late spa should be, given the day it was first found late. */
export function stageFor(overdueSince: string, today: string, rules: BillingRules): BillingStage {
  if (today >= readOnlyFrom(overdueSince, rules)) return 'read_only'
  return today > overdueSince ? 'grace' : 'overdue'
}

/** The stages a late spa passes through under these rules (`overdue` needs ≥ 1 grace day, `grace` ≥ 2). */
export const billingSteps = (rules: BillingRules) =>
  BILLING_STAGES.filter((s) => s === 'read_only' || rules.graceDays >= RANK[s])

export type BillingState = { stage: BillingStage | null; overdueSince: string | null }

/**
 * The next state of one spa. `late` = it has an unpaid invoice past `lateFrom`. `paused` (console, per spa or
 * globally) and `liftOnly` (payment paths) never escalate; lifting — fewer restrictions — always applies. A
 * longer grace period set later can step a spa back (read_only → grace). Escalation goes one step of `billingSteps`
 * per call (R37), so after missed runs (a worker outage) a spa still passes every stage, warnings first.
 */
export function nextBillingState(
  current: BillingState,
  late: boolean,
  today: string,
  rules: BillingRules,
  opts: { paused?: boolean; liftOnly?: boolean } = {},
): BillingState {
  if (!late) return { stage: null, overdueSince: null }
  const hold = opts.paused || opts.liftOnly
  if (!current.stage || !current.overdueSince) {
    if (hold) return current
    return { stage: stageFor(today, today, rules), overdueSince: today }
  }
  const target = stageFor(current.overdueSince, today, rules)
  const rank = RANK[current.stage]
  if (RANK[target] <= rank) return { stage: target, overdueSince: current.overdueSince }
  if (hold) return current
  return {
    stage: billingSteps(rules).find((s) => RANK[s] > rank) ?? target,
    overdueSince: current.overdueSince,
  }
}

/**
 * The first day a late spa can really be read-only (R37): `readOnlyFrom`, or later while the one-step rule still
 * has stages to pass (after an outage). `steppedToday` = its stage changed today, so its next step is tomorrow at
 * the earliest; otherwise today's run may take it. Read-only (or no stage): `readOnlyFrom`.
 */
export function effectiveReadOnlyFrom(
  state: BillingState,
  today: string,
  rules: BillingRules,
  steppedToday = false,
): string | null {
  if (!state.overdueSince) return null
  const from = readOnlyFrom(state.overdueSince, rules)
  if (!state.stage || state.stage === 'read_only') return from
  const rank = RANK[state.stage]
  const earliest = addDays(
    today,
    billingSteps(rules).filter((s) => RANK[s] > rank).length - (steppedToday ? 0 : 1),
  )
  return earliest > from ? earliest : from
}

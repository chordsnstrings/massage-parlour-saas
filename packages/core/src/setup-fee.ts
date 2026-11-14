// Setup fee on accepting a spa application (PLAN §18.3, owner answers 2026-10-09). Shared by the console's Accept
// dialog (live hint) and `acceptApplication` (validation), so both say the same thing.
import { addDays } from './booking'
import { createFormat } from './i18n/format'

/** When the rest of a setup-fee deposit is due: on the start (delivery) date, or 10 days after it (default). */
export const BALANCE_DUE_CHOICES = ['start', 'start_plus_10'] as const
export type BalanceDue = (typeof BALANCE_DUE_CHOICES)[number]
export const DEFAULT_BALANCE_DUE: BalanceDue = 'start_plus_10'

/** The setup invoice's due date (Asia/Dubai YYYY-MM-DD); never before `today` (its issue date). */
export function setupBalanceDueDate(start: string, choice: BalanceDue, today: string) {
  const due = choice === 'start' ? start : addDays(start, 10)
  return due < today ? today : due
}

const aed = createFormat('en').aed

/** The one wording of the deposit bounds: more than 0, less than the setup invoice total (VAT only when charged). */
export const depositRule = (totalAed: string | number, vat: boolean) =>
  `A deposit must be more than AED 0 and less than the setup invoice total (${aed(totalAed)}${
    vat ? ' incl. VAT' : ', no VAT'
  }).`

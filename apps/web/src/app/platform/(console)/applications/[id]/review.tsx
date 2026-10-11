'use client'
import {
  applyDiscount,
  BALANCE_DUE_CHOICES,
  type BalanceDue,
  DEFAULT_BALANCE_DUE,
  depositRule,
  parseDiscount,
  setupBalanceDueDate,
  vatTotals,
} from '@spa/core'
import { useState } from 'react'
import { type DiscountDraft, DiscountInput } from '@/components/plan/discount-input'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action'
import { formatAed, formatDate } from '@/lib/utils'

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>
/** `monthlyAed`: the monthly fee (null for a plan paid yearly). */
export type PlanChoice = {
  id: string
  label: string
  feeAed: string
  monthlyAed: string | null
}

/** A draft discount as the server will read it (`parseDiscount`); invalid → none (the server reports it). */
const draftDiscount = (d: DiscountDraft) => {
  const r = parseDiscount(d.kind, d.value)
  return r.ok ? r.discount : null
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Accept dialog (PLAN §18.3): plan + start date (prefilled from the application) and, when the plan has a setup fee,
 * VAT on/off (owner, 2026-10-09: optional; default = the platform settings), how it was paid — in full or a deposit
 * (amount + when the balance is due: start date or 10 days after it) — the date, cash / bank transfer / credit card,
 * reference + note. The plan's payment schedule is issued from the start date as well.
 */
export function AcceptSheet({
  action,
  plans,
  planId,
  unofferedPlan,
  startDate,
  today,
  vatRate,
  pricesIncludeVat,
}: {
  action: Action
  plans: PlanChoice[]
  /** Preselected plan; '' = none (the applicant's plan is no longer offered). */
  planId: string
  /** Name of the applicant's plan when it is no longer offered (archived, inactive or legacy). */
  unofferedPlan?: string
  startDate: string
  today: string
  /** The platform's VAT rate (%); 0 = no VAT choice to make. */
  vatRate: number
  pricesIncludeVat: boolean
}) {
  const [plan, setPlan] = useState(planId)
  const [start, setStart] = useState(startDate)
  const [vat, setVat] = useState(vatRate > 0)
  const [kind, setKind] = useState<'full' | 'deposit'>('full')
  const [due, setDue] = useState<BalanceDue>(DEFAULT_BALANCE_DUE)
  const [setupOff, setSetupOff] = useState<DiscountDraft>({ kind: 'none', value: '' })
  const [monthlyOff, setMonthlyOff] = useState<DiscountDraft>({ kind: 'none', value: '' })
  const chosen = plans.find((p) => p.id === plan)
  const listFee = Number(chosen?.feeAed ?? 0)
  // PLAN §18.8: the setup discount applies to the setup invoice; a fee discounted to 0 = no setup invoice.
  const setup = applyDiscount(listFee, draftDiscount(setupOff))
  const fee = Number(setup.netAed)
  const charged = vat && vatRate > 0
  const total = vatTotals(fee, { vatRate: String(vatRate), pricesIncludeVat }, charged).totalAed
  const monthly = chosen?.monthlyAed ? applyDiscount(chosen.monthlyAed, draftDiscount(monthlyOff)) : null
  const dueOn = (choice: BalanceDue) =>
    ISO_DATE.test(start) ? ` (${formatDate(setupBalanceDueDate(start, choice, today))})` : ''
  return (
    <FormSheet
      title="Accept application"
      description="Creates the spa with an active subscription, records the setup payment and issues the plan's invoices from the start date."
      trigger={<Button>Accept</Button>}
      action={action}
      submitLabel="Accept and create spa"
    >
      <Field
        label="Plan"
        name="planId"
        hint={
          unofferedPlan
            ? `The plan this applicant chose (${unofferedPlan}) is no longer offered. Choose one.`
            : undefined
        }
      >
        <Select id="planId" name="planId" value={plan} onChange={(e) => setPlan(e.target.value)}>
          {!plan && (
            <option value="" disabled>
              Choose a plan
            </option>
          )}
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <DiscountInput
          name="setupDiscount"
          label="Setup fee discount"
          hint="Optional: AED or % off the setup fee."
          onChange={setSetupOff}
        />
        <DiscountInput
          name="monthlyDiscount"
          label="Monthly fee discount"
          hint="Optional: AED or % off each monthly invoice."
          onChange={setMonthlyOff}
        />
      </div>
      {monthly && Number(monthly.discountAed) > 0 && (
        <p className="text-sm text-muted" data-testid="monthly-fee">
          Monthly fee {formatAed(chosen!.monthlyAed!)} − {formatAed(monthly.discountAed)} ={' '}
          {formatAed(monthly.netAed)} per month (excl. VAT).
        </p>
      )}
      <Field
        label="Start date"
        name="startDate"
        hint="The subscription runs one year from this date; its invoices start here."
      >
        <Input
          id="startDate"
          name="startDate"
          type="date"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
        />
      </Field>
      {/* No plan picked yet (the applicant's is no longer offered): no setup fee to describe. */}
      {!chosen ? null : fee > 0 ? (
        <fieldset className="space-y-4 rounded-lg border p-4">
          <legend className="px-1 text-sm font-semibold">Setup payment</legend>
          {vatRate > 0 && (
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox name="chargeVat" checked={vat} onChange={(e) => setVat(e.target.checked)} />
              Charge VAT ({vatRate}%)
            </label>
          )}
          <p className="text-sm text-muted" data-testid="setup-fee">
            Setup fee {formatAed(chosen!.feeAed)}
            {Number(setup.discountAed) > 0 && (
              <>
                {' '}
                − discount {formatAed(setup.discountAed)} = {formatAed(setup.netAed)}
              </>
            )}{' '}
            · invoice total {formatAed(total)} ({charged ? 'incl. VAT' : 'no VAT'}). Payments are recorded,
            never processed.
          </p>
          <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Setup payment">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="paymentKind"
                value="full"
                checked={kind === 'full'}
                onChange={() => setKind('full')}
              />
              Paid in full
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="paymentKind"
                value="deposit"
                checked={kind === 'deposit'}
                onChange={() => setKind('deposit')}
              />
              Deposit
            </label>
          </div>
          {kind === 'deposit' && (
            <>
              <Field
                label="Deposit amount (AED)"
                name="depositAed"
                hint={`${depositRule(total, charged)} The rest stays due on the invoice.`}
              >
                <Input id="depositAed" name="depositAed" inputMode="decimal" required />
              </Field>
              <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Balance due">
                <span className="font-medium">Balance due</span>
                {BALANCE_DUE_CHOICES.map((c) => (
                  <label key={c} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="balanceDue"
                      value={c}
                      checked={due === c}
                      onChange={() => setDue(c)}
                    />
                    {c === 'start' ? 'On the start / delivery date' : '10 days after start'}
                    <span className="text-muted">{dueOn(c)}</span>
                  </label>
                ))}
              </div>
            </>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Payment date" name="paidOn">
              <Input id="paidOn" name="paidOn" type="date" max={today} defaultValue={today} required />
            </Field>
            <Field label="Method" name="method">
              <Select id="method" name="method" defaultValue="bank_transfer">
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank transfer</option>
                <option value="card">Credit card</option>
              </Select>
            </Field>
          </div>
          <Field label="Reference (optional)" name="reference">
            <Input id="reference" name="reference" placeholder="Transfer ref / receipt no." />
          </Field>
          <Field label="Note (optional)" name="note">
            <Input id="note" name="note" />
          </Field>
        </fieldset>
      ) : (
        <p className="text-sm text-muted">
          {listFee > 0
            ? 'The setup fee is discounted to 0: no setup invoice or payment is recorded.'
            : 'This plan has no setup fee: no setup invoice or payment is recorded.'}
        </p>
      )}
    </FormSheet>
  )
}

export function RejectSheet({ action }: { action: Action }) {
  return (
    <FormSheet
      title="Reject application"
      description="Closes and signs out the applicant's login unless it already belongs to a spa (or is a super-admin). They get a short email."
      trigger={<Button variant="secondary">Reject</Button>}
      action={action}
      submitLabel="Reject application"
    >
      <Field label="Reason (optional)" name="reason">
        <Textarea id="reason" name="reason" rows={3} />
      </Field>
      <label className="flex items-center gap-2.5 text-sm">
        <Checkbox name="shareReason" /> Show reason to applicant
      </label>
    </FormSheet>
  )
}

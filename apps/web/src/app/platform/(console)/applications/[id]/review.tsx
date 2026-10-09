'use client'
import {
  BALANCE_DUE_CHOICES,
  type BalanceDue,
  DEFAULT_BALANCE_DUE,
  depositRule,
  setupBalanceDueDate,
} from '@spa/core'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action'
import { formatAed, formatDate } from '@/lib/utils'

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>
/** `totalVatAed` / `totalNoVatAed`: the setup invoice total with / without VAT. */
export type PlanChoice = {
  id: string
  label: string
  feeAed: string
  totalVatAed: string
  totalNoVatAed: string
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
  startDate,
  today,
  vatRate,
}: {
  action: Action
  plans: PlanChoice[]
  planId: string
  startDate: string
  today: string
  /** The platform's VAT rate (%); 0 = no VAT choice to make. */
  vatRate: number
}) {
  const [plan, setPlan] = useState(planId)
  const [start, setStart] = useState(startDate)
  const [vat, setVat] = useState(vatRate > 0)
  const [kind, setKind] = useState<'full' | 'deposit'>('full')
  const [due, setDue] = useState<BalanceDue>(DEFAULT_BALANCE_DUE)
  const chosen = plans.find((p) => p.id === plan)
  const fee = Number(chosen?.feeAed ?? 0)
  const charged = vat && vatRate > 0
  const total = (charged ? chosen?.totalVatAed : chosen?.totalNoVatAed) ?? '0'
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
      <Field label="Plan" name="planId">
        <Select id="planId" name="planId" value={plan} onChange={(e) => setPlan(e.target.value)}>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
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
      {fee > 0 ? (
        <fieldset className="space-y-4 rounded-lg border p-4">
          <legend className="px-1 text-sm font-semibold">Setup payment</legend>
          {vatRate > 0 && (
            <label className="flex items-center gap-2.5 text-sm">
              <Checkbox name="chargeVat" checked={vat} onChange={(e) => setVat(e.target.checked)} />
              Charge VAT ({vatRate}%)
            </label>
          )}
          <p className="text-sm text-muted" data-testid="setup-fee">
            Setup fee {formatAed(chosen!.feeAed)} · invoice total {formatAed(total)} (
            {charged ? 'incl. VAT' : 'no VAT'}). Payments are recorded, never processed.
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
          This plan has no setup fee: no setup invoice or payment is recorded.
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

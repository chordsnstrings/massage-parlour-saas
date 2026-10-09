'use client'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Checkbox, Input, Select, Textarea } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action'
import { formatAed } from '@/lib/utils'

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>
export type PlanChoice = { id: string; label: string; feeAed: string; invoiceTotalAed: string }

/**
 * Accept dialog (PLAN §18.3): plan + start date (prefilled from the application) and, when the plan has a setup fee,
 * how it was paid — in full or a deposit (amount), the date, cash / bank transfer / credit card, reference + note.
 */
export function AcceptSheet({
  action,
  plans,
  planId,
  startDate,
  today,
}: {
  action: Action
  plans: PlanChoice[]
  planId: string
  startDate: string
  today: string
}) {
  const [plan, setPlan] = useState(planId)
  const [kind, setKind] = useState<'full' | 'deposit'>('full')
  const chosen = plans.find((p) => p.id === plan)
  const fee = Number(chosen?.feeAed ?? 0)
  return (
    <FormSheet
      title="Accept application"
      description="Creates the spa with an active subscription and records the setup payment."
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
      <Field label="Start date" name="startDate" hint="The subscription runs one year from this date.">
        <Input id="startDate" name="startDate" type="date" defaultValue={startDate} required />
      </Field>
      {fee > 0 ? (
        <fieldset className="space-y-4 rounded-lg border p-4">
          <legend className="px-1 text-sm font-semibold">Setup payment</legend>
          <p className="text-sm text-muted" data-testid="setup-fee">
            Setup fee {formatAed(chosen!.feeAed)} · invoice total {formatAed(chosen!.invoiceTotalAed)} (incl.
            VAT). Payments are recorded, never processed.
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
            <Field
              label="Deposit amount (AED)"
              name="depositAed"
              hint={`More than 0 and less than ${formatAed(chosen!.invoiceTotalAed)}; the rest stays due on the invoice.`}
            >
              <Input id="depositAed" name="depositAed" inputMode="decimal" required />
            </Field>
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
      description="The applicant's login is closed and signed out. They get a short email."
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

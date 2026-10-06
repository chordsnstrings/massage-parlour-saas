'use client'
import { Ban, Printer, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select, Textarea } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action'

type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>

export function PrintButton() {
  return (
    <Button variant="secondary" size="lg" className="w-full" onClick={() => window.print()}>
      <Printer /> Print
    </Button>
  )
}

export function VoidSheet({ action, number }: { action: FormAction; number: number }) {
  return (
    <FormSheet
      title={`Void sale #${number}`}
      description="Use this for mistakes on a day that is still open. The sale drops out of today’s totals."
      submitLabel="Void sale"
      action={action}
      trigger={
        <Button variant="ghost" size="lg" className="w-full justify-start text-danger hover:text-danger">
          <Ban /> Void sale
        </Button>
      }
    >
      <Field label="Reason" name="reason">
        <Textarea id="reason" name="reason" rows={3} placeholder="e.g. Rang up the wrong client" />
      </Field>
    </FormSheet>
  )
}

export function RefundSheet({
  action,
  maxAed,
  defaultMethod,
}: {
  action: FormAction
  maxAed: number
  defaultMethod: string
}) {
  return (
    <FormSheet
      title="Record a refund"
      description="Give the money back first (cash, terminal or transfer), then record it here."
      submitLabel="Record refund"
      action={action}
      trigger={
        <Button variant="ghost" size="lg" className="w-full justify-start">
          <Undo2 /> Refund
        </Button>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Amount (AED)" name="amountAed" hint={`Up to ${maxAed.toFixed(2)}`}>
          <Input
            id="amountAed"
            name="amountAed"
            inputMode="decimal"
            defaultValue={maxAed.toFixed(2)}
            className="h-11 tabular"
          />
        </Field>
        <Field label="Paid back by" name="method">
          <Select id="method" name="method" defaultValue={defaultMethod} className="h-11">
            <option value="cash">Cash</option>
            <option value="card_terminal">Card terminal</option>
            <option value="bank_transfer">Bank transfer</option>
            <option value="other">Other</option>
          </Select>
        </Field>
      </div>
      <Field label="Reason" name="reason">
        <Textarea id="reason" name="reason" rows={3} placeholder="e.g. Session cut short" />
      </Field>
    </FormSheet>
  )
}

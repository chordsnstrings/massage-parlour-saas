'use client'
import { Ban, Printer, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldError } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select, Textarea } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action'
import { formatAed } from '@/lib/utils'

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

export type RefundLineOption = {
  saleLineId: string
  description: string
  qty: number
  refundedQty: number
  prepaid: boolean
  /** AED given back by each further unit, in refund order. */
  unitsAed: number[]
}

const sumFils = (units: number[], qty: number) =>
  units.slice(0, qty).reduce((s, v) => s + Math.round(v * 100), 0)

/** Why a line can't be refunded (any more), or what each unit gives back. */
function lineHint(l: RefundLineOption) {
  const left = l.unitsAed.length
  if (left === 0) {
    if (l.refundedQty >= l.qty) return 'Refunded'
    return l.prepaid ? 'Used — nothing unused to refund' : 'Nothing paid to refund'
  }
  if (l.prepaid)
    return left === 1
      ? `Unused ${formatAed(l.unitsAed[0]!)}`
      : `${left} unused · ${l.unitsAed.map(formatAed).join(', ')}`
  const each = l.unitsAed[0]!
  const same = l.unitsAed.every((v) => Math.abs(v - each) < 0.02)
  return `${left} of ${l.qty} refundable · ${same ? `${formatAed(each)} each` : formatAed(sumFils(l.unitsAed, left) / 100)}`
}

export function RefundSheet({
  action,
  lines,
  maxAed,
  defaultMethod,
}: {
  action: FormAction
  lines: RefundLineOption[]
  /** Sale-wide amount still refundable. */
  maxAed: number
  defaultMethod: string
}) {
  const [qty, setQty] = useState<Record<string, number>>({})
  const refundable = lines.filter((l) => l.unitsAed.length > 0)
  const totalFils = refundable.reduce((s, l) => s + sumFils(l.unitsAed, qty[l.saleLineId] ?? 0), 0)
  const set = (l: RefundLineOption, raw: string) => {
    const n = Math.floor(Number(raw))
    setQty((q) => ({
      ...q,
      [l.saleLineId]: Number.isFinite(n) ? Math.min(Math.max(n, 0), l.unitsAed.length) : 0,
    }))
  }
  const all = () => setQty(Object.fromEntries(refundable.map((l) => [l.saleLineId, l.unitsAed.length])))
  return (
    <FormSheet
      title="Record a refund"
      description="Pick what is coming back, give the money back first (cash, terminal or transfer), then record it here."
      submitLabel="Record refund"
      action={action}
      trigger={
        <Button variant="ghost" size="lg" className="w-full justify-start">
          <Undo2 /> Refund
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium">Items</p>
          {refundable.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={all}>
              Refund everything
            </Button>
          )}
        </div>
        <ul className="divide-y rounded-xl border">
          {lines.map((l) => {
            const max = l.unitsAed.length
            const label = `Refund quantity for ${l.description}`
            return (
              <li key={l.saleLineId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className={max ? 'text-sm font-medium' : 'text-sm font-medium text-muted'}>
                    {l.qty > 1 && <span className="tabular">{l.qty} × </span>}
                    {l.description}
                  </p>
                  <p className="text-[13px] text-muted tabular">{lineHint(l)}</p>
                </div>
                {max > 0 && (
                  <Input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={max}
                    step={1}
                    name={`qty.${l.saleLineId}`}
                    aria-label={label}
                    value={Math.min(qty[l.saleLineId] ?? 0, max)}
                    onChange={(e) => set(l, e.target.value)}
                    className="h-11 w-20 shrink-0 text-center tabular"
                  />
                )}
              </li>
            )
          })}
        </ul>
        <FieldError name="lines" />
      </div>
      <div className="flex items-baseline justify-between gap-4 rounded-xl bg-subtle px-4 py-3">
        <span className="text-sm text-muted">To give back</span>
        <span className="text-lg font-semibold tracking-tight tabular" data-testid="refund-total">
          {formatAed(totalFils / 100)}
        </span>
      </div>
      {totalFils > Math.round(maxAed * 100) && (
        <p className="text-[13px] text-danger">
          At most {formatAed(maxAed)} can still be refunded on this sale.
        </p>
      )}
      <Field label="Paid back by" name="method">
        <Select id="method" name="method" defaultValue={defaultMethod} className="h-11">
          <option value="cash">Cash</option>
          <option value="card_terminal">Card terminal</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="other">Other</option>
        </Select>
      </Field>
      <Field label="Reason" name="reason">
        <Textarea id="reason" name="reason" rows={3} placeholder="e.g. Session cut short" />
      </Field>
    </FormSheet>
  )
}

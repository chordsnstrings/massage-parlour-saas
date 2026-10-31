'use client'
import { enumLabel } from '@spa/core/i18n/labels'
import type { Translator } from '@spa/core/i18n/translate'
import { Ban, Printer, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Field, FieldError } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select, Textarea } from '@/components/ui/input'
import { useI18n } from '@/i18n/client'
import type { ActionResult } from '@/lib/action'

type FormAction = (prev: ActionResult, formData: FormData) => Promise<ActionResult>

export function PrintButton() {
  const { t } = useI18n()
  return (
    <Button variant="secondary" className="w-full" onClick={() => window.print()}>
      <Printer /> {t('sales.receipt.print')}
    </Button>
  )
}

export function VoidSheet({ action, number }: { action: FormAction; number: number }) {
  const { t } = useI18n()
  return (
    <FormSheet
      title={t('sales.void.title', { number })}
      description={t('sales.void.description')}
      submitLabel={t('sales.void.submit')}
      action={action}
      trigger={
        <Button variant="ghost" className="w-full justify-start text-danger hover:text-danger">
          <Ban /> {t('sales.void.submit')}
        </Button>
      }
    >
      <Field label={t('sales.void.reason')} name="reason">
        <Textarea id="reason" name="reason" rows={3} placeholder={t('sales.void.reasonPlaceholder')} />
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
function lineHint(t: Translator, aed: (v: number) => string, l: RefundLineOption) {
  const left = l.unitsAed.length
  if (left === 0) {
    if (l.refundedQty >= l.qty) return t('sales.refund.refunded')
    return l.prepaid ? t('sales.refund.usedUp') : t('sales.refund.nothingPaid')
  }
  if (l.prepaid)
    return left === 1
      ? t('sales.refund.unusedOne', { amount: aed(l.unitsAed[0]!) })
      : t('sales.refund.unusedMany', { count: left, amounts: l.unitsAed.map(aed).join(', ') })
  const each = l.unitsAed[0]!
  const same = l.unitsAed.every((v) => Math.abs(v - each) < 0.02)
  return same
    ? t('sales.refund.refundableEach', { left, qty: l.qty, amount: aed(each) })
    : t('sales.refund.refundableSum', { left, qty: l.qty, amount: aed(sumFils(l.unitsAed, left) / 100) })
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
  const { t, fmt } = useI18n()
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
      title={t('sales.refund.title')}
      description={t('sales.refund.description')}
      submitLabel={t('sales.refund.submit')}
      action={action}
      trigger={
        <Button variant="ghost" className="w-full justify-start">
          <Undo2 /> {t('sales.refund.trigger')}
        </Button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm font-medium">{t('sales.refund.items')}</p>
          {refundable.length > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={all}>
              {t('sales.refund.everything')}
            </Button>
          )}
        </div>
        <ul className="divide-y rounded-xl border">
          {lines.map((l) => {
            const max = l.unitsAed.length
            const label = t('sales.refund.qtyFor', { name: l.description })
            return (
              <li key={l.saleLineId} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className={max ? 'text-sm font-medium' : 'text-sm font-medium text-muted'}>
                    {l.qty > 1 && <span className="tabular">{l.qty} × </span>}
                    {l.description}
                  </p>
                  <p className="text-[13px] text-muted tabular">{lineHint(t, fmt.aed, l)}</p>
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
        <span className="text-sm text-muted">{t('sales.refund.toGiveBack')}</span>
        <span className="text-lg font-semibold tracking-tight tabular" data-testid="refund-total">
          {fmt.aed(totalFils / 100)}
        </span>
      </div>
      {totalFils > Math.round(maxAed * 100) && (
        <p className="text-[13px] text-danger">{t('sales.refund.atMost', { amount: fmt.aed(maxAed) })}</p>
      )}
      <Field label={t('sales.refund.paidBackBy')} name="method">
        <Select id="method" name="method" defaultValue={defaultMethod}>
          {(['cash', 'card_terminal', 'bank_transfer', 'other'] as const).map((m) => (
            <option key={m} value={m}>
              {enumLabel(t, 'paymentMethodKind', m)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('sales.refund.reason')} name="reason">
        <Textarea id="reason" name="reason" rows={3} placeholder={t('sales.refund.reasonPlaceholder')} />
      </Field>
    </FormSheet>
  )
}

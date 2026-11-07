'use client'
// Per-spa discount on the setup fee or the monthly fee (PLAN §18.8, console only — English). Posts
// `{name}Kind` (none | amount | percent) + `{name}Value`; parsed on the server with `parseDiscount` (@spa/core).
import type { Discount, DiscountKind } from '@spa/core'
import { useState } from 'react'
import { Field } from '@/components/ui/form'
import { Input, Select } from '@/components/ui/input'

export type DiscountDraft = { kind: DiscountKind | 'none'; value: string }

export const discountDraft = (d: Discount | null | undefined): DiscountDraft =>
  d ? { kind: d.kind, value: String(Number(d.value)) } : { kind: 'none', value: '' }

export function DiscountInput({
  name,
  label,
  hint,
  initial,
  onChange,
}: {
  name: 'setupDiscount' | 'monthlyDiscount'
  label: string
  hint?: string
  initial?: Discount | null
  onChange?: (d: DiscountDraft) => void
}) {
  const [draft, setDraft] = useState<DiscountDraft>(discountDraft(initial))
  const update = (next: DiscountDraft) => {
    setDraft(next)
    onChange?.(next)
  }
  return (
    <Field label={label} name={`${name}Value`} hint={hint}>
      <div className="flex gap-2">
        <Select
          name={`${name}Kind`}
          aria-label={`${label}: type`}
          value={draft.kind}
          onChange={(e) => update({ ...draft, kind: e.target.value as DiscountDraft['kind'] })}
          className="w-32 shrink-0"
        >
          <option value="none">None</option>
          <option value="percent">%</option>
          <option value="amount">AED</option>
        </Select>
        <Input
          id={`${name}Value`}
          name={`${name}Value`}
          inputMode="decimal"
          aria-label={`${label}: value`}
          placeholder={draft.kind === 'percent' ? '10' : draft.kind === 'amount' ? '500' : ''}
          disabled={draft.kind === 'none'}
          value={draft.kind === 'none' ? '' : draft.value}
          onChange={(e) => update({ ...draft, value: e.target.value })}
        />
      </div>
    </Field>
  )
}

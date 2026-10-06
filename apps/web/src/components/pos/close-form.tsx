'use client'
import { Check, TriangleAlert } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Textarea } from '@/components/ui/input'
import type { ActionResult } from '@/lib/action'
import { cn, formatAed } from '@/lib/utils'

const f = (v: string) => {
  const n = Number.parseFloat(v.replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

/** Opening float + counted cash with live expected cash and variance. `cashMovementAed` = cash in − cash out. */
export function CloseForm({
  action,
  cashMovementAed,
  defaultFloat,
}: {
  action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>
  cashMovementAed: number
  defaultFloat: number
}) {
  const reduce = useReducedMotion()
  const [float, setFloat] = useState(defaultFloat ? String(defaultFloat) : '')
  const [counted, setCounted] = useState('')
  const expected = f(float) + Math.round(cashMovementAed * 100)
  const variance = f(counted) - expected
  const hasCount = counted.trim() !== ''
  const tone = !hasCount ? 'idle' : variance === 0 ? 'even' : Math.abs(variance) <= 1000 ? 'small' : 'large'

  return (
    <ActionForm action={action} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Opening float (AED)" name="openingFloatAed" hint="Cash in the drawer at opening">
          <Input
            id="openingFloatAed"
            name="openingFloatAed"
            inputMode="decimal"
            placeholder="0"
            value={float}
            onChange={(e) => setFloat(e.target.value)}
            className="h-11 tabular"
          />
        </Field>
        <Field label="Counted cash (AED)" name="countedCashAed" hint="Everything in the drawer now">
          <Input
            id="countedCashAed"
            name="countedCashAed"
            inputMode="decimal"
            placeholder="0"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            className="h-11 tabular"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border bg-subtle/40 px-4 py-3.5">
          <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">Expected cash</p>
          <p className="mt-1.5 text-lg font-semibold tabular" data-testid="expected-cash">
            {formatAed(expected / 100)}
          </p>
        </div>
        <motion.div
          key={tone}
          initial={reduce ? false : { scale: 0.97, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          aria-live="polite"
          className={cn(
            'rounded-xl border px-4 py-3.5 transition-colors',
            tone === 'even' && 'border-accent/30 bg-accent-soft text-accent',
            tone === 'small' && 'border-warning/30 bg-warning-soft text-warning',
            tone === 'large' && 'border-danger/30 bg-danger-soft text-danger',
          )}
        >
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-[0.06em] opacity-80">
            {tone === 'even' && <Check className="size-3.5" />}
            {(tone === 'small' || tone === 'large') && <TriangleAlert className="size-3.5" />}
            Variance
          </p>
          <p className="mt-1.5 text-lg font-semibold tabular" data-testid="variance">
            {hasCount
              ? `${variance > 0 ? '+' : variance < 0 ? '−' : ''}${formatAed(Math.abs(variance) / 100)}`
              : '—'}
          </p>
        </motion.div>
      </div>

      <Field label="Notes" name="notes" hint="Explain any difference — it stays on the record.">
        <Textarea id="notes" name="notes" rows={3} />
      </Field>
      <SubmitButton size="lg" className="h-12 w-full sm:w-auto" disabled={!hasCount}>
        Close the day
      </SubmitButton>
    </ActionForm>
  )
}

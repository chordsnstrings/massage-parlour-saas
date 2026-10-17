'use client'
import { Check, TriangleAlert } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Textarea } from '@/components/ui/input'
import { useI18n } from '@/i18n/client'
import type { ActionResult } from '@/lib/action'
import { cn } from '@/lib/utils'

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
  const { t, fmt } = useI18n()
  const [float, setFloat] = useState(defaultFloat ? String(defaultFloat) : '')
  const [counted, setCounted] = useState('')
  const expected = f(float) + Math.round(cashMovementAed * 100)
  const variance = f(counted) - expected
  const hasCount = counted.trim() !== ''
  const tone = !hasCount ? 'idle' : variance === 0 ? 'even' : Math.abs(variance) <= 1000 ? 'small' : 'large'

  return (
    <ActionForm action={action} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('sales.close.floatLabel')} name="openingFloatAed" hint={t('sales.close.floatHint')}>
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
        <Field
          label={t('sales.close.countedLabel')}
          name="countedCashAed"
          hint={t('sales.close.countedHint')}
        >
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
        <div className="crm-stat">
          <p className="crm-lab">{t('sales.close.expectedCash')}</p>
          <p className="crm-n" data-testid="expected-cash">
            {fmt.aed(expected / 100)}
          </p>
        </div>
        <motion.div
          key={tone}
          initial={reduce ? false : { scale: 0.97, opacity: 0.7 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          aria-live="polite"
          className={cn(
            'crm-stat transition-colors',
            tone === 'even' && 'border-accent/30 bg-accent-soft text-accent',
            tone === 'small' && 'border-warning/30 bg-warning-soft text-warning',
            tone === 'large' && 'border-danger/30 bg-danger-soft text-danger',
          )}
        >
          <p className="crm-lab text-inherit opacity-80">
            {tone === 'even' && <Check className="size-3.5" />}
            {(tone === 'small' || tone === 'large') && <TriangleAlert className="size-3.5" />}
            {t('sales.close.variance')}
          </p>
          <p className="crm-n text-inherit" data-testid="variance">
            {hasCount
              ? `${variance > 0 ? '+' : variance < 0 ? '−' : ''}${fmt.aed(Math.abs(variance) / 100)}`
              : '—'}
          </p>
        </motion.div>
      </div>

      <Field label={t('sales.close.notes')} name="notes" hint={t('sales.close.notesHint')}>
        <Textarea id="notes" name="notes" rows={3} />
      </Field>
      <SubmitButton className="w-full sm:w-auto" disabled={!hasCount}>
        {t('sales.close.submit')}
      </SubmitButton>
    </ActionForm>
  )
}

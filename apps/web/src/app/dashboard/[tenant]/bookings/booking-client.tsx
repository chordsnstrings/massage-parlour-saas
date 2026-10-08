'use client'
import { CheckCircle2, RotateCcw, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { useConfirmAction } from '@/app/dashboard/[tenant]/services/services-client'
import { Button } from '@/components/ui/button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { useI18n, useT } from '@/i18n/client'
import { markBookingAction, saveCommissionAction } from './actions'

/** Pending / Cancelled buttons for the booking detail (Completed = the commission form). */
export function BookingMarks({
  slug,
  bookingId,
  status,
  canReopen,
}: {
  slug: string
  bookingId: string
  status: string
  canReopen: boolean
}) {
  const t = useT()
  const router = useRouter()
  const { pending, run } = useConfirmAction()
  const [reason, setReason] = useState('')
  const completed = status === 'completed'
  const closed = status === 'cancelled' || status === 'no_show'
  if (closed)
    return <p className="crm-muted text-[length:var(--crm-fs-sub)]">{t('bookings.detail.rebookHint')}</p>
  return (
    <div className="flex flex-wrap items-end gap-2">
      {completed && canReopen && (
        <Button
          variant="secondary"
          pending={pending}
          onClick={() =>
            run(
              t('bookings.detail.confirmReopen'),
              () => markBookingAction(slug, { bookingId, mark: 'pending' }),
              () => router.refresh(),
            )
          }
        >
          <RotateCcw /> {t('bookings.detail.markPending')}
        </Button>
      )}
      {(!completed || canReopen) && (
        <>
          <Field label={t('bookings.detail.reason')} name="reason" className="min-w-48 flex-1">
            <Input id="reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Button
            variant="danger"
            pending={pending}
            onClick={() =>
              run(
                t('bookings.detail.confirmCancel'),
                () => markBookingAction(slug, { bookingId, mark: 'cancelled', reason }),
                () => router.refresh(),
              )
            }
          >
            <XCircle /> {t('bookings.detail.markCancelled')}
          </Button>
        </>
      )}
    </div>
  )
}

export type CommissionRow = {
  itemId: string
  staffId: string
  name: string
  service: string
  amountAed: number | null
}

/** One AED field per item + therapist; submitting completes the booking (or saves a correction). */
export function CommissionForm({
  slug,
  bookingId,
  rows,
  completed,
}: {
  slug: string
  bookingId: string
  rows: CommissionRow[]
  completed: boolean
}) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const [values, setValues] = useState(() =>
    Object.fromEntries(rows.map((r) => [`c:${r.itemId}:${r.staffId}`, r.amountAed?.toString() ?? ''])),
  )
  const total = Object.values(values).reduce((s, v) => s + (Number(v) || 0), 0)
  return (
    <ActionForm
      action={saveCommissionAction.bind(null, slug, bookingId)}
      onSuccess={() => router.refresh()}
      className="space-y-3"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => {
          const key = `c:${r.itemId}:${r.staffId}`
          return (
            <Field
              key={key}
              name={key}
              label={t('bookings.commission.amount', { name: r.name, service: r.service })}
            >
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 start-3 grid place-items-center text-sm text-muted">
                  AED
                </span>
                <Input
                  id={key}
                  name={key}
                  inputMode="decimal"
                  required
                  value={values[key]}
                  onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
                  className="ps-12 tabular-nums"
                />
              </div>
            </Field>
          )
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="crm-muted text-[length:var(--crm-fs-sub)]">
          {t('bookings.commission.total')}: <strong className="crm-num">{fmt.aed(total)}</strong>
        </span>
        <SubmitButton>
          <CheckCircle2 /> {completed ? t('bookings.commission.save') : t('bookings.commission.complete')}
        </SubmitButton>
      </div>
    </ActionForm>
  )
}

/** Completing a booking without therapists: just the button. */
export function CompleteButton({ slug, bookingId }: { slug: string; bookingId: string }) {
  const t = useT()
  const router = useRouter()
  return (
    <ActionForm action={saveCommissionAction.bind(null, slug, bookingId)} onSuccess={() => router.refresh()}>
      <SubmitButton>
        <CheckCircle2 /> {t('bookings.commission.complete')}
      </SubmitButton>
    </ActionForm>
  )
}

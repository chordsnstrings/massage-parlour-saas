'use client'
// R36 inline Confirm for a pending booking: opens the R32 Confirm form (fee + commission, prefilled as on the
// booking page) in a sheet; submitting runs the same confirmBookingAction as the calendar and the booking page.
import { Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { TermsForm } from '@/components/bookings/order-forms'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n/client'
import { type ConfirmTerms, confirmTermsAction } from './confirm-actions'

export function ConfirmBookingButton({
  slug,
  bookingId,
  name,
  description,
  onDone,
}: {
  slug: string
  bookingId: string
  /** Client first name / walk-in (aria label). */
  name: string
  /** Sheet sub line, e.g. service · time. */
  description?: string
  onDone?: () => void
}) {
  const t = useT()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [terms, setTerms] = useState<ConfirmTerms | null>(null)
  const [pending, start] = useTransition()

  const load = () =>
    start(async () => {
      const r = await confirmTermsAction(slug, bookingId).catch(() => null)
      if (!r) {
        // Confirmed or cancelled meanwhile (or no longer allowed): show the current state.
        toast.error(t('errors.generic'))
        router.refresh()
        return
      }
      setTerms(r)
      setOpen(true)
    })

  return (
    <>
      <Button
        size="sm"
        pending={pending}
        onClick={load}
        aria-label={t('overview.today.confirmLabel', { name })}
        data-confirm-booking={bookingId}
      >
        <Check /> {t('overview.today.action.confirm')}
      </Button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title={t('overview.today.confirmTitle', { ref: terms?.ref ?? '' })}
        description={description}
      >
        {terms && (
          <TermsForm
            slug={slug}
            bookingId={bookingId}
            items={terms.items}
            canCommission={terms.canCommission}
            confirm
            onDone={() => {
              setOpen(false)
              onDone?.()
            }}
          />
        )}
      </Sheet>
    </>
  )
}

'use client'
// R36 inline Confirm for a pending booking: opens the R32 Confirm form (fee + commission, prefilled as on the
// booking page) in a sheet; submitting runs the same confirmBookingAction as the calendar and the booking page.
import { Check } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { TermsForm } from '@/components/bookings/order-forms'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n/client'
import { type ConfirmTerms, confirmTermsAction } from './confirm-actions'

/** Focuses the first match of newline-separated selectors. */
function focusNext(key: string) {
  for (const sel of key ? key.split('\n') : []) {
    const el = document.querySelector<HTMLElement>(sel)
    if (el) return el.focus()
  }
}

export function ConfirmBookingButton({
  slug,
  bookingId,
  name,
  description,
  onDone,
  onOpenChange,
  focusAfter,
}: {
  slug: string
  bookingId: string
  /** Client first name / walk-in (aria label). */
  name: string
  /** Sheet sub line, e.g. service · time. */
  description?: string
  onDone?: () => void
  /** The form opened / closed (the pop-up keeps its toast while the form is open). */
  onOpenChange?: (open: boolean) => void
  /**
   * Where focus goes once this button is gone after a confirm (the row / toast changed): CSS selectors, first match
   * wins (strings, so server components can pass them). Else focus returns to the button.
   */
  focusAfter?: string[]
}) {
  const t = useT()
  const router = useRouter()
  const [open, setOpenState] = useState(false)
  const [terms, setTerms] = useState<ConfirmTerms | null>(null)
  const [pending, start] = useTransition()
  const button = useRef<HTMLButtonElement>(null)
  const confirmed = useRef(false)
  const setOpen = (o: boolean) => {
    setOpenState(o)
    onOpenChange?.(o)
  }
  const afterKey = focusAfter?.join('\n') ?? ''

  // Confirmed, and the refresh then removed this button while it had focus: move on instead of leaving <body>.
  useEffect(
    () => () => {
      if (!confirmed.current) return
      setTimeout(() => {
        if (!document.activeElement || document.activeElement === document.body) focusNext(afterKey)
      }, 0)
    },
    [afterKey],
  )

  const load = () =>
    start(async () => {
      let failed = false
      const r = await confirmTermsAction(slug, bookingId).catch(() => {
        failed = true
        return null
      })
      if (!r) {
        // Network / server error, else confirmed or cancelled meanwhile (or no longer allowed): show the current state.
        toast.error(t(failed ? 'errors.generic' : 'overview.today.confirmGone'))
        router.refresh()
        return
      }
      setTerms(r)
      setOpen(true)
    })

  return (
    <>
      <Button
        ref={button}
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
        onCloseAutoFocus={(e) => {
          // No Dialog.Trigger: Radix would leave focus on <body>. Back to this button, else the caller's target.
          e.preventDefault()
          if (button.current?.isConnected) button.current.focus()
          else focusNext(afterKey)
        }}
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
              confirmed.current = true
              setOpen(false)
              onDone?.()
            }}
          />
        )}
      </Sheet>
    </>
  )
}

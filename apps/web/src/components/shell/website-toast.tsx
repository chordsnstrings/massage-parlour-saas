'use client'
// R36 website pop-ups (PLAN §14.8): a new online booking / website enquiry shows in the top end corner anywhere in the
// spa CRM — title + body (reader's locale), Open (marks read, like a bell click), Confirm for a still-pending online
// booking (calendar.manage; the dashboard's ConfirmBookingButton = the R32 Confirm form + confirmBookingAction, so its
// errors show in that form), Dismiss and a per-device Sound switch. The bell
// (notification-bell.tsx) decides what is new; this file renders the stack and keeps the per-device memory.
// Styles: crm.css (.crm-pop*).
import { CalendarPlus, MessageSquareText, Volume2, VolumeX, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ConfirmBookingButton } from '@/components/bookings/confirm-booking'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/client'
import type { BellItem } from '@/server/notifications'

const SOUND_KEY = 'crm.popup.sound'
const SHOWN_KEY = 'crm.popup.shown'

/** Sound on unless this device switched it off (storage may throw: private mode, blocked site data). */
export function readSound(): boolean {
  try {
    return localStorage.getItem(SOUND_KEY) !== 'off'
  } catch {
    return true
  }
}

export function writeSound(on: boolean) {
  try {
    localStorage.setItem(SOUND_KEY, on ? 'on' : 'off')
  } catch {
    // Not remembered on this device.
  }
}

/** The ids not popped up on this device yet; remembers them (newest 40), so another tab or a reload won't repeat. */
export function takeUnshown(ids: string[]): Set<string> {
  let shown: string[] = []
  try {
    const raw = JSON.parse(localStorage.getItem(SHOWN_KEY) ?? '[]')
    if (Array.isArray(raw)) shown = raw.filter((x): x is string => typeof x === 'string')
  } catch {
    // Unreadable: treat as empty.
  }
  const fresh = ids.filter((id) => !shown.includes(id))
  if (fresh.length) {
    try {
      localStorage.setItem(SHOWN_KEY, JSON.stringify([...fresh, ...shown].slice(0, 40)))
    } catch {
      // Not remembered on this device.
    }
  }
  return new Set(fresh)
}

export function WebsiteToasts({
  slug,
  items,
  sound,
  onSound,
  onOpen,
  onDismiss,
  onConfirmed,
  onFormOpen,
}: {
  slug: string
  /** Newest first, at most 3 (latest text from the bell's data). */
  items: BellItem[]
  sound: boolean
  onSound: (on: boolean) => void
  onOpen: (n: BellItem) => void
  onDismiss: (id: string) => void
  onConfirmed: (n: BellItem) => void
  /** Its Confirm form opened / closed: the bell keeps that toast while a newer alert arrives. */
  onFormOpen: (id: string, open: boolean) => void
}) {
  const t = useT()
  const [mounted, setMounted] = useState(false)
  const [confirmed, setConfirmed] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    setMounted(true)
  }, [])

  // Mounted once so screen readers announce what is added (a live region must exist before its content).
  if (!mounted) return null
  return createPortal(
    <div
      className="crm-pop-stack"
      role="status"
      aria-live="polite"
      aria-label={t('notifications.toast.label')}
    >
      {items.map((n) => {
        const done = confirmed.has(n.id)
        const Icon = n.kind === 'booking.online' ? CalendarPlus : MessageSquareText
        return (
          <div key={n.id} className="crm-pop" data-testid="website-toast">
            <span className="crm-pop-ic" aria-hidden>
              <Icon strokeWidth={1.7} />
            </span>
            <div className="crm-pop-b">
              <b>{n.title}</b>
              {/* The stored body says "waiting for confirmation": gone once confirmed here. */}
              {n.body && !done && <span>{n.body}</span>}
              {done && (
                <p className="crm-pop-msg" tabIndex={-1} data-toast-confirmed={n.id}>
                  {t('notifications.toast.confirmed')}
                </p>
              )}
              <div className="crm-pop-a">
                {n.confirm && !done && (
                  <ConfirmBookingButton
                    slug={slug}
                    bookingId={n.confirm.bookingId}
                    name={n.confirm.name}
                    description={n.body}
                    onDone={() => {
                      setConfirmed((c) => new Set(c).add(n.id))
                      onConfirmed(n)
                    }}
                    onOpenChange={(open) => onFormOpen(n.id, open)}
                    focusAfter={[`[data-toast-confirmed="${CSS.escape(n.id)}"]`]}
                  />
                )}
                {n.href && (
                  <Button size="sm" variant="secondary" onClick={() => onOpen(n)}>
                    {t('notifications.toast.open')}
                  </Button>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={sound}
                  className="crm-pop-sound"
                  onClick={() => onSound(!sound)}
                >
                  {sound ? <Volume2 aria-hidden /> : <VolumeX aria-hidden />}
                  {t('notifications.toast.sound')}
                </button>
              </div>
            </div>
            <button
              type="button"
              className="crm-pop-x"
              aria-label={t('ui.dismiss')}
              onClick={() => onDismiss(n.id)}
            >
              <X strokeWidth={1.7} />
            </button>
          </div>
        )
      })}
    </div>,
    document.body,
  )
}

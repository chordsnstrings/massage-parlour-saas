import { phoneDisplay } from '@spa/core'
import type { BookingStatus } from './types'

/** Grid minute (minutes since 00:00 of the business date, may exceed 1440) → "HH:MM". */
export const minuteLabel = (m: number) => {
  const wrapped = ((Math.round(m) % 1440) + 1440) % 1440
  const h = Math.floor(wrapped / 60)
  const mm = wrapped % 60
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/** "HH:MM" from a time input → grid minute, rolling past midnight when before the business-day cutoff. */
export const timeToGridMinute = (hhmm: string, cutoffMin: number) => {
  const [h, m] = hhmm.split(':').map(Number)
  const min = (h ?? 0) * 60 + (m ?? 0)
  return min < cutoffMin ? min + 1440 : min
}

export const snap = (m: number, step = 15) => Math.round(m / step) * step

/** Legacy English labels/tones (still used by un-converted screens); calendar UI uses enumLabel + crm statusTone. */
export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Pending',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  in_service: 'In service',
  completed: 'Completed',
  no_show: 'No-show',
  cancelled: 'Cancelled',
}

export const STATUS_TONE: Record<BookingStatus, 'neutral' | 'accent' | 'success' | 'warning' | 'danger'> = {
  pending: 'warning',
  confirmed: 'neutral',
  checked_in: 'accent',
  in_service: 'accent',
  completed: 'success',
  no_show: 'danger',
  cancelled: 'neutral',
}

export const isHiddenStatus = (s: BookingStatus) => s === 'cancelled' || s === 'no_show'

/** Masks a stored number (any country, R38): 971501234567 → +971 50 ••• 4567, 447700900123 → +44 ••• 0123. */
export const maskPhone = (e164: string) => phoneDisplay(e164, { mask: 'last4' })

/** +971 50 123 4567 for UAE mobiles, +digits for other countries. */
export const formatPhone = (e164: string) => phoneDisplay(e164)

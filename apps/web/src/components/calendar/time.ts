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

/** Long, friendly label for a YYYY-MM-DD business date. */
export const dateLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })

export const shortDateLabel = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  })

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

export const SOURCE_LABEL: Record<string, string> = {
  phone: 'Phone',
  whatsapp: 'WhatsApp',
  walk_in: 'Walk-in',
  instagram: 'Instagram',
  online: 'Online',
  ai_agent: 'AI agent',
  gbp: 'Google',
}

export const isHiddenStatus = (s: BookingStatus) => s === 'cancelled' || s === 'no_show'

/** Masks a UAE E.164 number: 971501234567 → +971 50 ••• 4567. */
export const maskPhone = (e164: string) =>
  e164.length >= 8 ? `+${e164.slice(0, 3)} ${e164.slice(3, 5)} ••• ${e164.slice(-4)}` : '•••'

export const formatPhone = (e164: string) =>
  e164.startsWith('971') && e164.length === 12
    ? `+971 ${e164.slice(3, 5)} ${e164.slice(5, 8)} ${e164.slice(8)}`
    : `+${e164}`

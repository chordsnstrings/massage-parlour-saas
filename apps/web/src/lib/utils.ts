import { createFormat } from '@spa/core/i18n/format'
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

// English formatters (pre-i18n call sites). Locale-aware code uses `fmt` from getI18n() / useI18n() instead;
// Phase 2 moves the remaining call sites over.
const en = createFormat('en')
/** Whole dirhams print without decimals (AED 350); anything with fils always shows two (AED 0.10). */
export const formatAed = en.aed
export const formatDate = (value: Date | string) => en.date(value)
export const formatDateTime = (value: Date | string) => en.dateTime(value)

/** Today in Asia/Dubai as YYYY-MM-DD. */
export const todayDubai = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

const aedFmt = (digits: number) =>
  new Intl.NumberFormat('en-AE', {
    style: 'currency',
    currency: 'AED',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
const aed0 = aedFmt(0)
const aed2 = aedFmt(2)
/** Whole dirhams print without decimals (AED 350); anything with fils always shows two (AED 0.10). */
export const formatAed = (value: number | string) => {
  const n = Number(value)
  return (Math.round(n * 100) % 100 === 0 ? aed0 : aed2).format(n)
}

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Dubai',
})
export const formatDate = (value: Date | string) =>
  dateFmt.format(typeof value === 'string' ? new Date(value) : value)

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Dubai',
})
export const formatDateTime = (value: Date | string) =>
  dateTimeFmt.format(typeof value === 'string' ? new Date(value) : value)

/** Today in Asia/Dubai as YYYY-MM-DD. */
export const todayDubai = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')

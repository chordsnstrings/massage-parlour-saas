import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

const aed = new Intl.NumberFormat('en-AE', {
  style: 'currency',
  currency: 'AED',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})
export const formatAed = (value: number | string) => aed.format(Number(value))

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

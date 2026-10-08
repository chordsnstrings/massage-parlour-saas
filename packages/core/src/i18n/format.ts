// Locale-aware formatting for the spa dashboard. Thai uses the Gregorian calendar and Latin digits (the design shows
// "2027", not the Buddhist year); money stays "AED 1,234" in every language; times are 24 h in Asia/Dubai.
import type { Locale } from './types'

const TZ = 'Asia/Dubai'
const TAG: Record<Locale, string> = { en: 'en-GB', th: 'th-TH-u-ca-gregory-nu-latn' }

export type Format = ReturnType<typeof build>

const toDate = (value: Date | string | number) => (value instanceof Date ? value : new Date(value))

function build(locale: Locale) {
  const tag = TAG[locale]
  const dt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(tag, { timeZone: TZ, ...o })
  const date = dt({ day: 'numeric', month: 'short', year: 'numeric' })
  const dateShort = dt({ day: 'numeric', month: 'short' })
  const weekdayDate = dt({ weekday: 'short', day: 'numeric', month: 'short' })
  const dateTime = dt({
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const time = dt({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  const monthYear = dt({ month: 'long', year: 'numeric' })
  const number = new Intl.NumberFormat(tag)
  const percent = new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 0 })
  const aed = (digits: number) =>
    new Intl.NumberFormat('en-AE', {
      style: 'currency',
      currency: 'AED',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })
  const aed0 = aed(0)
  const aed2 = aed(2)
  return {
    locale,
    /** 8 Oct 2026 · 8 ต.ค. 2026 */
    date: (v: Date | string | number) => date.format(toDate(v)),
    /** 8 Oct · 8 ต.ค. */
    dateShort: (v: Date | string | number) => dateShort.format(toDate(v)),
    /** Thu, 8 Oct · พฤ. 8 ต.ค. */
    weekdayDate: (v: Date | string | number) => weekdayDate.format(toDate(v)),
    /** 8 Oct, 14:05 · 8 ต.ค. 14:05 */
    dateTime: (v: Date | string | number) => dateTime.format(toDate(v)),
    /** 14:05 */
    time: (v: Date | string | number) => time.format(toDate(v)),
    /** October 2026 · ตุลาคม 2026 */
    monthYear: (v: Date | string | number) => monthYear.format(toDate(v)),
    number: (v: number) => number.format(v),
    /** 0.62 → 62% */
    percent: (ratio: number) => percent.format(ratio),
    /** Whole dirhams print without decimals (AED 350); anything with fils always shows two (AED 0.10). */
    aed: (value: number | string) => {
      const n = Number(value)
      return (Math.round(n * 100) % 100 === 0 ? aed0 : aed2).format(n)
    },
  }
}

const cache = new Map<Locale, Format>()
export function createFormat(locale: Locale): Format {
  let f = cache.get(locale)
  if (!f) {
    f = build(locale)
    cache.set(locale, f)
  }
  return f
}

// Locale-aware formatting for the spa dashboard (EN/TH) and the super-admin console (EN/AR, R22). Thai uses the
// Gregorian calendar and Latin digits (the design shows "2027", not the Buddhist year); Arabic uses Western digits too
// (owner: never Arabic-Indic); money stays "AED 1,234" in every language; times are 24 h in Asia/Dubai.
import type { AnyLocale } from './types'

const TZ = 'Asia/Dubai'

export type Format = ReturnType<typeof build>

const toDate = (value: Date | string | number) => (value instanceof Date ? value : new Date(value))

const AR_MONTHS = [
  'يناير',
  'فبراير',
  'مارس',
  'أبريل',
  'مايو',
  'يونيو',
  'يوليو',
  'أغسطس',
  'سبتمبر',
  'أكتوبر',
  'نوفمبر',
  'ديسمبر',
]

// Names are our own tables (not ICU's): Node and browsers ship different ICU data ("Thu, 8 Oct" vs "Thu 8 Oct",
// "Sep" vs "Sept"), which breaks hydration when a client component formats a date the server also rendered.
const NAMES: Record<AnyLocale, { mon: string[]; month: string[]; wd: string[] }> = {
  en: {
    mon: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
    month: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ],
    wd: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },
  th: {
    mon: ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'],
    month: [
      'มกราคม',
      'กุมภาพันธ์',
      'มีนาคม',
      'เมษายน',
      'พฤษภาคม',
      'มิถุนายน',
      'กรกฎาคม',
      'สิงหาคม',
      'กันยายน',
      'ตุลาคม',
      'พฤศจิกายน',
      'ธันวาคม',
    ],
    wd: ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'],
  },
  // Arabic has no month abbreviations: short and long names are the same (the names used across the UAE).
  ar: {
    mon: AR_MONTHS,
    month: AR_MONTHS,
    wd: ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
  },
}

// Only numeric parts come from ICU (identical everywhere); the calendar is always Gregorian.
const partsFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  hourCycle: 'h23',
})
type Parts = { y: number; m: number; d: number; wd: number; hh: string; mm: string }
function parts(v: Date | string | number): Parts {
  const p: Record<string, string> = {}
  for (const x of partsFmt.formatToParts(toDate(v))) p[x.type] = x.value
  const y = Number(p.year)
  const m = Number(p.month)
  const d = Number(p.day)
  const hh = String(Number(p.hour) % 24).padStart(2, '0')
  return {
    y,
    m,
    d,
    wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay(),
    hh,
    mm: (p.minute ?? '0').padStart(2, '0'),
  }
}

const number = new Intl.NumberFormat('en-US')
const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })
const money = (digits: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const money0 = money(0)
const money2 = money(2)
const NBSP = '\u00a0'

// Arabic pages are RTL: an amount is kept in a left-to-right isolate so "-AED 1,234" never reorders to "AED 1,234-".
const LRI = '\u2066'
const PDI = '\u2069'

function build(locale: AnyLocale) {
  const n = NAMES[locale]
  const dayMon = (p: Parts) => `${p.d} ${n.mon[p.m - 1]}`
  const hm = (p: Parts) => `${p.hh}:${p.mm}`
  return {
    locale,
    /** 8 Oct 2026 · 8 ต.ค. 2026 */
    date: (v: Date | string | number) => {
      const p = parts(v)
      return `${dayMon(p)} ${p.y}`
    },
    /** 8 Oct · 8 ต.ค. */
    dateShort: (v: Date | string | number) => dayMon(parts(v)),
    /** Thu 8 Oct · พฤ. 8 ต.ค. */
    weekdayDate: (v: Date | string | number) => {
      const p = parts(v)
      return `${n.wd[p.wd]} ${dayMon(p)}`
    },
    /** 8 Oct, 14:05 · 8 ต.ค. 14:05 */
    dateTime: (v: Date | string | number) => {
      const p = parts(v)
      return `${dayMon(p)}${locale === 'en' ? ',' : locale === 'ar' ? '،' : ''} ${hm(p)}`
    },
    /** 14:05 */
    time: (v: Date | string | number) => hm(parts(v)),
    /** October 2026 · ตุลาคม 2026 */
    monthYear: (v: Date | string | number) => {
      const p = parts(v)
      return `${n.month[p.m - 1]} ${p.y}`
    },
    /** Oct · ต.ค. */
    monthShort: (v: Date | string | number) => n.mon[parts(v).m - 1],
    number: (v: number) => number.format(v),
    /** 0.62 → 62% */
    percent: (ratio: number) => percent.format(ratio),
    /** Whole dirhams print without decimals (AED 350); anything with fils always shows two (AED 0.10). */
    aed: (value: number | string) => {
      const v = Number(value)
      const abs = Math.abs(v)
      const body = (Math.round(abs * 100) % 100 === 0 ? money0 : money2).format(abs)
      const text = `${v < 0 && body !== '0' && body !== '0.00' ? '-' : ''}AED${NBSP}${body}`
      return locale === 'ar' ? `${LRI}${text}${PDI}` : text
    },
  }
}

const cache = new Map<AnyLocale, Format>()
export function createFormat(locale: AnyLocale): Format {
  let f = cache.get(locale)
  if (!f) {
    f = build(locale)
    cache.set(locale, f)
  }
  return f
}

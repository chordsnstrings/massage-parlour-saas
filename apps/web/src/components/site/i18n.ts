import type { Bi, Locale, SiteMeta } from './types'

/** Resolves bilingual text for the page locale ({name} → spa name). Arabic falls back to English. */
export function tr(value: Bi | string | null | undefined, meta: Pick<SiteMeta, 'locale' | 'data'>): string {
  if (!value) return ''
  const raw = typeof value === 'string' ? value : (meta.locale === 'ar' && value.ar?.trim()) || value.en || ''
  return raw.replaceAll('{name}', meta.data.tenant.name)
}

const UI = {
  book: { en: 'Book now', ar: 'احجز الآن' },
  bookShort: { en: 'Book', ar: 'احجز' },
  whatsapp: { en: 'WhatsApp us', ar: 'راسلنا على واتساب' },
  call: { en: 'Call us', ar: 'اتصل بنا' },
  directions: { en: 'Get directions', ar: 'احصل على الاتجاهات' },
  closed: { en: 'Closed', ar: 'مغلق' },
  today: { en: 'Today', ar: 'اليوم' },
  hours: { en: 'Opening hours', ar: 'ساعات العمل' },
  visit: { en: 'Visit us', ar: 'زورونا' },
  contact: { en: 'Contact', ar: 'تواصل معنا' },
  from: { en: 'from', ar: 'من' },
  priceOnRequest: { en: 'Price on request', ar: 'السعر عند الطلب' },
  noServices: { en: 'Our menu is being updated.', ar: 'قائمتنا قيد التحديث.' },
  noTeam: { en: 'Meet our therapists soon.', ar: 'تعرّفوا على فريقنا قريبًا.' },
  rights: { en: 'All rights reserved.', ar: 'جميع الحقوق محفوظة.' },
  pages: { en: 'Pages', ar: 'الصفحات' },
  menu: { en: 'Menu', ar: 'القائمة' },
  bookingHello: { en: "Hi, I'd like to book a massage.", ar: 'مرحبًا، أود حجز جلسة مساج.' },
  // Hero emblems of the design templates (R5).
  emblemCaption: { en: 'Massage & wellness', ar: 'مساج وعافية' },
  emblemPlace: { en: 'UAE', ar: 'الإمارات' },
  openToday: { en: 'Open today', ar: 'مفتوح اليوم' },
  treatments: { en: 'Treatments', ar: 'الجلسات' },
  bookMinute: { en: 'Book in a minute', ar: 'احجز في دقيقة' },
} as const satisfies Record<string, Record<Locale, string>>

export const ui = (key: keyof typeof UI, locale: Locale) => UI[key][locale]

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_NAMES: Record<Locale, Record<(typeof WEEKDAYS)[number], string>> = {
  en: {
    mon: 'Monday',
    tue: 'Tuesday',
    wed: 'Wednesday',
    thu: 'Thursday',
    fri: 'Friday',
    sat: 'Saturday',
    sun: 'Sunday',
  },
  ar: {
    mon: 'الاثنين',
    tue: 'الثلاثاء',
    wed: 'الأربعاء',
    thu: 'الخميس',
    fri: 'الجمعة',
    sat: 'السبت',
    sun: 'الأحد',
  },
}
export const dayName = (day: (typeof WEEKDAYS)[number], locale: Locale) => DAY_NAMES[locale][day]

/** VAT-inclusive AED price; Latin digits in both languages (common UAE practice). */
/** A variant's price label — "Price on request" when it has none to show (R4). */
export const variantPrice = (aed: string | number | null, locale: Locale) =>
  aed == null ? UI.priceOnRequest[locale] : price(aed, locale)

export function price(aed: string | number, locale: Locale) {
  const n = Number(aed)
  const text = n.toLocaleString('en-AE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  return locale === 'ar' ? `${text} د.إ` : `AED ${text}`
}

export const minutes = (n: number, locale: Locale) => (locale === 'ar' ? `${n} دقيقة` : `${n} min`)

/** 24h "21:30" → "9:30 pm" (en) / "21:30" (ar). */
export function clock(hhmm: string, locale: Locale) {
  if (locale === 'ar') return hhmm
  const [h = 0, m = 0] = hhmm.split(':').map(Number)
  const suffix = h >= 12 && h < 24 ? 'pm' : 'am'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${suffix}`
}

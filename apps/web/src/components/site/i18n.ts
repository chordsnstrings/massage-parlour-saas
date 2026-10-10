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
  openInMaps: { en: 'Open in Google Maps', ar: 'افتح في خرائط Google' },
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
  // F15 blocks (Arabic copy: native review pending).
  findUs: { en: 'Find us', ar: 'موقعنا' },
  mapOf: { en: 'Map', ar: 'خريطة' },
  playVideo: { en: 'Play video', ar: 'تشغيل الفيديو' },
  playsFrom: { en: 'Plays from', ar: 'يُعرض من' },
  googleReviews: { en: 'Google reviews', ar: 'تقييمات Google' },
  seeOnGoogle: { en: 'See all on Google', ar: 'عرض الكل على Google' },
  outOf5: { en: 'out of 5', ar: 'من 5' },
  followInstagram: { en: 'Follow us on Instagram', ar: 'تابعونا على إنستغرام' },
  instagramPost: { en: 'Instagram post', ar: 'منشور على إنستغرام' },
  readMore: { en: 'Read more', ar: 'اقرأ المزيد' },
  blog: { en: 'Blog', ar: 'المدونة' },
  allPosts: { en: 'All posts', ar: 'كل المقالات' },
  home: { en: 'Home', ar: 'الرئيسية' },
  formName: { en: 'Your name', ar: 'الاسم' },
  formPhone: { en: 'Phone (WhatsApp)', ar: 'رقم الهاتف (واتساب)' },
  formPhoneHint: {
    en: 'UAE mobile (05…) or a number with its country code.',
    ar: 'جوال إماراتي (05…) أو رقم مع رمز الدولة.',
  },
  formMessage: { en: 'Message', ar: 'رسالتك' },
  formSend: { en: 'Send', ar: 'إرسال' },
  formSending: { en: 'Sending…', ar: 'جارٍ الإرسال…' },
  formPreview: {
    en: 'Preview — the form sends from the live site.',
    ar: 'معاينة — يُرسل النموذج من الموقع المنشور.',
  },
  errRequiredName: { en: 'Enter your name', ar: 'أدخل اسمك' },
  errLongName: { en: 'Keep your name under 80 characters', ar: 'يجب ألا يتجاوز الاسم 80 حرفًا' },
  errRequiredPhone: { en: 'Enter your phone number', ar: 'أدخل رقم هاتفك' },
  errPhone: {
    en: 'Enter a UAE mobile (05…) or a number with its country code (+44…)',
    ar: 'أدخل جوالًا إماراتيًا (05…) أو رقمًا مع رمز الدولة (+44…)',
  },
  errRequiredMessage: { en: 'Write your message', ar: 'اكتب رسالتك' },
  errLongMessage: { en: 'Keep your message under 1,500 characters', ar: 'يجب ألا تتجاوز الرسالة 1500 حرف' },
  errCheckFields: { en: 'Please check the highlighted fields.', ar: 'يرجى مراجعة الحقول المحددة.' },
  errTooMany: {
    en: 'Too many messages from your network. Please try again later or contact us on WhatsApp.',
    ar: 'رسائل كثيرة من شبكتك. يرجى المحاولة لاحقًا أو التواصل معنا عبر واتساب.',
  },
  errBotCheck: {
    en: "We couldn't confirm you're not a robot. Please try again.",
    ar: 'تعذّر التأكد من أنك لست روبوتًا. يرجى المحاولة مرة أخرى.',
  },
  errUnavailable: {
    en: 'This form is not available right now. Please contact us on WhatsApp.',
    ar: 'هذا النموذج غير متاح حاليًا. يرجى التواصل معنا عبر واتساب.',
  },
  errFailed: { en: 'Something went wrong. Please try again.', ar: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.' },
} as const satisfies Record<string, Record<Locale, string>>

export type SiteUiKey = keyof typeof UI
export const ui = (key: SiteUiKey, locale: Locale) => UI[key][locale]

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

/** "9 October 2026" / "9 أكتوبر 2026" (Latin digits, Dubai day). */
export function longDate(iso: string | Date, locale: Locale) {
  return new Date(iso).toLocaleDateString(locale === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Dubai',
  })
}

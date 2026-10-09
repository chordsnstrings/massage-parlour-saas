/** Online booking copy (EN + AR). Client-safe. */
export type Locale = 'en' | 'ar'
export type Bi = { en: string; ar?: string }

export const localeOf = (lang: string | string[] | undefined): Locale =>
  (Array.isArray(lang) ? lang[0] : lang) === 'ar' ? 'ar' : 'en'

/** Bilingual value for the locale; Arabic falls back to English. */
export const pick = (value: Bi | null | undefined, locale: Locale) =>
  value ? (locale === 'ar' && value.ar?.trim()) || value.en : ''

const T = {
  title: { en: 'Book a treatment', ar: 'احجز جلستك' },
  openInMaps: { en: 'Open in Google Maps', ar: 'افتح في خرائط Google' },
  intro: {
    en: 'Choose a treatment and a time that suits you. We will confirm on WhatsApp.',
    ar: 'اختر العلاج والوقت المناسب لك، وسنؤكد الحجز عبر واتساب.',
  },
  back: { en: 'Back', ar: 'رجوع' },
  backToSite: { en: 'Back to site', ar: 'العودة للموقع' },
  branch: { en: 'Branch', ar: 'الفرع' },
  change: { en: 'Change', ar: 'تغيير' },
  continue: { en: 'Continue', ar: 'متابعة' },
  stepService: { en: 'Treatment', ar: 'العلاج' },
  stepWhen: { en: 'Date & time', ar: 'التاريخ والوقت' },
  stepDetails: { en: 'Your details', ar: 'بياناتك' },
  chooseService: { en: 'Choose a treatment', ar: 'اختر العلاج' },
  chooseDate: { en: 'Choose a day', ar: 'اختر اليوم' },
  chooseTime: { en: 'Choose a time', ar: 'اختر الوقت' },
  therapist: { en: 'Therapist', ar: 'المعالج' },
  anyTherapist: { en: 'No preference', ar: 'بدون تفضيل' },
  other: { en: 'Treatments', ar: 'العلاجات' },
  min: { en: 'min', ar: 'دقيقة' },
  aed: { en: 'AED', ar: 'درهم' },
  vatIncl: { en: 'Prices include VAT', ar: 'الأسعار شاملة الضريبة' },
  today: { en: 'Today', ar: 'اليوم' },
  tomorrow: { en: 'Tomorrow', ar: 'غداً' },
  closed: { en: 'Closed', ar: 'مغلق' },
  morning: { en: 'Morning', ar: 'الصباح' },
  afternoon: { en: 'Afternoon', ar: 'بعد الظهر' },
  evening: { en: 'Evening', ar: 'المساء' },
  loadingTimes: { en: 'Finding free times…', ar: 'جارٍ البحث عن أوقات متاحة…' },
  noTimes: { en: 'No free times on this day', ar: 'لا توجد أوقات متاحة في هذا اليوم' },
  noTimesHint: {
    en: 'Try another day or another therapist.',
    ar: 'جرّب يوماً آخر أو معالجاً آخر.',
  },
  name: { en: 'Your name', ar: 'الاسم' },
  phone: { en: 'UAE mobile', ar: 'رقم الجوال (الإمارات)' },
  phoneHint: { en: 'We will confirm on WhatsApp.', ar: 'سنؤكد الحجز عبر واتساب.' },
  notes: { en: 'Notes (optional)', ar: 'ملاحظات (اختياري)' },
  notesHint: {
    en: 'Pressure preference, areas to avoid, anything we should know.',
    ar: 'تفضيل الضغط أو مناطق يجب تجنبها أو أي شيء نود معرفته.',
  },
  confirm: { en: 'Request booking', ar: 'طلب الحجز' },
  summary: { en: 'Your booking', ar: 'حجزك' },
  nothingYet: { en: 'Pick a treatment to begin.', ar: 'اختر العلاج للبدء.' },
  total: { en: 'Total', ar: 'الإجمالي' },
  priceOnRequest: { en: 'Price on request', ar: 'السعر عند الطلب' },
  payAtSpa: { en: 'Pay at the spa — no card needed now.', ar: 'الدفع في المركز — لا حاجة لبطاقة الآن.' },
  doneTitle: { en: 'Booking requested', ar: 'تم استلام طلب الحجز' },
  doneBody: {
    en: 'Your time is held. Tap below to confirm on WhatsApp — we reply quickly.',
    ar: 'تم حجز موعدك مبدئياً. اضغط أدناه للتأكيد عبر واتساب — نرد بسرعة.',
  },
  doneConfirmedTitle: { en: 'Booking confirmed', ar: 'تم تأكيد الحجز' },
  doneConfirmedBody: {
    en: 'Welcome back — your time is booked. We will send the details on WhatsApp.',
    ar: 'أهلاً بعودتك — تم حجز موعدك. سنرسل لك التفاصيل عبر واتساب.',
  },
  chatWhatsapp: { en: 'Message us on WhatsApp', ar: 'راسلنا عبر واتساب' },
  ref: { en: 'Reference', ar: 'الرقم المرجعي' },
  confirmWhatsapp: { en: 'Confirm on WhatsApp', ar: 'أكّد عبر واتساب' },
  addCalendar: { en: 'Add to calendar', ar: 'أضف إلى التقويم' },
  bookAnother: { en: 'Book another', ar: 'حجز آخر' },
  noServices: {
    en: 'Online booking opens soon. Please contact us to book.',
    ar: 'الحجز الإلكتروني متاح قريباً. يرجى التواصل معنا للحجز.',
  },
  unavailable: {
    en: 'Online booking is not available right now. Please contact us to book.',
    ar: 'الحجز الإلكتروني غير متاح حالياً. يرجى التواصل معنا للحجز.',
  },
  slotTaken: {
    en: 'That time was just taken — here are the latest free times.',
    ar: 'تم حجز هذا الوقت للتو — إليك أحدث الأوقات المتاحة.',
  },
  error: { en: 'Something went wrong. Please try again.', ar: 'حدث خطأ ما. يرجى المحاولة مرة أخرى.' },
  langSwitch: { en: 'العربية', ar: 'English' },
} as const satisfies Record<string, Record<Locale, string>>

export type TextKey = keyof typeof T
export const t = (key: TextKey, locale: Locale) => T[key][locale]

/** Intl locale with Latin digits (common on UAE sites, avoids mixed numerals in phone/ref). */
export const intlLocale = (locale: Locale) => (locale === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB')

export const fmtAed = (amount: number, locale: Locale) =>
  locale === 'ar'
    ? `${amount.toLocaleString('en-AE', { maximumFractionDigits: 2 })} ${t('aed', locale)}`
    : `AED ${amount.toLocaleString('en-AE', { maximumFractionDigits: 2 })}`

/** A public price, or "Price on request" when there is none to show. */
export const fmtPrice = (amount: number | null, locale: Locale) =>
  amount == null ? t('priceOnRequest', locale) : fmtAed(amount, locale)

/** "Tue 7 Oct" for a business date (YYYY-MM-DD). */
export const fmtDate = (date: string, locale: Locale, opts: Intl.DateTimeFormatOptions = {}) =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
    ...opts,
  }).format(new Date(`${date}T12:00:00Z`))

/** "15:30" for an instant, Dubai wall clock. */
export const fmtTime = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'Asia/Dubai',
  }).format(new Date(iso))

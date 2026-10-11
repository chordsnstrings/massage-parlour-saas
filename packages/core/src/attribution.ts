// F13 (G20): where a website visitor came from, as web_events.source (raw) and bookings.attribution (normalised).

/** Mirrors the `booking_attribution` pgEnum (packages/db schema/operations.ts; services test asserts they match). */
export const BOOKING_ATTRIBUTIONS = [
  'instagram',
  'gbp',
  'google',
  'qr',
  'facebook',
  'tiktok',
  'whatsapp',
  'widget',
  'campaign',
  'referral',
  'direct',
] as const
export type BookingAttribution = (typeof BOOKING_ATTRIBUTIONS)[number]

/** What public/t.js keeps for the tab session (`sessionStorage.spa_entry`) and sends with every event. */
export type WebEntry = { referrer?: string | null; utm?: Record<string, string> | null }

/**
 * Raw entry source as /api/collect stores it in web_events.source: the `?src=` / `utm_source` tag as given (ig, gbp,
 * qr, widget, …), else a known referrer (instagram, google, whatsapp, facebook, tiktok) or the referrer host, else direct.
 */
export function webEntrySource(utm: WebEntry['utm'], referrer: WebEntry['referrer']): string {
  const tag = (utm?.src ?? utm?.utm_source ?? '').trim().toLowerCase()
  if (tag) return tag.slice(0, 30)
  if (!referrer) return 'direct'
  try {
    const h = new URL(referrer).hostname
    if (/instagram/.test(h)) return 'instagram'
    if (/google/.test(h)) return 'google'
    if (/whatsapp|wa\.me/.test(h)) return 'whatsapp'
    if (/facebook|fb\./.test(h)) return 'facebook'
    if (/tiktok/.test(h)) return 'tiktok'
    return h.replace(/^www\./, '').slice(0, 40)
  } catch {
    return 'direct'
  }
}

const TAGS: Record<string, BookingAttribution> = {
  ig: 'instagram',
  insta: 'instagram',
  instagram: 'instagram',
  gbp: 'gbp',
  gmb: 'gbp',
  google_business: 'gbp',
  google: 'google',
  qr: 'qr',
  fb: 'facebook',
  facebook: 'facebook',
  tiktok: 'tiktok',
  tt: 'tiktok',
  wa: 'whatsapp',
  whatsapp: 'whatsapp',
  widget: 'widget',
  direct: 'direct',
}

/** Raw entry source (webEntrySource) → booking attribution; unknown tags = campaign, other hosts = referral. */
export function attributionOf(raw: string | null | undefined): BookingAttribution {
  const key = raw?.trim().toLowerCase()
  if (!key) return 'direct'
  return TAGS[key] ?? (key.includes('.') ? 'referral' : 'campaign')
}

/** A visitor's entry ({ referrer, utm }) → booking attribution. */
export const bookingAttribution = (entry: WebEntry | null | undefined) =>
  attributionOf(webEntrySource(entry?.utm, entry?.referrer))

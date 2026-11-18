// F15: automatic client message drafts (review requests, birthday greetings, win-back) — settings, caps and timing.
// The worker only QUEUES WhatsApp drafts in the outbox (click-to-send); these rules decide who and when.
import { addDays, dubaiInstant, dubaiParts } from './booking'

export type ClientDraftSettings = {
  /** Quiet hours, Dubai HH:MM: a draft never falls due from `quietStart` until `quietEnd` (may cross midnight). */
  quietStart: string
  quietEnd: string
  /** Link for `{link}` in review requests (e.g. the Google "write a review" link); empty = none are queued. */
  reviewLink: string
  /** A review request falls due this many hours after checkout. */
  reviewDelayHours: number
  /** Win-back: clients whose last visit is at least this many days ago. */
  winbackDays: number
}

export const CLIENT_DRAFT_DEFAULTS: ClientDraftSettings = {
  quietStart: '21:00',
  quietEnd: '10:00',
  reviewLink: '',
  reviewDelayHours: 3,
  winbackDays: 60,
}

/** Guardrails (not editable by the spa). */
export const CLIENT_DRAFT_LIMITS = {
  reviewDelayHours: { min: 1, max: 72 },
  winbackDays: { min: 21, max: 365 },
  /** At most one review request per client in this many days (whatever the number of visits). */
  reviewCapDays: 90,
  /** Only visits checked out within this many hours get a review request (no backfill when switched on). */
  reviewWindowHours: 48,
  /** At most one birthday message per client in this many days. */
  birthdayCapDays: 300,
  /** Win-back: once per lapse (none since the last visit), never for clients gone longer than this. */
  winbackMaxDays: 365,
  /** Most win-back drafts one spa gets per Dubai day (the most recent lapses first). */
  winbackPerDay: 25,
  /** Birthday + win-back skip a client another marketing message reached (or will reach) within this many days. */
  marketingCapDays: 7,
} as const

export const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

const intIn = (v: unknown, r: { min: number; max: number }, fallback: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= r.min && v <= r.max ? v : fallback

/** The spa's settings (`tenants.settings.clientDrafts`) with defaults for missing or invalid values. */
export function clientDraftSettings(
  settings: { clientDrafts?: Partial<Record<keyof ClientDraftSettings, unknown>> } | null | undefined,
): ClientDraftSettings {
  const s = settings?.clientDrafts ?? {}
  const d = CLIENT_DRAFT_DEFAULTS
  const time = (v: unknown, fallback: string) => (typeof v === 'string' && HHMM.test(v) ? v : fallback)
  const link = typeof s.reviewLink === 'string' && /^https:\/\/\S+$/.test(s.reviewLink) ? s.reviewLink : ''
  return {
    quietStart: time(s.quietStart, d.quietStart),
    quietEnd: time(s.quietEnd, d.quietEnd),
    reviewLink: link,
    reviewDelayHours: intIn(s.reviewDelayHours, CLIENT_DRAFT_LIMITS.reviewDelayHours, d.reviewDelayHours),
    winbackDays: intIn(s.winbackDays, CLIENT_DRAFT_LIMITS.winbackDays, d.winbackDays),
  }
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** Is `at` inside the quiet hours (Dubai)? Equal start and end = no quiet hours. */
export function inQuietHours(at: Date, q: Pick<ClientDraftSettings, 'quietStart' | 'quietEnd'>) {
  const start = minutesOf(q.quietStart)
  const end = minutesOf(q.quietEnd)
  if (start === end) return false
  const m = dubaiParts(at).minutes
  return start < end ? m >= start && m < end : m >= start || m < end
}

/** The first moment at or after `at` outside the quiet hours: `at` itself, or the next end of the quiet hours. */
export function afterQuietHours(at: Date, q: Pick<ClientDraftSettings, 'quietStart' | 'quietEnd'>): Date {
  if (!inQuietHours(at, q)) return at
  const { date, minutes } = dubaiParts(at)
  const end = minutesOf(q.quietEnd)
  return dubaiInstant(minutes < end ? date : addDays(date, 1), end)
}

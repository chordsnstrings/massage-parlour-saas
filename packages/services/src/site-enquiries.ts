// F15 enquiry form: leads from a spa's website (EnquiryForm block) → the spa's dashboard (Inbox → Enquiries), answered
// by WhatsApp click-to-send (never emailed). Callers run these inside withTenant(); bot check, rate limit,
// permission and audit stay in the caller.
import { addDays, afterMidnight, dubaiParts, type OpeningHours, toE164 } from '@spa/core'
import {
  bookingItems,
  bookings,
  type SiteEnquiryBooking,
  services,
  serviceVariants,
  siteEnquiries,
  type Tx,
} from '@spa/db'
import { and, asc, desc, eq, ilike, inArray, isNotNull, or, type SQL, sql } from 'drizzle-orm'
import { z } from 'zod'
import { DomainError } from './errors'

export const SITE_ENQUIRY_STATUSES = ['new', 'replied', 'closed'] as const
export type SiteEnquiryStatus = (typeof SITE_ENQUIRY_STATUSES)[number]
export type SiteEnquiryFilter = SiteEnquiryStatus | 'all'
export type SiteEnquiry = typeof siteEnquiries.$inferSelect

/** Per visitor IP across all spa sites: 5 an hour, 20 a day (web: `withinIpLimit('site-enquiry', …)`). */
export const SITE_ENQUIRY_LIMITS = [
  [5, 3600],
  [20, 86_400],
] as const
export const SITE_ENQUIRY_MESSAGE_MAX = 1500
export const SITE_ENQUIRY_PAGE_SIZE = 50

const BIDI = /[\u202A-\u202E\u2066-\u2069]/gu
const oneLine = (v: string) =>
  v
    .replace(BIDI, '')
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s{2,}/g, ' ')
const multiLine = (v: string) =>
  v
    .replace(BIDI, '')
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/(?![\n\t])\p{Cc}/gu, '')
    .replace(/\n{3,}/g, '\n\n')

/**
 * What the website form sends. Messages are error codes (`required:name`, `long:name`, `phone`, …); the site turns
 * them into the visitor's language (EN/AR).
 */
export const siteEnquirySchema = z.object({
  name: z
    .string({ error: 'required:name' })
    .overwrite(oneLine)
    .trim()
    .min(1, 'required:name')
    .max(80, 'long:name'),
  phone: z
    .string({ error: 'required:phone' })
    .trim()
    .min(1, 'required:phone')
    .max(40, 'phone')
    .transform((v) => {
      const e164 = toE164(v)
      return e164 ? `+${e164}` : null
    })
    .refine((v): v is string => v !== null, 'phone'),
  message: z
    .string({ error: 'required:message' })
    .overwrite(multiLine)
    .trim()
    .min(1, 'required:message')
    .max(SITE_ENQUIRY_MESSAGE_MAX, 'long:message'),
  locale: z.enum(['en', 'ar']).catch('en'),
  page: z
    .string()
    .max(80)
    .regex(/^$|^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)?$/)
    .catch(''),
})
export type SiteEnquiryInput = z.output<typeof siteEnquirySchema>

/**
 * R26: booking requests from an HTML design's form (`{site}/crm-enquiry`, no Turnstile — the design runs sandboxed):
 * per spa 30 an hour, 150 a day, always on (one spa's inbox stays usable against rotating IPs); the per-IP
 * `SITE_ENQUIRY_LIMITS` apply too.
 */
export const DESIGN_ENQUIRY_TENANT_LIMITS = [
  [30, 3600],
  [150, 86_400],
] as const
/** Largest booking-request body read (bytes). */
export const DESIGN_ENQUIRY_MAX_BYTES = 8192
/** How far ahead (days) a requested date may be; yesterday is accepted (time zones of the visitor's clock). */
export const DESIGN_ENQUIRY_MAX_DAYS = 120

const ymd = /^\d{4}-\d{2}-\d{2}$/
const realDate = (v: string) => {
  const d = new Date(`${v}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}
const inWindow = (v: string) => {
  const today = dubaiParts(new Date()).date
  return v >= addDays(today, -1) && v <= addDays(today, DESIGN_ENQUIRY_MAX_DAYS)
}
const optionalId = z
  .string()
  .trim()
  .max(100, 'long:id')
  .nullish()
  .transform((v) => v || null)

/**
 * The booking form body of a contract design (documented in its header): `{spa, service_id, service_name,
 * duration_minutes, guests, date, time, staff_id, name, phone, notes, source, submitted_at}`. `spa`, `source`,
 * `submitted_at` and unknown keys are dropped; ids are resolved server-side by the caller (never trusted).
 */
export const designEnquirySchema = z
  .object({
    name: siteEnquirySchema.shape.name,
    phone: siteEnquirySchema.shape.phone,
    service_id: optionalId,
    service_name: z
      .string()
      .overwrite(oneLine)
      .trim()
      .max(120, 'long:service')
      .nullish()
      .transform((v) => v || ''),
    duration_minutes: z
      .number()
      .int()
      .min(5, 'duration')
      .max(600, 'duration')
      .nullish()
      .transform((v) => v ?? null),
    guests: z.number().int().min(1, 'guests').max(10, 'guests').default(1),
    date: z
      .string({ error: 'required:date' })
      .regex(ymd, 'date')
      .refine(realDate, 'date')
      .refine(inWindow, 'date'),
    time: z.string({ error: 'required:time' }).regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, 'time'),
    staff_id: optionalId,
    notes: z
      .string()
      .overwrite(multiLine)
      .trim()
      .max(1000, 'long:notes')
      .nullish()
      .transform((v) => v ?? ''),
  })
  .refine((v) => Boolean(v.service_id || v.service_name), { path: ['service_id'], error: 'required:service' })
export type DesignEnquiryInput = z.output<typeof designEnquirySchema>

export async function submitSiteEnquiry(
  tx: Tx,
  tenantId: string,
  input: SiteEnquiryInput & { booking?: SiteEnquiryBooking | null },
  meta: { ipHash: string | null },
): Promise<SiteEnquiry> {
  const [row] = await tx
    .insert(siteEnquiries)
    .values({ tenantId, ...input, ipHash: meta.ipHash })
    .returning()
  return row!
}

export type SiteEnquiryList = {
  rows: SiteEnquiry[]
  total: number
  counts: Record<SiteEnquiryStatus, number>
}

/** Newest first; `q` matches name, phone digits or message. */
export async function listSiteEnquiries(
  tx: Tx,
  opts: { status?: SiteEnquiryFilter; q?: string; limit?: number; offset?: number } = {},
): Promise<SiteEnquiryList> {
  const where: SQL[] = []
  if (opts.status && opts.status !== 'all') where.push(eq(siteEnquiries.status, opts.status))
  const q = opts.q?.trim().slice(0, 80)
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    const digits = q.replace(/\D/g, '')
    const match = or(
      ilike(siteEnquiries.name, like),
      ilike(siteEnquiries.message, like),
      sql`${siteEnquiries.booking}->>'service' ilike ${like}`,
      digits.length >= 3 ? ilike(siteEnquiries.phone, `%${digits}%`) : undefined,
    )
    if (match) where.push(match)
  }
  const cond = where.length ? and(...where) : undefined
  const rows = await tx
    .select()
    .from(siteEnquiries)
    .where(cond)
    .orderBy(desc(siteEnquiries.createdAt))
    .limit(Math.min(opts.limit ?? SITE_ENQUIRY_PAGE_SIZE, 200))
    .offset(opts.offset ?? 0)
  const [total] = await tx.select({ n: sql<number>`count(*)::int` }).from(siteEnquiries).where(cond)
  const byStatus = await tx
    .select({ status: siteEnquiries.status, n: sql<number>`count(*)::int` })
    .from(siteEnquiries)
    .groupBy(siteEnquiries.status)
  const counts = { new: 0, replied: 0, closed: 0 }
  for (const r of byStatus) counts[r.status] = r.n
  return { rows, total: total?.n ?? 0, counts }
}

export async function getSiteEnquiry(tx: Tx, id: string): Promise<SiteEnquiry | null> {
  const [row] = await tx.select().from(siteEnquiries).where(eq(siteEnquiries.id, id)).limit(1)
  return row ?? null
}

/** Moves an enquiry (new → replied → closed, or back to new); returns the previous status, null when not found. */
export async function setSiteEnquiryStatus(
  tx: Tx,
  id: string,
  status: SiteEnquiryStatus,
  userId: string | null,
): Promise<{ from: SiteEnquiryStatus; row: SiteEnquiry } | null> {
  const before = await getSiteEnquiry(tx, id)
  if (!before) return null
  const [row] = await tx
    .update(siteEnquiries)
    .set({ status, handledBy: userId, handledAt: new Date(), updatedAt: new Date() })
    .where(eq(siteEnquiries.id, id))
    .returning()
  return { from: before.status, row: row! }
}

/** The night a booking request is for, and its time's calendar date: stored since 2026-10-13, else computed. */
export function enquiryNight(b: SiteEnquiryBooking, hours: OpeningHours | null | undefined) {
  return typeof b.afterMidnight === 'boolean' && b.calendarDate
    ? { afterMidnight: b.afterMidnight, calendarDate: b.calendarDate }
    : afterMidnight(b.date, b.time, hours)
}

const notRequest = () => new DomainError('Booking request not found', 'not_found')

/**
 * "Make booking" (owner 2026-10-13): locks one of this spa's booking requests (RLS) while its booking is created in
 * the same transaction. Refused when not found (another spa's included), not a booking request, or already booked
 * (a booking that isn't cancelled).
 */
export async function lockSiteEnquiryForBooking(tx: Tx, id: string) {
  const [row] = await tx.select().from(siteEnquiries).where(eq(siteEnquiries.id, id)).for('update')
  if (!row?.booking) throw notRequest()
  const linked = row.booking.bookingId
  if (linked) {
    const [b] = await tx.select({ status: bookings.status }).from(bookings).where(eq(bookings.id, linked))
    if (b && b.status !== 'cancelled') throw new DomainError('Booking request already booked')
  }
  return { ...row, booking: row.booking }
}

/** Records the booking made from a booking request in its `booking` jsonb (no column): which, when, by whom. */
export async function linkSiteEnquiryBooking(tx: Tx, id: string, bookingId: string, userId: string | null) {
  const [b] = await tx.select({ id: bookings.id }).from(bookings).where(eq(bookings.id, bookingId))
  if (!b) throw new DomainError('Booking not found', 'not_found')
  const link = { bookingId, bookedAt: new Date().toISOString(), bookedBy: userId }
  const [row] = await tx
    .update(siteEnquiries)
    .set({ booking: sql`${siteEnquiries.booking} || ${JSON.stringify(link)}::jsonb`, updatedAt: new Date() })
    .where(and(eq(siteEnquiries.id, id), isNotNull(siteEnquiries.booking)))
    .returning()
  if (!row) throw notRequest()
  return row
}

/** A booking made from a booking request, as the inbox shows it (Dubai date + time of its start). */
export type SiteEnquiryBooked = {
  id: string
  status: (typeof bookings.$inferSelect)['status']
  branchId: string
  businessDate: string
  date: string
  time: string
  service: { en: string; ar?: string }
}

const hhmm = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

/** The bookings these requests were booked as, by booking id (another spa's never: RLS). */
export async function siteEnquiryBookings(tx: Tx, rows: Pick<SiteEnquiry, 'booking'>[]) {
  const ids = [...new Set(rows.flatMap((r) => (r.booking?.bookingId ? [r.booking.bookingId] : [])))]
  const out = new Map<string, SiteEnquiryBooked>()
  if (!ids.length) return out
  const found = await tx.select().from(bookings).where(inArray(bookings.id, ids))
  const items = await tx
    .select({ bookingId: bookingItems.bookingId, item: bookingItems.serviceName, name: services.name })
    .from(bookingItems)
    .leftJoin(serviceVariants, eq(serviceVariants.id, bookingItems.serviceVariantId))
    .leftJoin(services, eq(services.id, serviceVariants.serviceId))
    .where(inArray(bookingItems.bookingId, ids))
    .orderBy(asc(bookingItems.startsAt))
  for (const r of found) {
    const { date, minutes } = dubaiParts(r.startsAt)
    const first = items.find((i) => i.bookingId === r.id)
    out.set(r.id, {
      id: r.id,
      status: r.status,
      branchId: r.branchId,
      businessDate: r.businessDate,
      date,
      time: hhmm(minutes),
      service: first?.name ?? { en: first?.item ?? '' },
    })
  }
  return out
}

/** A greeting name: the visitor's first word when it reads as a name (letters, marks, ' ’ -), else nothing. */
const greetingName = (name: string) => {
  const first = name.trim().split(/\s+/)[0] ?? ''
  return /^[\p{L}\p{M}'’-]{1,40}$/u.test(first) ? first : ''
}

/**
 * First words of the spa's WhatsApp reply, in the language the visitor wrote in (the staff member adds the rest).
 * The spa's own number sends it to the phone on the enquiry, which anyone can type: only names the CRM resolved
 * (a website service, the booked service) and validated values go in, never the visitor's free text (no links in the
 * spa's name). `hours` (main branch) dates small-hours requests stored before 2026-10-13; `booked` (the booking made
 * from the request, not cancelled) turns it into the confirmation.
 */
export function siteEnquiryReplyText(
  e: { name: string; locale: string; booking?: SiteEnquiryBooking | null },
  spaName: string,
  opts: { hours?: OpeningHours | null; booked?: SiteEnquiryBooked | null } = {},
) {
  const first = greetingName(e.name)
  const ar = e.locale === 'ar'
  const hi = ar ? (first ? `مرحبًا ${first}، ` : 'مرحبًا، ') : first ? `Hi ${first}, ` : 'Hi, '
  // Arabic copy needs native review. The small hours: "on the night of {night} at {time} (after midnight, {date})".
  const when = (night: string, time: string, date: string) =>
    night !== date
      ? ar
        ? `ليلة ${night} الساعة ${time} (بعد منتصف الليل، ${date})`
        : `on the night of ${night} at ${time} (after midnight, ${date})`
      : ar
        ? `يوم ${date} الساعة ${time}`
        : `on ${date} at ${time}`
  const b = e.booking
  const k = opts.booked
  if (b && k) {
    const service = (ar && k.service.ar?.trim()) || k.service.en
    const at = when(k.businessDate, k.time, k.date)
    return ar
      ? `${hi}تم تأكيد حجزك في ${spaName}${service ? ` لـ ${service}` : ''} ${at}. `
      : `${hi}your booking at ${spaName} is confirmed${service ? ` for ${service}` : ''} ${at}. `
  }
  // R26: a booking request; the service only when the CRM named it.
  if (b) {
    const service = b.serviceId ? b.service : ''
    const at = when(b.date, b.time, enquiryNight(b, opts.hours).calendarDate)
    return ar
      ? `${hi}شكرًا لطلب الحجز في ${spaName}${service ? ` لـ ${service}` : ''} ${at}. `
      : `${hi}thank you for your booking request at ${spaName}${service ? ` for ${service}` : ''} ${at}. `
  }
  return ar ? `${hi}شكرًا لرسالتك إلى ${spaName}. ` : `${hi}thank you for your message to ${spaName}. `
}

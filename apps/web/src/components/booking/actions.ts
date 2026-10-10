'use server'
import { bookingAttribution, businessDateOf, toUaeE164, whatsappLink } from '@spa/core'
import { services, serviceVariants, staff, type Tx, withTenant } from '@spa/db'
import {
  availableSlots,
  createBooking,
  DomainError,
  findOrCreateClient,
  notify,
  publicPrice,
  selfBookingStatus,
  spaHidesPrices,
} from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { type ActionResult, fail, fromZod, ok } from '@/lib/action'
import { audit } from '@/server/audit'
import { clientIp } from '@/server/rate-limit'
import { resolveSiteTenant } from '@/server/sites'
import { passesBotCheck } from '@/server/turnstile'
import { acceptsBookings, bookingBranch, bookingDates, LEAD_MIN } from './data'
import { fmtDate, fmtTime, type Locale, t } from './i18n'
import type { BookingDone, SiteKey, SlotOption } from './types'

const siteKey = z.union([
  z.object({ slug: z.string().trim().min(1).max(63) }),
  z.object({ hostname: z.string().trim().min(1).max(253) }),
])
const locale = z.enum(['en', 'ar']).catch('en')

// --- Abuse limits (in-memory, per web process; enough for one droplet) -----------------------------
const HOUR = 3600_000
const attempts = new Map<string, number[]>()
const successes = new Map<string, number[]>()
const MAX_ATTEMPTS = 20
const MAX_BOOKINGS = 5
/** Off only with AUTH_RATE_LIMIT=off (the e2e server: every spec books from 127.0.0.1), like the other per-IP limits. */
const limited = () => process.env.AUTH_RATE_LIMIT !== 'off'

function recent(map: Map<string, number[]>, ip: string) {
  const now = Date.now()
  const list = (map.get(ip) ?? []).filter((at) => now - at < HOUR)
  map.set(ip, list)
  if (map.size > 10_000) {
    for (const [key, value] of map) if (!value.some((at) => now - at < HOUR)) map.delete(key)
  }
  return list
}

async function siteTenant(key: SiteKey) {
  const parsed = siteKey.safeParse(key)
  if (!parsed.success) return null
  const tenant = await resolveSiteTenant(parsed.data)
  return tenant && acceptsBookings(tenant.status) ? tenant : null
}

/** Active, online-bookable variant (+ its service) or null. */
async function bookableVariant(tx: Tx, variantId: string) {
  const [row] = await tx
    .select({ variant: serviceVariants, service: services })
    .from(serviceVariants)
    .innerJoin(services, eq(services.id, serviceVariants.serviceId))
    .where(
      and(
        eq(serviceVariants.id, variantId),
        eq(serviceVariants.active, true),
        eq(services.active, true),
        eq(services.onlineBookable, true),
      ),
    )
  return row ?? null
}

const slotQuery = z.object({
  site: siteKey,
  variantId: z.uuid(),
  date: z.iso.date(),
  staffId: z
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  branchId: z.uuid().optional(),
  lang: locale,
})

async function freeSlots(
  tx: Tx,
  branch: NonNullable<Awaited<ReturnType<typeof bookingBranch>>>,
  q: { variantId: string; date: string; staffId?: string },
) {
  return availableSlots(tx, {
    branchId: branch.id,
    date: q.date,
    serviceVariantId: q.variantId,
    preferredStaffIds: q.staffId ? [q.staffId] : undefined,
    notBefore: new Date(Date.now() + LEAD_MIN * 60_000),
  })
}

/** Free start times for a service variant on one business date (public, no login). */
export async function getSlots(input: z.input<typeof slotQuery>): Promise<ActionResult> {
  const parsed = slotQuery.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const q = parsed.data
  const tenant = await siteTenant(q.site)
  if (!tenant) return fail(t('unavailable', q.lang))
  try {
    const slots = await withTenant(tenant.id, async (tx) => {
      const branch = await bookingBranch(tx, q.branchId)
      if (!branch || !(await bookableVariant(tx, q.variantId))) return null
      if (!bookingDates(branch).some((d) => d.date === q.date)) return []
      const found = await freeSlots(tx, branch, q)
      return found.map(
        (s): SlotOption => ({
          start: s.start.toISOString(),
          minutes: Math.round((s.start.getTime() - Date.parse(`${q.date}T00:00:00+04:00`)) / 60_000),
        }),
      )
    })
    if (!slots) return fail(t('unavailable', q.lang))
    return ok(undefined, { slots })
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message)
    throw e
  }
}

const bookingInput = z.object({
  site: siteKey,
  variantId: z.uuid(),
  start: z.iso.datetime({ offset: true }),
  staffId: z
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  name: z.string().trim().min(2, 'Enter your name').max(80),
  phone: z
    .string()
    .trim()
    .refine((v) => toUaeE164(v) !== null, 'Enter a UAE mobile number, e.g. 050 123 4567'),
  notes: z.string().trim().max(500).optional().default(''),
  /** Honeypot: humans never see this field. */
  website: z.string().optional().default(''),
  /** Set by the embeddable widget (public/widget.js) — attribution only; same limits + honeypot. */
  via: z.enum(['widget']).optional(),
  /** F13: the visitor's entry ({ referrer, utm } from public/t.js) → bookings.attribution; only the key is stored. */
  entry: z
    .object({
      referrer: z.string().max(500).nullish(),
      utm: z
        .object({
          src: z.string().max(60).optional(),
          utm_source: z.string().max(60).optional(),
          utm_medium: z.string().max(60).optional(),
          utm_campaign: z.string().max(60).optional(),
        })
        .nullish(),
    })
    .optional()
    .catch(undefined),
  /** F9: Cloudflare Turnstile token (verified server-side when keys are configured). */
  botToken: z.string().max(4096).optional(),
  branchId: z.uuid().optional(),
  lang: locale,
})

function confirmText(
  lang: Locale,
  v: { spa: string; ref: string; service: string; start: Date; name: string },
) {
  const day = fmtDate(businessDateOf(v.start, '00:00'), lang, { weekday: 'long', month: 'long' })
  const time = fmtTime(v.start.toISOString(), lang)
  return lang === 'ar'
    ? `مرحباً ${v.spa}، أود تأكيد حجزي رقم ${v.ref}: ${v.service} يوم ${day} الساعة ${time}. الاسم: ${v.name}.`
    : `Hi ${v.spa}, I'd like to confirm my booking #${v.ref}: ${v.service} on ${day} at ${time}. Name: ${v.name}.`
}

/** Public booking request → pending (or auto-confirmed, G21) booking with resources reserved; returns the details. */
export async function bookOnline(input: z.input<typeof bookingInput>): Promise<ActionResult> {
  const parsed = bookingInput.safeParse(input)
  const lang: Locale = input?.lang === 'ar' ? 'ar' : 'en'
  if (!parsed.success) return fromZod(parsed.error)
  const v = parsed.data
  const ip = await clientIp()
  const tooMany = recent(attempts, ip).length >= MAX_ATTEMPTS || recent(successes, ip).length >= MAX_BOOKINGS
  if (tooMany && limited())
    return fail(
      lang === 'ar'
        ? 'طلبات كثيرة. يرجى المحاولة لاحقاً أو التواصل معنا عبر واتساب.'
        : 'Too many requests. Please try again later or contact us on WhatsApp.',
    )
  attempts.get(ip)!.push(Date.now())
  // Bots fill every field; answer like a generic failure and store nothing.
  if (v.website.trim()) return fail(t('error', lang))
  if (!(await passesBotCheck(v.botToken, 'booking', { customDomain: 'hostname' in v.site })))
    return fail(t('botCheck', lang))
  const tenant = await siteTenant(v.site)
  if (!tenant) return fail(t('unavailable', lang))
  const start = new Date(v.start)
  // F13: first-touch website source; the widget's iframe is tagged src=widget (public/widget.js).
  const fromEntry = bookingAttribution(v.entry)
  const attribution = v.via === 'widget' && fromEntry === 'direct' ? 'widget' : fromEntry

  try {
    const result = await withTenant(tenant.id, async (tx) => {
      const branch = await bookingBranch(tx, v.branchId)
      const row = await bookableVariant(tx, v.variantId)
      if (!branch || !row) return { kind: 'unavailable' as const }
      const date = businessDateOf(start, branch.businessDayCutoff.slice(0, 5))
      if (!bookingDates(branch).some((d) => d.date === date)) return { kind: 'taken' as const }
      // Re-check against live availability (lead time, shifts, skills, preferred therapist).
      const slot = (await freeSlots(tx, branch, { variantId: v.variantId, date, staffId: v.staffId })).find(
        (s) => s.start.getTime() === start.getTime(),
      )
      if (!slot) return { kind: 'taken' as const }

      const client = await findOrCreateClient(tx, tenant.id, {
        name: v.name,
        phone: v.phone,
        source: 'online',
        language: lang,
      })
      if (client.blocklisted) return { kind: 'blocked' as const }

      const notes = [
        v.notes,
        client.name.trim().toLowerCase() !== v.name.toLowerCase() ? `Booked online as "${v.name}"` : '',
      ]
        .filter(Boolean)
        .join('\n')
      // Pending until the front desk confirms, unless the spa auto-confirms returning clients (G21).
      const status = await selfBookingStatus(tx, tenant.id, client.id)
      const booking = await createBooking(tx, {
        tenantId: tenant.id,
        branchId: branch.id,
        clientId: client.id,
        source: 'online',
        attribution,
        status,
        notes: notes || null,
        items: [{ serviceVariantId: v.variantId, start, staffIds: v.staffId ? [v.staffId] : undefined }],
      })
      // Pending: the confirmation + reminders are queued when the receptionist confirms (G4); a confirmed
      // booking queued them in createBooking.

      let therapist: string | null = null
      if (v.staffId) {
        const [s] = await tx.select({ name: staff.displayName }).from(staff).where(eq(staff.id, v.staffId))
        therapist = s?.name ?? null
      }
      const hides = await spaHidesPrices(tx, tenant.id)
      const service = `${(lang === 'ar' && row.service.name.ar?.trim()) || row.service.name.en} · ${row.variant.durationMin} ${t('min', lang)}`
      const done: BookingDone = {
        ref: booking.refCode,
        start: start.toISOString(),
        end: new Date(start.getTime() + row.variant.durationMin * 60_000).toISOString(),
        service,
        durationMin: row.variant.durationMin,
        priceAed: (() => {
          const p = publicPrice(row.variant.priceAed, row.service.showPrice, hides)
          return p == null ? null : Number(p)
        })(),
        therapist,
        whatsappUrl: branch.whatsappE164
          ? whatsappLink(
              branch.whatsappE164,
              confirmText(lang, { spa: tenant.name, ref: booking.refCode, service, start, name: v.name }),
            )
          : null,
        spa: tenant.name,
        address: branch.address,
        confirmed: status === 'confirmed',
      }
      return { kind: 'ok' as const, bookingId: booking.id, done, date, serviceEn: row.service.name.en }
    })

    if (result.kind === 'unavailable') return fail(t('unavailable', lang))
    if (result.kind === 'taken') return fail(t('slotTaken', lang), { start: t('slotTaken', lang) })
    if (result.kind === 'blocked')
      return fail(
        lang === 'ar'
          ? 'تعذّر إتمام الحجز عبر الإنترنت. يرجى التواصل معنا عبر واتساب أو الهاتف.'
          : "We couldn't complete this booking online. Please contact us on WhatsApp or by phone.",
      )

    recent(successes, ip).push(Date.now())
    await audit({
      tenantId: tenant.id,
      action: 'booking.created',
      entity: 'booking',
      entityId: result.bookingId,
      data: { ref: result.done.ref, source: 'online', attribution, ...(v.via ? { via: v.via } : {}) },
    })
    revalidatePath(`/dashboard/${tenant.slug}/calendar`)
    revalidatePath(`/dashboard/${tenant.slug}`)
    // Bell + push to the front desk after the response; a failed notification never affects the booking.
    after(() =>
      notify({
        tenantId: tenant.id,
        kind: 'booking.online',
        params: { name: v.name, service: result.serviceEn, at: result.done.start },
        url: `/${tenant.slug}/calendar?date=${result.date}`,
        dedupeKey: `booking.online:${result.bookingId}`,
      }).catch((e) => console.error('booking notification failed', e)),
    )
    return ok(undefined, { booking: result.done })
  } catch (e) {
    if (e instanceof DomainError) {
      if (
        e.code === 'slot_taken' ||
        e.code === 'no_staff' ||
        e.code === 'no_room' ||
        e.code === 'no_equipment'
      )
        return fail(t('slotTaken', lang), { start: t('slotTaken', lang) })
      return fail(e.message)
    }
    throw e
  }
}

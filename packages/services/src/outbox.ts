import { type AutomationKey, automationOn, type WhatsAppMode, whatsappLink } from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  clients,
  messageTemplates,
  outbox,
  type Tx,
  tenants,
} from '@spa/db'
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'

export type MessageKind = (typeof outbox.$inferSelect)['kind']

/** Default WhatsApp texts (EN/AR). Tenants can override per kind + language in message_templates. */
export const DEFAULT_TEMPLATES: Record<MessageKind, { en: string; ar: string }> = {
  booking_confirmation: {
    en: 'Hi {first_name}, your {service} at {spa} is confirmed for {day} at {time}. Ref {ref}. Reply here if you need to change anything.',
    ar: 'مرحباً {first_name}، تم تأكيد موعد {service} في {spa} يوم {day} الساعة {time}. الرقم المرجعي {ref}.',
  },
  reminder: {
    en: 'Hi {first_name}, a reminder of your {service} at {spa} on {day} at {time}. See you soon!',
    ar: 'مرحباً {first_name}، تذكير بموعد {service} في {spa} يوم {day} الساعة {time}. نراك قريباً!',
  },
  reminder_2h: {
    en: 'Hi {first_name}, see you soon! Your {service} at {spa} is today at {time}. Ref {ref}.',
    ar: 'مرحباً {first_name}، نراك قريباً! موعد {service} في {spa} اليوم الساعة {time}. الرقم المرجعي {ref}.',
  },
  thank_you: {
    en: 'Thank you for visiting {spa}, {first_name}! We hope you feel wonderful.',
    ar: 'شكراً لزيارتك {spa} يا {first_name}! نتمنى لك يوماً رائعاً.',
  },
  review_request: {
    en: 'Hi {first_name}, thank you for visiting {spa}. Would you share a quick review? {link}',
    ar: 'مرحباً {first_name}، شكراً لزيارتك {spa}. هل تشاركنا رأيك؟ {link}',
  },
  rebook: {
    en: 'Hi {first_name}, it has been a while! Shall we book your next {service} at {spa}?',
    ar: 'مرحباً {first_name}، اشتقنا إليك! هل نحجز موعدك القادم في {spa}؟',
  },
  birthday: {
    en: 'Happy birthday, {first_name}! Treat yourself at {spa} this week: {link}',
    ar: 'عيد ميلاد سعيد يا {first_name}! دلّل نفسك في {spa} هذا الأسبوع: {link}',
  },
  winback: {
    en: 'Hi {first_name}, we miss you at {spa}. Come back for a relaxing treatment soon: {link}',
    ar: 'مرحباً {first_name}، نفتقدك في {spa}. نتطلع لرؤيتك قريباً: {link}',
  },
  slot_offer: {
    en: 'Hi {first_name}, we have a free slot {day} at {time} at {spa}. Would you like it?',
    ar: 'مرحباً {first_name}، لدينا موعد متاح {day} الساعة {time} في {spa}. هل ترغب بحجزه؟',
  },
  waitlist_slot: {
    en: 'Hi {first_name}, good news: a {service} slot just opened at {spa} on {day} at {time}. Reply here if you would like it.',
    ar: 'مرحباً {first_name}، خبر سار: أصبح موعد {service} متاحاً في {spa} يوم {day} الساعة {time}. راسلنا هنا إذا كنت ترغب بحجزه.',
  },
  custom: { en: '{text}', ar: '{text}' },
  membership_renewal: {
    en: 'Hi {first_name}, your {service} membership at {spa} ends on {day}. Would you like to renew it? Reply here or renew at your next visit.',
    ar: 'مرحباً {first_name}، تنتهي عضويتك {service} في {spa} يوم {day}. هل ترغب بتجديدها؟ راسلنا هنا أو جدّدها في زيارتك القادمة.',
  },
}

export const renderTemplate = (body: string, vars: Record<string, string>) =>
  body.replace(/\{(\w+)\}/g, (m, key: string) => vars[key] ?? m)

export const fmtDay = (d: Date, lang: string) =>
  d.toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Dubai',
  })
export const fmtTime = (d: Date, lang: string) =>
  d.toLocaleTimeString(lang === 'ar' ? 'ar-AE' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dubai',
  })

/** Automation switch that gates each booking message kind (others are queued by their own flows). */
const BOOKING_MESSAGE_AUTOMATION: Partial<Record<MessageKind, AutomationKey>> = {
  booking_confirmation: 'bookingMessages',
  reminder: 'bookingMessages',
  reminder_2h: 'bookingMessages',
  thank_you: 'thankYou',
  review_request: 'reviewRequests',
}

export async function templateFor(tx: Tx, kind: MessageKind, lang: string) {
  const [row] = await tx
    .select({ body: messageTemplates.body })
    .from(messageTemplates)
    .where(and(eq(messageTemplates.kind, kind), eq(messageTemplates.lang, lang)))
  return row?.body ?? DEFAULT_TEMPLATES[kind][lang === 'ar' ? 'ar' : 'en']
}

type BookingMessageContext = NonNullable<Awaited<ReturnType<typeof bookingMessageContext>>>

/** Booking + client + spa data a booking message is rendered from (null when the client has no mobile). */
async function bookingMessageContext(tx: Tx, bookingId: string) {
  const [row] = await tx
    .select({
      booking: bookings,
      client: clients,
      spa: tenants.name,
      settings: tenants.settings,
      branch: branches,
    })
    .from(bookings)
    .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
    .innerJoin(branches, eq(branches.id, bookings.branchId))
    .leftJoin(clients, eq(clients.id, bookings.clientId))
    .where(eq(bookings.id, bookingId))
  if (!row?.client?.phoneE164) return null
  const [first] = await tx
    .select({ serviceName: bookingItems.serviceName })
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId))
    .orderBy(asc(bookingItems.startsAt))
    .limit(1)
  return { ...row, client: row.client, phoneE164: row.client.phoneE164, service: first?.serviceName ?? '' }
}

async function renderBookingMessage(tx: Tx, c: BookingMessageContext, kind: MessageKind) {
  const lang = c.client.language === 'ar' ? 'ar' : 'en'
  return renderTemplate(await templateFor(tx, kind, lang), {
    first_name: c.client.name.split(' ')[0] ?? c.client.name,
    name: c.client.name,
    spa: c.spa,
    service: c.service,
    day: fmtDay(c.booking.startsAt, lang),
    time: fmtTime(c.booking.startsAt, lang),
    ref: c.booking.refCode,
  })
}

/**
 * Queues a WhatsApp message about a booking (idempotent per booking + kind). Returns null when the
 * client has no mobile number or the spa switched that automation off (B3). `dueAt` lets reminders appear in the
 * outbox at the right time.
 */
export async function enqueueBookingMessage(
  tx: Tx,
  bookingId: string,
  kind: MessageKind,
  dueAt = new Date(),
) {
  const c = await bookingMessageContext(tx, bookingId)
  if (!c) return null
  const automation = BOOKING_MESSAGE_AUTOMATION[kind]
  if (automation && !automationOn(c.settings, automation)) return null
  const [created] = await tx
    .insert(outbox)
    .values({
      tenantId: c.booking.tenantId,
      branchId: c.booking.branchId,
      clientId: c.client.id,
      bookingId,
      kind,
      phoneE164: c.phoneE164,
      text: await renderBookingMessage(tx, c, kind),
      dueAt,
    })
    .onConflictDoNothing()
    .returning()
  return created ?? null
}

const HOUR_MS = 3_600_000
/** Messages planned for every confirmed booking (G4), and when each is due relative to the start. */
export const PLANNED_BOOKING_MESSAGES = ['booking_confirmation', 'reminder', 'reminder_2h'] as const
type PlannedKind = (typeof PLANNED_BOOKING_MESSAGES)[number]
const LEAD_MS: Record<PlannedKind, number | null> = {
  booking_confirmation: null,
  reminder: 24 * HOUR_MS,
  reminder_2h: 2 * HOUR_MS,
}
const UNSENT = ['queued', 'opened'] as const

/**
 * (Re)plans a booking's click-to-send messages from its current status and time (G4); idempotent.
 * - confirmed → confirmation now + reminders 24 h and 2 h before the start (a reminder whose time has passed is
 *   skipped). Unsent rows are re-rendered with the current time; with `rescheduled`, already sent/skipped rows
 *   are queued again so the client hears about the new time.
 * - checked in / completed → unsent confirmation + reminders are skipped (no longer useful).
 * - cancelled / no-show → every unsent message about the booking is skipped.
 * - pending → nothing (messages are planned when staff confirm).
 * Returns the booking's live planned rows by kind.
 */
export async function planBookingMessages(
  tx: Tx,
  bookingId: string,
  opts: { now?: Date; rescheduled?: boolean } = {},
) {
  const planned: Partial<Record<PlannedKind, typeof outbox.$inferSelect>> = {}
  const [b] = await tx
    .select({ status: bookings.status, startsAt: bookings.startsAt })
    .from(bookings)
    .where(eq(bookings.id, bookingId))
  if (!b || b.status === 'pending') return planned
  if (b.status !== 'confirmed') {
    await skipBookingMessages(
      tx,
      bookingId,
      b.status === 'cancelled' || b.status === 'no_show' ? undefined : [...PLANNED_BOOKING_MESSAGES],
    )
    return planned
  }
  const now = opts.now ?? new Date()
  const c = await bookingMessageContext(tx, bookingId)
  if (!c) return planned
  const enabled = automationOn(c.settings, 'bookingMessages')
  const existing = await tx
    .select()
    .from(outbox)
    .where(and(eq(outbox.bookingId, bookingId), inArray(outbox.kind, [...PLANNED_BOOKING_MESSAGES])))
  for (const kind of PLANNED_BOOKING_MESSAGES) {
    const lead = LEAD_MS[kind]
    const dueAt = lead === null ? now : new Date(b.startsAt.getTime() - lead)
    // A reminder whose moment has passed is not worth sending (the confirmation always is).
    const late = lead !== null && dueAt <= now
    const row = existing.find((r) => r.kind === kind)
    const unsent = row && (UNSENT as readonly string[]).includes(row.status)
    if (late) {
      if (unsent) await tx.update(outbox).set({ status: 'skipped' }).where(eq(outbox.id, row.id))
      continue
    }
    const text = await renderBookingMessage(tx, c, kind)
    // The confirmation keeps its original due time unless the booking moved.
    const due = kind === 'booking_confirmation' && row && !opts.rescheduled ? row.dueAt : dueAt
    if (!row) {
      if (!enabled) continue
      const [created] = await tx
        .insert(outbox)
        .values({
          tenantId: c.booking.tenantId,
          branchId: c.booking.branchId,
          clientId: c.client.id,
          bookingId,
          kind,
          phoneE164: c.phoneE164,
          text,
          dueAt: due,
        })
        .onConflictDoNothing()
        .returning()
      if (created) planned[kind] = created
    } else if (unsent || opts.rescheduled) {
      const [updated] = await tx
        .update(outbox)
        .set({
          text,
          dueAt: due,
          phoneE164: c.phoneE164,
          ...(unsent ? {} : { status: 'queued' as const, sentAt: null, sentBy: null }),
        })
        .where(eq(outbox.id, row.id))
        .returning()
      if (updated) planned[kind] = updated
    }
  }
  return planned
}

/** Skips the unsent messages about a booking (all kinds, or only `kinds`). */
export async function skipBookingMessages(tx: Tx, bookingId: string, kinds?: MessageKind[]) {
  await tx
    .update(outbox)
    .set({ status: 'skipped' })
    .where(
      and(
        eq(outbox.bookingId, bookingId),
        inArray(outbox.status, [...UNSENT]),
        kinds ? inArray(outbox.kind, kinds) : undefined,
      ),
    )
}

/** Outbox rows that still belong to a live booking (none about a cancelled / no-show booking). */
export const outboxBookingLive = () =>
  or(
    isNull(outbox.bookingId),
    sql`not exists (select 1 from ${bookings} where ${bookings.id} = ${outbox.bookingId} and ${bookings.status} in ('cancelled', 'no_show'))`,
  )!

/** Click-to-send link for an outbox row; a human presses send in WhatsApp. */
export const outboxLink = (row: { phoneE164: string; text: string }, mode: WhatsAppMode = 'web') =>
  whatsappLink(row.phoneE164, row.text, mode)

/** Marks an outbox message as sent/skipped by a staff member. */
export async function markOutbox(tx: Tx, id: string, status: 'sent' | 'skipped' | 'opened', userId: string) {
  await tx
    .update(outbox)
    .set({ status, sentAt: status === 'sent' ? new Date() : null, sentBy: status === 'sent' ? userId : null })
    .where(eq(outbox.id, id))
}

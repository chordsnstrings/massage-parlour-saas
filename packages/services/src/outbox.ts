import { type WhatsAppMode, whatsappLink } from '@spa/core'
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
import { and, asc, eq } from 'drizzle-orm'

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
    en: 'Happy birthday, {first_name}! Treat yourself at {spa} this week.',
    ar: 'عيد ميلاد سعيد يا {first_name}! دلّل نفسك في {spa} هذا الأسبوع.',
  },
  winback: {
    en: 'Hi {first_name}, we miss you at {spa}. Come back for a relaxing treatment soon.',
    ar: 'مرحباً {first_name}، نفتقدك في {spa}. نتطلع لرؤيتك قريباً.',
  },
  slot_offer: {
    en: 'Hi {first_name}, we have a free slot {day} at {time} at {spa}. Would you like it?',
    ar: 'مرحباً {first_name}، لدينا موعد متاح {day} الساعة {time} في {spa}. هل ترغب بحجزه؟',
  },
  custom: { en: '{text}', ar: '{text}' },
}

export const renderTemplate = (body: string, vars: Record<string, string>) =>
  body.replace(/\{(\w+)\}/g, (m, key: string) => vars[key] ?? m)

const fmtDay = (d: Date, lang: string) =>
  d.toLocaleDateString(lang === 'ar' ? 'ar-AE' : 'en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Dubai',
  })
const fmtTime = (d: Date, lang: string) =>
  d.toLocaleTimeString(lang === 'ar' ? 'ar-AE' : 'en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Dubai',
  })

async function templateFor(tx: Tx, kind: MessageKind, lang: string) {
  const [row] = await tx
    .select({ body: messageTemplates.body })
    .from(messageTemplates)
    .where(and(eq(messageTemplates.kind, kind), eq(messageTemplates.lang, lang)))
  return row?.body ?? DEFAULT_TEMPLATES[kind][lang === 'ar' ? 'ar' : 'en']
}

/**
 * Queues a WhatsApp message about a booking (idempotent per booking + kind). Returns null when the
 * client has no mobile number. `dueAt` lets reminders appear in the outbox at the right time.
 */
export async function enqueueBookingMessage(
  tx: Tx,
  bookingId: string,
  kind: MessageKind,
  dueAt = new Date(),
) {
  const [row] = await tx
    .select({ booking: bookings, client: clients, spa: tenants.name, branch: branches })
    .from(bookings)
    .innerJoin(tenants, eq(tenants.id, bookings.tenantId))
    .innerJoin(branches, eq(branches.id, bookings.branchId))
    .leftJoin(clients, eq(clients.id, bookings.clientId))
    .where(eq(bookings.id, bookingId))
  if (!row?.client?.phoneE164) return null
  const [first] = await tx
    .select()
    .from(bookingItems)
    .where(eq(bookingItems.bookingId, bookingId))
    .orderBy(asc(bookingItems.startsAt))
    .limit(1)
  const lang = row.client.language === 'ar' ? 'ar' : 'en'
  const text = renderTemplate(await templateFor(tx, kind, lang), {
    first_name: row.client.name.split(' ')[0] ?? row.client.name,
    name: row.client.name,
    spa: row.spa,
    service: first?.serviceName ?? '',
    day: fmtDay(row.booking.startsAt, lang),
    time: fmtTime(row.booking.startsAt, lang),
    ref: row.booking.refCode,
  })
  const [created] = await tx
    .insert(outbox)
    .values({
      tenantId: row.booking.tenantId,
      branchId: row.booking.branchId,
      clientId: row.client.id,
      bookingId,
      kind,
      phoneE164: row.client.phoneE164,
      text,
      dueAt,
    })
    .onConflictDoNothing()
    .returning()
  return created ?? null
}

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

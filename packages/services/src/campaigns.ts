// Click-to-send WhatsApp campaigns: message rendering, results (bookings within 14 days) and lifecycle.
import { bookings, campaigns, outbox, type Tx } from '@spa/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { renderTemplate } from './outbox'

/** Guardrails (PLAN §1.10/§1.11): one campaign per client per 7 days, max 500 recipients each. */
export const CAMPAIGN_LIMITS = { maxRecipients: 500, capDays: 7, attributionDays: 14 } as const

/** Variables a campaign message may use. */
export const CAMPAIGN_VARIABLES = ['name', 'spa', 'booking_link', 'offer_code'] as const

export type CampaignVars = { spa: string; bookingLink?: string; offerCode?: string | null }

/** The text one client receives: Arabic body for Arabic speakers when there is one, else English. */
export function renderCampaignMessage(
  body: { en: string; ar?: string },
  client: { name: string; language: string },
  vars: CampaignVars,
) {
  const lang = client.language === 'ar' && body.ar?.trim() ? 'ar' : 'en'
  const first = client.name.trim().split(/\s+/)[0] ?? client.name
  const text = renderTemplate(lang === 'ar' ? body.ar! : body.en, {
    name: first,
    first_name: first,
    full_name: client.name,
    spa: vars.spa,
    booking_link: vars.bookingLink ?? '',
    offer_code: vars.offerCode ?? '',
  })
  return { lang, text: text.replace(/[ \t]+\n/g, '\n').trim() } as const
}

export type CampaignResult = {
  total: number
  pending: number
  sent: number
  skipped: number
  /** Recipients (messaged) who made a booking within 14 days of their message. */
  bookedClients: number
  bookings: number
}

const emptyResult = (): CampaignResult => ({
  total: 0,
  pending: 0,
  sent: 0,
  skipped: 0,
  bookedClients: 0,
  bookings: 0,
})

/**
 * Outbox counts and the result metric per campaign. Clicks are not tracked; a client counts as converted when
 * they created a (non-cancelled) booking within 14 days after their message was sent (or opened in WhatsApp).
 */
export async function campaignResults(tx: Tx, campaignIds: string[]) {
  const out = new Map<string, CampaignResult>()
  if (!campaignIds.length) return out
  for (const id of campaignIds) out.set(id, emptyResult())
  const counts = await tx
    .select({
      id: outbox.campaignId,
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${outbox.status} in ('queued', 'opened'))::int`,
      sent: sql<number>`count(*) filter (where ${outbox.status} = 'sent')::int`,
      skipped: sql<number>`count(*) filter (where ${outbox.status} = 'skipped')::int`,
    })
    .from(outbox)
    .where(inArray(outbox.campaignId, campaignIds))
    .groupBy(outbox.campaignId)
  for (const { id, ...c } of counts) Object.assign(out.get(id!)!, c)
  const sentAt = sql`coalesce(${outbox.sentAt}, ${outbox.dueAt})`
  const booked = await tx
    .select({
      id: outbox.campaignId,
      clients: sql<number>`count(distinct ${outbox.clientId})::int`,
      bookings: sql<number>`count(distinct ${bookings.id})::int`,
    })
    .from(outbox)
    .innerJoin(
      bookings,
      and(
        eq(bookings.clientId, outbox.clientId),
        sql`${bookings.status} <> 'cancelled'`,
        sql`${bookings.createdAt} >= ${sentAt}`,
        sql`${bookings.createdAt} < ${sentAt} + make_interval(days => ${CAMPAIGN_LIMITS.attributionDays})`,
      ),
    )
    .where(and(inArray(outbox.campaignId, campaignIds), inArray(outbox.status, ['sent', 'opened'])))
    .groupBy(outbox.campaignId)
  for (const b of booked) {
    const r = out.get(b.id!)!
    r.bookedClients = b.clients
    r.bookings = b.bookings
  }
  return out
}

/** Client ids that booked within 14 days of this campaign's message (for the recipients table). */
export async function campaignBookedClients(tx: Tx, campaignId: string) {
  const sentAt = sql`coalesce(${outbox.sentAt}, ${outbox.dueAt})`
  const rows = await tx
    .selectDistinct({ clientId: outbox.clientId })
    .from(outbox)
    .innerJoin(
      bookings,
      and(
        eq(bookings.clientId, outbox.clientId),
        sql`${bookings.status} <> 'cancelled'`,
        sql`${bookings.createdAt} >= ${sentAt}`,
        sql`${bookings.createdAt} < ${sentAt} + make_interval(days => ${CAMPAIGN_LIMITS.attributionDays})`,
      ),
    )
    .where(and(eq(outbox.campaignId, campaignId), inArray(outbox.status, ['sent', 'opened'])))
  return new Set(rows.map((r) => r.clientId!))
}

/** Marks queued campaigns as done once every message was sent or skipped. Returns how many finished. */
export async function finishCampaigns(tx: Tx) {
  const done = await tx
    .update(campaigns)
    .set({ status: 'done', updatedAt: new Date() })
    .where(
      and(
        eq(campaigns.status, 'queued'),
        sql`not exists (select 1 from ${outbox} o where o.campaign_id = ${campaigns.id} and o.status in ('queued', 'opened'))`,
      ),
    )
    .returning({ id: campaigns.id })
  return done.length
}

/** Copies a campaign (message, segment, offer) into a new draft. */
export async function duplicateCampaign(tx: Tx, campaignId: string, userId?: string) {
  const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (!c) throw new DomainError('Campaign not found', 'not_found')
  const [copy] = await tx
    .insert(campaigns)
    .values({
      tenantId: c.tenantId,
      name: `${c.name} (copy)`.slice(0, 80),
      segmentId: c.segmentId,
      body: c.body,
      rules: c.rules,
      promoCodeId: c.promoCodeId,
      createdBy: userId,
    })
    .returning()
  return copy!
}

/**
 * Archives a campaign (hidden from the main list). Messages not yet sent are taken out of the WhatsApp queue
 * so nobody sends them by accident; returns how many were withdrawn.
 */
export async function archiveCampaign(tx: Tx, campaignId: string, archived = true) {
  const [c] = await tx
    .update(campaigns)
    .set({ archivedAt: archived ? new Date() : null, updatedAt: new Date() })
    .where(eq(campaigns.id, campaignId))
    .returning({ id: campaigns.id })
  if (!c) throw new DomainError('Campaign not found', 'not_found')
  if (!archived) return 0
  const withdrawn = await tx
    .update(outbox)
    .set({ status: 'skipped' })
    .where(and(eq(outbox.campaignId, campaignId), inArray(outbox.status, ['queued', 'opened'])))
    .returning({ id: outbox.id })
  // Nothing is left to send, so a queued campaign is finished.
  await tx
    .update(campaigns)
    .set({ status: 'done' })
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.status, 'queued')))
  return withdrawn.length
}

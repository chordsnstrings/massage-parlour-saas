// Client segments → click-to-send WhatsApp campaigns (rows in the outbox), and document expiry reminders.
import { addDays, businessDateOf } from '@spa/core'
import {
  bookingItems,
  bookings,
  businessDocuments,
  type CampaignStats,
  campaigns,
  clientPackages,
  clients,
  outbox,
  promoCodes,
  type SegmentRule,
  sales,
  segments,
  serviceVariants,
  staff,
  staffDocuments,
  type Tx,
  tenants,
} from '@spa/db'
import { and, asc, eq, inArray, isNotNull, isNull, lte, ne, or, type SQL, sql } from 'drizzle-orm'
import { CAMPAIGN_LIMITS, type CampaignVars, renderCampaignMessage } from './campaigns'
import { DomainError } from './errors'

const DAY = 86_400_000
/** Calendar date in Dubai (birthdays follow the calendar, not the business-day cutoff). */
const dubaiDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' })
const iso = (d: Date) => d.toISOString()

/** SQL condition for one rule, evaluated on the `clients` row. */
function ruleCondition(r: SegmentRule, now: Date): SQL {
  switch (r.kind) {
    case 'lapsed':
      return sql`${clients.lastVisitAt} < ${iso(new Date(now.getTime() - r.days * DAY))}::timestamptz`
    case 'visited_within':
      return sql`${clients.lastVisitAt} >= ${iso(new Date(now.getTime() - r.days * DAY))}::timestamptz`
    case 'visits_at_least':
    case 'visits_at_most': {
      const visits = sql`(select count(*) from ${bookings} b where b.client_id = ${clients.id} and b.status = 'completed')`
      return r.kind === 'visits_at_least' ? sql`${visits} >= ${r.count}` : sql`${visits} <= ${r.count}`
    }
    case 'spent_at_least':
      return sql`(select coalesce(sum(s.total_aed), 0) from ${sales} s where s.client_id = ${clients.id} and s.status = 'paid') >= ${r.aed}`
    case 'service':
      return sql`exists (select 1 from ${bookingItems} bi join ${bookings} b on b.id = bi.booking_id
        join ${serviceVariants} v on v.id = bi.service_variant_id
        where b.client_id = ${clients.id} and b.status <> 'cancelled' and v.service_id = ${r.serviceId}::uuid)`
    case 'birthday_month':
      return sql`${clients.birthday} is not null
        and extract(month from ${clients.birthday}) = extract(month from ${dubaiDate(now)}::date)`
    case 'birthday_within':
      // 29 February birthdays fall on 28 February in non-leap years (the day after it is 1 March).
      return sql`${clients.birthday} is not null and exists (
        select 1 from generate_series(${dubaiDate(now)}::date, ${dubaiDate(now)}::date + ${r.days}::int, interval '1 day') g(d)
        where to_char(g.d, 'MM-DD') = to_char(${clients.birthday}, 'MM-DD')
          or (to_char(${clients.birthday}, 'MM-DD') = '02-29' and to_char(g.d, 'MM-DD') = '02-28'
            and to_char(g.d + interval '1 day', 'MM-DD') = '03-01'))`
    case 'gender':
      return sql`${clients.gender} = ${r.gender}`
    case 'language':
      return r.language === 'ar' ? sql`${clients.language} = 'ar'` : sql`${clients.language} <> 'ar'`
    case 'tag':
      return sql`${r.tag} = any(${clients.tags})`
    case 'has_package':
      return sql`exists (select 1 from ${clientPackages} p where p.client_id = ${clients.id}
        and p.status = 'active' and p.expires_at > ${iso(now)}::timestamptz)`
    case 'package_expiring':
      return sql`exists (select 1 from ${clientPackages} p where p.client_id = ${clients.id}
        and p.status = 'active' and p.expires_at > ${iso(now)}::timestamptz
        and p.expires_at <= ${iso(new Date(now.getTime() + r.days * DAY))}::timestamptz)`
    case 'no_shows_at_least':
      return sql`${clients.noShowCount} >= ${r.count}`
  }
}

/** Tag that keeps a client out of every campaign (alongside the marketing opt-out date). */
export const NO_MARKETING_TAG = 'no-marketing'

/** Conditions on the `clients` row for receiving marketing: a mobile number, not blocklisted, not opted out. */
const marketingConsent = () => [
  isNotNull(clients.phoneE164),
  isNull(clients.marketingOptOutAt),
  eq(clients.blocklisted, false),
  sql`not (${NO_MARKETING_TAG} = any(${clients.tags}))`,
]

/**
 * True for an outbox row that belongs to a campaign whose client has since opted out, been blocklisted or
 * tagged `no-marketing` — such messages must not be sent (consent is re-checked at send time, not only at queueing).
 */
export const campaignConsentWithdrawn = () =>
  sql`(${outbox.campaignId} is not null and not exists (
    select 1 from ${clients} where ${clients.id} = ${outbox.clientId} and ${and(...marketingConsent())}))`

/**
 * Takes campaign messages still waiting in the WhatsApp queue out of it (status `skipped`) when their client no
 * longer accepts marketing. Returns how many were withdrawn.
 */
export async function withdrawCampaignMessagesWithoutConsent(tx: Tx) {
  const rows = await tx
    .update(outbox)
    .set({ status: 'skipped' })
    .where(and(inArray(outbox.status, ['queued', 'opened']), campaignConsentWithdrawn()))
    .returning({ id: outbox.id })
  return rows.length
}

/**
 * Clients matching every rule, most recent visitors first. Marketing guardrails always apply: a mobile number,
 * not blocklisted, not opted out (date or `no-marketing` tag) and — unless `requireVisit` is false — at least one visit.
 */
export async function resolveSegment(
  tx: Tx,
  tenantId: string,
  rules: SegmentRule[],
  now = new Date(),
  opts: { requireVisit?: boolean } = {},
) {
  const conds: (SQL | undefined)[] = [
    eq(clients.tenantId, tenantId),
    ...marketingConsent(),
    opts.requireVisit === false ? undefined : isNotNull(clients.lastVisitAt),
    ...rules.map((r) => ruleCondition(r, now)),
  ]
  return tx
    .select({
      id: clients.id,
      name: clients.name,
      phone: clients.phoneE164,
      language: clients.language,
      lastVisitAt: clients.lastVisitAt,
    })
    .from(clients)
    .where(and(...conds))
    .orderBy(sql`${clients.lastVisitAt} desc nulls last`, asc(clients.name), asc(clients.id))
}

export type SegmentClient = Awaited<ReturnType<typeof resolveSegment>>[number]

/**
 * Who a campaign sent at `sendAt` would reach: the segment as it stands at `sendAt` (birthdays, lapsed days and
 * package expiry are counted from the send time, not from when it was queued) minus clients another campaign
 * messages within 7 days of it (frequency cap), capped at 500 recipients.
 *
 * Sending is manual, so the cap looks at when a message was actually sent (`sent_at`), and treats a message still
 * waiting in the queue as sendable any time from its due time on: an unsent message due before `sendAt` + 7 days
 * blocks the client, however old it is.
 */
export async function planAudience(
  tx: Tx,
  tenantId: string,
  rules: SegmentRule[],
  opts: { sendAt?: Date; excludeCampaignId?: string; now?: Date; limit?: number } = {},
) {
  const now = opts.now ?? new Date()
  const sendAt = opts.sendAt ?? now
  const limit = opts.limit ?? CAMPAIGN_LIMITS.maxRecipients
  const matched = await resolveSegment(tx, tenantId, rules, sendAt)
  const capMs = CAMPAIGN_LIMITS.capDays * DAY
  const from = iso(new Date(sendAt.getTime() - capMs))
  const until = iso(new Date(sendAt.getTime() + capMs))
  const at = sql`coalesce(${outbox.sentAt}, ${outbox.dueAt})`
  const recent = await tx
    .selectDistinct({ clientId: outbox.clientId })
    .from(outbox)
    .where(
      and(
        eq(outbox.tenantId, tenantId),
        isNotNull(outbox.campaignId),
        opts.excludeCampaignId ? ne(outbox.campaignId, opts.excludeCampaignId) : undefined,
        ne(outbox.status, 'skipped'),
        or(
          sql`${at} > ${from}::timestamptz and ${at} < ${until}::timestamptz`,
          and(inArray(outbox.status, ['queued', 'opened']), sql`${outbox.dueAt} < ${until}::timestamptz`),
        ),
      ),
    )
  const recentIds = new Set(recent.map((r) => r.clientId))
  const eligible = matched.filter((c) => !recentIds.has(c.id))
  const recipients = eligible.slice(0, limit)
  return {
    matched: matched.length,
    recipients,
    skippedRecent: matched.length - eligible.length,
    skippedOverLimit: eligible.length - recipients.length,
  }
}

/**
 * Queues one personalised WhatsApp message per recipient into the outbox, due at the campaign's send time.
 * Nothing is sent automatically: the receptionist clicks to send each one on /messages.
 * Rules default to the campaign's segment (or its saved snapshot). Returns the number of messages queued.
 */
export async function queueCampaign(
  tx: Tx,
  campaignId: string,
  rules?: SegmentRule[],
  opts: { sendAt?: Date; bookingLink?: string; now?: Date } = {},
) {
  const now = opts.now ?? new Date()
  const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId)).for('update')
  if (!c) throw new DomainError('Campaign not found', 'not_found')
  if (c.status !== 'draft') throw new DomainError('This campaign was already queued')
  if (c.archivedAt) throw new DomainError('Restore this campaign before queueing it')
  // One campaign at a time per spa, so two campaigns can't both pass the 7-day cap for the same client.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`campaigns:${c.tenantId}`}))`)
  let use = rules
  if (!use && c.segmentId) {
    const [seg] = await tx
      .select({ rules: segments.rules })
      .from(segments)
      .where(eq(segments.id, c.segmentId))
    use = seg?.rules
  }
  use ??= c.rules ?? undefined
  if (!use) throw new DomainError('Choose who should receive this campaign')
  const sendAt = opts.sendAt ?? c.scheduledAt ?? now
  const [spa] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, c.tenantId))
  let offerCode: string | null = null
  if (c.promoCodeId) {
    const [promo] = await tx
      .select({ code: promoCodes.code })
      .from(promoCodes)
      .where(eq(promoCodes.id, c.promoCodeId))
    offerCode = promo?.code ?? null
  }
  const vars: CampaignVars = { spa: spa?.name ?? '', bookingLink: opts.bookingLink, offerCode }
  const plan = await planAudience(tx, c.tenantId, use, { sendAt, excludeCampaignId: c.id, now })
  const stats: CampaignStats = {
    matched: plan.matched,
    skippedRecent: plan.skippedRecent,
    skippedOverLimit: plan.skippedOverLimit,
    en: 0,
    ar: 0,
  }
  const rows = plan.recipients.map((p) => {
    const msg = renderCampaignMessage(c.body, p, vars)
    stats[msg.lang] = (stats[msg.lang] ?? 0) + 1
    return {
      tenantId: c.tenantId,
      clientId: p.id,
      campaignId,
      kind: 'custom' as const,
      phoneE164: p.phone!,
      text: msg.text,
      dueAt: sendAt,
    }
  })
  if (rows.length) await tx.insert(outbox).values(rows)
  await tx
    .update(campaigns)
    .set({
      status: 'queued',
      recipients: rows.length,
      rules: use,
      scheduledAt: sendAt,
      queuedAt: now,
      stats,
      updatedAt: now,
    })
    .where(eq(campaigns.id, campaignId))
  return rows.length
}

/** Staff and business documents expiring within `days` (or already expired). */
export async function expiringDocuments(tx: Tx, tenantId: string, days = 90, now = new Date()) {
  const until = addDays(businessDateOf(now), days)
  const staffDocs = await tx
    .select({
      id: staffDocuments.id,
      type: staffDocuments.type,
      expiresOn: staffDocuments.expiresOn,
      owner: staff.displayName,
    })
    .from(staffDocuments)
    .innerJoin(staff, eq(staff.id, staffDocuments.staffId))
    .where(
      and(
        eq(staffDocuments.tenantId, tenantId),
        isNotNull(staffDocuments.expiresOn),
        lte(staffDocuments.expiresOn, until),
      ),
    )
  const bizDocs = await tx
    .select({
      id: businessDocuments.id,
      type: businessDocuments.type,
      expiresOn: businessDocuments.expiresOn,
    })
    .from(businessDocuments)
    .where(
      and(
        eq(businessDocuments.tenantId, tenantId),
        isNotNull(businessDocuments.expiresOn),
        lte(businessDocuments.expiresOn, until),
      ),
    )
  return [
    ...staffDocs.map((d) => ({ ...d, scope: 'staff' as const })),
    ...bizDocs.map((d) => ({ ...d, owner: 'Business', scope: 'business' as const })),
  ].sort((a, b) => String(a.expiresOn).localeCompare(String(b.expiresOn)))
}

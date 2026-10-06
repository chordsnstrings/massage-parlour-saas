// Client segments → click-to-send WhatsApp campaigns (rows in the outbox), and document expiry reminders.
import { addDays, businessDateOf } from '@spa/core'
import {
  bookingItems,
  bookings,
  businessDocuments,
  campaigns,
  clients,
  outbox,
  type SegmentRule,
  sales,
  serviceVariants,
  staff,
  staffDocuments,
  type Tx,
  tenants,
} from '@spa/db'
import { and, eq, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { renderTemplate } from './outbox'

/** Client ids matching every rule (opted-out clients and those without a mobile are always excluded). */
export async function resolveSegment(tx: Tx, tenantId: string, rules: SegmentRule[], now = new Date()) {
  const conds = [
    eq(clients.tenantId, tenantId),
    isNotNull(clients.phoneE164),
    isNull(clients.marketingOptOutAt),
    eq(clients.blocklisted, false),
  ]
  for (const r of rules) {
    if (r.kind === 'lapsed')
      conds.push(
        sql`${clients.lastVisitAt} < ${new Date(now.getTime() - r.days * 86_400_000).toISOString()}::timestamptz`,
      )
    if (r.kind === 'tag') conds.push(sql`${r.tag} = any(${clients.tags})`)
    if (r.kind === 'birthday_within') {
      conds.push(sql`${clients.birthday} is not null and (
        (date_part('doy', ${clients.birthday}) - date_part('doy', ${now.toISOString()}::date) + 366)::int % 366 <= ${r.days})`)
    }
    if (r.kind === 'visits_at_least') {
      conds.push(
        sql`(select count(*) from ${bookings} b where b.client_id = ${clients.id} and b.status = 'completed') >= ${r.count}`,
      )
    }
    if (r.kind === 'spent_at_least') {
      conds.push(
        sql`(select coalesce(sum(s.total_aed), 0) from ${sales} s where s.client_id = ${clients.id} and s.status = 'paid') >= ${r.aed}`,
      )
    }
    if (r.kind === 'service') {
      conds.push(sql`exists (select 1 from ${bookingItems} bi join ${bookings} b on b.id = bi.booking_id join ${serviceVariants} v on v.id = bi.service_variant_id
        where b.client_id = ${clients.id} and v.service_id = ${r.serviceId})`)
    }
  }
  return tx
    .select({ id: clients.id, name: clients.name, phone: clients.phoneE164, language: clients.language })
    .from(clients)
    .where(and(...conds))
}

/** Queues one personalised WhatsApp message per recipient into the outbox (receptionist clicks to send). */
export async function queueCampaign(tx: Tx, campaignId: string, rules: SegmentRule[]) {
  const [c] = await tx.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (!c) throw new DomainError('Campaign not found', 'not_found')
  if (c.status !== 'draft') throw new DomainError('This campaign was already queued')
  const [spa] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, c.tenantId))
  const people = await resolveSegment(tx, c.tenantId, rules)
  if (people.length) {
    await tx.insert(outbox).values(
      people.map((p) => ({
        tenantId: c.tenantId,
        clientId: p.id,
        campaignId,
        kind: 'custom' as const,
        phoneE164: p.phone!,
        text: renderTemplate(p.language === 'ar' && c.body.ar ? c.body.ar : c.body.en, {
          first_name: p.name.split(' ')[0] ?? p.name,
          name: p.name,
          spa: spa?.name ?? '',
        }),
      })),
    )
  }
  await tx
    .update(campaigns)
    .set({ status: 'queued', recipients: people.length })
    .where(eq(campaigns.id, campaignId))
  return people.length
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

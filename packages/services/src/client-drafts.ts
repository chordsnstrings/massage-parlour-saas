// F15: automatic client message drafts — a review request after a visit, a birthday greeting, a win-back note for
// lapsed clients. Nothing is sent: rows are QUEUED in the WhatsApp outbox for staff to click-to-send (F28 assignment
// and the auto-assign rule apply as to any row). The worker calls these only for spas whose switch is on and whose
// plan includes marketing (`automationOnSql`). Enforced here: marketing consent (mobile, not opted out / blocklisted /
// tagged no-marketing), quiet hours (due time moved past them), per-client caps (CLIENT_DRAFT_LIMITS).
import {
  afterQuietHours,
  CLIENT_DRAFT_LIMITS,
  type ClientDraftSettings,
  clientDraftSettings,
  dubaiInstant,
  dubaiParts,
  freeSiteUrl,
} from '@spa/core'
import { bookingItems, bookings, branches, clients, domains, outbox, sales, type Tx, tenants } from '@spa/db'
import { and, asc, desc, eq, gte, inArray, isNotNull, ne, or, sql } from 'drizzle-orm'
import { marketingConsent, resolveSegment } from './growth'
import { renderTemplate, templateFor } from './outbox'

const DAY = 86_400_000
const HOUR = 3_600_000

export type DraftKind = 'review_request' | 'birthday' | 'winback'

/** The spa's public site address: its primary active custom domain, else the free address (worker-safe). */
export async function spaSiteUrl(
  tx: Tx,
  slug: string,
  env: { ROOT_DOMAIN?: string; APP_URL?: string } = {
    ROOT_DOMAIN: process.env.ROOT_DOMAIN,
    APP_URL: process.env.APP_URL,
  },
) {
  const [primary] = await tx
    .select({ hostname: domains.hostname })
    .from(domains)
    .where(and(eq(domains.kind, 'custom'), eq(domains.status, 'active'), eq(domains.isPrimary, true)))
    .limit(1)
  return primary ? `https://${primary.hostname}` : freeSiteUrl(slug, env)
}

async function spaOf(tx: Tx, tenantId: string) {
  const [spa] = await tx
    .select({ name: tenants.name, slug: tenants.slug, settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
  const [branch] = await tx
    .select({ id: branches.id })
    .from(branches)
    .orderBy(desc(branches.isDefault), asc(branches.createdAt))
    .limit(1)
  return spa
    ? { ...spa, defaultBranchId: branch?.id ?? null, drafts: clientDraftSettings(spa.settings) }
    : null
}

/** Clients a marketing message (campaign or automatic draft) reached or is due to reach within ±7 days of `at`. */
async function recentlyMarketed(tx: Tx, clientIds: string[], at: Date) {
  if (!clientIds.length) return new Set<string>()
  const cap = CLIENT_DRAFT_LIMITS.marketingCapDays * DAY
  const when = sql`coalesce(${outbox.sentAt}, ${outbox.dueAt})`
  const rows = await tx
    .selectDistinct({ clientId: outbox.clientId })
    .from(outbox)
    .where(
      and(
        inArray(outbox.clientId, clientIds),
        ne(outbox.status, 'skipped'),
        or(isNotNull(outbox.campaignId), inArray(outbox.kind, ['birthday', 'winback', 'slot_offer'])),
        sql`${when} > ${new Date(at.getTime() - cap).toISOString()}::timestamptz`,
        sql`${when} < ${new Date(at.getTime() + cap).toISOString()}::timestamptz`,
      ),
    )
  return new Set(rows.map((r) => r.clientId!))
}

/** Each client's latest booking: branch (for the outbox row + assignment scope) and first service name. */
async function lastBookings(tx: Tx, clientIds: string[]) {
  if (!clientIds.length) return new Map<string, { branchId: string; service: string }>()
  const rows = await tx.execute<{ client_id: string; branch_id: string; service: string | null }>(sql`
    select distinct on (b.client_id) b.client_id, b.branch_id,
      (select bi.service_name from ${bookingItems} bi where bi.booking_id = b.id order by bi.starts_at limit 1) as service
    from ${bookings} b
    where b.client_id in (${sql.join(
      clientIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}) and b.status <> 'cancelled'
    order by b.client_id, b.starts_at desc`)
  return new Map(rows.rows.map((r) => [r.client_id, { branchId: r.branch_id, service: r.service ?? '' }]))
}

type Spa = NonNullable<Awaited<ReturnType<typeof spaOf>>>
type Target = {
  clientId: string
  name: string
  language: string
  phone: string
  branchId: string | null
  bookingId?: string
  service?: string
  dueAt: Date
}

async function insertDrafts(
  tx: Tx,
  tenantId: string,
  spa: Spa,
  kind: DraftKind,
  link: string,
  rows: Target[],
) {
  if (!rows.length) return 0
  const bodies = { en: await templateFor(tx, kind, 'en'), ar: await templateFor(tx, kind, 'ar') }
  const inserted = await tx
    .insert(outbox)
    .values(
      rows.map((r) => {
        const first = r.name.trim().split(/\s+/)[0] ?? r.name
        return {
          tenantId,
          branchId: r.branchId ?? spa.defaultBranchId,
          clientId: r.clientId,
          bookingId: r.bookingId ?? null,
          kind,
          phoneE164: r.phone,
          text: renderTemplate(r.language === 'ar' ? bodies.ar : bodies.en, {
            first_name: first,
            name: r.name,
            spa: spa.name,
            link,
            service: r.service ?? '',
          })
            .replace(/[ \t]+\n/g, '\n')
            .trim(),
          dueAt: afterQuietHours(r.dueAt, spa.drafts),
        }
      }),
    )
    .onConflictDoNothing()
    .returning({ id: outbox.id })
  return inserted.length
}

/** One run of a draft kind at a time per spa (the hourly job and a manual run can't double-queue). */
const lockSpa = (tx: Tx, tenantId: string, kind: DraftKind) =>
  tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`client-drafts:${kind}:${tenantId}`}))`)

/**
 * Review requests: visits checked out within the last 48 h (no backfill on switch-on) get one `review_request`
 * (once per booking), due `reviewDelayHours` after checkout and outside quiet hours; at most one per client in 90 days.
 * Needs the spa's review link (`{link}`); without one nothing is queued. Returns how many were queued.
 */
export async function queueReviewRequests(tx: Tx, tenantId: string, now = new Date()) {
  const spa = await spaOf(tx, tenantId)
  if (!spa?.drafts.reviewLink) return 0
  await lockSpa(tx, tenantId, 'review_request')
  const since = new Date(now.getTime() - CLIENT_DRAFT_LIMITS.reviewWindowHours * HOUR)
  const capSince = new Date(now.getTime() - CLIENT_DRAFT_LIMITS.reviewCapDays * DAY)
  const visits = await tx
    .selectDistinctOn([bookings.clientId], {
      bookingId: bookings.id,
      branchId: bookings.branchId,
      clientId: clients.id,
      name: clients.name,
      language: clients.language,
      phone: clients.phoneE164,
      checkedOutAt: sales.createdAt,
    })
    .from(bookings)
    .innerJoin(clients, eq(clients.id, bookings.clientId))
    .innerJoin(sales, and(eq(sales.bookingId, bookings.id), ne(sales.status, 'void')))
    .where(
      and(
        eq(bookings.status, 'completed'),
        gte(sales.createdAt, since),
        ...marketingConsent(),
        sql`not exists (select 1 from ${outbox} o where o.client_id = ${clients.id}
          and o.kind = 'review_request' and o.created_at > ${capSince.toISOString()}::timestamptz)`,
      ),
    )
    .orderBy(bookings.clientId, desc(sales.createdAt))
  const rows: Target[] = visits.map((v) => ({
    clientId: v.clientId,
    name: v.name,
    language: v.language,
    phone: v.phone!,
    branchId: v.branchId,
    bookingId: v.bookingId,
    dueAt: new Date(Math.max(now.getTime(), v.checkedOutAt.getTime() + spa.drafts.reviewDelayHours * HOUR)),
  }))
  return insertDrafts(tx, tenantId, spa, 'review_request', spa.drafts.reviewLink, rows)
}

/** Dubai calendar date (birthdays follow the calendar, not the business-day cutoff). */
const dubaiDate = (d: Date) => dubaiParts(d).date

/**
 * Birthday greetings: clients (with at least one visit) whose birthday is today in Dubai (29 Feb → 28 Feb in other
 * years) get one `birthday` draft, at most one per client in 300 days and none when another marketing message reaches
 * them within 7 days. `{link}` = the spa's booking page.
 */
export async function queueBirthdayMessages(tx: Tx, tenantId: string, now = new Date(), siteUrl?: string) {
  const spa = await spaOf(tx, tenantId)
  if (!spa) return 0
  await lockSpa(tx, tenantId, 'birthday')
  const people = await resolveSegment(tx, tenantId, [{ kind: 'birthday_within', days: 0 }], now)
  if (!people.length) return 0
  const ids = people.map((p) => p.id)
  const capSince = new Date(now.getTime() - CLIENT_DRAFT_LIMITS.birthdayCapDays * DAY)
  const had = await tx
    .selectDistinct({ clientId: outbox.clientId })
    .from(outbox)
    .where(
      and(
        inArray(outbox.clientId, ids),
        eq(outbox.kind, 'birthday'),
        sql`${outbox.createdAt} > ${capSince.toISOString()}::timestamptz`,
      ),
    )
  const skip = new Set([...had.map((r) => r.clientId!), ...(await recentlyMarketed(tx, ids, now))])
  const pick = people.filter((p) => !skip.has(p.id))
  const last = await lastBookings(
    tx,
    pick.map((p) => p.id),
  )
  // The hourly job first sees a birthday just after midnight: due when the quiet hours end that morning.
  const rows: Target[] = pick.map((p) => ({
    clientId: p.id,
    name: p.name,
    language: p.language,
    phone: p.phone!,
    branchId: last.get(p.id)?.branchId ?? null,
    service: last.get(p.id)?.service,
    dueAt: now,
  }))
  const link = `${siteUrl ?? (await spaSiteUrl(tx, spa.slug))}/book`
  return insertDrafts(tx, tenantId, spa, 'birthday', link, rows)
}

/**
 * Win-back: clients whose last visit was `winbackDays`–365 days ago, with no booking ahead, get one `winback` draft
 * per lapse (none since their last visit), none when another marketing message reaches them within 7 days, at most
 * 25 per spa per Dubai day (the most recent lapses first). `{link}` = the booking page, `{service}` = last treatment.
 */
export async function queueWinbackMessages(tx: Tx, tenantId: string, now = new Date(), siteUrl?: string) {
  const spa = await spaOf(tx, tenantId)
  if (!spa) return 0
  await lockSpa(tx, tenantId, 'winback')
  const today = dubaiDate(now)
  const dayStart = dubaiInstant(today, 0)
  const [{ n: queuedToday } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(outbox)
    .where(and(eq(outbox.kind, 'winback'), gte(outbox.createdAt, dayStart)))
  const room = CLIENT_DRAFT_LIMITS.winbackPerDay - queuedToday
  if (room <= 0) return 0
  const people = await resolveSegment(
    tx,
    tenantId,
    [
      { kind: 'lapsed', days: spa.drafts.winbackDays },
      { kind: 'visited_within', days: CLIENT_DRAFT_LIMITS.winbackMaxDays },
    ],
    now,
  )
  if (!people.length) return 0
  const ids = people.map((p) => p.id)
  const blocked = await tx.execute<{ id: string }>(sql`
    select c.id from ${clients} c
    where c.id in (${sql.join(
      ids.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})
      and (exists (select 1 from ${bookings} b where b.client_id = c.id
             and b.status in ('pending', 'confirmed') and b.starts_at > ${now.toISOString()}::timestamptz)
        or exists (select 1 from ${outbox} o where o.client_id = c.id and o.kind = 'winback'
             and o.created_at > c.last_visit_at))`)
  const skip = new Set([...blocked.rows.map((r) => r.id), ...(await recentlyMarketed(tx, ids, now))])
  const pick = people.filter((p) => !skip.has(p.id)).slice(0, room)
  const last = await lastBookings(
    tx,
    pick.map((p) => p.id),
  )
  const rows: Target[] = pick.map((p) => ({
    clientId: p.id,
    name: p.name,
    language: p.language,
    phone: p.phone!,
    branchId: last.get(p.id)?.branchId ?? null,
    service: last.get(p.id)?.service,
    dueAt: now,
  }))
  const link = `${siteUrl ?? (await spaSiteUrl(tx, spa.slug))}/book`
  return insertDrafts(tx, tenantId, spa, 'winback', link, rows)
}

/** Saves the spa's draft settings (jsonb merge; other settings untouched). */
export async function saveClientDraftSettings(tx: Tx, tenantId: string, s: ClientDraftSettings) {
  await tx
    .update(tenants)
    .set({
      settings: sql`${tenants.settings} || jsonb_build_object('clientDrafts', ${JSON.stringify(s)}::jsonb)`,
    })
    .where(eq(tenants.id, tenantId))
}

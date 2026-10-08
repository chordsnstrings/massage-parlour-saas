// Duplicate clients (PLAN §14.7 B5.2): suggest pairs (same normalised phone / same normalised name), preview what
// moves, then merge in one transaction. Every FK to clients.id is re-pointed to the kept client (list below; the
// test compares it with pg_constraint), stats are combined, the merged row is deleted. Ledger is never touched.
import {
  bookings,
  clientMemberships,
  clientPackages,
  clients,
  conversations,
  giftCards,
  intakeSubmissions,
  outbox,
  sales,
  type Tx,
  treatmentNotes,
  waitlistEntries,
} from '@spa/db'
import { eq, inArray, sql } from 'drizzle-orm'
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core'
import { DomainError } from './errors'

/** Every column that references clients.id (table name → column). Keep in sync with the schema. */
export const CLIENT_REFERENCES = {
  bookings: [bookings, bookings.clientId],
  sales: [sales, sales.clientId],
  outbox: [outbox, outbox.clientId],
  intake_submissions: [intakeSubmissions, intakeSubmissions.clientId],
  treatment_notes: [treatmentNotes, treatmentNotes.clientId],
  client_packages: [clientPackages, clientPackages.clientId],
  client_memberships: [clientMemberships, clientMemberships.clientId],
  gift_cards: [giftCards, giftCards.purchaserClientId],
  conversations: [conversations, conversations.clientId],
  waitlist_entries: [waitlistEntries, waitlistEntries.clientId],
} satisfies Record<string, [PgTable, PgColumn]>

export type ClientReference = keyof typeof CLIENT_REFERENCES
export type MergeCounts = Record<ClientReference, number>

/** UAE mobile key: last 9 digits (5XXXXXXXX), so 050…, +97150… and 97150… compare equal. */
export const phoneKey = (phone: string | null | undefined) => {
  const d = (phone ?? '').replace(/\D/g, '')
  return d.length >= 7 ? d.slice(-9) : null
}
export const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ')

type ClientRow = typeof clients.$inferSelect
export type DuplicatePair = { keep: ClientRow; merge: ClientRow; reason: 'phone' | 'name' }

/**
 * Suggested duplicate pairs, oldest client first (suggested to keep). Two equi-joins (hash joins) instead of an
 * OR self-join, so it stays cheap on large client lists.
 */
export async function duplicateClientPairs(tx: Tx, limit = 50): Promise<DuplicatePair[]> {
  const phone = sql`right(regexp_replace(coalesce(phone_e164, ''), '\\D', '', 'g'), 9)`
  const name = sql`lower(regexp_replace(btrim(name), '\\s+', ' ', 'g'))`
  const { rows } = await tx.execute<{ a: string; b: string; reason: 'phone' | 'name' }>(sql`
    with c as (select id, created_at, ${phone} as pk, ${name} as nk from clients),
    pairs as (
      select a.id as a, b.id as b, 'phone' as reason, a.created_at as at from c a
        join c b on b.pk = a.pk and length(a.pk) >= 7
          and (a.created_at, a.id) < (b.created_at, b.id)
      union all
      select a.id, b.id, 'name', a.created_at from c a
        join c b on b.nk = a.nk and length(a.nk) >= 2
          and (a.created_at, a.id) < (b.created_at, b.id)
    )
    select distinct on (a, b) a, b, reason from pairs order by a, b, reason desc limit ${limit}`)
  if (!rows.length) return []
  const ids = [...new Set(rows.flatMap((r) => [r.a, r.b]))]
  const people = new Map(
    (await tx.select().from(clients).where(inArray(clients.id, ids))).map((c) => [c.id, c]),
  )
  return rows
    .map((r) => ({ keep: people.get(r.a)!, merge: people.get(r.b)!, reason: r.reason }))
    .filter((p) => p.keep && p.merge)
    .sort((x, y) => (x.reason === y.reason ? 0 : x.reason === 'phone' ? -1 : 1))
}

async function countRefs(tx: Tx, clientId: string): Promise<MergeCounts> {
  const out = {} as MergeCounts
  for (const [key, [table, col]] of Object.entries(CLIENT_REFERENCES) as [
    ClientReference,
    [PgTable, PgColumn],
  ][]) {
    const [row] = await tx.select({ n: sql<number>`count(*)::int` }).from(table).where(eq(col, clientId))
    out[key] = row?.n ?? 0
  }
  return out
}

/** Both clients + what would move from `mergeId` to `keepId`. */
export async function mergePreview(tx: Tx, keepId: string, mergeId: string) {
  if (keepId === mergeId) throw new DomainError('Choose two different clients')
  const rows = await tx
    .select()
    .from(clients)
    .where(inArray(clients.id, [keepId, mergeId]))
  const keep = rows.find((r) => r.id === keepId)
  const merge = rows.find((r) => r.id === mergeId)
  if (!keep || !merge) throw new DomainError('Client not found', 'not_found')
  return { keep, merge, counts: await countRefs(tx, mergeId), result: combined(keep, merge) }
}

const minDate = (a: Date | null, b: Date | null) => (a && b ? (a < b ? a : b) : (a ?? b))
const maxDate = (a: Date | null, b: Date | null) => (a && b ? (a > b ? a : b) : (a ?? b))

/** The kept client's fields after the merge (kept values win; gaps filled from the merged client). */
function combined(keep: ClientRow, merge: ClientRow) {
  const notes = [keep.notes, merge.notes].filter((n) => n?.trim()).join('\n\n') || null
  return {
    phoneE164: keep.phoneE164 ?? merge.phoneE164,
    email: keep.email ?? merge.email,
    gender: keep.gender ?? merge.gender,
    birthday: keep.birthday ?? merge.birthday,
    nationality: keep.nationality ?? merge.nationality,
    source: keep.source ?? merge.source,
    tags: [...new Set([...keep.tags, ...merge.tags])],
    preferences: { ...merge.preferences, ...keep.preferences },
    notes,
    blocklisted: keep.blocklisted || merge.blocklisted,
    blocklistReason: keep.blocklisted
      ? keep.blocklistReason
      : (merge.blocklistReason ?? keep.blocklistReason),
    noShowCount: keep.noShowCount + merge.noShowCount,
    marketingOptOutAt: minDate(keep.marketingOptOutAt, merge.marketingOptOutAt),
    firstVisitAt: minDate(keep.firstVisitAt, merge.firstVisitAt),
    lastVisitAt: maxDate(keep.lastVisitAt, merge.lastVisitAt),
    createdAt: minDate(keep.createdAt, merge.createdAt)!,
  }
}

/**
 * Merges `mergeId` into `keepId` in the caller's transaction: locks both rows (id order, so opposite merges can't
 * deadlock; the loser finds its row gone → not_found), re-points every reference, deletes the merged client and
 * writes the combined fields onto the kept one. Journal entries hold no client ids, so the ledger is untouched.
 */
export async function mergeClients(tx: Tx, keepId: string, mergeId: string) {
  if (keepId === mergeId) throw new DomainError('Choose two different clients')
  const locked = await tx
    .select()
    .from(clients)
    .where(inArray(clients.id, [keepId, mergeId]))
    .orderBy(clients.id)
    .for('update')
  const keep = locked.find((r) => r.id === keepId)
  const merge = locked.find((r) => r.id === mergeId)
  if (!keep || !merge) throw new DomainError('Client not found', 'not_found')
  const moved = {} as MergeCounts
  for (const [key, [table, col]] of Object.entries(CLIENT_REFERENCES) as [
    ClientReference,
    [PgTable, PgColumn],
  ][]) {
    const res = await tx
      .update(table)
      .set({ [col.name === 'purchaser_client_id' ? 'purchaserClientId' : 'clientId']: keepId })
      .where(eq(col, mergeId))
    moved[key] = res.rowCount ?? 0
  }
  const fields = combined(keep, merge)
  // Delete first: the merged phone may move to the kept client (unique tenant + phone).
  await tx.delete(clients).where(eq(clients.id, mergeId))
  const [kept] = await tx
    .update(clients)
    .set({ ...fields, updatedAt: new Date() })
    .where(eq(clients.id, keepId))
    .returning()
  return { kept: kept!, merged: merge, moved }
}

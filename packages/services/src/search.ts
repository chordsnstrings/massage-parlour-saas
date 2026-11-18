// Global search (PLAN §14.7 B4): one query across clients, bookings, receipts (sales), staff and services.
// Tenant-scoped through the caller's `withTenant` tx (RLS); the caller decides what the member may see (`scope`) —
// a group missing from the scope is never queried. Phone numbers are matched and returned only with `phone: true`
// (`clients.phone`). Ranking: exact > prefix > substring, then pg_trgm similarity (migration 0024 indexes).
import { bookingItems, bookings, clients, sales, services, staff, type Tx } from '@spa/db'
import { and, eq, inArray, or, type SQL, sql } from 'drizzle-orm'

export const SEARCH_KINDS = ['clients', 'bookings', 'sales', 'staff', 'services'] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]

export type SearchScope = {
  clients?: { phone: boolean }
  /** Branches the member may see; `staffId` = only bookings with this therapist (members without calendar.manage). */
  bookings?: { branchIds: string[]; staffId?: string | null }
  sales?: { branchIds: string[] }
  staff?: boolean
  services?: boolean
}

export type SearchHit = {
  kind: SearchKind
  id: string
  title: string
  /** Kind-specific facts for the sub line (the UI formats and translates them). */
  phone?: string | null
  refCode?: string
  number?: number
  clientName?: string | null
  at?: Date | null
  status?: string
  totalAed?: string
}

export type SearchGroup = { kind: SearchKind; hits: SearchHit[]; hasMore: boolean }

export const SEARCH_MIN_CHARS = 2

/** `%` and `_` typed by the user are literal. */
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** Rank of a text column against q: exact 3, prefix 2, substring 1, plus trigram similarity (0–1). */
const rank = (col: SQL | unknown, q: string) =>
  sql<number>`(case when lower(${col}) = lower(${q}) then 3 when ${col} ilike ${`${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`} then 2 when ${col} ilike ${like(q)} then 1 else 0 end + coalesce(word_similarity(${q}, ${col}), 0))`

/** Text match: substring, or (3+ chars) a close word-similarity hit for typos — both served by trigram indexes. */
const textMatch = (col: SQL | unknown, q: string) =>
  q.length >= 3 ? sql`(${col} ilike ${like(q)} or ${q} <% ${col})` : sql`${col} ilike ${like(q)}`

/** Digits of a phone query; a local 05x number also matches its stored 9715x form. */
function phoneDigits(q: string) {
  if (!/^[+\d\s()-]+$/.test(q)) return null
  const d = q.replace(/\D/g, '')
  if (d.length < 3) return null
  return d.startsWith('00') ? d.slice(2) : d.startsWith('0') ? d.slice(1) : d
}

/**
 * Searches every group in `scope`. `limit` = hits per group (one extra is read for `hasMore`); `kind` + `page`
 * page through a single group (the palette's "more" row). Groups without hits are left out.
 */
export async function globalSearch(
  tx: Tx,
  query: string,
  scope: SearchScope,
  opts: { limit?: number; kind?: SearchKind; page?: number } = {},
): Promise<SearchGroup[]> {
  const q = query.trim().slice(0, 80)
  if (q.length < SEARCH_MIN_CHARS) return []
  const limit = Math.min(Math.max(opts.limit ?? 5, 1), 50)
  const offset = (Math.max(opts.page ?? 1, 1) - 1) * limit
  const want = (k: SearchKind) => !opts.kind || opts.kind === k
  const tasks: (() => Promise<SearchGroup>)[] = []
  const group = (kind: SearchKind, hits: SearchHit[]): SearchGroup => ({
    kind,
    hits: hits.slice(0, limit),
    hasMore: hits.length > limit,
  })

  if (scope.clients && want('clients')) {
    const digits = scope.clients.phone ? phoneDigits(q) : null
    const showPhone = scope.clients.phone
    const score = digits
      ? sql<number>`greatest(${rank(clients.name, q)}, case when ${clients.phoneE164} like ${`%${digits}%`} then 2 else 0 end)`
      : rank(clients.name, q)
    tasks.push(() =>
      tx
        .select({
          id: clients.id,
          name: clients.name,
          phone: clients.phoneE164,
          lastVisitAt: clients.lastVisitAt,
        })
        .from(clients)
        .where(
          digits
            ? or(textMatch(clients.name, q), sql`${clients.phoneE164} like ${`%${digits}%`}`)
            : textMatch(clients.name, q),
        )
        .orderBy(sql`${score} desc`, clients.name, clients.id)
        .limit(limit + 1)
        .offset(offset)
        .then((rows) =>
          group(
            'clients',
            rows.map((r) => ({
              kind: 'clients' as const,
              id: r.id,
              title: r.name,
              phone: showPhone ? r.phone : null,
              at: r.lastVisitAt,
            })),
          ),
        ),
    )
  }

  const bookingScope = scope.bookings
  if (bookingScope?.branchIds.length && want('bookings')) {
    const ref = q.replace(/^#/, '').toUpperCase()
    const bookingScore = sql<number>`greatest(case when ${bookings.refCode} = ${ref} then 4 when ${bookings.refCode} like ${`${ref.replace(/[\\%_]/g, '')}%`} then 2.5 else 0 end, coalesce(${rank(clients.name, q)}, 0))`
    tasks.push(() =>
      tx
        .select({
          id: bookings.id,
          refCode: bookings.refCode,
          status: bookings.status,
          startsAt: bookings.startsAt,
          clientName: clients.name,
          score: bookingScore,
        })
        .from(bookings)
        .leftJoin(clients, eq(clients.id, bookings.clientId))
        .where(
          and(
            inArray(bookings.branchId, bookingScope.branchIds),
            bookingScope.staffId
              ? sql`exists (select 1 from ${bookingItems} bi where bi.booking_id = ${bookings.id} and ${bookingScope.staffId}::uuid = any(bi.staff_ids))`
              : undefined,
            or(sql`${bookings.refCode} ilike ${like(ref)}`, textMatch(clients.name, q)),
          ),
        )
        .orderBy(sql`${bookingScore} desc`, sql`${bookings.startsAt} desc`, bookings.id)
        .limit(limit + 1)
        .offset(offset)
        .then((rows) =>
          group(
            'bookings',
            rows.map((r) => ({
              kind: 'bookings' as const,
              id: r.id,
              title: r.refCode,
              refCode: r.refCode,
              clientName: r.clientName,
              at: r.startsAt,
              status: r.status,
            })),
          ),
        ),
    )
  }

  const saleScope = scope.sales
  const saleNo = /^#?\d{1,9}$/.test(q) ? Number(q.replace('#', '')) : null
  if (saleScope?.branchIds.length && want('sales')) {
    const saleScore = sql<number>`greatest(${saleNo === null ? sql`0` : sql`case when ${sales.number} = ${saleNo} then 4 else 0 end`}, coalesce(${rank(clients.name, q)}, 0))`
    tasks.push(() =>
      tx
        .select({
          id: sales.id,
          number: sales.number,
          status: sales.status,
          totalAed: sales.totalAed,
          createdAt: sales.createdAt,
          clientName: clients.name,
          score: saleScore,
        })
        .from(sales)
        .leftJoin(clients, eq(clients.id, sales.clientId))
        .where(
          and(
            inArray(sales.branchId, saleScope.branchIds),
            saleNo === null
              ? textMatch(clients.name, q)
              : or(eq(sales.number, saleNo), textMatch(clients.name, q)),
          ),
        )
        .orderBy(sql`${saleScore} desc`, sql`${sales.number} desc`)
        .limit(limit + 1)
        .offset(offset)
        .then((rows) =>
          group(
            'sales',
            rows.map((r) => ({
              kind: 'sales' as const,
              id: r.id,
              title: String(r.number),
              number: r.number,
              clientName: r.clientName,
              at: r.createdAt,
              status: r.status,
              totalAed: r.totalAed,
            })),
          ),
        ),
    )
  }

  if (scope.staff && want('staff')) {
    tasks.push(() =>
      tx
        .select({ id: staff.id, name: staff.displayName })
        .from(staff)
        .where(textMatch(staff.displayName, q))
        .orderBy(sql`${rank(staff.displayName, q)} desc`, staff.displayName, staff.id)
        .limit(limit + 1)
        .offset(offset)
        .then((rows) =>
          group(
            'staff',
            rows.map((r) => ({ kind: 'staff' as const, id: r.id, title: r.name })),
          ),
        ),
    )
  }

  if (scope.services && want('services')) {
    const en = sql`(${services.name}->>'en')`
    const ar = sql`(${services.name}->>'ar')`
    const serviceScore = sql<number>`greatest(${rank(en, q)}, coalesce(${rank(ar, q)}, 0))`
    tasks.push(() =>
      tx
        .select({ id: services.id, name: services.name })
        .from(services)
        .where(or(textMatch(en, q), textMatch(ar, q)))
        .orderBy(sql`${serviceScore} desc`, en, services.id)
        .limit(limit + 1)
        .offset(offset)
        .then((rows) =>
          group(
            'services',
            rows.map((r) => ({ kind: 'services' as const, id: r.id, title: r.name.en || r.name.ar || '' })),
          ),
        ),
    )
  }

  if (!tasks.length) return []
  // Typo tolerance for `<%` (default 0.6 misses e.g. "fatma" → "Fatima"); transaction-local.
  await tx.execute(sql`select set_config('pg_trgm.word_similarity_threshold', '0.5', true)`)
  const groups: SearchGroup[] = []
  for (const run of tasks) groups.push(await run()) // one tx = one connection: run in turn
  return groups.filter((g) => g.hits.length > 0)
}

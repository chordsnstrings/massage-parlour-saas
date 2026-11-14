// Data deletion (PLAN §18 G12; the public /data-deletion page promises deletion within 30 days on request).
// - Tenant purge: a soft-deleted spa is removed for good — every row of every tenant table (one DELETE of the tenant
//   row; every tenant_id FK is ON DELETE CASCADE), its bucket objects, Cloudflare custom hostnames and pg-boss jobs
//   that name it. The ledger is append-only for live spas (triggers block `spa_app` only); purging a whole deleted
//   spa as the platform role is the one allowed exception. A `tenant_purges` row (no FK) survives as the record.
// - Client erase: one person's personal data is removed; sales, ledger, bookings and prepaid balances stay (the
//   client row is kept, anonymised, so accounting keeps its reference).
import {
  bookings,
  clients,
  conversationMessages,
  conversations,
  type Db,
  type DbOrTx,
  domains,
  intakeSubmissions,
  outbox,
  platformSettings,
  type Tx,
  tenantPurges,
  tenants,
  treatmentNotes,
  waitlistEntries,
} from '@spa/db'
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { deleteClientIntakePdfs } from './intake'
import { type CfConfig, cfDeleteHostname, cloudflareConfig } from './integrations/cloudflare'
import { deleteTenantObjects } from './storage'

/** Purges kept off by the console below this many days after the soft delete (export window). */
export const MIN_AUTO_PURGE_DAYS = 30

/** Every public base table with a `tenant_id` column (read from the catalog, so new tables are covered). */
export async function tenantTables(db: DbOrTx): Promise<string[]> {
  const { rows } = await db.execute<{ t: string }>(sql`
    select c.table_name as t from information_schema.columns c
    join information_schema.tables b on b.table_schema = c.table_schema and b.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and b.table_type = 'BASE TABLE'
    order by 1`)
  return rows.map((r) => r.t)
}

/** Row count per tenant table for one tenant (tables with no rows are left out). */
export async function countTenantRows(db: DbOrTx, tenantId: string) {
  const out: Record<string, number> = {}
  for (const t of await tenantTables(db)) {
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from ${sql.identifier(t)} where tenant_id = ${tenantId}`,
    )
    if (rows[0]?.n) out[t] = rows[0].n
  }
  return out
}

/** pg-boss jobs whose payload names the tenant (none today: every job is a cron with no data). Best effort. */
async function deleteTenantJobs(tx: Tx, tenantId: string) {
  const { rows } = await tx.execute<{ ok: boolean }>(sql`
    select exists (select 1 from pg_namespace where nspname = 'pgboss')
      and has_schema_privilege('pgboss', 'USAGE') as ok`)
  if (!rows[0]?.ok) return 0
  const { rows: can } = await tx.execute<{ ok: boolean }>(
    sql`select to_regclass('pgboss.job') is not null and has_table_privilege('pgboss.job', 'DELETE') as ok`,
  )
  if (!can[0]?.ok) return 0
  const res = await tx.execute(sql`delete from pgboss.job where data->>'tenantId' = ${tenantId}`)
  return res.rowCount ?? 0
}

export type PurgeOptions = {
  actorUserId?: string | null
  mode?: 'manual' | 'auto'
  /** Cloudflare custom-hostname API (defaults to the environment's; null = skip). */
  cf?: CfConfig | null
}

/**
 * Permanently deletes a soft-deleted spa (platform db). `confirmSlug` must be the spa's address for a manual
 * purge; the automatic purge passes null. Order: Cloudflare hostnames (needs the domain rows) → one transaction
 * (counts, pg-boss jobs, DELETE tenants → cascade, purge record) → bucket objects under `<tenantId>/`.
 * Outside-Postgres failures are recorded on the purge row (`errors`), never undo the purge.
 */
export async function purgeTenant(
  db: Db,
  tenantId: string,
  confirmSlug: string | null,
  opts: PurgeOptions = {},
) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  if (!tenant) throw new DomainError('Spa not found', 'not_found')
  if (!tenant.deletedAt) throw new DomainError('Delete the spa first; only a deleted spa can be purged')
  if (confirmSlug !== null && confirmSlug.trim().toLowerCase() !== tenant.slug)
    throw new DomainError(`Type ${tenant.slug} to confirm`)

  const errors: string[] = []
  const cf = opts.cf !== undefined ? opts.cf : cloudflareConfig()
  const hosts = await db
    .select({ hostname: domains.hostname, cfId: domains.cfHostnameId })
    .from(domains)
    .where(and(eq(domains.tenantId, tenantId), isNotNull(domains.cfHostnameId)))
  for (const h of hosts) {
    if (!cf || !h.cfId) continue
    try {
      await cfDeleteHostname(cf, h.cfId)
    } catch (e) {
      errors.push(`cloudflare ${h.hostname}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const record = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), isNotNull(tenants.deletedAt)))
      .for('update')
    if (!locked) throw new DomainError('Spa not found', 'not_found')
    const counts = await countTenantRows(tx, tenantId)
    counts.tenants = 1
    const jobs = await deleteTenantJobs(tx, tenantId)
    if (jobs) counts['pgboss.job'] = jobs
    await tx.delete(tenants).where(eq(tenants.id, tenantId))
    const [row] = await tx
      .insert(tenantPurges)
      .values({
        purgedTenantId: tenantId,
        slug: tenant.slug,
        name: tenant.name,
        purgedBy: opts.actorUserId ?? null,
        mode: opts.mode ?? 'manual',
        deletedAt: tenant.deletedAt,
        counts,
        errors,
      })
      .returning()
    return row!
  })

  let objects = { deleted: 0, errors: [] as string[] }
  try {
    objects = await deleteTenantObjects(tenantId)
  } catch (e) {
    objects.errors.push(`bucket: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (objects.deleted || objects.errors.length) {
    errors.push(...objects.errors)
    await db
      .update(tenantPurges)
      .set({ objectsDeleted: objects.deleted, errors })
      .where(eq(tenantPurges.id, record.id))
  }
  return { ...record, objectsDeleted: objects.deleted, errors }
}

/**
 * Worker `tenant-auto-purge` (daily): purges spas soft-deleted more than `platform_settings.auto_purge_days` ago.
 * Off unless the owner sets the days in the console (null = off; values below 30 are raised to 30).
 */
export async function autoPurgeDeletedTenants(db: Db, opts: { now?: Date; cf?: CfConfig | null } = {}) {
  const [s] = await db.select({ days: platformSettings.autoPurgeDays }).from(platformSettings)
  if (s?.days == null) return { enabled: false as const, purged: [] as string[], failed: [] as string[] }
  const days = Math.max(MIN_AUTO_PURGE_DAYS, s.days)
  const cutoff = new Date((opts.now ?? new Date()).getTime() - days * 86_400_000)
  const due = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(and(isNotNull(tenants.deletedAt), lt(tenants.deletedAt, cutoff)))
  const purged: string[] = []
  const failed: string[] = []
  for (const t of due) {
    try {
      await purgeTenant(db, t.id, null, { mode: 'auto', cf: opts.cf })
      purged.push(t.slug)
    } catch {
      failed.push(t.slug)
    }
  }
  return { enabled: true as const, days, purged, failed }
}

/** Stored name of an erased client (the UI shows a translated label when `erased_at` is set). */
export const ERASED_CLIENT_NAME = 'Erased client'

/**
 * Erases one client's personal data in the caller's tenant transaction (owner request / data-deletion request).
 * Removed: name, phone, email, birthday, nationality, gender, tags, preferences, notes, blocklist reason,
 * treatment notes, intake answers + signatures and their signed PDFs (stored files, F27), WhatsApp outbox messages,
 * conversations (+ their messages) and waitlist entries; the client's booking notes are cleared. Kept for
 * accounting: the (anonymised) client row, bookings, sales, ledger, packages, memberships and gift cards.
 */
export async function eraseClient(tx: Tx, clientId: string, now = new Date()) {
  const [client] = await tx.select().from(clients).where(eq(clients.id, clientId)).for('update')
  if (!client) throw new DomainError('Client not found', 'not_found', { key: 'clients.result.notFound' })
  const convs = await tx
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.clientId, clientId))
  const convIds = convs.map((c) => c.id)
  const [msgs] = convIds.length
    ? await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(conversationMessages)
        .where(inArray(conversationMessages.conversationId, convIds))
    : [{ n: 0 }]
  // Signed intake PDFs first (their rows point at the files; the bucket object goes with the file row).
  const intakePdfs = await deleteClientIntakePdfs(tx, clientId)
  const removed = {
    intakePdfs,
    treatmentNotes:
      (await tx.delete(treatmentNotes).where(eq(treatmentNotes.clientId, clientId))).rowCount ?? 0,
    intakeSubmissions:
      (await tx.delete(intakeSubmissions).where(eq(intakeSubmissions.clientId, clientId))).rowCount ?? 0,
    outbox: (await tx.delete(outbox).where(eq(outbox.clientId, clientId))).rowCount ?? 0,
    conversationMessages: msgs?.n ?? 0,
    conversations: convIds.length
      ? ((await tx.delete(conversations).where(inArray(conversations.id, convIds))).rowCount ?? 0)
      : 0,
    waitlistEntries:
      (await tx.delete(waitlistEntries).where(eq(waitlistEntries.clientId, clientId))).rowCount ?? 0,
    bookingNotes:
      (
        await tx
          .update(bookings)
          .set({ notes: null })
          .where(and(eq(bookings.clientId, clientId), isNotNull(bookings.notes)))
      ).rowCount ?? 0,
  }
  const [row] = await tx
    .update(clients)
    .set({
      name: ERASED_CLIENT_NAME,
      phoneE164: null,
      email: null,
      gender: null,
      birthday: null,
      nationality: null,
      tags: [],
      preferences: {},
      notes: null,
      blocklisted: false,
      blocklistReason: null,
      marketingOptOutAt: client.marketingOptOutAt ?? now,
      erasedAt: now,
      updatedAt: now,
    })
    .where(eq(clients.id, clientId))
    .returning()
  return { client: row!, removed, alreadyErased: Boolean(client.erasedAt) }
}

// F23: renaming a spa's web address (slug). The old slug is kept in `tenant_slug_history` so the free address
// ({old}.{root} on every platform domain, /s/{old}, app/{old}/…) 301s to the new one, and nobody else can claim it
// during the cooling period. Platform role only (`platformDb()`); permission checks and audit stay in the caller.
import { checkSlug, normalizeSlug } from '@spa/core'
import { type DbOrTx, spaApplications, type Tx, tenantSlugHistory, tenants } from '@spa/db'
import { and, eq, sql } from 'drizzle-orm'
import { DomainError, pgCode } from './errors'

/** Owner-facing rule (decision 2026-10-10): an old address stays reserved to its spa — and redirects — for 12 months. */
export const SLUG_COOLING_MONTHS = 12

export function slugReservedUntil(from: Date): Date {
  const d = new Date(from)
  d.setUTCMonth(d.getUTCMonth() + SLUG_COOLING_MONTHS)
  return d
}

/** A still-reserved previous address of another spa (null = free to use, or the asking spa's own old address). */
export async function slugReservation(
  db: DbOrTx,
  slug: string,
  opts: { forTenantId?: string; now?: Date } = {},
): Promise<{ tenantId: string; reservedUntil: Date } | null> {
  const [row] = await db.select().from(tenantSlugHistory).where(eq(tenantSlugHistory.slug, slug)).limit(1)
  if (!row || row.renamedTenantId === opts.forTenantId) return null
  if (row.reservedUntil <= (opts.now ?? new Date())) return null
  return { tenantId: row.renamedTenantId, reservedUntil: row.reservedUntil }
}

/**
 * Before a spa takes `slug` (provisioning or a rename): refuses another spa's reserved old address, then drops the
 * history row (an expired one, or the spa's own) so the address no longer redirects anywhere.
 */
export async function claimSlugTx(tx: Tx, slug: string, opts: { tenantId?: string; now?: Date } = {}) {
  const [row] = await tx
    .select()
    .from(tenantSlugHistory)
    .where(eq(tenantSlugHistory.slug, slug))
    .for('update')
  if (!row) return
  if (row.renamedTenantId !== opts.tenantId && row.reservedUntil > (opts.now ?? new Date()))
    throw new DomainError('That address is taken.')
  await tx.delete(tenantSlugHistory).where(eq(tenantSlugHistory.slug, slug))
}

/**
 * Every previous address that redirects now (old slug → the spa's current slug, while no live spa holds the old one),
 * for host routing's in-memory map: the table only grows with renames, so one small query refreshes the whole map.
 * After the cooling period a row stays until someone claims the address, so an unclaimed old address keeps working.
 */
export async function slugRedirects(db: DbOrTx): Promise<Map<string, string>> {
  const rows = await db
    .select({ from: tenantSlugHistory.slug, to: tenants.slug })
    .from(tenantSlugHistory)
    .innerJoin(tenants, eq(tenants.id, tenantSlugHistory.renamedTenantId))
    .where(sql`not exists (select 1 from ${tenants} t2 where t2.slug = ${tenantSlugHistory.slug})`)
  return new Map(rows.filter((r) => r.from !== r.to).map((r) => [r.from, r.to]))
}

/** The spa's previous addresses, newest first (console). */
export function slugHistoryOf(db: DbOrTx, tenantId: string) {
  return db
    .select({
      slug: tenantSlugHistory.slug,
      renamedAt: tenantSlugHistory.renamedAt,
      reservedUntil: tenantSlugHistory.reservedUntil,
    })
    .from(tenantSlugHistory)
    .where(eq(tenantSlugHistory.renamedTenantId, tenantId))
    .orderBy(sql`${tenantSlugHistory.renamedAt} desc`)
}

/**
 * Super-admin renames a spa's address. Same rules as the Apply form (format, reserved names, not another spa's, not a
 * pending application's) plus previous addresses: another spa's old address is refused during its cooling period; the
 * spa's own old address can be taken back. The old slug is recorded for redirects (reserved for 12 months).
 */
export async function renameTenantSlug(
  db: DbOrTx,
  input: { tenantId: string; slug: string; actorUserId?: string | null; now?: Date },
): Promise<{ from: string; to: string; reservedUntil: Date }> {
  const now = input.now ?? new Date()
  const to = normalizeSlug(input.slug)
  const check = checkSlug(to)
  if (!check.ok) throw new DomainError(check.reason)
  const run = async (tx: Tx) => {
    const [tenant] = await tx
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .for('update')
    if (!tenant) throw new DomainError('Spa not found', 'not_found')
    if (tenant.slug === to) throw new DomainError('That is already this spa’s address.')
    const [other] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, to)).limit(1)
    if (other) throw new DomainError('That address is taken.')
    const [pending] = await tx
      .select({ id: spaApplications.id })
      .from(spaApplications)
      .where(and(eq(spaApplications.slug, to), eq(spaApplications.status, 'pending')))
      .limit(1)
    if (pending) throw new DomainError('That address is taken.')
    await claimSlugTx(tx, to, { tenantId: tenant.id, now })
    await tx.update(tenants).set({ slug: to }).where(eq(tenants.id, tenant.id))
    const reservedUntil = slugReservedUntil(now)
    const history = {
      renamedTenantId: tenant.id,
      renamedBy: input.actorUserId ?? null,
      renamedAt: now,
      reservedUntil,
    }
    await tx
      .insert(tenantSlugHistory)
      .values({ slug: tenant.slug, ...history })
      .onConflictDoUpdate({ target: tenantSlugHistory.slug, set: history })
    return { from: tenant.slug, to, reservedUntil }
  }
  try {
    // A transaction (or a savepoint inside the caller's): the tenant row lock serialises concurrent renames.
    return await db.transaction(run)
  } catch (e) {
    if (pgCode(e) === '23505') throw new DomainError('That address is taken.')
    throw e
  }
}

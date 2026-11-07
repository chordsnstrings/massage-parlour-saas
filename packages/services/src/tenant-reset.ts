// R40 "Reset spa data" (super-admin console, platform db): one spa starts again from today. Its operational data is
// deleted (clients, bookings, sales, ledger, payroll, sold packages, stock history, enquiries, chats, …); its setup is
// kept (staff, logins, services, rooms, website, settings, products, package/membership types, platform billing).
// The ledger and booking-commission triggers block `spa_app` only, so the platform role may delete them here — like
// `purgeTenant`, the one other allowed exception. Everything runs in one transaction, after a gzip snapshot of every
// deleted row is stored on the `tenant_resets` record (undo by hand); bucket objects go after the commit.

import { gzipSync } from 'node:zlib'
import {
  campaigns,
  type Db,
  promoCodes,
  stockLevels,
  storedFiles,
  type Tx,
  tenantResets,
  tenants,
} from '@spa/db'
import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { deleteFile } from './storage'

/** Tables emptied for the spa, children before parents (no SET NULL updates, no NO ACTION FK in the way). */
export const RESET_DELETE_TABLES = [
  'notification_reads',
  'notifications',
  'instagram_reply_queue',
  'conversation_messages',
  'conversations',
  'reviews',
  'site_enquiries',
  'journal_lines',
  'journal_entries',
  'period_locks',
  'commission_entries',
  'booking_commissions',
  'package_redemptions',
  'membership_redemptions',
  'gift_card_txns',
  'client_packages',
  'client_memberships',
  'gift_cards',
  'payroll_lines',
  'payroll_runs',
  'salary_advances',
  'time_entries',
  'leave_requests',
  'refund_lines',
  'refunds',
  'tips',
  'payments',
  'sale_lines',
  'sales',
  'day_closes',
  'expenses',
  'purchase_lines',
  'purchases',
  'stock_movements',
  'outbox',
  'treatment_notes',
  'intake_submissions',
  'waitlist_entries',
  'rotation_entries',
  'reservations',
  'booking_items',
  'bookings',
  'clients',
  'counters',
] as const

/**
 * Tenant tables a reset keeps (some get a field reset: stock levels → 0, promo code uses → 0, sent campaigns cleared;
 * `stored_files` loses only the files of deleted rows). A test fails when a new tenant table is in neither list.
 */
export const RESET_KEEP_TABLES = [
  'ai_agent_settings',
  'ai_runs',
  'ai_usage',
  'announcement_dismissals',
  'audit_log',
  'booking_partners',
  'branches',
  'brand_profiles',
  'business_documents',
  'campaigns',
  'domain_orders',
  'domains',
  'equipment',
  'feature_flag_overrides',
  'intake_templates',
  'invitations',
  'job_runs',
  'ledger_accounts',
  'media_assets',
  'member_branches',
  'members',
  'membership_plans',
  'message_templates',
  'package_definitions',
  'page_versions',
  'platform_invoices',
  'platform_payments',
  'platform_reminders',
  'products',
  'promo_codes',
  'roles',
  'rooms',
  'saved_sections',
  'segments',
  'seo_checks',
  'service_categories',
  'service_consumables',
  'service_variants',
  'services',
  'shifts',
  'site_change_requests',
  'site_page_locks',
  'site_pages',
  'site_posts',
  'site_redirects',
  'sites',
  'social_accounts',
  'social_posts',
  'staff',
  'staff_documents',
  'staff_services',
  'stock_levels',
  'stored_files',
  'subscriptions',
  'suppliers',
  'web_daily_stats',
  'web_events',
] as const

const FILE_ID = /\/files\/([0-9a-f-]{36})/i

/** Stored files that belong to rows the reset deletes: intake PDFs, day-sheet PDFs, expense / purchase receipts. */
async function resetFileIds(tx: Tx, tenantId: string) {
  const { rows } = await tx.execute<{ id: string | null; url: string | null }>(sql`
    select pdf_file_id::text as id, null as url from day_closes where tenant_id = ${tenantId} and pdf_file_id is not null
    union all select pdf_file_id::text, null from intake_submissions where tenant_id = ${tenantId} and pdf_file_id is not null
    union all select null, receipt_url from expenses where tenant_id = ${tenantId} and receipt_url is not null
    union all select null, receipt_url from purchases where tenant_id = ${tenantId} and receipt_url is not null`)
  const ids = new Set<string>()
  for (const r of rows) {
    const id = r.id ?? r.url?.match(FILE_ID)?.[1]
    if (id) ids.add(id.toLowerCase())
  }
  if (!ids.size) return []
  // Only the spa's own files of those kinds (a receipt URL could name any file).
  const found = await tx
    .select({ id: storedFiles.id })
    .from(storedFiles)
    .where(
      and(
        eq(storedFiles.tenantId, tenantId),
        inArray(storedFiles.id, [...ids]),
        inArray(storedFiles.purpose, ['intake_pdf', 'day_sheet_pdf', 'receipt']),
      ),
    )
  return found.map((f) => f.id)
}

async function tableRows(tx: Tx, table: string, tenantId: string) {
  const { rows } = await tx.execute<{ rows: unknown[] }>(
    sql`select coalesce(json_agg(t), '[]'::json) as rows from ${sql.identifier(table)} t where t.tenant_id = ${tenantId}`,
  )
  return (rows[0]?.rows ?? []) as unknown[]
}

export type ResetOptions = { actorUserId?: string | null; now?: Date }

/**
 * Resets one spa's data (platform db). `confirmName` must be the spa's name (case and outer spaces ignored).
 * Returns the `tenant_resets` record (without the snapshot) plus how many stored files were removed.
 */
export async function resetTenantData(
  db: Db,
  tenantId: string,
  confirmName: string,
  opts: ResetOptions = {},
) {
  const now = opts.now ?? new Date()
  const { record, fileIds } = await db.transaction(async (tx) => {
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update')
    if (!tenant || tenant.deletedAt) throw new DomainError('Spa not found', 'not_found')
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
    if (norm(confirmName) !== norm(tenant.name)) throw new DomainError(`Type ${tenant.name} to confirm`)

    const fileIds = await resetFileIds(tx, tenantId)
    const snapshot: Record<string, unknown[]> = {}
    const counts: Record<string, number> = {}
    for (const t of RESET_DELETE_TABLES) {
      const rows = await tableRows(tx, t, tenantId)
      if (rows.length) snapshot[t] = rows
    }
    if (fileIds.length) {
      const { rows } = await tx.execute<{ rows: unknown[] }>(
        sql`select coalesce(json_agg(f), '[]'::json) as rows from stored_files f where f.id in (${sql.join(
          fileIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      )
      snapshot.stored_files = (rows[0]?.rows ?? []) as unknown[]
    }
    // Kept rows whose fields change: their values before.
    snapshot['stock_levels(before)'] = await tableRows(tx, 'stock_levels', tenantId)
    snapshot['promo_codes(before)'] = await tableRows(tx, 'promo_codes', tenantId)
    snapshot['campaigns(before)'] = await tableRows(tx, 'campaigns', tenantId)

    for (const t of RESET_DELETE_TABLES) {
      const res = await tx.execute(sql`delete from ${sql.identifier(t)} where tenant_id = ${tenantId}`)
      if (res.rowCount) counts[t] = res.rowCount
    }
    const levels = await tx
      .update(stockLevels)
      .set({ qty: '0' })
      .where(and(eq(stockLevels.tenantId, tenantId), ne(stockLevels.qty, '0')))
      .returning({ productId: stockLevels.productId })
    if (levels.length) counts['stock_levels(qty → 0)'] = levels.length
    await tx.update(promoCodes).set({ uses: 0 }).where(eq(promoCodes.tenantId, tenantId))
    // Their messages left with the outbox: a queued campaign goes back to draft, a sent one is archived.
    await tx
      .update(campaigns)
      .set({ status: 'draft', queuedAt: null, recipients: 0, stats: {} })
      .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.status, 'queued')))
    await tx
      .update(campaigns)
      .set({
        recipients: 0,
        stats: {},
        archivedAt: sql`coalesce(${campaigns.archivedAt}, ${now.toISOString()}::timestamptz)`,
      })
      .where(and(eq(campaigns.tenantId, tenantId), eq(campaigns.status, 'done')))

    const zipped = gzipSync(
      Buffer.from(JSON.stringify({ tenantId, takenAt: now.toISOString(), tables: snapshot })),
    )
    const [row] = await tx
      .insert(tenantResets)
      .values({
        resetTenantId: tenantId,
        slug: tenant.slug,
        name: tenant.name,
        resetBy: opts.actorUserId ?? null,
        counts,
        snapshot: zipped,
        snapshotSize: zipped.length,
        filesDeleted: fileIds.length,
      })
      .returning({
        id: tenantResets.id,
        slug: tenantResets.slug,
        name: tenantResets.name,
        counts: tenantResets.counts,
        snapshotSize: tenantResets.snapshotSize,
        createdAt: tenantResets.createdAt,
      })
    return { record: row!, fileIds }
  })

  // Stored files of deleted rows: row + bucket object, each on its own (a failure is recorded, never undoes the reset).
  const errors: string[] = []
  for (const id of fileIds) {
    try {
      await db.transaction((tx) => deleteFile(tx, id))
    } catch (e) {
      errors.push(`file ${id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (errors.length) await db.update(tenantResets).set({ errors }).where(eq(tenantResets.id, record.id))
  return { ...record, filesDeleted: fileIds.length, errors }
}

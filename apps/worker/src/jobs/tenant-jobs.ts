import { queueSlotOffers } from '@spa/ai'
import { aiAgentSettings, branches, outbox, platformDb, tenants, withTenant } from '@spa/db'
import { automationOnSql, expirePackages, runMembershipRenewals } from '@spa/services'
import { and, eq, gte, ne } from 'drizzle-orm'
import { log } from '../log'
import { activeTenants, recordRun } from './runs'

/** Daily: expire packages past their validity and book the unused value as breakage (spas with the switch on). */
export async function expireAllPackages() {
  for (const t of await activeTenants('packageExpiry')) {
    try {
      const n = await withTenant(t.id, (tx) => expirePackages(tx, t.id))
      if (n) log('info', 'packages expired', { tenant: t.slug, n })
      await recordRun(t.id, 'packages-expire', 'ok', { count: n })
    } catch (error) {
      log('error', 'package expiry failed', { tenant: t.slug, error: String(error) })
      await recordRun(t.id, 'packages-expire', 'failed')
    }
  }
}

/**
 * Daily: membership periods ending within 7 days → `due` + a WhatsApp renewal reminder queued in /messages
 * (click-to-send); ended periods → `expired` with the unused value recognised (spas with the switch on).
 */
export async function renewAllMemberships() {
  for (const t of await activeTenants('membershipRenewals')) {
    try {
      const r = await withTenant(t.id, (tx) => runMembershipRenewals(tx, t.id))
      if (r.due || r.expired) log('info', 'memberships renewed', { tenant: t.slug, ...r })
      await recordRun(t.id, 'memberships-renew', 'ok', { count: r.due + r.expired })
    } catch (error) {
      log('error', 'membership renewals failed', { tenant: t.slug, error: String(error) })
      await recordRun(t.id, 'memberships-renew', 'failed')
    }
  }
}

/**
 * Twice a day: for spas with the quiet-slot automation on (B3 switch) and the slot-filler agent enabled, queue
 * WhatsApp offers for quiet hours (max once per day). Offers wait in /messages for staff to click-to-send.
 */
export async function runSlotFiller() {
  const enabled = await platformDb()
    .select({ tenantId: aiAgentSettings.tenantId })
    .from(aiAgentSettings)
    .innerJoin(tenants, eq(tenants.id, aiAgentSettings.tenantId))
    .where(
      and(
        eq(aiAgentSettings.agentKey, 'slot_filler'),
        eq(aiAgentSettings.enabled, true),
        ne(tenants.status, 'cancelled'),
        automationOnSql('slotFiller'),
      ),
    )
  const startOfDay = new Date(Date.now() - ((Date.now() + 4 * 3600_000) % 86_400_000))
  for (const { tenantId } of enabled) {
    try {
      // Tenant tables are read as the tenant (RLS); only the enabled-spa lookup above is cross-tenant.
      const branch = await withTenant(tenantId, async (tx) => {
        const [already] = await tx
          .select({ id: outbox.id })
          .from(outbox)
          .where(and(eq(outbox.kind, 'slot_offer'), gte(outbox.createdAt, startOfDay)))
          .limit(1)
        if (already) return null
        const [row] = await tx.select().from(branches).where(eq(branches.isDefault, true))
        return row ?? null
      })
      if (!branch) continue
      const n = await queueSlotOffers({ tenantId, branchId: branch.id })
      if (n) log('info', 'slot offers queued', { tenantId, n })
      await recordRun(tenantId, 'slot-filler', 'ok', { count: n })
    } catch (error) {
      log('error', 'slot filler failed', { tenantId, error: String(error) })
      await recordRun(tenantId, 'slot-filler', 'failed')
    }
  }
}

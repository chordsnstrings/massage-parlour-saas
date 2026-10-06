import { queueSlotOffers } from '@spa/ai'
import { aiAgentSettings, branches, outbox, platformDb, tenants, withTenant } from '@spa/db'
import { expirePackages } from '@spa/services'
import { and, eq, gte, inArray, ne } from 'drizzle-orm'
import { log } from '../log'

const activeTenants = () =>
  platformDb()
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(inArray(tenants.status, ['trial', 'active', 'past_due']))

/** Daily: expire packages past their validity and book the unused value as breakage. */
export async function expireAllPackages() {
  for (const t of await activeTenants()) {
    try {
      const n = await withTenant(t.id, (tx) => expirePackages(tx, t.id))
      if (n) log('info', 'packages expired', { tenant: t.slug, n })
    } catch (error) {
      log('error', 'package expiry failed', { tenant: t.slug, error: String(error) })
    }
  }
}

/** Twice a day: for spas with the slot filler switched on, queue WhatsApp offers for quiet hours (max once per day). */
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
      ),
    )
  const startOfDay = new Date(Date.now() - ((Date.now() + 4 * 3600_000) % 86_400_000))
  for (const { tenantId } of enabled) {
    try {
      const [already] = await platformDb()
        .select({ id: outbox.id })
        .from(outbox)
        .where(
          and(
            eq(outbox.tenantId, tenantId),
            eq(outbox.kind, 'slot_offer'),
            gte(outbox.createdAt, startOfDay),
          ),
        )
        .limit(1)
      if (already) continue
      const [branch] = await platformDb()
        .select()
        .from(branches)
        .where(and(eq(branches.tenantId, tenantId), eq(branches.isDefault, true)))
      if (!branch) continue
      const n = await queueSlotOffers({ tenantId, branchId: branch.id })
      if (n) log('info', 'slot offers queued', { tenantId, n })
    } catch (error) {
      log('error', 'slot filler failed', { tenantId, error: String(error) })
    }
  }
}

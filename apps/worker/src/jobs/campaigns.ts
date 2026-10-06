import { platformDb, tenants, withTenant } from '@spa/db'
import { finishCampaigns } from '@spa/services'
import { inArray } from 'drizzle-orm'
import { log } from '../log'

/**
 * Hourly: marks queued WhatsApp campaigns as done once every message was sent or skipped.
 * Messages themselves are never sent here — staff click to send each one on /messages.
 */
export async function finishAllCampaigns() {
  const active = await platformDb()
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(inArray(tenants.status, ['trial', 'active', 'past_due']))
  for (const t of active) {
    try {
      const n = await withTenant(t.id, (tx) => finishCampaigns(tx))
      if (n) log('info', 'campaigns finished', { tenant: t.slug, n })
    } catch (error) {
      log('error', 'campaign housekeeping failed', { tenant: t.slug, error: String(error) })
    }
  }
}

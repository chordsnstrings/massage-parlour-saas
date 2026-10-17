import { platformDb, tenants, withTenant } from '@spa/db'
import { finishCampaigns, withdrawCampaignMessagesWithoutConsent } from '@spa/services'
import { inArray } from 'drizzle-orm'
import { log } from '../log'

/**
 * Hourly: withdraws waiting campaign messages whose client has since opted out (or was blocklisted / tagged
 * no-marketing; /messages already hides them), then marks queued WhatsApp campaigns as done once every message
 * was sent or skipped. Messages themselves are never sent here — staff click to send each one on /messages.
 */
export async function finishAllCampaigns() {
  const active = await platformDb()
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(inArray(tenants.status, ['trial', 'active', 'past_due']))
  for (const t of active) {
    try {
      const { withdrawn, finished } = await withTenant(t.id, async (tx) => ({
        withdrawn: await withdrawCampaignMessagesWithoutConsent(tx),
        finished: await finishCampaigns(tx),
      }))
      if (withdrawn || finished)
        log('info', 'campaigns housekeeping', { tenant: t.slug, withdrawn, finished })
    } catch (error) {
      log('error', 'campaign housekeeping failed', { tenant: t.slug, error: String(error) })
    }
  }
}

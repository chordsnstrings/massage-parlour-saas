import { aiConfigured, generateInsights, NotEnoughDataError } from '@spa/ai'
import { businessDateOf, dubaiParts, weekStartOf } from '@spa/core'
import { branches, withTenant } from '@spa/db'
import { notify } from '@spa/services'
import { eq, sql } from 'drizzle-orm'
import { log } from '../log'
import { notifyDocumentExpiry } from './notifications'
import { activeTenants, recordRun } from './runs'

/** Daily 09:00 Dubai: bell + push for staff managers about documents with 60, 30, 7 or 0 days left. */
export const documentExpiryReminders = (now = new Date()) => notifyDocumentExpiry(now)

/**
 * Mondays 08:00 Dubai: AI insights digest for every active spa with activity, then a bell row (deduped per week)
 * + push in each report viewer's locale.
 */
export async function weeklyInsights(now = new Date()) {
  if (!aiConfigured()) return { skipped: 'AI not configured' }
  let generated = 0
  for (const t of await activeTenants('weeklyInsights')) {
    try {
      const run = await generateInsights({ tenantId: t.id, trigger: 'schedule', now })
      generated++
      const first = (run.output as { insights?: { title: string }[] } | null)?.insights?.[0]?.title
      await notify({
        tenantId: t.id,
        kind: 'weekly_insights',
        // The headline is AI-written content (stays as generated); fallback = translated line.
        params: { headline: first ?? { key: 'notifications.digest.insightsFallback' } },
        url: `/${t.slug}`,
        dedupeKey: `weekly_insights:${weekStartOf(dubaiParts(now).date)}`,
      })
      await recordRun(t.id, 'weekly-insights', 'ok')
    } catch (error) {
      if (error instanceof NotEnoughDataError) {
        await recordRun(t.id, 'weekly-insights', 'skipped')
        continue
      }
      log('error', 'weekly insights failed', { tenant: t.slug, error: String(error) })
      await recordRun(t.id, 'weekly-insights', 'failed')
    }
  }
  return { generated }
}

/**
 * Daily 09:30 Dubai (optional digest): today's bookings and those still waiting for confirmation, as a bell row
 * (deduped per business day) + push in each recipient's locale.
 */
export async function dailyDigest(now = new Date()) {
  for (const t of await activeTenants('dailyDigest')) {
    try {
      const counts = await withTenant(t.id, async (tx) => {
        const [branch] = await tx
          .select({ cutoff: branches.businessDayCutoff })
          .from(branches)
          .where(eq(branches.isDefault, true))
          .limit(1)
        const today = businessDateOf(now, branch?.cutoff.slice(0, 5) ?? '05:00')
        const [row] = (
          await tx.execute(sql`select
              count(*) filter (where status not in ('cancelled', 'no_show'))::int as booked,
              count(*) filter (where status = 'pending')::int as pending
            from bookings where business_date = ${today}::date`)
        ).rows as { booked: number; pending: number }[]
        return { today, booked: Number(row?.booked ?? 0), pending: Number(row?.pending ?? 0) }
      })
      if (!counts.booked) {
        await recordRun(t.id, 'daily-digest', 'skipped', { count: 0 })
        continue
      }
      await notify({
        tenantId: t.id,
        kind: 'daily_digest',
        params: {
          count: counts.booked,
          detail: counts.pending
            ? { key: 'notifications.digest.pending', params: { count: counts.pending } }
            : { key: 'notifications.digest.allConfirmed' },
        },
        url: `/${t.slug}`,
        dedupeKey: `daily_digest:${counts.today}`,
      })
      await recordRun(t.id, 'daily-digest', 'ok', { count: counts.booked, pending: counts.pending })
    } catch (error) {
      log('error', 'daily digest failed', { tenant: t.slug, error: String(error) })
      await recordRun(t.id, 'daily-digest', 'failed')
    }
  }
  return { ok: true }
}

import { aiConfigured, generateInsights, NotEnoughDataError } from '@spa/ai'
import { businessDateOf } from '@spa/core'
import { branches, withTenant } from '@spa/db'
import { notifyTenant, pushConfigured } from '@spa/services'
import { eq, sql } from 'drizzle-orm'
import { log } from '../log'
import { notifyDocumentExpiry } from './notifications'
import { activeTenants, recordRun } from './runs'

/** Daily 09:00 Dubai: bell + push for staff managers about documents with 60, 30, 7 or 0 days left. */
export const documentExpiryReminders = (now = new Date()) => notifyDocumentExpiry(now)

/** Mondays 08:00 Dubai: AI insights digest for every active spa with activity, then a push to report viewers. */
export async function weeklyInsights(now = new Date()) {
  if (!aiConfigured()) return { skipped: 'AI not configured' }
  let generated = 0
  for (const t of await activeTenants('weeklyInsights')) {
    try {
      const run = await generateInsights({ tenantId: t.id, trigger: 'schedule', now })
      generated++
      const first = (run.output as { insights?: { title: string }[] } | null)?.insights?.[0]?.title
      await notifyTenant(
        t.id,
        {
          title: 'Your weekly insights are ready',
          body: first ?? 'See what changed last week and two things to try this week.',
          url: `/${t.slug}`,
          tag: 'insights',
        },
        { permission: 'reports.view' },
      )
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

/** Daily 09:30 Dubai (optional digest): today's bookings and online requests still waiting for confirmation. */
export async function dailyDigest(now = new Date()) {
  if (!pushConfigured()) return { skipped: 'push not configured' }
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
        return { booked: Number(row?.booked ?? 0), pending: Number(row?.pending ?? 0) }
      })
      if (!counts.booked) {
        await recordRun(t.id, 'daily-digest', 'skipped', { count: 0 })
        continue
      }
      await notifyTenant(
        t.id,
        {
          title: `Today: ${counts.booked} booking${counts.booked === 1 ? '' : 's'}`,
          body: counts.pending
            ? `${counts.pending} still waiting for confirmation — confirm them on WhatsApp.`
            : 'All confirmed. Have a calm day.',
          url: `/${t.slug}/calendar`,
          tag: 'digest',
        },
        { permission: 'calendar.manage' },
      )
      await recordRun(t.id, 'daily-digest', 'ok', { count: counts.booked, pending: counts.pending })
    } catch (error) {
      log('error', 'daily digest failed', { tenant: t.slug, error: String(error) })
      await recordRun(t.id, 'daily-digest', 'failed')
    }
  }
  return { ok: true }
}

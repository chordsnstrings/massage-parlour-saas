'use server'
// R36 dashboard home refresh: a cheap fingerprint of the "Today's bookings & sales" and "From the website" cards,
// polled every 30 s while the tab is visible (components/kpis/dashboard-live.tsx). Same scope as the page.
import { withTenant } from '@spa/db'
import { dashboardPulse } from '@spa/services'
import { homeScope } from '@/app/dashboard/[tenant]/home-scope'
import { can, requireMember } from '@/server/access'

export async function dashboardPulseAction(
  slug: string,
  o: { branch?: string; day?: string },
): Promise<string | null> {
  const ctx = await requireMember(slug)
  if (!can(ctx, 'dashboard.view')) return null
  const branch = typeof o?.branch === 'string' ? o.branch : undefined
  const day = typeof o?.day === 'string' ? o.day : undefined
  return withTenant(ctx.tenant.id, async (tx) => {
    const s = await homeScope(tx, ctx, { branch, day, now: new Date() })
    return dashboardPulse(tx, { branchIds: s.branchIds, date: s.day, today: s.today })
  })
}

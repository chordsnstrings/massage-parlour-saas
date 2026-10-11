// Sidebar count badges (crm-spec §2.1 ③): one tenant transaction + one counting query per request (React cache),
// permission-filtered — a count the viewer may not see is never queried.
import { withTenant } from '@spa/db'
import { type NavCounts, navCounts } from '@spa/services'
import { cache } from 'react'
import { can, type MemberContext } from '@/server/access'

const NONE: NavCounts = { today: 0, pending: 0, outboxDue: 0, igUnread: 0, outboxMine: 0, enquiriesNew: 0 }

export const navBadgeCounts = cache(async (ctx: MemberContext): Promise<NavCounts> => {
  const calendar = can(ctx, 'calendar.view')
  const send = can(ctx, 'marketing.send')
  const enquiries = can(ctx, 'clients.view')
  if (!calendar && !send && !enquiries) return NONE
  const m = ctx.member
  const canManage = can(ctx, 'calendar.manage')
  // Same own-only rule as the calendar: therapists always, other non-managers when linked to a staff profile.
  const own = m && (m.roleKey === 'therapist' || !canManage) ? m.id : null
  return withTenant(ctx.tenant.id, (tx) =>
    navCounts(tx, {
      branchIds: !m || m.allBranches ? null : m.branchIds,
      ownMemberId: own,
      ownIfLinked: own !== null && m?.roleKey !== 'therapist',
      calendar,
      outbox: send,
      instagram: send,
      assigneeMemberId: send ? (m?.id ?? null) : null,
      enquiries,
    }),
  )
})

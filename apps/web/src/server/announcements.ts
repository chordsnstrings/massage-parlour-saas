// F20 announcements in the spa dashboard. Announcements are platform data (read on the platform role, like the
// plan catalogue); dismissals are the member's own rows, written through withTenant (dashboard announcements/actions.ts).
import { type AnnouncementSeverity, announcementCopy } from '@spa/core'
import { platformDb } from '@spa/db'
import { activeAnnouncements } from '@spa/services'
import type { MemberContext } from './access'
import { getEntitlements } from './entitlements'

export type ShownAnnouncement = { id: string; severity: AnnouncementSeverity; title: string; body: string }

/** Live, not-dismissed announcements for this member of this spa, in the viewer's language (TH falls back to EN). */
export async function announcementsFor(ctx: MemberContext, locale: string): Promise<ShownAnnouncement[]> {
  const ent = await getEntitlements(ctx.tenant.id)
  const rows = await activeAnnouncements(platformDb(), {
    tenantId: ctx.tenant.id,
    userId: ctx.user.id,
    planCode: ent.plan?.code ?? null,
  })
  return rows.map((a) => ({ id: a.id, severity: a.severity, ...announcementCopy(a, locale) }))
}

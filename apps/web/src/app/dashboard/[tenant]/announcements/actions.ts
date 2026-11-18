'use server'
import { withTenant } from '@spa/db'
import { dismissAnnouncement } from '@spa/services'
import { z } from 'zod'
import { getLocale } from '@/i18n/server'
import { type ActionResult, fail, ok } from '@/lib/action'
import { requireMember } from '@/server/access'
import { announcementsFor } from '@/server/announcements'

/**
 * F20: hides a platform announcement for this member in this spa. Not `guard`: it is the member's own view state,
 * so it also works while the spa is read-only. Only an announcement currently shown to the member is recorded.
 */
export async function dismissAnnouncementAction(slug: string, id: string): Promise<ActionResult> {
  const ctx = await requireMember(slug)
  if (!z.uuid().safeParse(id).success) return fail('errors.checkFields')
  const shown = await announcementsFor(ctx, await getLocale())
  if (!shown.some((a) => a.id === id)) return ok()
  await withTenant(ctx.tenant.id, (tx) =>
    dismissAnnouncement(tx, { tenantId: ctx.tenant.id, userId: ctx.user.id, announcementId: id }),
  )
  return ok()
}

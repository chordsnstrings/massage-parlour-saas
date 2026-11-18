'use server'
// Bell + /notifications page. Read state is the viewer's own (not spa data), so it's allowed in read-only spas and
// isn't audited; visibility is re-checked in the service (recipient + permission), tenant via withTenant/RLS.
import { withTenant } from '@spa/db'
import { markAllNotificationsRead, markNotificationRead } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getI18n } from '@/i18n/server'
import { type ActionResult, fail, ok } from '@/lib/action'
import { requireMember } from '@/server/access'
import { type BellData, bellData, viewerOf } from '@/server/notifications'

export async function bellAction(slug: string): Promise<BellData> {
  const ctx = await requireMember(slug)
  const { t, fmt } = await getI18n()
  return bellData(ctx, t, fmt)
}

export async function markNotificationReadAction(slug: string, id: string): Promise<ActionResult> {
  const ctx = await requireMember(slug)
  const parsed = z.uuid().safeParse(id)
  if (!parsed.success) return fail('errors.notFound')
  const done = await withTenant(ctx.tenant.id, (tx) => markNotificationRead(tx, viewerOf(ctx), parsed.data))
  if (!done) return fail('errors.notFound')
  revalidatePath(`/dashboard/${ctx.tenant.slug}/notifications`)
  return ok()
}

export async function markAllNotificationsReadAction(slug: string): Promise<ActionResult> {
  const ctx = await requireMember(slug)
  await withTenant(ctx.tenant.id, (tx) => markAllNotificationsRead(tx, viewerOf(ctx)))
  revalidatePath(`/dashboard/${ctx.tenant.slug}`, 'layout')
  return ok('notifications.allRead')
}

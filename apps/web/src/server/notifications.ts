// Bell + /notifications data (PLAN §14.7 B2): the viewer's notifications, permission-filtered, as display text.
import { notificationText } from '@spa/core'
import type { Format, Translator } from '@spa/core/i18n'
import { withTenant } from '@spa/db'
import { listNotifications, type NotificationItem, unreadNotificationCount, type Viewer } from '@spa/services'
import { appPath } from '@/lib/paths'
import type { MemberContext } from '@/server/access'

export type BellItem = {
  id: string
  title: string
  body: string
  href: string | null
  at: string
  read: boolean
}
export type BellData = { unread: number; items: BellItem[] }

export const viewerOf = (ctx: MemberContext): Viewer => ({
  userId: ctx.user.id,
  permissions: ctx.permissions,
})

export function toBellItem(n: NotificationItem, t: Translator, fmt: Format): BellItem {
  return {
    id: n.id,
    ...notificationText(t, fmt, n),
    // Stored paths start with "/<slug>/…" (no routing prefix): only same-dashboard paths become links.
    href: n.url?.startsWith('/') && !n.url.startsWith('//') ? appPath(n.url) : null,
    at: n.createdAt.toISOString(),
    read: n.readAt !== null,
  }
}

export async function bellData(ctx: MemberContext, t: Translator, fmt: Format, limit = 8): Promise<BellData> {
  const viewer = viewerOf(ctx)
  const [items, unread] = await withTenant(
    ctx.tenant.id,
    async (tx) =>
      [await listNotifications(tx, viewer, { limit }), await unreadNotificationCount(tx, viewer)] as const,
  )
  return { unread, items: items.map((n) => toBellItem(n, t, fmt)) }
}

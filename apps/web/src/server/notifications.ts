// Bell + /notifications data (PLAN §14.7 B2): the viewer's notifications, permission-filtered, as display text.
import { notificationText } from '@spa/core'
import type { Format, Translator } from '@spa/core/i18n'
import { withTenant } from '@spa/db'
import {
  listNotifications,
  type NotificationItem,
  pendingBookingIds,
  unreadNotificationCount,
  type Viewer,
} from '@spa/services'
import { allowedBranches } from '@/app/dashboard/[tenant]/calendar/data'
import { appPath } from '@/lib/paths'
import { can, type MemberContext } from '@/server/access'

export type BellItem = {
  id: string
  kind: string
  title: string
  body: string
  href: string | null
  at: string
  read: boolean
  /**
   * R36: an unread booking.online whose booking is still pending in one of the viewer's branches, for a viewer with
   * calendar.manage (pop-up Confirm).
   */
  confirm?: { bookingId: string; name: string }
}
export type BellData = { unread: number; items: BellItem[] }

export const viewerOf = (ctx: MemberContext): Viewer => ({
  userId: ctx.user.id,
  permissions: ctx.permissions,
})

export function toBellItem(n: NotificationItem, t: Translator, fmt: Format): BellItem {
  return {
    id: n.id,
    kind: n.kind,
    ...notificationText(t, fmt, n),
    // Stored paths start with "/<slug>/…" (no routing prefix): only same-dashboard paths become links.
    href: n.url?.startsWith('/') && !n.url.startsWith('//') ? appPath(n.url) : null,
    at: n.createdAt.toISOString(),
    read: n.readAt !== null,
  }
}

export async function bellData(ctx: MemberContext, t: Translator, fmt: Format, limit = 8): Promise<BellData> {
  const viewer = viewerOf(ctx)
  const bookingOf = (n: NotificationItem) =>
    n.kind === 'booking.online' && !n.readAt && typeof n.params?.bookingId === 'string'
      ? n.params.bookingId
      : null
  const [items, unread, pending] = await withTenant(ctx.tenant.id, async (tx) => {
    const list = await listNotifications(tx, viewer, { limit })
    const ids = can(ctx, 'calendar.manage') ? list.flatMap((n) => bookingOf(n) ?? []) : []
    // Only bookings of the viewer's (open) branches: the same check the Confirm itself makes.
    const branchIds = ids.length ? (await allowedBranches(tx, ctx)).map((b) => b.id) : []
    return [
      list,
      await unreadNotificationCount(tx, viewer),
      await pendingBookingIds(tx, ids, branchIds),
    ] as const
  })
  return {
    unread,
    items: items.map((n) => {
      const booking = bookingOf(n)
      const name = typeof n.params?.name === 'string' ? n.params.name : ''
      return {
        ...toBellItem(n, t, fmt),
        ...(booking && pending.has(booking) ? { confirm: { bookingId: booking, name } } : {}),
      }
    }),
  }
}

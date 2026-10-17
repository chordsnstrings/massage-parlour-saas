'use client'
// Top-bar bell (crm-spec §7, PLAN §14.7 B2): unread count + the latest notifications; a click marks one read and
// opens its deep link. Refreshes when opened and every minute while the tab is visible. Styles: crm.css.
import { Bell, CheckCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DropdownMenu } from 'radix-ui'
import { useCallback, useEffect, useState } from 'react'
import {
  bellAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/app/dashboard/[tenant]/notifications/actions'
import { useI18n } from '@/i18n/client'
import type { BellData, BellItem } from '@/server/notifications'

export function NotificationBell({
  slug,
  initial,
  pageHref,
}: {
  slug: string
  initial: BellData
  pageHref: string
}) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const [data, setData] = useState(initial)

  useEffect(() => {
    setData(initial)
  }, [initial])

  const refresh = useCallback(async () => {
    try {
      setData(await bellAction(slug))
    } catch {
      // Offline or signed out: keep what we have.
    }
  }, [slug])

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 60_000)
    return () => {
      clearInterval(id)
    }
  }, [refresh])

  const markLocal = (pred: (n: BellItem) => boolean) =>
    setData((d) => {
      const items = d.items.map((n) => (pred(n) ? { ...n, read: true } : n))
      const cleared = d.items.filter((n) => pred(n) && !n.read).length
      return { items, unread: Math.max(0, d.unread - cleared) }
    })

  const open = (n: BellItem) => {
    if (!n.read) {
      markLocal((x) => x.id === n.id)
      void markNotificationReadAction(slug, n.id)
    }
    if (n.href) router.push(n.href)
  }

  const markAll = async () => {
    markLocal(() => true)
    setData((d) => ({ ...d, unread: 0 }))
    await markAllNotificationsReadAction(slug)
  }

  const count = data.unread
  return (
    <DropdownMenu.Root
      onOpenChange={(o) => {
        if (o) void refresh()
      }}
    >
      <DropdownMenu.Trigger
        className="crm-iconbtn crm-bell"
        aria-label={count ? t('notifications.bellUnread', { count }) : t('notifications.bell')}
        data-testid="notification-bell"
      >
        <Bell strokeWidth={1.7} />
        {count > 0 && (
          <span className="crm-bell-n" aria-hidden>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="crm-menu crm-notif">
          <div className="crm-notif-h">
            <b>{t('notifications.title')}</b>
            {count > 0 && (
              <DropdownMenu.Item
                className="crm-notif-all"
                onSelect={(e) => {
                  e.preventDefault()
                  void markAll()
                }}
              >
                <CheckCheck /> {t('notifications.markAll')}
              </DropdownMenu.Item>
            )}
          </div>
          {data.items.length === 0 ? (
            <p className="crm-notif-empty">{t('notifications.emptyTitle')}</p>
          ) : (
            data.items.map((n) => (
              <DropdownMenu.Item
                key={n.id}
                className="crm-menu-item crm-notif-item"
                data-unread={n.read ? undefined : true}
                onSelect={() => open(n)}
              >
                <span className="crm-notif-dot" aria-hidden />
                <span className="crm-notif-b">
                  <b className="crm-notif-t">{n.title}</b>
                  {n.body && <span>{n.body}</span>}
                  <time dateTime={n.at}>{fmt.dateTime(n.at)}</time>
                </span>
              </DropdownMenu.Item>
            ))
          )}
          <DropdownMenu.Separator className="crm-menu-sep" />
          <DropdownMenu.Item asChild className="crm-menu-item crm-notif-more">
            <Link href={pageHref}>{t('notifications.viewAll')}</Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

'use client'
// Top-bar bell (crm-spec §7, PLAN §14.7 B2): unread count + the latest notifications; a click marks one read and
// opens its deep link. Refreshes when opened, when the tab comes back and every 30 s while it is visible. R36: a
// website booking / enquiry that arrives after the page loaded pops up (website-toast.tsx) with a short chime.
// Styles: crm.css.
import { POPUP_NOTIFICATION_KINDS } from '@spa/core'
import { Bell, CheckCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { DropdownMenu } from 'radix-ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  bellAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/app/dashboard/[tenant]/notifications/actions'
import { useI18n } from '@/i18n/client'
import { chime, unlockChime } from '@/lib/chime'
import type { BellData, BellItem } from '@/server/notifications'
import { readSound, takeUnshown, WebsiteToasts, writeSound } from './website-toast'

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
  // R36: what was there when the page loaded never pops up; only later website rows do (newest 3 kept).
  const [seen] = useState(() => ({
    ids: new Set(initial.items.map((n) => n.id)),
    after: initial.items.reduce((max, n) => (n.at > max ? n.at : max), ''),
  }))
  const [toasts, setToasts] = useState<BellItem[]>([])
  // The toast whose Confirm form is open stays when a newer alert arrives (its typed fee would be lost).
  const pinned = useRef(new Set<string>())
  const [sound, setSound] = useState(true)
  const soundRef = useRef(true)

  useEffect(() => {
    setData(initial)
  }, [initial])

  useEffect(() => {
    const on = readSound()
    soundRef.current = on
    setSound(on)
  }, [])

  // Browsers start audio only after a gesture: unlock on presses while the sound is on — every press, since iOS
  // suspends / interrupts the audio again when the app goes to the background or the screen locks.
  useEffect(() => {
    const unlock = () => {
      if (soundRef.current) unlockChime()
    }
    window.addEventListener('pointerdown', unlock, true)
    window.addEventListener('keydown', unlock, true)
    return () => {
      window.removeEventListener('pointerdown', unlock, true)
      window.removeEventListener('keydown', unlock, true)
    }
  }, [])

  useEffect(() => {
    const fresh = data.items.filter(
      (n) =>
        !seen.ids.has(n.id) &&
        n.at > seen.after &&
        !n.read &&
        (POPUP_NOTIFICATION_KINDS as readonly string[]).includes(n.kind),
    )
    for (const n of data.items) seen.ids.add(n.id)
    if (!fresh.length) return
    const unshown = takeUnshown(fresh.map((n) => n.id))
    const show = fresh.filter((n) => unshown.has(n.id))
    if (!show.length) return
    setToasts((ts) => {
      const next = [...show, ...ts.filter((x) => !unshown.has(x.id))]
      let room = 3 - next.filter((x) => pinned.current.has(x.id)).length
      return next.filter((x) => pinned.current.has(x.id) || room-- > 0)
    })
    if (soundRef.current) chime()
  }, [data, seen])

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
    }, 30_000)
    const back = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', back)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', back)
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
    setToasts([])
    await markAllNotificationsReadAction(slug)
  }

  const dismiss = (id: string) => setToasts((ts) => ts.filter((x) => x.id !== id))
  const switchSound = (on: boolean) => {
    soundRef.current = on
    setSound(on)
    writeSound(on)
    if (on) unlockChime()
  }

  const count = data.unread
  return (
    <>
      <WebsiteToasts
        slug={slug}
        items={toasts.map((n) => data.items.find((x) => x.id === n.id) ?? n)}
        sound={sound}
        onSound={switchSound}
        onOpen={(n) => {
          dismiss(n.id)
          open(n)
        }}
        onDismiss={dismiss}
        onFormOpen={(id, o) => {
          if (o) pinned.current.add(id)
          else pinned.current.delete(id)
        }}
        onConfirmed={(n) => {
          // Handled: read (the Confirm form already refreshed the page).
          if (!n.read) {
            markLocal((x) => x.id === n.id)
            void markNotificationReadAction(slug, n.id)
          }
        }}
      />
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
    </>
  )
}

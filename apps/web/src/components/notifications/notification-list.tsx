'use client'
// /notifications rows + "Mark all as read" (PLAN §14.7 B2). A row click marks it read and opens its deep link.
import { Bell, CheckCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/app/dashboard/[tenant]/notifications/actions'
import { Pill } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { resultText, useI18n } from '@/i18n/client'
import { cn } from '@/lib/utils'
import type { BellItem } from '@/server/notifications'

export function MarkAllReadButton({ slug }: { slug: string }) {
  const { t } = useI18n()
  const router = useRouter()
  const [pending, start] = useTransition()
  return (
    <Button
      variant="secondary"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await markAllNotificationsReadAction(slug)
          if (res) (res.ok ? toast.success : toast.error)(resultText(t, res) ?? '')
          router.refresh()
        })
      }
    >
      <CheckCheck className="size-4" /> {t('notifications.markAll')}
    </Button>
  )
}

export function NotificationRows({ slug, items }: { slug: string; items: BellItem[] }) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const [, start] = useTransition()
  const open = (n: BellItem) =>
    start(async () => {
      if (!n.read) await markNotificationReadAction(slug, n.id)
      if (n.href) router.push(n.href)
      else router.refresh()
    })
  return (
    <ul className="m-0 list-none p-0">
      {items.map((n) => (
        <li key={n.id}>
          <button
            type="button"
            className={cn('crm-row w-full text-start', !n.read && 'font-medium')}
            data-unread={n.read ? undefined : true}
            onClick={() => open(n)}
          >
            <span className="crm-ricon" aria-hidden>
              <Bell />
            </span>
            <span className="crm-rbody">
              <b className="block">{n.title}</b>
              {n.body && <p>{n.body}</p>}
            </span>
            <span className="crm-rtime">
              <time dateTime={n.at}>{fmt.dateTime(n.at)}</time>
            </span>
            {!n.read && (
              <span className="crm-rend">
                <Pill tone="acc" dot>
                  {t('notifications.unread')}
                </Pill>
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  )
}

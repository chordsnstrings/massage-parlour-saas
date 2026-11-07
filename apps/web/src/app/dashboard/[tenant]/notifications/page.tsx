import { withTenant } from '@spa/db'
import { listNotifications, unreadNotificationCount } from '@spa/services'
import { Bell } from 'lucide-react'
import Link from 'next/link'
import { Card, Seg } from '@/components/crm'
import { MarkAllReadButton, NotificationRows } from '@/components/notifications/notification-list'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { requireMember } from '@/server/access'
import { toBellItem, viewerOf } from '@/server/notifications'

export async function generateMetadata() {
  return { title: (await getT())('notifications.title') }
}

const PAGE = 50

export default async function NotificationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ filter?: string; before?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  const sp = await searchParams
  const { t, fmt } = await getI18n()
  const unreadOnly = sp.filter === 'unread'
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before) : undefined
  const viewer = viewerOf(ctx)
  const [rows, unread] = await withTenant(
    ctx.tenant.id,
    async (tx) =>
      [
        await listNotifications(tx, viewer, { limit: PAGE + 1, unreadOnly, before }),
        await unreadNotificationCount(tx, viewer),
      ] as const,
  )
  const items = rows.slice(0, PAGE).map((n) => toBellItem(n, t, fmt))
  const base = appPath(`/${ctx.tenant.slug}/notifications`)
  const filterQs = unreadOnly ? 'filter=unread&' : ''
  const older =
    rows.length > PAGE ? `${base}?${filterQs}before=${encodeURIComponent(items.at(-1)!.at)}` : null

  return (
    <PageBody>
      <PageHeader
        title={t('notifications.title')}
        description={t('notifications.description')}
        actions={unread > 0 ? <MarkAllReadButton slug={ctx.tenant.slug} /> : undefined}
      />
      <Card
        flush
        title={
          <Seg
            label={t('notifications.title')}
            value={unreadOnly ? 'unread' : 'all'}
            items={[
              { value: 'all', label: t('notifications.filter.all'), href: base },
              {
                value: 'unread',
                label: `${t('notifications.filter.unread')}${unread ? ` (${fmt.number(unread)})` : ''}`,
                href: `${base}?filter=unread`,
              },
            ]}
          />
        }
        footer={
          older ? (
            <Link href={older} className="crm-muted">
              {t('notifications.older')} →
            </Link>
          ) : undefined
        }
      >
        {items.length === 0 ? (
          <EmptyState
            icon={<Bell />}
            title={t('notifications.emptyTitle')}
            description={t('notifications.empty')}
          />
        ) : (
          <NotificationRows slug={ctx.tenant.slug} items={items} />
        )}
      </Card>
    </PageBody>
  )
}

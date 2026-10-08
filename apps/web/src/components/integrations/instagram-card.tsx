import { withTenant } from '@spa/db'
import { instagramStatus, metaConfig, metaUrls, missingMetaEnv } from '@spa/services'
import { ChevronDown, ImageUp, MessageCircle, MessagesSquare, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { CONNECT_NOTICES } from '@/app/api/integrations/meta/oauth'
import { Card, Pill } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/ui/copy-button'
import { getI18n } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { can, type MemberContext } from '@/server/access'
import { requestUrls } from '@/server/origin'
import { InstagramGlyph } from '../inbox/icons'
import { InstagramConnectButton, InstagramDisconnectButton } from './instagram-card-actions'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

const FEATURES = [
  { icon: MessageCircle, key: 'dm' },
  { icon: MessagesSquare, key: 'comments' },
  { icon: ImageUp, key: 'posts' },
] as const

/** Settings → Instagram & Google: connection status, connect/disconnect and the URLs for the Meta app. */
export async function InstagramCard({
  ctx,
  searchParams,
}: {
  ctx: MemberContext
  searchParams: Record<string, string | string[] | undefined>
}) {
  const slug = ctx.tenant.slug
  const { t, fmt } = await getI18n()
  const configured = metaConfig() !== null
  const missing = missingMetaEnv()
  const account = await withTenant(ctx.tenant.id, (tx) => instagramStatus(tx))
  const urls = metaUrls()
  // Connecting runs on the platform domain in use, so Meta needs this domain's redirect URI too.
  const redirectUri = metaUrls((await requestUrls()).api('')).callback
  const canManage = can(ctx, 'ai.manage')
  const noticeKey = one(searchParams.ig) ?? ''
  const known = CONNECT_NOTICES[noticeKey]
  const notice = known && {
    tone: known.tone,
    text: t.maybe(`settings.integrations.ig.notices.${noticeKey}`) ?? known.text,
  }
  const badge = !configured
    ? { tone: 'neutral' as const, label: t('settings.integrations.status.notConfiguredShort') }
    : account?.status === 'connected'
      ? { tone: 'ok' as const, label: t('settings.integrations.status.connected') }
      : account?.status === 'expired'
        ? { tone: 'warn' as const, label: t('settings.integrations.status.needsReconnecting') }
        : { tone: 'neutral' as const, label: t('settings.integrations.status.notConnected') }

  return (
    <Card
      className="flex flex-col"
      data-testid="instagram-card"
      title={
        <span className="inline-flex items-center gap-2">
          <InstagramGlyph /> {t('settings.integrations.ig.title')}
        </span>
      }
      sub={t('settings.integrations.ig.sub')}
      actions={<Pill tone={badge.tone}>{badge.label}</Pill>}
    >
      <div className="flex-1 space-y-6">
        {notice && (
          <p
            role="status"
            className={cn(
              'anim-fade-in rounded-lg px-4 py-3 text-sm',
              notice.tone === 'success' ? 'bg-accent-soft text-fg' : 'bg-danger-soft text-danger',
            )}
          >
            {notice.text}
          </p>
        )}

        {!configured ? (
          <div className="space-y-3 rounded-lg border border-dashed px-4 py-4">
            <p className="text-sm font-medium">{t('settings.integrations.ig.notConfiguredTitle')}</p>
            <p className="text-sm text-muted">{t('settings.integrations.ig.notConfigured')}</p>
            <div className="flex flex-wrap gap-1.5">
              {missing.map((k) => (
                <code key={k} className="rounded-md bg-subtle px-2 py-1 text-xs text-muted">
                  {k}
                </code>
              ))}
            </div>
          </div>
        ) : account ? (
          <div className="space-y-5">
            <div className="flex items-center gap-4">
              {account.profilePictureUrl ? (
                // biome-ignore lint/performance/noImgElement: Instagram CDN avatar
                <img
                  src={account.profilePictureUrl}
                  alt=""
                  className="size-12 shrink-0 rounded-full border object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="grid size-12 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
                  <InstagramGlyph className="size-5" />
                </div>
              )}
              <div className="min-w-0">
                <p className="truncate text-[15px] font-medium">
                  {account.username ? `@${account.username}` : t('settings.integrations.ig.account')}
                </p>
                <p className="text-sm text-muted">
                  {t('settings.integrations.ig.connectedOn', { date: fmt.date(account.connectedAt) })}
                </p>
              </div>
            </div>
            {account.status === 'expired' && (
              <p className="flex gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                {t('settings.integrations.ig.expired')}
              </p>
            )}
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="space-y-1">
                <dt className="text-muted">{t('settings.integrations.ig.access')}</dt>
                <dd>
                  {account.tokenExpiresAt
                    ? t('settings.integrations.ig.renewsUntil', { date: fmt.date(account.tokenExpiresAt) })
                    : t('settings.integrations.ig.renews')}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted">{t('settings.integrations.ig.events')}</dt>
                <dd className={account.webhooks === 'failed' ? 'text-warning' : undefined}>
                  {account.webhooks === 'failed'
                    ? t('settings.integrations.ig.notSubscribed')
                    : t('settings.integrations.ig.subscribed')}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              {can(ctx, 'marketing.send') && (
                <Button asChild variant="secondary" className="min-h-11">
                  <Link href={appPath(`/${slug}/inbox`)}>
                    <MessagesSquare /> {t('settings.integrations.ig.openInbox')}
                  </Link>
                </Button>
              )}
              {canManage && (
                <>
                  <InstagramConnectButton
                    slug={slug}
                    label={t('settings.integrations.ig.reconnect')}
                    variant={account.status === 'expired' ? 'primary' : 'secondary'}
                  />
                  <InstagramDisconnectButton slug={slug} username={account.username} />
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            <ul className="space-y-4">
              {FEATURES.map((f) => (
                <li key={f.key} className="flex gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-subtle text-muted">
                    <f.icon className="size-4" strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-sm font-medium">
                      {t(`settings.integrations.ig.features.${f.key}Title`)}
                    </span>
                    <span className="block text-sm text-muted">
                      {t(`settings.integrations.ig.features.${f.key}Text`)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
            {canManage ? (
              <InstagramConnectButton slug={slug} />
            ) : (
              <p className="text-sm text-muted">{t('settings.integrations.ig.askManager')}</p>
            )}
          </div>
        )}
      </div>
      <details className="group mt-4 border-t">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
          {t('settings.integrations.ig.metaSettings')}
          <ChevronDown
            className="size-4 text-muted transition-transform duration-200 group-open:rotate-180"
            strokeWidth={1.5}
          />
        </summary>
        <div className="space-y-4 pb-1 text-sm">
          <p className="text-muted">{t('settings.integrations.ig.metaHelp')}</p>
          <UrlRow label={t('settings.integrations.ig.webhookUrl')} value={urls.webhook} />
          <UrlRow label={t('settings.integrations.ig.redirectUri')} value={redirectUri} />
          <UrlRow label={t('settings.integrations.ig.deauthorizeUrl')} value={urls.deauthorize} />
          <UrlRow label={t('settings.integrations.ig.deletionUrl')} value={urls.dataDeletion} />
        </div>
      </details>
    </Card>
  )
}

function UrlRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[13px] text-muted">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border bg-subtle/60 px-2.5 py-2 text-xs">
          {value}
        </code>
        <CopyButton value={value} />
      </div>
    </div>
  )
}

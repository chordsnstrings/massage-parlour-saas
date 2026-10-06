import { withTenant } from '@spa/db'
import { instagramStatus, metaConfig, metaUrls, missingMetaEnv } from '@spa/services'
import { ChevronDown, ImageUp, MessageCircle, MessagesSquare, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { CONNECT_NOTICES } from '@/app/api/integrations/meta/oauth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { CopyButton } from '@/components/ui/copy-button'
import { appPath } from '@/lib/paths'
import { cn, formatDate } from '@/lib/utils'
import { can, type MemberContext } from '@/server/access'
import { InstagramGlyph } from '../inbox/icons'
import { InstagramConnectButton, InstagramDisconnectButton } from './instagram-card-actions'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

const FEATURES = [
  {
    icon: MessageCircle,
    title: 'Answer DMs and take bookings',
    text: 'Approve-first or autopilot, always inside Instagram’s 24-hour reply window.',
  },
  {
    icon: MessagesSquare,
    title: 'Reply to comments',
    text: 'Short, neutral public replies drafted for you to approve.',
  },
  { icon: ImageUp, title: 'Publish posts', text: 'Approved posts from AI studio go out on schedule.' },
]

/** Settings → Instagram & Google: connection status, connect/disconnect and the URLs for the Meta app. */
export async function InstagramCard({
  ctx,
  searchParams,
}: {
  ctx: MemberContext
  searchParams: Record<string, string | string[] | undefined>
}) {
  const slug = ctx.tenant.slug
  const configured = metaConfig() !== null
  const missing = missingMetaEnv()
  const account = await withTenant(ctx.tenant.id, (tx) => instagramStatus(tx))
  const urls = metaUrls()
  const canManage = can(ctx, 'ai.manage')
  const notice = CONNECT_NOTICES[one(searchParams.ig) ?? '']
  const badge = !configured
    ? { tone: 'neutral' as const, label: 'Not configured' }
    : account?.status === 'connected'
      ? { tone: 'success' as const, label: 'Connected' }
      : account?.status === 'expired'
        ? { tone: 'warning' as const, label: 'Needs reconnecting' }
        : { tone: 'neutral' as const, label: 'Not connected' }

  return (
    <Card className="flex flex-col" data-testid="instagram-card">
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            <InstagramGlyph /> Instagram
          </span>
        }
        description="DMs, comments and publishing for a professional account — no Facebook Page needed."
        action={<Badge tone={badge.tone}>{badge.label}</Badge>}
      />
      <CardBody className="flex-1 space-y-6">
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
            <p className="text-sm font-medium">Not configured yet</p>
            <p className="text-sm text-muted">
              Instagram needs the platform’s Meta app before spas can connect. Once the keys below are set on the
              server, a Connect button appears here.
            </p>
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
                  {account.username ? `@${account.username}` : 'Instagram account'}
                </p>
                <p className="text-sm text-muted">Connected {formatDate(account.connectedAt)}</p>
              </div>
            </div>
            {account.status === 'expired' && (
              <p className="flex gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                Instagram access expired or was revoked. Reconnect to keep answering DMs and publishing.
              </p>
            )}
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="space-y-1">
                <dt className="text-muted">Access</dt>
                <dd>
                  {account.tokenExpiresAt
                    ? `Renews automatically · valid until ${formatDate(account.tokenExpiresAt)}`
                    : 'Renews automatically'}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted">DM & comment events</dt>
                <dd className={account.webhooks === 'failed' ? 'text-warning' : undefined}>
                  {account.webhooks === 'failed' ? 'Not subscribed — reconnect to retry' : 'Subscribed'}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              {can(ctx, 'marketing.send') && (
                <Button asChild variant="secondary" className="min-h-11">
                  <Link href={appPath(`/${slug}/inbox`)}>
                    <MessagesSquare /> Open inbox
                  </Link>
                </Button>
              )}
              {canManage && (
                <>
                  <InstagramConnectButton
                    slug={slug}
                    label="Reconnect"
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
                <li key={f.title} className="flex gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-subtle text-muted">
                    <f.icon className="size-4" strokeWidth={1.5} />
                  </span>
                  <span className="min-w-0 space-y-0.5">
                    <span className="block text-sm font-medium">{f.title}</span>
                    <span className="block text-sm text-muted">{f.text}</span>
                  </span>
                </li>
              ))}
            </ul>
            {canManage ? (
              <InstagramConnectButton slug={slug} />
            ) : (
              <p className="text-sm text-muted">Ask an owner or manager to connect Instagram.</p>
            )}
          </div>
        )}
      </CardBody>
      <details className="group border-t">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 text-sm font-medium sm:px-6 [&::-webkit-details-marker]:hidden">
          Meta app settings
          <ChevronDown
            className="size-4 text-muted transition-transform duration-200 group-open:rotate-180"
            strokeWidth={1.5}
          />
        </summary>
        <div className="space-y-4 px-5 pb-5 text-sm sm:px-6 sm:pb-6">
          <p className="text-muted">
            For the platform’s Meta app (Instagram API with Instagram Login). Subscribe the webhook to{' '}
            <span className="text-fg">messages</span> and <span className="text-fg">comments</span>; the verify
            token is the server’s META_WEBHOOK_VERIFY_TOKEN.
          </p>
          <UrlRow label="Webhook callback URL" value={urls.webhook} />
          <UrlRow label="OAuth redirect URI" value={urls.callback} />
          <UrlRow label="Deauthorize callback URL" value={urls.deauthorize} />
          <UrlRow label="Data deletion request URL" value={urls.dataDeletion} />
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
        <code className="min-w-0 flex-1 truncate rounded-md border bg-subtle/60 px-2.5 py-2 text-xs">{value}</code>
        <CopyButton value={value} />
      </div>
    </div>
  )
}

import type { MessageKey } from '@spa/core/i18n'
import { withTenant } from '@spa/db'
import {
  DomainError,
  type FacebookPageChoice,
  facebookView,
  getFacebookAccount,
  MetaApiError,
  metaConfig,
  metaUrls,
  pendingFacebookPages,
} from '@spa/services'
import { AlertCircle, CheckCircle2, ChevronDown, TriangleAlert } from 'lucide-react'
import { FB_NOTICES } from '@/app/api/integrations/meta/oauth'
import { Card, Pill } from '@/components/crm'
import { CopyButton } from '@/components/ui/copy-button'
import { getI18n } from '@/i18n/server'
import { cn } from '@/lib/utils'
import { can, type MemberContext } from '@/server/access'
import { hasFeature } from '@/server/entitlements'
import { requestUrls } from '@/server/origin'
import { InstagramGlyph } from '../inbox/icons'
import { ChoosePageForm, FacebookConnectButton, FacebookDisconnectButton } from './facebook-card-actions'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

async function loadPages(tenantId: string): Promise<{ pages: FacebookPageChoice[]; failed: boolean }> {
  try {
    return { pages: await pendingFacebookPages(tenantId), failed: false }
  } catch (e) {
    if (e instanceof DomainError || e instanceof MetaApiError) return { pages: [], failed: true }
    throw e
  }
}

/**
 * Settings → Instagram & Google: the Facebook Page (F19, Facebook Login for Business) — connect, choose the Page
 * linked to the Instagram professional account, connected Page + Instagram account, expiry warnings, disconnect.
 * Premium ('marketing'); a Standard spa only sees the Premium label (and can still disconnect).
 */
export async function FacebookCard({
  ctx,
  searchParams,
}: {
  ctx: MemberContext
  searchParams: Record<string, string | string[] | undefined>
}) {
  const slug = ctx.tenant.slug
  const { t, fmt } = await getI18n()
  const configured = metaConfig() !== null && Boolean(process.env.BETTER_AUTH_SECRET)
  const premium = await hasFeature(ctx.tenant.id, 'marketing')
  const manage = can(ctx, 'ai.manage')
  const view = facebookView(await withTenant(ctx.tenant.id, (tx) => getFacebookAccount(tx)))
  const picker =
    view?.status === 'pending_page' && configured && manage ? await loadPages(ctx.tenant.id) : null
  const redirectUri = metaUrls((await requestUrls()).api('')).facebookCallback
  const noticeKey = one(searchParams.fb) ?? ''
  const tone = FB_NOTICES[noticeKey]

  const badge = !configured ? (
    <Pill>{t('settings.integrations.status.notConfiguredShort')}</Pill>
  ) : !premium && !view ? (
    <Pill tone="info">{t('plan.premiumBadge')}</Pill>
  ) : !view ? (
    <Pill>{t('settings.integrations.status.notConnected')}</Pill>
  ) : view.status === 'pending_page' ? (
    <Pill tone="warn">{t('settings.integrations.fb.choosePill')}</Pill>
  ) : view.status === 'expired' ? (
    <Pill tone="bad">{t('settings.integrations.status.needsReconnecting')}</Pill>
  ) : (
    <Pill tone="ok">{t('settings.integrations.status.connected')}</Pill>
  )

  return (
    <Card
      className="flex flex-col"
      data-testid="facebook-card"
      title={t('settings.integrations.fb.title')}
      sub={t('settings.integrations.fb.sub')}
      actions={badge}
    >
      <div className="flex-1 space-y-5">
        {tone && (
          <p
            role={tone === 'error' ? 'alert' : 'status'}
            className={cn(
              'anim-fade-in flex items-start gap-2 rounded-lg px-3.5 py-3 text-sm',
              tone === 'success' ? 'bg-accent-soft text-fg' : 'bg-danger-soft text-danger',
            )}
          >
            {tone === 'success' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-accent" strokeWidth={1.75} />
            ) : (
              <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={1.75} />
            )}
            <span>{t(`settings.integrations.fb.notices.${noticeKey}` as MessageKey)}</span>
          </p>
        )}

        {!configured ? (
          <p className="text-sm text-muted">{t('settings.integrations.fb.notConfigured')}</p>
        ) : !view ? (
          <div className="space-y-3 text-sm text-muted">
            <p>{t('settings.integrations.fb.intro')}</p>
            {!premium && <p>{t('settings.integrations.fb.premium')}</p>}
            {premium && !manage && <p>{t('settings.integrations.ig.askManager')}</p>}
          </div>
        ) : view.status === 'pending_page' ? (
          !manage ? (
            <p className="text-sm text-muted">{t('settings.integrations.fb.pendingOther')}</p>
          ) : picker?.failed ? (
            <p className="text-sm text-danger" role="alert">
              {t('settings.integrations.fb.pagesFailed')}
            </p>
          ) : picker ? (
            <ChoosePageForm
              slug={slug}
              pages={picker.pages.map((p) => ({
                id: p.id,
                name: p.name,
                instagram: p.instagram?.username ?? (p.instagram ? p.instagram.id : null),
              }))}
            />
          ) : null
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              {view.igPicture ? (
                // biome-ignore lint/performance/noImgElement: Instagram CDN avatar
                <img
                  src={view.igPicture}
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
                <p className="truncate text-[15px] font-medium" data-testid="facebook-page-name">
                  {view.pageName ?? t('settings.integrations.mcp.pageNoName')}
                </p>
                <p className="truncate text-sm text-muted">
                  {view.igUserId
                    ? t('settings.integrations.fb.linkedIg', {
                        account: view.igUsername ? `@${view.igUsername}` : view.igUserId,
                      })
                    : t('settings.integrations.fb.noIg')}
                </p>
              </div>
            </div>
            {view.status === 'expired' ? (
              <p className="flex gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                {t('settings.integrations.fb.expired')}
              </p>
            ) : (
              view.expiresSoon && (
                <p className="flex gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.5} />
                  {t('settings.integrations.fb.expiresSoon', { date: fmt.date(view.expiresSoon) })}
                </p>
              )
            )}
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div className="space-y-1">
                <dt className="text-muted">{t('settings.integrations.ig.access')}</dt>
                <dd>
                  {view.dataAccessExpiresAt
                    ? t('settings.integrations.fb.validUntil', { date: fmt.date(view.dataAccessExpiresAt) })
                    : t('settings.integrations.fb.noExpiry')}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-muted">{t('settings.integrations.fb.connectedOn')}</dt>
                <dd>{fmt.date(view.connectedAt)}</dd>
              </div>
            </dl>
            <p className="text-[13px] text-muted">{t('settings.integrations.fb.uses')}</p>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
        {configured && manage && premium && (view?.status !== 'connected' || view.expiresSoon) && (
          <FacebookConnectButton
            slug={slug}
            label={view ? t('settings.integrations.fb.reconnect') : t('settings.integrations.fb.connect')}
          />
        )}
        {view && manage && (
          <span className="ms-auto">
            <FacebookDisconnectButton slug={slug} name={view.pageName} />
          </span>
        )}
      </div>
      {configured && (
        <details className="group mt-2 border-t">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
            {t('settings.integrations.ig.metaSettings')}
            <ChevronDown
              className="size-4 text-muted transition-transform duration-200 group-open:rotate-180"
              strokeWidth={1.5}
            />
          </summary>
          <div className="space-y-1.5 pb-1 text-sm">
            <p className="text-[13px] text-muted">{t('settings.integrations.fb.redirectUri')}</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border bg-subtle/60 px-2.5 py-2 text-xs">
                {redirectUri}
              </code>
              <CopyButton value={redirectUri} />
            </div>
          </div>
        </details>
      )}
    </Card>
  )
}

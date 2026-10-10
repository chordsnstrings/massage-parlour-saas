import { withTenant } from '@spa/db'
import {
  type GbpLocation,
  gbpBookView,
  gbpConnectionView,
  gbpErrorMessage,
  gbpSearchConsoleView,
  getGbpAccount,
  googleBookingUrl,
  googleConfig,
  listGbpAccounts,
  listGbpLocations,
  reviewStats,
  sitemapUrlOf,
  withGbpToken,
} from '@spa/services'
import { AlertCircle, CheckCircle2, MapPin, Star } from 'lucide-react'
import Link from 'next/link'
import { chooseLocationAction } from '@/app/api/integrations/google/actions'
import { GBP_NOTICES } from '@/app/api/integrations/google/oauth'
import { Card, Pill } from '@/components/crm'
import { buttonVariants } from '@/components/ui/button'
import { ActionForm, FieldError, SubmitButton } from '@/components/ui/form'
import { getI18n } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import type { MemberContext } from '@/server/access'
import { can } from '@/server/access'
import { hasFeature } from '@/server/entitlements'
import { publicSiteUrl } from '@/server/sites'
import {
  ChangeLocationButton,
  ConnectGoogleButton,
  DisconnectGoogleButton,
  SyncGoogleButton,
} from './gbp-card-actions'
import { GbpSiteSection } from './gbp-site'

type Choice = GbpLocation & { accountName: string; accountLabel: string }

/** Every location the signed-in Google user manages (first 10 accounts). */
async function loadLocations(tenantId: string): Promise<{ choices: Choice[]; error: string | null }> {
  try {
    const choices = await withGbpToken({ tenantId }, async (token) => {
      const accounts = (await listGbpAccounts(token)).slice(0, 10)
      const out: Choice[] = []
      for (const a of accounts)
        for (const l of await listGbpLocations(token, a.name))
          out.push({ ...l, accountName: a.name, accountLabel: a.accountName })
      return out
    })
    return { choices, error: null }
  } catch (e) {
    return { choices: [], error: gbpErrorMessage(e) }
  }
}

const Notice = ({ tone, text }: { tone: 'success' | 'error'; text: string }) => (
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
    <span>{text}</span>
  </p>
)

/** Google Business Profile: connect (OAuth + PKCE), pick the location, sync reviews, disconnect. */
export async function GbpCard({
  ctx,
  searchParams,
}: {
  ctx: MemberContext
  searchParams: Record<string, string | string[] | undefined>
}) {
  const slug = ctx.tenant.slug
  const { t, fmt } = await getI18n()
  const configured = Boolean(googleConfig() && process.env.BETTER_AUTH_SECRET)
  const manage = can(ctx, 'ai.manage')
  /** Sync now and the reviews page need ai.approve (settings.manage alone can open this card). */
  const approve = can(ctx, 'ai.approve')
  const { conn, stats, book, sc } = await withTenant(ctx.tenant.id, async (tx) => {
    const row = await getGbpAccount(tx, ctx.tenant.id)
    return {
      conn: gbpConnectionView(row),
      stats: row ? await reviewStats(tx, ctx.tenant.id) : null,
      book: gbpBookView(row),
      sc: gbpSearchConsoleView(row),
    }
  })
  const siteBase = conn ? await publicSiteUrl(ctx.tenant) : ''
  const premium = await hasFeature(ctx.tenant.id, 'marketing')
  const picker =
    conn?.status === 'pending_location' && configured && manage ? await loadLocations(ctx.tenant.id) : null
  const noticeKey = typeof searchParams.gbp === 'string' ? searchParams.gbp : undefined
  const known = noticeKey ? GBP_NOTICES[noticeKey] : undefined
  const notice = known && {
    tone: known.tone,
    text: t.maybe(`settings.integrations.gbp.notices.${noticeKey}`) ?? known.text,
  }
  const reviewsHref = appPath(`/${slug}/ai/reviews`)

  const badge = !configured ? (
    <Pill>{t('settings.integrations.status.notConfigured')}</Pill>
  ) : !conn ? (
    <Pill>{t('settings.integrations.status.notConnected')}</Pill>
  ) : conn.status === 'error' ? (
    <Pill tone="bad">{t('settings.integrations.status.reconnect')}</Pill>
  ) : conn.status === 'pending_location' ? (
    <Pill tone="warn">{t('settings.integrations.status.chooseLocation')}</Pill>
  ) : (
    <Pill tone="ok">{t('settings.integrations.status.connected')}</Pill>
  )

  return (
    <Card
      className="flex flex-col"
      data-testid="gbp-card"
      title={t('settings.integrations.gbp.title')}
      sub={t('settings.integrations.gbp.sub')}
      actions={badge}
    >
      <div className="flex-1 space-y-5">
        {notice && <Notice tone={notice.tone} text={notice.text} />}

        {!configured ? (
          <div className="space-y-3 text-sm text-muted">
            <p>{t('settings.integrations.gbp.notConfigured')}</p>
            <p>{t('settings.integrations.gbp.untilThen')}</p>
          </div>
        ) : !conn ? (
          <ul className="space-y-2.5 text-sm text-muted">
            {(['reviews', 'autopilot', 'posts'] as const).map((k) => (
              <li key={k} className="flex gap-2.5">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                {t(`settings.integrations.gbp.features.${k}`)}
              </li>
            ))}
          </ul>
        ) : null}

        {conn?.status === 'error' && (
          <Notice tone="error" text={conn.lastError ?? t('settings.integrations.gbp.expired')} />
        )}

        {conn?.status === 'pending_location' &&
          (!configured || !manage ? (
            <p className="text-sm text-muted">{t('settings.integrations.gbp.pendingLocation')}</p>
          ) : picker?.error ? (
            <Notice tone="error" text={picker.error} />
          ) : picker && picker.choices.length === 0 ? (
            <p className="text-sm text-muted">{t('settings.integrations.gbp.noLocations')}</p>
          ) : picker ? (
            <ActionForm action={chooseLocationAction.bind(null, slug)} className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">
                  {t('settings.integrations.gbp.whichLocation')}
                </legend>
                {picker.choices.map((l, i) => (
                  <label
                    key={`${l.accountName}|${l.name}`}
                    className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-3 transition-colors hover:bg-subtle has-[:checked]:border-accent has-[:checked]:bg-accent-soft/50"
                  >
                    <input
                      type="radio"
                      name="location"
                      value={`${l.accountName}|${l.name}`}
                      defaultChecked={i === 0}
                      className="mt-1 size-4 accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{l.title}</span>
                      <span className="block truncate text-[13px] text-muted">
                        {l.address || l.accountLabel}
                      </span>
                    </span>
                  </label>
                ))}
              </fieldset>
              <FieldError name="location" />
              <SubmitButton className="h-11 sm:h-10">
                <MapPin /> {t('settings.integrations.gbp.useLocation')}
              </SubmitButton>
            </ActionForm>
          ) : null)}

        {conn?.hasLocation && (
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted">
                {t('settings.integrations.gbp.location')}
              </dt>
              <dd className="font-medium">{conn.title}</dd>
              {conn.address && <dd className="text-muted">{conn.address}</dd>}
            </div>
            <div className="space-y-1">
              <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted">
                {t('settings.integrations.gbp.lastSync')}
              </dt>
              <dd>
                {conn.lastSyncAt ? fmt.dateTime(conn.lastSyncAt) : t('settings.integrations.gbp.notYet')}
              </dd>
            </div>
            {stats && (
              <div className="space-y-1">
                <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted">
                  {t('settings.integrations.gbp.reviews')}
                </dt>
                <dd className="inline-flex items-center gap-1.5">
                  {fmt.number(stats.count)}
                  {stats.count > 0 && (
                    <>
                      <span className="text-muted">·</span>
                      <Star className="size-3.5 text-warning" fill="currentColor" strokeWidth={1.5} />
                      {stats.average.toFixed(1)}
                    </>
                  )}
                </dd>
              </div>
            )}
          </dl>
        )}
        {conn?.hasLocation && conn.lastError && conn.status !== 'error' && (
          <p className="text-[13px] text-danger" role="alert">
            {t('settings.integrations.gbp.lastSyncFailed', { error: conn.lastError })}
          </p>
        )}
        {configured && conn && conn.status !== 'error' && (
          <GbpSiteSection
            slug={slug}
            book={book}
            sc={sc}
            manage={manage}
            premium={premium}
            bookingUrl={googleBookingUrl(siteBase)}
            sitemapUrl={sitemapUrlOf(siteBase)}
          />
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
        {configured && manage && (!conn || conn.status === 'error') && (
          <ConnectGoogleButton
            slug={slug}
            label={conn ? t('settings.integrations.gbp.reconnect') : t('settings.integrations.gbp.connect')}
          />
        )}
        {conn?.status === 'connected' && configured && approve && <SyncGoogleButton slug={slug} />}
        {approve && (
          <Link href={reviewsHref} className={cn(buttonVariants({ variant: 'ghost' }), 'h-11 sm:h-10')}>
            {t('settings.integrations.gbp.reviewReplies')}
          </Link>
        )}
        {conn && manage && (
          <span className="ms-auto flex flex-wrap gap-1">
            {conn.hasLocation && conn.status !== 'error' && <ChangeLocationButton slug={slug} />}
            <DisconnectGoogleButton slug={slug} />
          </span>
        )}
      </div>
    </Card>
  )
}

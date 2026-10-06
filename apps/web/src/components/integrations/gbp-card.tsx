import { withTenant } from '@spa/db'
import {
  type GbpLocation,
  gbpConnectionView,
  gbpErrorMessage,
  getGbpAccount,
  googleConfig,
  listGbpAccounts,
  listGbpLocations,
  reviewStats,
  withGbpToken,
} from '@spa/services'
import { AlertCircle, CheckCircle2, MapPin, Star } from 'lucide-react'
import Link from 'next/link'
import { chooseLocationAction } from '@/app/api/integrations/google/actions'
import { GBP_NOTICES } from '@/app/api/integrations/google/oauth'
import { Badge } from '@/components/ui/badge'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card'
import { ActionForm, FieldError, SubmitButton } from '@/components/ui/form'
import { appPath } from '@/lib/paths'
import { cn, formatDateTime } from '@/lib/utils'
import type { MemberContext } from '@/server/access'
import { can } from '@/server/access'
import {
  ChangeLocationButton,
  ConnectGoogleButton,
  DisconnectGoogleButton,
  SyncGoogleButton,
} from './gbp-card-actions'

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
  const configured = Boolean(googleConfig() && process.env.BETTER_AUTH_SECRET)
  const manage = can(ctx, 'ai.manage')
  const { conn, stats } = await withTenant(ctx.tenant.id, async (tx) => {
    const row = await getGbpAccount(tx, ctx.tenant.id)
    return {
      conn: gbpConnectionView(row),
      stats: row ? await reviewStats(tx, ctx.tenant.id) : null,
    }
  })
  const picker =
    conn?.status === 'pending_location' && configured && manage ? await loadLocations(ctx.tenant.id) : null
  const noticeKey = typeof searchParams.gbp === 'string' ? searchParams.gbp : undefined
  const notice = noticeKey ? GBP_NOTICES[noticeKey] : undefined
  const reviewsHref = appPath(`/${slug}/ai/reviews`)

  const badge = !configured ? (
    <Badge tone="neutral">Not configured yet</Badge>
  ) : !conn ? (
    <Badge tone="neutral">Not connected</Badge>
  ) : conn.status === 'error' ? (
    <Badge tone="danger">Reconnect needed</Badge>
  ) : conn.status === 'pending_location' ? (
    <Badge tone="warning">Choose location</Badge>
  ) : (
    <Badge tone="success">Connected</Badge>
  )

  return (
    <Card className="flex flex-col" data-testid="gbp-card">
      <CardHeader
        title="Google Business Profile"
        description="Sync Google reviews, post approved replies and share offers with a Book button."
        action={badge}
      />
      <CardBody className="flex-1 space-y-5">
        {notice && <Notice tone={notice.tone} text={notice.text} />}

        {!configured ? (
          <div className="space-y-3 text-sm text-muted">
            <p>
              Google sign-in isn't set up on this server yet. The platform administrator adds{' '}
              <code className="rounded bg-subtle px-1.5 py-0.5 text-[13px] text-fg">GOOGLE_CLIENT_ID</code>{' '}
              and{' '}
              <code className="rounded bg-subtle px-1.5 py-0.5 text-[13px] text-fg">
                GOOGLE_CLIENT_SECRET
              </code>{' '}
              once Google approves API access.
            </p>
            <p>
              Until then, paste new reviews into Review replies — the AI drafts a reply you can copy into
              Google.
            </p>
          </div>
        ) : !conn ? (
          <ul className="space-y-2.5 text-sm text-muted">
            {[
              'Reviews arrive every two hours, with an AI draft reply when the review agent is on.',
              'Autopilot answers 4–5★ reviews; 1–3★ always wait for your approval.',
              'Approved AI-studio posts can go to Google with a Book button to your booking page.',
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
        ) : null}

        {conn?.status === 'error' && (
          <Notice
            tone="error"
            text={conn.lastError ?? 'Google sign-in expired. Reconnect to keep syncing.'}
          />
        )}

        {conn?.status === 'pending_location' &&
          (!configured || !manage ? (
            <p className="text-sm text-muted">Signed in with Google — a location still needs to be chosen.</p>
          ) : picker?.error ? (
            <Notice tone="error" text={picker.error} />
          ) : picker && picker.choices.length === 0 ? (
            <p className="text-sm text-muted">
              This Google account doesn't manage any Business Profile locations. Sign in with the account that
              owns or manages the spa's profile.
            </p>
          ) : picker ? (
            <ActionForm action={chooseLocationAction.bind(null, slug)} className="space-y-4">
              <fieldset className="space-y-2">
                <legend className="mb-2 text-sm font-medium">Which location is this spa?</legend>
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
                <MapPin /> Use this location
              </SubmitButton>
            </ActionForm>
          ) : null)}

        {conn?.hasLocation && (
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted">Location</dt>
              <dd className="font-medium">{conn.title}</dd>
              {conn.address && <dd className="text-muted">{conn.address}</dd>}
            </div>
            <div className="space-y-1">
              <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted">Last sync</dt>
              <dd>{conn.lastSyncAt ? formatDateTime(conn.lastSyncAt) : 'Not yet'}</dd>
            </div>
            {stats && (
              <div className="space-y-1">
                <dt className="text-xs font-medium uppercase tracking-[0.06em] text-muted">Reviews</dt>
                <dd className="inline-flex items-center gap-1.5">
                  {stats.count}
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
            Last sync failed: {conn.lastError}
          </p>
        )}
      </CardBody>

      <CardFooter className="justify-start gap-2">
        {configured && manage && (!conn || conn.status === 'error') && (
          <ConnectGoogleButton slug={slug} label={conn ? 'Reconnect Google' : 'Connect Google'} />
        )}
        {conn?.status === 'connected' && configured && <SyncGoogleButton slug={slug} />}
        <Link href={reviewsHref} className={cn(buttonVariants({ variant: 'ghost' }), 'h-11 sm:h-10')}>
          Review replies
        </Link>
        {conn && manage && (
          <span className="ms-auto flex flex-wrap gap-1">
            {conn.hasLocation && conn.status !== 'error' && <ChangeLocationButton slug={slug} />}
            <DisconnectGoogleButton slug={slug} />
          </span>
        )}
      </CardFooter>
    </Card>
  )
}

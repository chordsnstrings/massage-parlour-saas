import { reviews, withTenant } from '@spa/db'
import { gbpConnectionView, getGbpAccount, googleConfig, isLocationReview, reviewStats } from '@spa/services'
import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { AlertCircle, ArrowLeft, Plus, Star } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Grid, Pill, Seg, Stat, TName, type Tone } from '@/components/crm'
import { SyncGoogleButton } from '@/components/integrations/gbp-card-actions'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { addReviewAction } from '../actions'
import { ReplyEditor } from './reply-editor'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('reviews.title') }
}

const stars = (n: number, label: string) => (
  <span className="inline-flex gap-0.5 text-warning" role="img" aria-label={label}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Star key={i} className="size-3.5" fill={i <= n ? 'currentColor' : 'none'} strokeWidth={1.5} />
    ))}
  </span>
)

const STATUS_TONE: Record<string, Tone> = {
  none: 'warn',
  draft: 'neutral',
  approved: 'info',
  posted: 'ok',
  failed: 'bad',
}

const STATUS_FILTERS = {
  open: ['none', 'draft', 'failed'],
  approved: ['approved'],
  posted: ['posted'],
  failed: ['failed'],
} as const
type StatusFilter = keyof typeof STATUS_FILTERS

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'ai.approve')) notFound()
  const slug = ctx.tenant.slug
  const sp = await searchParams
  const rating = typeof sp.rating === 'string' && /^[1-5]$/.test(sp.rating) ? Number(sp.rating) : null
  const status =
    typeof sp.status === 'string' && sp.status in STATUS_FILTERS ? (sp.status as StatusFilter) : null

  const where: SQL[] = [eq(reviews.tenantId, ctx.tenant.id)]
  if (rating) where.push(eq(reviews.rating, rating))
  if (status) where.push(inArray(reviews.replyStatus, [...STATUS_FILTERS[status]]))
  const { t, fmt } = await getI18n()
  const { conn, stats, extra, rows } = await withTenant(ctx.tenant.id, async (tx) => ({
    conn: gbpConnectionView(await getGbpAccount(tx, ctx.tenant.id)),
    stats: await reviewStats(tx, ctx.tenant.id),
    // New this month (Dubai) + AI drafts waiting — for the crm-spec §5.10 stat row.
    extra: (
      await tx.execute(sql`select
        (count(*) filter (where coalesce(reviewed_at, created_at) >=
          date_trunc('month', now() at time zone 'Asia/Dubai') at time zone 'Asia/Dubai'))::int as fresh,
        (count(*) filter (where reply_status = 'draft'))::int as drafts
        from reviews`)
    ).rows[0] as { fresh: number; drafts: number },
    rows: await tx
      .select()
      .from(reviews)
      .where(and(...where))
      .orderBy(sql`${reviews.reviewedAt} desc nulls last`, desc(reviews.createdAt))
      .limit(100),
  }))
  const connected = Boolean(conn?.hasLocation)
  // Replies go through the API only for the connected location's reviews; older locations' reviews are history.
  const parent = conn?.hasLocation ? `${conn.accountName}/${conn.locationName}` : null
  // Reconnecting happens on the integrations card, which needs ai.manage.
  const canReconnect = can(ctx, 'ai.manage')
  const base = appPath(`/${slug}/ai/reviews`)
  const href = (next: { rating?: number | null; status?: StatusFilter | null }) => {
    const q = new URLSearchParams()
    const r = next.rating === undefined ? rating : next.rating
    const s = next.status === undefined ? status : next.status
    if (r) q.set('rating', String(r))
    if (s) q.set('status', s)
    const qs = q.toString()
    return qs ? `${base}?${qs}` : base
  }

  const starsLabel = (n: number) => t('reviews.stars', { count: n })
  return (
    <>
      <Link
        href={appPath(`/${slug}/ai`)}
        className="crm-muted mb-4 inline-flex items-center gap-1.5 text-sm transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" strokeWidth={1.5} /> {t('ai.studio')}
      </Link>
      <PageHeader
        title={t('reviews.title')}
        description={
          connected
            ? t('reviews.descConnected', { name: conn?.title ?? t('reviews.yourProfile') })
            : t('reviews.descManual')
        }
        actions={
          <>
            {connected && googleConfig() && <SyncGoogleButton slug={slug} variant="primary" />}
            <FormSheet
              title={t('reviews.addTitle')}
              action={addReviewAction.bind(null, slug)}
              trigger={
                <Button variant={connected ? 'secondary' : 'primary'} className="h-11 sm:h-10">
                  <Plus /> {t('reviews.add')}
                </Button>
              }
            >
              <Field label={t('reviews.reviewer')} name="author">
                <Input id="author" name="author" />
              </Field>
              <Field label={t('reviews.rating')} name="rating">
                <Select id="rating" name="rating" defaultValue="5">
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {starsLabel(n)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('reviews.reviewText')} name="text">
                <Textarea id="text" name="text" dir="auto" />
              </Field>
            </FormSheet>
          </>
        }
      />
      <PageBody>
        {conn?.status === 'error' && (
          <div
            role="status"
            className="crm-card flex flex-wrap items-center gap-3 border-danger/30 bg-danger-soft text-sm text-danger"
          >
            <AlertCircle className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">{conn.lastError ?? t('reviews.signInExpired')}</span>
            {canReconnect ? (
              <Link
                href={appPath(`/${slug}/settings/integrations`)}
                className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline sm:min-h-0"
              >
                {t('reviews.reconnect')}
              </Link>
            ) : (
              <span className="font-medium">{t('reviews.askManager')}</span>
            )}
          </div>
        )}

        <Grid cols="g4">
          <Stat
            label={t('reviews.statRating')}
            value={
              <span className="inline-flex items-center gap-1.5">
                <span>{stats.count ? stats.average.toFixed(1) : '–'}</span>
                <Star className="size-5 text-warning" fill="currentColor" strokeWidth={1.5} aria-hidden />
              </span>
            }
            change={{ text: t('reviews.statRatingSub', { count: stats.count }) }}
          />
          <Stat
            label={t('reviews.statNew')}
            value={fmt.number(extra.fresh)}
            change={{ text: t('reviews.statNewSub', { count: stats.count }) }}
          />
          <Stat
            label={t('reviews.statAwaiting')}
            value={fmt.number(stats.needsReply)}
            change={{ text: t('reviews.statAwaitingSub', { count: extra.drafts }) }}
          />
          <Stat
            label={t('reviews.statRate')}
            value={fmt.percent(stats.responseRate / 100)}
            change={{ text: t('reviews.statRateSub') }}
          />
        </Grid>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-full overflow-x-auto">
            <Seg
              label={t('reviews.filterRating')}
              value={rating ? String(rating) : 'all'}
              items={[
                { value: 'all', label: t('reviews.allRatings'), href: href({ rating: null }) },
                ...[5, 4, 3, 2, 1].map((n) => ({
                  value: String(n),
                  href: href({ rating: n }),
                  label: (
                    <>
                      <span aria-hidden className="inline-flex items-center gap-0.5">
                        {n}
                        <Star className="size-3.5" fill="currentColor" strokeWidth={1.5} />
                      </span>
                      <span className="sr-only">{starsLabel(n)}</span>
                    </>
                  ),
                })),
              ]}
            />
          </div>
          <div className="max-w-full overflow-x-auto">
            <Seg
              label={t('reviews.filterStatus')}
              value={status ?? 'any'}
              items={[
                { value: 'any', label: t('reviews.anyStatus'), href: href({ status: null }) },
                ...(Object.keys(STATUS_FILTERS) as StatusFilter[]).map((k) => ({
                  value: k,
                  label: t(`reviews.filter.${k}`),
                  href: href({ status: k }),
                })),
              ]}
            />
          </div>
        </div>

        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Star className="size-5" />}
              title={rating || status ? t('reviews.emptyFiltered') : t('reviews.emptyTitle')}
              description={
                rating || status
                  ? t('reviews.emptyFilteredBody')
                  : connected
                    ? t('reviews.emptyConnected')
                    : t('reviews.emptyManual')
              }
              action={
                rating || status ? (
                  <Link
                    href={base}
                    className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                  >
                    {t('reviews.clearFilters')}
                  </Link>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <Stagger className="crm-grid crm-g2">
            {rows.map((r) => {
              const viaGoogle = isLocationReview(r.externalId, parent)
              const author = r.author ?? t('reviews.googleUser')
              return (
                <StaggerItem key={r.id}>
                  <Card as="article" className="flex h-full flex-col gap-3" data-testid="review">
                    <div className="flex items-start justify-between gap-3">
                      <TName name={author} sub={stars(r.rating, starsLabel(r.rating))} />
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <Pill tone={STATUS_TONE[r.replyStatus] ?? 'neutral'} dot>
                          {t(`reviews.status.${r.replyStatus}`)}
                        </Pill>
                        {r.reviewedAt && <span className="crm-muted text-xs">{fmt.date(r.reviewedAt)}</span>}
                      </span>
                    </div>
                    {r.text ? (
                      <p dir="auto" className="crm-muted whitespace-pre-line text-[15px] leading-relaxed">
                        {r.text}
                      </p>
                    ) : (
                      <p className="crm-muted text-sm italic">{t('reviews.ratingOnly')}</p>
                    )}
                    <div className="mt-auto border-t border-[var(--crm-line)] pt-3">
                      <ReplyEditor
                        key={`${r.replyStatus}:${r.replyText ?? ''}:${r.replyError ?? ''}`}
                        slug={slug}
                        mode={viaGoogle ? 'google' : 'manual'}
                        review={{
                          id: r.id,
                          replyText: r.replyText,
                          replyStatus: r.replyStatus,
                          replyError: r.replyError,
                        }}
                      />
                    </div>
                  </Card>
                </StaggerItem>
              )
            })}
          </Stagger>
        )}
      </PageBody>
    </>
  )
}

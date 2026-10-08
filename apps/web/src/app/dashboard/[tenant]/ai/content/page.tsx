import { enumLabel } from '@spa/core/i18n'
import { socialPosts, withTenant } from '@spa/db'
import {
  gbpConnectionView,
  getGbpAccount,
  instagramStatus,
  isPublishing,
  metaConfig,
  publicImageUrl,
} from '@spa/services'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { ArrowLeft, Image as ImageIcon, Sparkles } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BarChart, Card, Grid, Legend, Pill, Stat, statusTone } from '@/components/crm'
import { InstagramGlyph } from '@/components/inbox/icons'
import { GbpPostButton } from '@/components/integrations/gbp-post-button'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Checkbox, Textarea } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { draftPostAction } from '../actions'
import { PostActions } from './post-actions'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('marketing.title') }
}

type Agg = {
  scheduled: number
  next: string | null
  awaiting: number
  reviews: number
  avg: string | null
  clicks: number
}

export default async function ContentPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'ai.approve')) notFound()
  const slug = ctx.tenant.slug
  const reports = can(ctx, 'reports.view')
  const { t, fmt } = await getI18n()
  const { posts, ig, gbp, onGoogle, agg, sources } = await withTenant(ctx.tenant.id, async (tx) => {
    const posts = await tx.select().from(socialPosts).orderBy(desc(socialPosts.createdAt)).limit(30)
    // Captions already published as Google local posts (the same check publishGbpLocalPost makes).
    const copies = posts.length
      ? await tx
          .select({ caption: socialPosts.caption })
          .from(socialPosts)
          .where(
            and(
              eq(socialPosts.platform, 'gbp'),
              eq(socialPosts.status, 'published'),
              inArray(
                socialPosts.caption,
                posts.map((p) => p.caption),
              ),
            ),
          )
      : []
    // Marketing header stats (crm-spec §5.8) — cheap aggregates over existing tables.
    const [agg] = (
      await tx.execute(sql`select
        (select count(*)::int from social_posts where status = 'scheduled') as scheduled,
        (select min(scheduled_at)::text from social_posts where status = 'scheduled' and scheduled_at > now()) as next,
        (select count(*)::int from social_posts where status in ('draft', 'pending_approval')) as awaiting,
        (select count(*)::int from reviews) as reviews,
        (select round(avg(rating), 1)::text from reviews) as avg,
        (select count(*)::int from web_events where type in ('wa_click', 'booking_start')
          and ts >= now() - interval '30 days') as clicks`)
    ).rows as unknown as Agg[]
    const sources = reports
      ? ((
          await tx.execute(sql`select source::text as key, count(*)::int as n from bookings
            where created_at >= now() - interval '30 days' and status <> 'cancelled' group by 1 order by 2 desc`)
        ).rows as unknown as { key: string; n: number }[])
      : []
    return {
      posts,
      agg: agg!,
      sources,
      ig: await instagramStatus(tx),
      gbp: gbpConnectionView(await getGbpAccount(tx, ctx.tenant.id)),
      onGoogle: new Set(copies.map((c) => c.caption)),
    }
  })
  // Why "Publish to Instagram" can't run for a post (null = ready).
  const accountBlocker = !metaConfig()
    ? t('marketing.blockNotConfigured')
    : ig?.status !== 'connected'
      ? t('marketing.blockConnect')
      : null
  const publishBlocker = (p: (typeof posts)[number]) => {
    if (isPublishing(p)) return t('marketing.blockPublishing')
    if (accountBlocker) return accountBlocker
    if (!p.media[0]?.url) return t('marketing.blockNoImage')
    if (!publicImageUrl(p.media[0].url)) return t('marketing.blockPrivateImage')
    return null
  }
  const top = sources[0]
  return (
    <>
      <Link
        href={appPath(`/${slug}/ai`)}
        className="crm-muted mb-4 inline-flex items-center gap-1.5 text-sm transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4 rtl:rotate-180" strokeWidth={1.5} /> {t('ai.studio')}
      </Link>
      <PageHeader title={t('marketing.title')} description={t('marketing.description')} />
      <PageBody>
        <Grid cols="g4">
          <Stat
            label={t('marketing.statScheduled')}
            value={fmt.number(agg.scheduled)}
            change={{
              text: agg.next
                ? t('marketing.statNext', { when: fmt.dateTime(agg.next) })
                : t('marketing.statNoneNext'),
            }}
          />
          <Stat
            label={t('marketing.statAwaiting')}
            value={fmt.number(agg.awaiting)}
            change={{ text: t('marketing.statAwaitingSub') }}
          />
          <Stat
            label={t('marketing.statReviews')}
            value={fmt.number(agg.reviews)}
            change={
              agg.avg ? { text: t('marketing.statAvg', { avg: fmt.number(Number(agg.avg)) }) } : undefined
            }
          />
          <Stat
            label={t('marketing.statClicks')}
            value={fmt.number(agg.clicks)}
            change={{ text: t('marketing.statClicksSub') }}
          />
        </Grid>
        <div className={reports ? 'crm-grid crm-col-2' : undefined}>
          <Card title={t('marketing.newDraft')} sub={t('marketing.newDraftSub')}>
            <ActionForm action={draftPostAction.bind(null, slug)} className="grid gap-4" resetOnSuccess>
              <Field label={t('marketing.idea')} name="brief">
                <Textarea id="brief" name="brief" className="min-h-20" placeholder={t('marketing.ideaPh')} />
              </Field>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2.5 text-sm">
                  <Checkbox name="image" defaultChecked /> {t('marketing.createImage')}
                </label>
                <SubmitButton>
                  <Sparkles /> {t('marketing.draftPost')}
                </SubmitButton>
              </div>
            </ActionForm>
          </Card>
          {reports && (
            <Card title={t('marketing.sources')} sub={t('marketing.sourcesSub')}>
              {top ? (
                <>
                  <BarChart
                    label={t('marketing.sources')}
                    data={sources.map((r) => ({
                      label: enumLabel(t, 'bookingSource', r.key),
                      value: r.n,
                      hi: r.key === top.key,
                      title: t('marketing.bookingsCount', { count: r.n }),
                    }))}
                  />
                  <Legend
                    className="mt-3"
                    items={[
                      {
                        label: t('marketing.topSource'),
                        value: `${enumLabel(t, 'bookingSource', top.key)} · ${t('marketing.bookingsCount', { count: top.n })}`,
                      },
                    ]}
                  />
                </>
              ) : (
                <p className="crm-muted text-sm">{t('marketing.sourcesEmpty')}</p>
              )}
            </Card>
          )}
        </div>
        {posts.length === 0 ? (
          <Card>
            <EmptyState
              icon={<ImageIcon className="size-5" />}
              title={t('marketing.emptyTitle')}
              description={t('marketing.emptyBody')}
            />
          </Card>
        ) : (
          <Stagger className="crm-grid crm-g3">
            {posts.map((p) => (
              <StaggerItem key={p.id}>
                <Card as="article" flush className="flex h-full flex-col overflow-hidden">
                  {p.media[0] ? (
                    // biome-ignore lint/performance/noImgElement: remote AI image URL
                    <img
                      src={p.media[0].url}
                      alt={p.media[0].alt ?? ''}
                      className="aspect-square w-full bg-subtle object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="grid aspect-square place-items-center bg-subtle text-muted">
                      <ImageIcon className="size-6" strokeWidth={1.5} />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col gap-3 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5">
                        {isPublishing(p) ? (
                          <Pill tone="info" dot>
                            {t('marketing.publishing')}
                          </Pill>
                        ) : (
                          <Pill tone={p.status === 'pending_approval' ? 'warn' : statusTone(p.status)} dot>
                            {enumLabel(t, 'postStatus', p.status)}
                          </Pill>
                        )}
                        {p.platform === 'gbp' && <Pill>{t('marketing.google')}</Pill>}
                      </span>
                      <span className="crm-muted text-xs">
                        {p.scheduledAt
                          ? t('marketing.scheduledAt', { when: fmt.dateTime(p.scheduledAt) })
                          : fmt.dateTime(p.createdAt)}
                      </span>
                    </div>
                    <p
                      dir="auto"
                      className="line-clamp-[10] flex-1 whitespace-pre-wrap text-sm leading-relaxed"
                    >
                      {p.caption}
                    </p>
                    {p.status === 'failed' && p.error && !isPublishing(p) && (
                      <p className="rounded-lg bg-danger-soft px-3 py-2 text-[13px] text-danger">{p.error}</p>
                    )}
                    {p.status === 'published' && p.externalId && (
                      <p className="crm-muted flex items-center gap-1.5 text-[13px]">
                        <InstagramGlyph className="size-3.5" /> {t('marketing.publishedIg')}
                        {p.publishedAt ? ` · ${fmt.dateTime(p.publishedAt)}` : ''}
                      </p>
                    )}
                    {p.status === 'scheduled' && p.scheduledAt && !publishBlocker(p) && (
                      <p className="crm-muted text-[13px]">{t('marketing.autoPublish')}</p>
                    )}
                    <PostActions
                      slug={slug}
                      postId={p.id}
                      status={p.status}
                      caption={p.caption}
                      publishBlocker={
                        p.platform === 'instagram' ? publishBlocker(p) : t('marketing.blockNotIg')
                      }
                    />
                    {p.platform !== 'gbp' && onGoogle.has(p.caption) ? (
                      <Pill tone="ok" className="self-start">
                        {t('marketing.onGoogle')}
                      </Pill>
                    ) : (
                      gbp?.status === 'connected' &&
                      p.platform !== 'gbp' &&
                      (p.status === 'scheduled' || p.status === 'published') && (
                        <GbpPostButton slug={slug} postId={p.id} />
                      )
                    )}
                  </div>
                </Card>
              </StaggerItem>
            ))}
          </Stagger>
        )}
      </PageBody>
    </>
  )
}

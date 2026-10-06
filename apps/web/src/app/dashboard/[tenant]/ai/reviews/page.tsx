import { reviews, withTenant } from '@spa/db'
import {
  gbpConnectionView,
  getGbpAccount,
  googleConfig,
  isGoogleReviewName,
  reviewStats,
} from '@spa/services'
import { and, desc, eq, inArray, type SQL, sql } from 'drizzle-orm'
import { AlertCircle, ArrowLeft, Plus, Star } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { SyncGoogleButton } from '@/components/integrations/gbp-card-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select, Textarea } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { StatCard } from '@/components/ui/stat-card'
import { appPath } from '@/lib/paths'
import { cn, formatDate } from '@/lib/utils'
import { can, requireMember } from '@/server/access'
import { addReviewAction } from '../actions'
import { ReplyEditor } from './reply-editor'

export const metadata: Metadata = { title: 'Google reviews' }

const stars = (n: number) => (
  <span className="inline-flex gap-0.5 text-warning" role="img" aria-label={`${n} stars`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Star key={i} className="size-3.5" fill={i <= n ? 'currentColor' : 'none'} strokeWidth={1.5} />
    ))}
  </span>
)

const STATUS = {
  none: { label: 'Needs reply', tone: 'warning' },
  draft: { label: 'Draft', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'accent' },
  posted: { label: 'Posted', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
} as const

const STATUS_FILTERS = {
  open: { label: 'Needs reply', statuses: ['none', 'draft', 'failed'] },
  approved: { label: 'Approved', statuses: ['approved'] },
  posted: { label: 'Posted', statuses: ['posted'] },
  failed: { label: 'Failed', statuses: ['failed'] },
} as const
type StatusFilter = keyof typeof STATUS_FILTERS

/** Phones: one sideways-scrolling row bleeding to the screen edge; wider screens wrap. */
const FILTER_ROW =
  '-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0'

function Chip({
  href,
  active,
  label,
  children,
}: {
  href: string
  active: boolean
  label?: string
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? 'true' : undefined}
      scroll={false}
      className={cn(
        'inline-flex min-h-11 shrink-0 items-center gap-1 rounded-full border px-3.5 text-sm transition-colors sm:min-h-9',
        active
          ? 'border-accent bg-accent-soft font-medium text-accent'
          : 'text-muted hover:bg-subtle hover:text-fg',
      )}
    >
      {children}
    </Link>
  )
}

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
  if (status) where.push(inArray(reviews.replyStatus, [...STATUS_FILTERS[status].statuses]))
  const { conn, stats, rows } = await withTenant(ctx.tenant.id, async (tx) => ({
    conn: gbpConnectionView(await getGbpAccount(tx, ctx.tenant.id)),
    stats: await reviewStats(tx, ctx.tenant.id),
    rows: await tx
      .select()
      .from(reviews)
      .where(and(...where))
      .orderBy(sql`${reviews.reviewedAt} desc nulls last`, desc(reviews.createdAt))
      .limit(100),
  }))
  const connected = Boolean(conn?.hasLocation)
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

  return (
    <>
      <Link
        href={appPath(`/${slug}/ai`)}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" strokeWidth={1.5} /> AI studio
      </Link>
      <PageHeader
        title="Google reviews"
        description={
          connected
            ? `Synced from ${conn?.title ?? 'your Google Business Profile'} every two hours. Draft a reply with AI, approve it, then post it to Google.`
            : 'Until Google Business Profile is connected, paste new reviews here — the AI drafts a reply you can copy into Google.'
        }
        actions={
          <>
            {connected && googleConfig() && <SyncGoogleButton slug={slug} variant="primary" />}
            <FormSheet
              title="Add a review"
              action={addReviewAction.bind(null, slug)}
              trigger={
                <Button variant={connected ? 'secondary' : 'primary'} className="h-11 sm:h-10">
                  <Plus /> Add review
                </Button>
              }
            >
              <Field label="Reviewer" name="author">
                <Input id="author" name="author" />
              </Field>
              <Field label="Rating" name="rating">
                <Select id="rating" name="rating" defaultValue="5">
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n} stars
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Review text" name="text">
                <Textarea id="text" name="text" dir="auto" />
              </Field>
            </FormSheet>
          </>
        }
      />
      <PageBody>
        {conn?.status === 'error' && (
          <Card className="flex flex-wrap items-center gap-3 border-danger/30 bg-danger-soft p-4 text-sm text-danger sm:px-5">
            <AlertCircle className="size-4 shrink-0" strokeWidth={1.75} />
            <span className="min-w-0 flex-1">{conn.lastError ?? 'Google sign-in expired.'}</span>
            <Link
              href={appPath(`/${slug}/settings/integrations`)}
              className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline sm:min-h-0"
            >
              Reconnect
            </Link>
          </Card>
        )}

        <Stagger className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StaggerItem>
            <Card className="h-full p-5 sm:p-6">
              <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">Average rating</p>
              <p className="mt-3 flex items-center gap-2 text-[26px] font-semibold tracking-tight">
                <span className="tabular">{stats.count ? stats.average.toFixed(1) : '–'}</span>
                <Star className="size-5 text-warning" fill="currentColor" strokeWidth={1.5} />
              </p>
              <p className="mt-1 text-[13px] text-muted">Out of 5</p>
            </Card>
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Reviews" value={stats.count} format="int" hint="All time" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Response rate" value={stats.responseRate} format="pct" hint="Replies posted" />
          </StaggerItem>
          <StaggerItem>
            <StatCard label="Needs reply" value={stats.needsReply} format="int" hint="Not yet on Google" />
          </StaggerItem>
        </Stagger>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <nav aria-label="Filter by rating" className={FILTER_ROW}>
            <Chip href={href({ rating: null })} active={!rating}>
              All ratings
            </Chip>
            {[5, 4, 3, 2, 1].map((n) => (
              <Chip key={n} href={href({ rating: n })} active={rating === n} label={`${n} stars`}>
                {n}
                <Star className="size-3.5" fill="currentColor" strokeWidth={1.5} aria-hidden />
              </Chip>
            ))}
          </nav>
          <nav aria-label="Filter by reply status" className={FILTER_ROW}>
            <Chip href={href({ status: null })} active={!status}>
              Any status
            </Chip>
            {(Object.keys(STATUS_FILTERS) as StatusFilter[]).map((k) => (
              <Chip key={k} href={href({ status: k })} active={status === k}>
                {STATUS_FILTERS[k].label}
              </Chip>
            ))}
          </nav>
        </div>

        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Star className="size-5" />}
              title={rating || status ? 'No reviews match these filters' : 'No reviews yet'}
              description={
                rating || status
                  ? 'Try another rating or status.'
                  : connected
                    ? 'New Google reviews appear here after the next sync.'
                    : 'Add your latest Google reviews to draft replies.'
              }
              action={
                rating || status ? (
                  <Link
                    href={base}
                    className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                  >
                    Clear filters
                  </Link>
                ) : undefined
              }
            />
          </Card>
        ) : (
          <Stagger className="grid gap-4 lg:grid-cols-2">
            {rows.map((r) => {
              const s = STATUS[r.replyStatus]
              const viaGoogle = connected && isGoogleReviewName(r.externalId)
              return (
                <StaggerItem key={r.id}>
                  <Card className="flex h-full flex-col gap-4 p-5 sm:p-6" data-testid="review">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <p className="truncate font-medium">{r.author ?? 'Google user'}</p>
                        <div className="flex items-center gap-2">
                          {stars(r.rating)}
                          {r.reviewedAt && (
                            <span className="text-xs text-muted">{formatDate(r.reviewedAt)}</span>
                          )}
                        </div>
                      </div>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </div>
                    {r.text ? (
                      <p dir="auto" className="whitespace-pre-line text-[15px] leading-relaxed text-muted">
                        {r.text}
                      </p>
                    ) : (
                      <p className="text-sm italic text-muted">Rating only — no written review.</p>
                    )}
                    <div className="mt-auto border-t pt-4">
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

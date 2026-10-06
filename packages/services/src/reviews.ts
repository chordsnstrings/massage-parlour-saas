// Google reviews: sync from Business Profile (upsert by review name), AI drafts for new reviews, autopilot for 4–5★,
// posting approved replies, and summary stats. 1–3★ replies always wait for a person.
import { aiAgentSettings, reviews, type Tx, withTenant } from '@spa/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { type GbpOpts, gbpErrorMessage, gbpParent, setGbpSyncState, withGbpToken } from './gbp'
import { listGbpReviews, type MappedReview, mapGoogleReview, putGbpReply } from './integrations/google'

/** Lowest rating autopilot may answer on its own. */
export const AUTO_POST_MIN_RATING = 4
/** Google's limit for a reply. */
export const REPLY_MAX_BYTES = 4096

export const canAutoPost = (rating: number, mode: 'approve' | 'autopilot') =>
  mode === 'autopilot' && rating >= AUTO_POST_MIN_RATING

/** True for reviews that came from the Google API (manual fallback rows can't be answered through the API). */
export const isGoogleReviewName = (externalId: string) =>
  /^accounts\/[\w-]+\/locations\/[\w-]+\/reviews\/[\w-]+$/.test(externalId)

/**
 * Inserts new Google reviews and refreshes changed ones. A reply found on Google marks the review `posted` (a missing
 * one never downgrades ours: the list can lag right after a reply is posted). Returns the new reviews still waiting for a reply.
 */
export async function upsertGoogleReviews(tx: Tx, tenantId: string, items: MappedReview[]) {
  const created: { id: string; rating: number; reviewedAt: Date | null }[] = []
  let updated = 0
  if (!items.length) return { created, updated }
  const existing = await tx
    .select()
    .from(reviews)
    .where(
      and(
        eq(reviews.tenantId, tenantId),
        eq(reviews.source, 'google'),
        inArray(
          reviews.externalId,
          items.map((i) => i.externalId),
        ),
      ),
    )
  const byExt = new Map(existing.map((r) => [r.externalId, r]))
  const fresh = items.filter((i) => !byExt.has(i.externalId))
  for (let i = 0; i < fresh.length; i += 200) {
    const rows = await tx
      .insert(reviews)
      .values(
        fresh.slice(i, i + 200).map((r) => ({
          tenantId,
          source: 'google',
          externalId: r.externalId,
          author: r.author,
          rating: r.rating,
          text: r.text,
          reviewedAt: r.reviewedAt,
          replyText: r.replyText,
          replyStatus: r.replyText ? ('posted' as const) : ('none' as const),
          repliedAt: r.repliedAt,
        })),
      )
      .onConflictDoNothing()
      .returning({
        id: reviews.id,
        rating: reviews.rating,
        reviewedAt: reviews.reviewedAt,
        replyText: reviews.replyText,
      })
    for (const r of rows)
      if (!r.replyText) created.push({ id: r.id, rating: r.rating, reviewedAt: r.reviewedAt })
  }
  for (const r of items) {
    const ex = byExt.get(r.externalId)
    if (!ex) continue
    const set: Partial<typeof reviews.$inferInsert> = {}
    if (ex.author !== r.author) set.author = r.author
    if (ex.rating !== r.rating) set.rating = r.rating
    if (ex.text !== r.text) set.text = r.text
    if (r.reviewedAt && ex.reviewedAt?.getTime() !== r.reviewedAt.getTime()) set.reviewedAt = r.reviewedAt
    if (r.replyText) {
      if (ex.replyStatus !== 'posted' || ex.replyText !== r.replyText)
        Object.assign(set, {
          replyText: r.replyText,
          replyStatus: 'posted',
          repliedAt: r.repliedAt ?? ex.repliedAt,
          replyError: null,
        })
    }
    if (Object.keys(set).length) {
      await tx.update(reviews).set(set).where(eq(reviews.id, ex.id))
      updated++
    }
  }
  return { created, updated }
}

export type SyncResult =
  | {
      ok: true
      fetched: number
      created: number
      updated: number
      drafted: number
      posted: number
      failed: number
    }
  | { ok: false; error: string }

/**
 * Pulls every review of the connected location, upserts them and — when the review agent is on — drafts replies for
 * new ones (newest first, `maxDrafts` per run). Autopilot then posts 4–5★ replies; lower ratings wait for approval.
 * `draft` is the AI drafting function (the worker passes `draftReviewReply` from @spa/ai).
 */
export async function syncGbpReviews(
  opts: GbpOpts & { draft?: (reviewId: string) => Promise<unknown>; maxDrafts?: number },
): Promise<SyncResult> {
  const now = opts.now ?? new Date()
  let mapped: MappedReview[]
  try {
    const list = await withGbpToken(opts, (token, account) =>
      listGbpReviews(token, gbpParent(account), opts.fetch),
    )
    mapped = list.reviews.map(mapGoogleReview).filter((r): r is MappedReview => r !== null)
  } catch (e) {
    const error = gbpErrorMessage(e)
    await setGbpSyncState(opts, { lastError: error }).catch(() => {})
    return { ok: false, error }
  }
  const { created, updated } = await withTenant(
    opts.tenantId,
    (tx) => upsertGoogleReviews(tx, opts.tenantId, mapped),
    opts.db,
  )
  await setGbpSyncState(opts, { lastSyncAt: now, lastError: null })

  let drafted = 0
  let posted = 0
  let failed = 0
  const [agent] = await withTenant(
    opts.tenantId,
    (tx) =>
      tx
        .select({ enabled: aiAgentSettings.enabled, mode: aiAgentSettings.mode })
        .from(aiAgentSettings)
        .where(
          and(eq(aiAgentSettings.tenantId, opts.tenantId), eq(aiAgentSettings.agentKey, 'review_agent')),
        ),
    opts.db,
  )
  if (opts.draft && agent?.enabled) {
    const queue = [...created]
      .sort((a, b) => (b.reviewedAt?.getTime() ?? 0) - (a.reviewedAt?.getTime() ?? 0))
      .slice(0, opts.maxDrafts ?? 10)
    for (const r of queue) {
      try {
        await opts.draft(r.id)
        drafted++
      } catch {
        continue // AI unavailable / budget used up: staff can draft by hand
      }
      if (!canAutoPost(r.rating, agent.mode)) continue
      await withTenant(
        opts.tenantId,
        (tx) =>
          tx
            .update(reviews)
            .set({ replyStatus: 'approved' })
            .where(and(eq(reviews.id, r.id), eq(reviews.replyStatus, 'draft'))),
        opts.db,
      )
      const res = await postGbpReply({ ...opts, reviewId: r.id })
      if (res.ok) posted++
      else failed++
    }
  }
  return { ok: true, fetched: mapped.length, created: created.length, updated, drafted, posted, failed }
}

/** Posts an approved (or previously failed) reply to Google; the review ends `posted` or `failed` with the reason. */
export async function postGbpReply(
  opts: GbpOpts & { reviewId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = opts.now ?? new Date()
  const [review] = await withTenant(
    opts.tenantId,
    (tx) =>
      tx
        .select()
        .from(reviews)
        .where(and(eq(reviews.tenantId, opts.tenantId), eq(reviews.id, opts.reviewId))),
    opts.db,
  )
  if (!review) return { ok: false, error: 'Review not found.' }
  if (review.source !== 'google' || !isGoogleReviewName(review.externalId))
    return { ok: false, error: 'This review was added by hand — copy the reply into Google instead.' }
  const reply = review.replyText?.trim()
  if (!reply) return { ok: false, error: 'Write a reply first.' }
  if (review.replyStatus !== 'approved' && review.replyStatus !== 'failed')
    return { ok: false, error: 'Approve the reply before posting it.' }
  if (Buffer.byteLength(reply, 'utf8') > REPLY_MAX_BYTES)
    return { ok: false, error: 'The reply is too long for Google — please shorten it.' }

  const save = (set: Partial<typeof reviews.$inferInsert>) =>
    withTenant(opts.tenantId, (tx) => tx.update(reviews).set(set).where(eq(reviews.id, review.id)), opts.db)
  try {
    const res = await withGbpToken(opts, (token) => putGbpReply(token, review.externalId, reply, opts.fetch))
    await save({ replyStatus: 'posted', repliedAt: res.updateTime ?? now, replyError: null })
    return { ok: true }
  } catch (e) {
    const error = gbpErrorMessage(e)
    await save({ replyStatus: 'failed', replyError: error })
    return { ok: false, error }
  }
}

export type ReviewStats = {
  count: number
  average: number
  /** Share of reviews with a reply posted on Google (0–100). */
  responseRate: number
  needsReply: number
}

/** Count, average rating, response rate and open replies over all of a spa's reviews. */
export async function reviewStats(tx: Tx, tenantId: string): Promise<ReviewStats> {
  const [r] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      average: sql<number>`coalesce(avg(${reviews.rating}), 0)::float8`,
      replied: sql<number>`(count(*) filter (where ${reviews.replyStatus} = 'posted'))::int`,
    })
    .from(reviews)
    .where(eq(reviews.tenantId, tenantId))
  const count = r?.count ?? 0
  const replied = r?.replied ?? 0
  return {
    count,
    average: Math.round((r?.average ?? 0) * 10) / 10,
    responseRate: count ? Math.round((replied / count) * 100) : 0,
    needsReply: count - replied,
  }
}

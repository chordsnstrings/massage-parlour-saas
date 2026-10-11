// Google reviews: sync from Business Profile (upsert by review name), AI drafts for new reviews, autopilot for 4–5★,
// posting approved replies, and summary stats. 1–3★ replies always wait for a person.
import { aiAgentSettings, reviews, type Tx, withTenant } from '@spa/db'
import { and, desc, eq, gte, inArray, isNull, like, sql } from 'drizzle-orm'
import {
  GBP_PENDING_ID,
  type GbpAccountRow,
  type GbpOpts,
  gbpErrorMessage,
  gbpParent,
  getGbpAccount,
  setGbpSyncState,
  withGbpToken,
} from './gbp'
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
 * True for a review of the connected location (`accounts/{a}/locations/{l}`). Reviews of a previously connected
 * location are history: their replies can't go through the API any more.
 */
export const isLocationReview = (externalId: string, parent: string | null | undefined) =>
  Boolean(parent) && externalId.startsWith(`${parent}/reviews/`) && isGoogleReviewName(externalId)

/** The connected location's parent, or null while none is chosen. */
const locationParent = (row: GbpAccountRow | null) => {
  const m = row?.meta
  return row && row.externalId !== GBP_PENDING_ID && m?.accountName && m.locationName
    ? `${m.accountName}/${m.locationName}`
    : null
}

/** Reviews written on Google before the location was chosen are history: no AI drafts, no autopilot. */
const draftCutoff = (row: GbpAccountRow) => {
  const t = Date.parse(row.meta?.importedAt ?? '')
  return Number.isNaN(t) ? row.createdAt : new Date(t)
}

const likePrefix = (s: string) => `${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/**
 * Inserts new Google reviews and refreshes changed ones. A reply found on Google marks the review `posted` (a missing
 * one never downgrades ours: the list can lag right after a reply is posted), except over a different reply a person
 * approved here or whose post failed — that one is still to be posted. `created` counts new reviews without a reply.
 */
export async function upsertGoogleReviews(tx: Tx, tenantId: string, items: MappedReview[]) {
  let created = 0
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
      .returning({ replyText: reviews.replyText })
    created += rows.filter((r) => !r.replyText).length
  }
  for (const r of items) {
    const ex = byExt.get(r.externalId)
    if (!ex) continue
    const set: Partial<typeof reviews.$inferInsert> = {}
    if (ex.author !== r.author) set.author = r.author
    if (ex.rating !== r.rating) set.rating = r.rating
    if (ex.text !== r.text) set.text = r.text
    if (r.reviewedAt && ex.reviewedAt?.getTime() !== r.reviewedAt.getTime()) set.reviewedAt = r.reviewedAt
    const pendingHere =
      (ex.replyStatus === 'approved' || ex.replyStatus === 'failed') &&
      Boolean(ex.replyText) &&
      ex.replyText !== r.replyText
    if (r.replyText && !pendingHere) {
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
 * unanswered ones written since the location was chosen (newest first, `maxDrafts` per run). The queue comes from the
 * stored rows, so reviews whose draft failed or didn't fit this run are picked up by the next one. Autopilot then posts
 * 4–5★ replies; lower ratings wait for approval. `draft` is the AI drafting function (the worker passes
 * `draftReviewReply` from @spa/ai).
 */
export async function syncGbpReviews(
  opts: GbpOpts & { draft?: (reviewId: string) => Promise<unknown>; maxDrafts?: number },
): Promise<SyncResult> {
  const now = opts.now ?? new Date()
  let mapped: MappedReview[]
  let parent: string
  let cutoff: Date
  try {
    const res = await withGbpToken(opts, async (token, account) => ({
      parent: gbpParent(account),
      cutoff: draftCutoff(account),
      list: await listGbpReviews(token, gbpParent(account), opts.fetch),
    }))
    ;({ parent, cutoff } = res)
    mapped = res.list.reviews.map(mapGoogleReview).filter((r): r is MappedReview => r !== null)
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
    const queue = await withTenant(
      opts.tenantId,
      (tx) =>
        tx
          .select({ id: reviews.id, rating: reviews.rating })
          .from(reviews)
          .where(
            and(
              eq(reviews.tenantId, opts.tenantId),
              eq(reviews.source, 'google'),
              like(reviews.externalId, likePrefix(`${parent}/reviews/`)),
              eq(reviews.replyStatus, 'none'),
              isNull(reviews.replyText),
              gte(reviews.reviewedAt, cutoff),
            ),
          )
          .orderBy(desc(reviews.reviewedAt))
          .limit(opts.maxDrafts ?? 10),
      opts.db,
    )
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
  return { ok: true, fetched: mapped.length, created, updated, drafted, posted, failed }
}

/** Posts an approved (or previously failed) reply to Google; the review ends `posted` or `failed` with the reason. */
export async function postGbpReply(
  opts: GbpOpts & { reviewId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const now = opts.now ?? new Date()
  const { review, parent } = await withTenant(
    opts.tenantId,
    async (tx) => {
      const [review] = await tx
        .select()
        .from(reviews)
        .where(and(eq(reviews.tenantId, opts.tenantId), eq(reviews.id, opts.reviewId)))
      return { review, parent: locationParent(await getGbpAccount(tx, opts.tenantId)) }
    },
    opts.db,
  )
  if (!review) return { ok: false, error: 'Review not found.' }
  if (review.source !== 'google' || !isGoogleReviewName(review.externalId))
    return { ok: false, error: 'This review was added by hand — copy the reply into Google instead.' }
  if (parent && !isLocationReview(review.externalId, parent))
    return {
      ok: false,
      error: 'This review belongs to a Google location that is no longer connected — reply to it on Google.',
    }
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

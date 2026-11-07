// F15 Reviews + Instagram feed site blocks: read what the spa already has stored — Google reviews synced from
// Google Business (reviews.ts) and the Instagram posts published through the dashboard (social_posts). No API calls
// at render time. Premium feature `marketing` (PLAN §18.8): the caller checks the entitlement first.
import { reviews, socialAccounts, socialPosts, type Tx } from '@spa/db'
import { and, desc, eq, gte, isNotNull, ne, sql } from 'drizzle-orm'

export type SiteReviewItem = {
  id: string
  author: string
  rating: number
  text: string
  reviewedAt: Date | null
}
export type SiteReviews = { average: number; count: number; items: SiteReviewItem[] }

/** First name + initial ("Layla M."), so a site never shows more of a reviewer's name than needed. */
export function reviewerName(author: string | null | undefined): string {
  const parts = (author ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'Google user'
  const [first, ...rest] = parts
  const last = rest.at(-1)
  return last ? `${first} ${[...last][0]!.toUpperCase()}.` : first!
}

/**
 * Google reviews for the site: average + count over all synced Google reviews, and the newest `limit` reviews with
 * text rated at least `minRating`.
 */
export async function siteReviews(
  tx: Tx,
  opts: { limit?: number; minRating?: number } = {},
): Promise<SiteReviews> {
  const [stats] = await tx
    .select({
      count: sql<number>`count(*)::int`,
      average: sql<number>`coalesce(avg(${reviews.rating}), 0)::float8`,
    })
    .from(reviews)
    .where(eq(reviews.source, 'google'))
  const rows = await tx
    .select({
      id: reviews.id,
      author: reviews.author,
      rating: reviews.rating,
      text: reviews.text,
      reviewedAt: reviews.reviewedAt,
    })
    .from(reviews)
    .where(
      and(
        eq(reviews.source, 'google'),
        gte(reviews.rating, Math.min(5, Math.max(1, opts.minRating ?? 4))),
        isNotNull(reviews.text),
        sql`btrim(${reviews.text}) <> ''`,
      ),
    )
    .orderBy(desc(sql`coalesce(${reviews.reviewedAt}, ${reviews.createdAt})`))
    .limit(Math.min(Math.max(opts.limit ?? 6, 1), 12))
  return {
    average: Math.round((stats?.average ?? 0) * 10) / 10,
    count: stats?.count ?? 0,
    items: rows.map((r) => ({
      id: r.id,
      author: reviewerName(r.author),
      rating: r.rating,
      text: (r.text ?? '').trim().slice(0, 600),
      reviewedAt: r.reviewedAt,
    })),
  }
}

export type SiteInstagramItem = { id: string; image: string; caption: string }
export type SiteInstagram = { username: string | null; profileUrl: string | null; items: SiteInstagramItem[] }

const IG_USERNAME = /^[A-Za-z0-9._]{1,30}$/
/** Images the feed may show: our own library files or https links (never data:/javascript:). */
const IMAGE = /^(?:\/files\/[0-9a-f-]{36}|https:\/\/[^\s"'<>`\\]{1,1500})$/i

/** The connected Instagram account + its newest posts published from the dashboard (first picture each). */
export async function siteInstagram(tx: Tx, opts: { limit?: number } = {}): Promise<SiteInstagram> {
  const [account] = await tx
    .select({ username: socialAccounts.username })
    .from(socialAccounts)
    .where(and(eq(socialAccounts.platform, 'instagram'), ne(socialAccounts.status, 'disconnected')))
    .limit(1)
  const handle = account?.username?.replace(/^@/, '') ?? ''
  const username = IG_USERNAME.test(handle) ? handle : null
  const posts = await tx
    .select({ id: socialPosts.id, media: socialPosts.media, caption: socialPosts.caption })
    .from(socialPosts)
    .where(and(eq(socialPosts.platform, 'instagram'), eq(socialPosts.status, 'published')))
    .orderBy(desc(sql`coalesce(${socialPosts.publishedAt}, ${socialPosts.createdAt})`))
    .limit(48)
  const items: SiteInstagramItem[] = []
  for (const p of posts) {
    const raw = p.media?.[0]?.url ?? ''
    // Library files are stored as absolute app URLs (`https://app…/files/{id}?f=jpg`); keep them as is.
    if (!IMAGE.test(raw)) continue
    items.push({ id: p.id, image: raw, caption: p.caption.trim().slice(0, 200) })
    if (items.length >= Math.min(Math.max(opts.limit ?? 6, 1), 12)) break
  }
  return {
    username,
    profileUrl: username ? `https://www.instagram.com/${username}/` : null,
    items,
  }
}

// Editor analytics overlay (PLAN §11.6 P2): per-block reach and clicks from the cookieless tracker.
import { type Tx, webEvents } from '@spa/db'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'

export type BlockStat = { seen: number; seenPct: number; clicks: number }
export type PageBlockStats = { sessions: number; days: number; blocks: Record<string, BlockStat> }

const CLICK_TYPES = ['click', 'wa_click', 'ig_click', 'booking_start'] as const

/**
 * Public paths a page is served at: `/{slug}` on a subdomain or custom domain, `/s/{tenant}/{slug}` with
 * path routing (home = `/` or `/s/{tenant}`).
 */
export function pagePaths(tenantSlug: string, pageSlug: string): string[] {
  const tail = pageSlug ? `/${pageSlug}` : ''
  const paths = [tail || '/', `/s/${tenantSlug}${tail}`]
  if (!pageSlug) paths.push(`/s/${tenantSlug}/`)
  return paths
}

/**
 * Sessions that viewed the page in the last `days` and, per top-level block (`data-block-id` = Puck id),
 * how many of them saw it and how many clicks it got.
 */
export async function pageBlockStats(
  tx: Tx,
  input: { tenantId: string; paths: string[]; blockIds: string[]; days?: number; now?: Date },
): Promise<PageBlockStats> {
  const days = input.days ?? 30
  const since = new Date((input.now ?? new Date()).getTime() - days * 86_400_000)
  const [page] = await tx
    .select({ sessions: sql<number>`count(distinct ${webEvents.sessionHash})::int` })
    .from(webEvents)
    .where(
      and(
        eq(webEvents.tenantId, input.tenantId),
        gte(webEvents.ts, since),
        eq(webEvents.type, 'pageview'),
        inArray(webEvents.path, input.paths.length ? input.paths : ['/']),
      ),
    )
  const ids = input.blockIds.filter(Boolean).slice(0, 200)
  const rows = ids.length
    ? await tx
        .select({
          blockId: webEvents.blockId,
          seen: sql<number>`count(distinct ${webEvents.sessionHash}) filter (where ${webEvents.type} = 'block_view')::int`,
          clicks: sql<number>`count(*) filter (where ${webEvents.type} in (${sql.join(
            CLICK_TYPES.map((t) => sql`${t}`),
            sql`, `,
          )}))::int`,
        })
        .from(webEvents)
        .where(
          and(
            eq(webEvents.tenantId, input.tenantId),
            gte(webEvents.ts, since),
            inArray(webEvents.blockId, ids),
          ),
        )
        .groupBy(webEvents.blockId)
    : []
  const sessions = page?.sessions ?? 0
  const blocks: Record<string, BlockStat> = {}
  for (const r of rows) {
    if (!r.blockId) continue
    // A block can be seen in more sessions than recorded pageviews (e.g. tracker loaded late): cap at 100%.
    const denominator = Math.max(sessions, r.seen, 1)
    blocks[r.blockId] = {
      seen: r.seen,
      seenPct: Math.round((r.seen / denominator) * 100),
      clicks: r.clicks,
    }
  }
  return { sessions, days, blocks }
}

// Postgres-backed fixed-window rate limit (no Redis, PLAN §2): one row per key, counted atomically by an upsert.
import { type DbOrTx, rateLimits } from '@spa/db'
import { lt, sql } from 'drizzle-orm'

/**
 * Counts one hit for `key` and says whether it is still within `max` hits per `windowSec`. A new window starts with
 * the first hit after the previous one ran out. Platform role only (the table is invisible to spa roles).
 */
export async function hitRateLimit(db: DbOrTx, key: string, max: number, windowSec: number) {
  const expired = sql`${rateLimits.windowStart} <= now() - make_interval(secs => ${windowSec})`
  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`case when ${expired} then 1 else ${rateLimits.count} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ count: rateLimits.count })
  // Keep the table small: windows older than a day are never read again.
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, sql`now() - interval '1 day'`))
  const count = row?.count ?? 1
  return { allowed: count <= max, count }
}

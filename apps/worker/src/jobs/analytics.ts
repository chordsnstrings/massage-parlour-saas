import { platformDb } from '@spa/db'
import { sql } from 'drizzle-orm'

/**
 * Recomputes web_daily_stats for the last two Dubai days from raw events (idempotent upserts):
 * page views, block views/clicks, sources (sessions + bookings) and the booking funnel.
 */
export async function rollupAnalytics() {
  const db = platformDb()
  const since = sql`(date_trunc('day', now() at time zone 'Asia/Dubai') - interval '1 day') at time zone 'Asia/Dubai'`
  const day = sql`(e.ts at time zone 'Asia/Dubai')::date`
  const upsert = sql`on conflict (tenant_id, day, dimension, key) do update set views = excluded.views, clicks = excluded.clicks, sessions = excluded.sessions, conversions = excluded.conversions`
  await db.execute(sql`insert into web_daily_stats (tenant_id, day, dimension, key, views, clicks, sessions, conversions)
    select e.tenant_id, ${day}, 'page', e.path, count(*) filter (where e.type = 'pageview'), count(*) filter (where e.type <> 'pageview' and e.type <> 'block_view'),
      count(distinct e.session_hash), count(*) filter (where e.type = 'booking_complete')
    from web_events e where e.ts >= ${since} group by 1, 2, 4 ${upsert}`)
  await db.execute(sql`insert into web_daily_stats (tenant_id, day, dimension, key, views, clicks, sessions, conversions)
    select e.tenant_id, ${day}, 'block', e.block_id || '|' || coalesce(e.block_type, ''), count(*) filter (where e.type = 'block_view'),
      count(*) filter (where e.type not in ('block_view', 'pageview')), count(distinct e.session_hash), count(*) filter (where e.type in ('booking_start', 'wa_click'))
    from web_events e where e.ts >= ${since} and e.block_id is not null group by 1, 2, 4 ${upsert}`)
  await db.execute(sql`insert into web_daily_stats (tenant_id, day, dimension, key, views, clicks, sessions, conversions)
    select e.tenant_id, ${day}, 'source', entry.src, count(*) filter (where e.type = 'pageview'), count(*) filter (where e.type in ('wa_click', 'ig_click')),
      count(distinct e.session_hash), count(*) filter (where e.type = 'booking_complete')
    from web_events e join (select distinct on (tenant_id, session_hash) tenant_id, session_hash, coalesce(source, 'direct') as src
      from web_events where ts >= ${since} order by tenant_id, session_hash, ts) entry using (tenant_id, session_hash)
    where e.ts >= ${since} group by 1, 2, 4 ${upsert}`)
  await db.execute(sql`insert into web_daily_stats (tenant_id, day, dimension, key, views, clicks, sessions, conversions)
    select e.tenant_id, ${day}, 'funnel', e.type, count(*), 0, count(distinct e.session_hash), 0
    from web_events e where e.ts >= ${since} and e.type in ('pageview', 'booking_start', 'booking_complete', 'wa_click') group by 1, 2, 4 ${upsert}`)
}

/** Raw events are kept for 90 days; daily rollups are kept. */
export async function pruneAnalytics() {
  await platformDb().execute(sql`delete from web_events where ts < now() - interval '90 days'`)
}

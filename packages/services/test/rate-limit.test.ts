// Postgres-backed fixed-window limit behind "Apply for your spa" (per IP; no Redis).
import { closeAllDbs, rateLimits, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hitRateLimit } from '../src'

const { platform, app } = testDbs()

beforeAll(resetTestDatabase)
afterAll(closeAllDbs)

describe('hitRateLimit', () => {
  it('allows max hits per window, per key, and starts a new window once it ran out', async () => {
    const hit = (key: string) => hitRateLimit(platform, key, 2, 3600)
    expect(await hit('signup:ip:1.2.3.4')).toEqual({ allowed: true, count: 1 })
    expect(await hit('signup:ip:1.2.3.4')).toEqual({ allowed: true, count: 2 })
    expect(await hit('signup:ip:1.2.3.4')).toEqual({ allowed: false, count: 3 })
    expect((await hit('signup:ip:5.6.7.8')).allowed).toBe(true)
    // The window ran out an hour later: counting starts again.
    await platform
      .update(rateLimits)
      .set({ windowStart: sql`now() - interval '61 minutes'` })
      .where(eq(rateLimits.key, 'signup:ip:1.2.3.4'))
    expect(await hit('signup:ip:1.2.3.4')).toEqual({ allowed: true, count: 1 })
  })

  it('counts concurrent hits exactly (one atomic upsert)', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => hitRateLimit(platform, 'burst', 5, 60)),
    )
    expect(results.filter((r) => r.allowed)).toHaveLength(5)
    expect(results.map((r) => r.count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('is platform-only: a spa role sees no counters', async () => {
    const rows = await withTenant(
      '00000000-0000-4000-8000-000000000000',
      (tx) => tx.select().from(rateLimits),
      app,
    )
    expect(rows).toEqual([])
  })
})

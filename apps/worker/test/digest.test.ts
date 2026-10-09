import { bookings, branches, closeAllDbs, notifications, tenants } from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dailyDigest, weeklyInsights } from '../src/jobs/engage'

vi.mock('@spa/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@spa/ai')>()),
  aiConfigured: () => true,
  generateInsights: vi.fn(async () => ({ output: { insights: [{ title: 'Fridays are busiest' }] } })),
}))

const { owner } = testDbs()
// Thu 8 Oct 2026, 09:30 Dubai.
const now = new Date('2026-10-08T05:30:00Z')
const rows = (tenantId: string) =>
  owner.select().from(notifications).where(eq(notifications.tenantId, tenantId))

describe('digest bell rows (weekly insights + daily digest)', () => {
  let on: string
  let off: string
  beforeAll(async () => {
    process.env.DATABASE_URL_PLATFORM = testUrls.platform
    process.env.DATABASE_URL_APP = testUrls.app
    await resetTestDatabase()
    const [a] = await owner.insert(tenants).values({ slug: 'dig-on', name: 'On' }).returning()
    const [b] = await owner
      .insert(tenants)
      .values({
        slug: 'dig-off',
        name: 'Off',
        settings: { automations: { dailyDigest: false, weeklyInsights: false } },
      })
      .returning()
    on = a!.id
    off = b!.id
    for (const tid of [on, off]) {
      const [br] = await owner
        .insert(branches)
        .values({ tenantId: tid, name: 'Main', isDefault: true })
        .returning()
      for (const [i, status] of (['pending', 'confirmed', 'cancelled'] as const).entries())
        await owner.insert(bookings).values({
          tenantId: tid,
          branchId: br!.id,
          refCode: `D${i}${tid.slice(0, 4)}`,
          source: 'phone',
          status,
          businessDate: '2026-10-08',
          startsAt: new Date('2026-10-08T10:00:00Z'),
          endsAt: new Date('2026-10-08T11:00:00Z'),
        })
    }
  }, 60_000)
  afterAll(closeAllDbs)

  it('daily digest: one row per business day with counts, none for a switched-off spa', async () => {
    await dailyDigest(now)
    await dailyDigest(now) // same day → deduped
    const list = await rows(on)
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      kind: 'daily_digest',
      permission: 'calendar.manage',
      dedupeKey: 'daily_digest:2026-10-08',
      payload: {
        url: '/dig-on',
        params: { count: 2, detail: { key: 'notifications.digest.pending', params: { count: 1 } } },
      },
    })
    expect(await rows(off)).toHaveLength(0)
  })

  it('weekly insights: one row per week with the headline', async () => {
    await weeklyInsights(now)
    await weeklyInsights(new Date('2026-10-09T05:30:00Z')) // same week → deduped
    const list = (await rows(on)).filter((r) => r.kind === 'weekly_insights')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      permission: 'reports.view',
      dedupeKey: 'weekly_insights:2026-10-05',
      payload: { url: '/dig-on', params: { headline: 'Fridays are busiest' } },
    })
    expect(await rows(off)).toHaveLength(0)
  })
})

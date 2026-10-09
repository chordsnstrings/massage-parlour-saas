import { closeAllDbs, jobRuns, tenants } from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { autoAssignDueOutbox, expirePackages } from '@spa/services'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dailyDigest } from '../src/jobs/engage'
import { autoAssignOutbox, expireAllPackages } from '../src/jobs/tenant-jobs'

vi.mock('@spa/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@spa/services')>()),
  expirePackages: vi.fn(async () => 2),
  autoAssignDueOutbox: vi.fn(async () => 3),
  pushConfigured: () => true,
  notifyTenant: vi.fn(async () => ({ sent: 0 })),
}))

const { owner } = testDbs()
const runsOf = (tenantId: string) => owner.select().from(jobRuns).where(eq(jobRuns.tenantId, tenantId))

describe('automation switches (B3) in worker jobs', () => {
  let on: string
  let off: string
  beforeAll(async () => {
    process.env.DATABASE_URL_PLATFORM = testUrls.platform
    process.env.DATABASE_URL_APP = testUrls.app
    await resetTestDatabase()
    const [a] = await owner.insert(tenants).values({ slug: 'auto-on', name: 'On' }).returning()
    const [b] = await owner
      .insert(tenants)
      .values({
        slug: 'auto-off',
        name: 'Off',
        settings: { automations: { packageExpiry: false, dailyDigest: false } },
      })
      .returning()
    on = a!.id
    off = b!.id
  }, 60_000)
  afterAll(closeAllDbs)

  it('packages-expire skips a switched-off spa and logs the run for the others', async () => {
    await expireAllPackages()
    const spy = vi.mocked(expirePackages)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![1]).toBe(on)
    expect(await runsOf(off)).toHaveLength(0)
    const [run] = await runsOf(on)
    expect(run).toMatchObject({ job: 'packages-expire', status: 'ok', summary: { count: 2 } })
  })

  it('outbox auto-assign runs only for spas that switched it on (off by default)', async () => {
    await owner
      .update(tenants)
      .set({ settings: { automations: { packageExpiry: false, dailyDigest: false, outboxAutoAssign: true } } })
      .where(eq(tenants.id, off))
    await autoAssignOutbox()
    const spy = vi.mocked(autoAssignDueOutbox)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![1]).toBe(off)
    expect((await runsOf(off)).map((r) => r.job)).toEqual(['outbox-auto-assign'])
    await owner
      .update(tenants)
      .set({ settings: { automations: { packageExpiry: false, dailyDigest: false } } })
      .where(eq(tenants.id, off))
    await owner.delete(jobRuns).where(eq(jobRuns.tenantId, off))
  })

  it('daily-digest skips a switched-off spa', async () => {
    await dailyDigest()
    expect((await runsOf(on)).map((r) => r.job)).toContain('daily-digest')
    expect(await runsOf(off)).toHaveLength(0)
  })
})

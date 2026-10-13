import { draftReviewReply } from '@spa/ai'
import { REVIEW_REPLIES_LIVE } from '@spa/core'
import { closeAllDbs, socialAccounts, tenants } from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { syncGbpReviews } from '@spa/services'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { syncAllGbpReviews } from '../src/jobs/gbp'

vi.mock('@spa/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@spa/ai')>()),
  draftReviewReply: vi.fn(async () => 'Thank you!'),
}))
vi.mock('@spa/services', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@spa/services')>()),
  integrationEnv: vi.fn(async () => ({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })),
  syncGbpReviews: vi.fn(async () => ({
    ok: true as const,
    fetched: 1,
    created: 1,
    updated: 0,
    removed: 0,
    drafted: 0,
    posted: 0,
    failed: 0,
  })),
}))

const { owner } = testDbs()

describe('gbp-reviews-sync job while review replies are dropped (owner 2026-10-13)', () => {
  let tenantId: string
  beforeAll(async () => {
    process.env.DATABASE_URL_PLATFORM = testUrls.platform
    process.env.DATABASE_URL_APP = testUrls.app
    await resetTestDatabase()
    const [t] = await owner.insert(tenants).values({ slug: 'gbp-job', name: 'GBP job' }).returning()
    tenantId = t!.id
    await owner.insert(socialAccounts).values({
      tenantId,
      platform: 'gbp',
      externalId: 'locations/222',
      username: 'GBP job',
      tokenEnc: 'fake-token',
      meta: { accountName: 'accounts/111', locationName: 'locations/222', title: 'GBP job' },
    })
  }, 60_000)
  afterAll(closeAllDbs)

  it('still reads reviews but hands the sync no AI drafter (no drafts, no autopilot)', async () => {
    expect(REVIEW_REPLIES_LIVE).toBe(false)
    expect(await syncAllGbpReviews()).toEqual({ tenants: 1, synced: 1 })
    const spy = vi.mocked(syncGbpReviews)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toMatchObject({ tenantId, draft: undefined })
    expect(spy.mock.calls[0]![0]).not.toHaveProperty('repliesLive')
    expect(vi.mocked(draftReviewReply)).not.toHaveBeenCalled()
  })
})

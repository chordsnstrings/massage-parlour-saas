import { queueSlotOffers } from '@spa/ai'
import { aiAgentSettings, branches, closeAllDbs, outbox, tenants } from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { runSlotFiller } from '../src/jobs/tenant-jobs'

vi.mock('@spa/ai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@spa/ai')>()),
  queueSlotOffers: vi.fn(async () => 0),
}))

const { owner } = testDbs()
const spy = vi.mocked(queueSlotOffers)

/** An enabled-slot-filler spa with a default branch. */
async function seedSpa(slug: string) {
  const [t] = await owner.insert(tenants).values({ slug, name: slug }).returning()
  const [b] = await owner
    .insert(branches)
    .values({ tenantId: t!.id, name: 'Main', isDefault: true })
    .returning()
  await owner.insert(aiAgentSettings).values({ tenantId: t!.id, agentKey: 'slot_filler', enabled: true })
  return { tenantId: t!.id, branchId: b!.id }
}
const offerToday = (s: { tenantId: string; branchId: string }) =>
  owner.insert(outbox).values({ ...s, kind: 'slot_offer', phoneE164: '+971500000000', text: 'Offer' })

describe('runSlotFiller (worker job)', () => {
  let a: { tenantId: string; branchId: string }
  beforeAll(async () => {
    process.env.DATABASE_URL_PLATFORM = testUrls.platform
    process.env.DATABASE_URL_APP = testUrls.app
    await resetTestDatabase()
    a = await seedSpa('slot-a')
  }, 60_000)
  beforeEach(() => {
    spy.mockClear()
  })
  afterAll(closeAllDbs)

  it('queues offers for the default branch when none went out today', async () => {
    await runSlotFiller()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ tenantId: a.tenantId, branchId: a.branchId })
  })

  it("another spa's offer today does not suppress this spa (RLS-scoped read)", async () => {
    const b = await seedSpa('slot-b')
    await offerToday(b)
    await runSlotFiller()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ tenantId: a.tenantId, branchId: a.branchId })
  })

  it('skips a spa that already sent a slot offer today', async () => {
    await offerToday(a)
    await runSlotFiller()
    expect(spy).not.toHaveBeenCalled()
  })
})

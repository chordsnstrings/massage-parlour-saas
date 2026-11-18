// R19 (owner 2026-10-10): Delete on Console → Plans & prices. An unused plan is deleted; a plan spas (or
// applications) point at is archived — hidden from new spas, those spas keep plan, price and entitlements — and can
// be restored (still inactive). Built-in plans are always archived (the deploy seed would add a deleted one back).
// The last plan new spas can get is never removed; the checks hold under concurrency.
import { closeAllDbs, plans, spaApplications, subscriptions, tenants, user } from '@spa/db'
import { seedPlatform } from '@spa/db/seed'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acceptApplication,
  offeredPlans,
  planByCode,
  planUsage,
  removePlan,
  restorePlan,
  tenantEntitlements,
} from '../src'

const { platform } = testDbs()
const remove = (id: string) => platform.transaction((tx) => removePlan(tx, id))
const restore = (id: string) => platform.transaction((tx) => restorePlan(tx, id))
const planRow = async (id: string) => (await platform.select().from(plans).where(eq(plans.id, id)))[0]

async function newPlan(code: string, extra: Partial<typeof plans.$inferInsert> = {}) {
  const [row] = await platform
    .insert(plans)
    .values({ code, name: `Plan ${code}`, priceAed: '12000', billingInterval: 'month', ...extra })
    .returning()
  return row!
}

const application = (
  userId: string,
  slug: string,
  planId: string,
  status: 'pending' | 'rejected' = 'pending',
) =>
  platform
    .insert(spaApplications)
    .values({
      userId,
      applicantName: 'Applicant',
      email: `${userId}@plans.test`,
      phone: '+971501234567',
      spaName: `Spa ${slug}`,
      slug,
      emirate: 'dubai',
      streetAddress: 'Street 1',
      planId,
      preferredStart: '2026-11-01',
      status,
    })
    .returning()
    .then((r) => r[0]!)

async function spaOn(slug: string, planId: string, subscriptionPlanId: string | null = planId) {
  const [t] = await platform
    .insert(tenants)
    .values({ slug, name: `Spa ${slug}`, planId })
    .returning()
  if (subscriptionPlanId)
    await platform.insert(subscriptions).values({
      tenantId: t!.id,
      planId: subscriptionPlanId,
      priceAed: '24000',
      billingInterval: 'year',
      currentPeriodStart: '2026-01-01',
      currentPeriodEnd: '2026-12-31',
    })
  return t!.id
}

beforeAll(async () => {
  await resetTestDatabase()
  await seedPlatform(platform)
  await platform.insert(user).values([
    { id: 'u-applicant', name: 'Applicant', email: 'apply@plans.test' },
    { id: 'u-racer', name: 'Racer', email: 'racer@plans.test' },
  ])
})
afterAll(closeAllDbs)

describe('removePlan', () => {
  it('deletes a plan nothing points at', async () => {
    const p = await newPlan('unused')
    expect(await remove(p.id)).toEqual({ outcome: 'deleted', code: 'unused', name: 'Plan unused' })
    expect(await planRow(p.id)).toBeUndefined()
  })

  it('archives a used plan: hidden from new spas, the spa keeps its plan, price and features', async () => {
    const p = await newPlan('used', { limits: { ai: false, marketing: false, multiBranch: false } })
    // One spa on it twice (tenant + subscription) counts once; a second spa only through `tenants.plan_id`.
    const a = await spaOn('used-a', p.id)
    await spaOn('used-b', p.id, null)
    expect((await planUsage(platform, [p.id])).get(p.id)).toEqual({
      spas: 2,
      applications: 0,
      pendingApplications: 0,
    })
    const before = await tenantEntitlements(platform, a)

    expect(await remove(p.id)).toEqual({
      outcome: 'archived',
      code: 'used',
      name: 'Plan used',
      spas: 2,
      applications: 0,
      pendingApplications: 0,
    })
    const row = await planRow(p.id)
    expect(row).toMatchObject({ active: false })
    expect(row?.archivedAt).toBeInstanceOf(Date)
    expect((await offeredPlans(platform)).map((o) => o.id)).not.toContain(p.id)
    const [sub] = await platform.select().from(subscriptions).where(eq(subscriptions.tenantId, a))
    expect(sub).toMatchObject({ planId: p.id, priceAed: '24000.00' })
    const after = await tenantEntitlements(platform, a)
    expect(after.features).toEqual(before.features)
    expect(after.plan).toMatchObject({ id: p.id, name: 'Plan used', tier: 'standard' })

    // Archived stays archived: no second removal, and the database refuses offering it again while archived.
    await expect(remove(p.id)).rejects.toThrow('Plan used is already archived')
    await expect(platform.update(plans).set({ active: true }).where(eq(plans.id, p.id))).rejects.toThrow()
  })

  it('archives a plan only applications chose (pending or reviewed)', async () => {
    const p = await newPlan('applied')
    await application('u-applicant', 'applied-spa', p.id)
    await application('u-applicant', 'rejected-spa', p.id, 'rejected')
    expect(await remove(p.id)).toMatchObject({
      outcome: 'archived',
      spas: 0,
      applications: 2,
      pendingApplications: 1,
    })
  })

  it('archives a built-in plan even when unused, so the deploy seed does not bring it back', async () => {
    const standard = (await planByCode(platform, 'standard'))!
    expect((await planUsage(platform, [standard.id])).get(standard.id)).toEqual({
      spas: 0,
      applications: 0,
      pendingApplications: 0,
    })
    expect(await remove(standard.id)).toEqual({
      outcome: 'archived',
      code: 'standard',
      name: 'Standard',
      spas: 0,
      applications: 0,
      pendingApplications: 0,
    })
    await seedPlatform(platform) // every deploy runs the seed
    const rows = await platform.select().from(plans).where(eq(plans.code, 'standard'))
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: standard.id, active: false })
    expect(rows[0]?.archivedAt).toBeInstanceOf(Date)
    expect((await offeredPlans(platform)).map((o) => o.code)).toEqual(['premium'])
    await restore(standard.id) // back (hidden) for the tests below
  })

  it('never removes the last plan new spas can get (the legacy plan does not count)', async () => {
    const premium = (await planByCode(platform, 'premium'))!
    const standard = (await planByCode(platform, 'standard'))!
    const legacy = (await planByCode(platform, 'legacy-yearly'))!
    await platform.update(plans).set({ active: true }).where(eq(plans.id, legacy.id))
    await platform.update(plans).set({ active: false }).where(eq(plans.id, standard.id))
    try {
      await expect(remove(premium.id)).rejects.toThrow(
        'Premium is the only plan new spas can get. Add another plan or make one available first.',
      )
      expect(await planRow(premium.id)).toMatchObject({ active: true, archivedAt: null })
      // A hidden plan may go even while it's the only other one (built in: archived).
      expect(await remove(standard.id)).toMatchObject({ outcome: 'archived', spas: 0 })
    } finally {
      await platform.update(plans).set({ active: false }).where(eq(plans.id, legacy.id))
    }
  })

  it('two removals at once never leave new spas without a plan', async () => {
    const x = await newPlan('race-x')
    const y = await newPlan('race-y')
    const premium = (await planByCode(platform, 'premium'))!
    await platform.update(plans).set({ active: false }).where(eq(plans.id, premium.id))
    try {
      const results = await Promise.allSettled([remove(x.id), remove(y.id)])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.find((r) => r.status === 'rejected')?.reason).toMatchObject({
        message: expect.stringMatching(/is the only plan new spas can get/),
      })
      const left = await platform
        .select()
        .from(plans)
        .where(inArray(plans.id, [x.id, y.id]))
      expect(left).toHaveLength(1)
    } finally {
      await platform.update(plans).set({ active: true }).where(eq(plans.id, premium.id))
    }
  })

  it('a spa written for the plan while it is being removed is counted (archived, not deleted)', async () => {
    const p = await newPlan('late-spa')
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let inserted!: () => void
    const wrote = new Promise<void>((r) => {
      inserted = r
    })
    const writer = platform.transaction(async (tx) => {
      await tx.insert(tenants).values({ slug: 'late-spa', name: 'Late Spa', planId: p.id })
      inserted()
      await gate
    })
    await wrote
    const removal = remove(p.id) // waits for the writer's FK lock on the plan row
    await new Promise((r) => setTimeout(r, 150))
    release()
    await writer
    expect(await removal).toMatchObject({ outcome: 'archived', spas: 1 })
  })

  it('an approval while the plan is being archived waits, then refuses it: no new spa on an archived plan', async () => {
    const p = await newPlan('race-accept', { setupFeeAed: '0' })
    const app = await application('u-racer', 'race-accept-spa', p.id)
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let archived!: () => void
    const locked = new Promise<void>((r) => {
      archived = r
    })
    const removal = platform.transaction(async (tx) => {
      const res = await removePlan(tx, p.id)
      archived()
      await gate
      return res
    })
    await locked
    const accept = acceptApplication(platform, {
      applicationId: app.id,
      reviewerId: 'u-applicant',
      planId: p.id,
      startDate: '2026-11-01',
      today: '2026-10-10',
      payment: null,
    }).then(
      () => null,
      (e: unknown) => e,
    ) // waits for the removal's lock on the plan row
    await new Promise((r) => setTimeout(r, 150))
    release()
    expect(await removal).toMatchObject({ outcome: 'archived', applications: 1, pendingApplications: 1 })
    expect(await accept).toMatchObject({ message: 'Choose a plan that is offered to spas' })
    expect(await platform.select().from(tenants).where(eq(tenants.slug, 'race-accept-spa'))).toEqual([])
  })
})

describe('restorePlan', () => {
  it('brings an archived plan back, still hidden until it is edited to available', async () => {
    const p = await newPlan('restore-me')
    await spaOn('restore-me', p.id)
    await remove(p.id)
    expect(await restore(p.id)).toEqual({ code: 'restore-me', name: 'Plan restore-me' })
    expect(await planRow(p.id)).toMatchObject({ archivedAt: null, active: false })
    expect((await offeredPlans(platform)).map((o) => o.id)).not.toContain(p.id)
    await expect(restore(p.id)).rejects.toThrow('Plan restore-me is not archived')
    await platform.update(plans).set({ active: true }).where(eq(plans.id, p.id))
    expect((await offeredPlans(platform)).map((o) => o.id)).toContain(p.id)
  })
})

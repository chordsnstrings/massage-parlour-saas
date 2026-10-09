// Plans + entitlements (PLAN §18.8): the seeded Premium / Standard / legacy plans and the data migration for existing
// databases, effective entitlements (plan + super-admin override), the worker's entitlement SQL, the Standard
// single-branch rule, per-spa discounts on the setup invoice and the payment schedule, plan switches (legacy only at
// renewal) and that legacy subscriptions are left alone.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  branches,
  closeAllDbs,
  plans,
  platformInvoices,
  platformSettings,
  spaApplications,
  subscriptions,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { seedPlatform } from '@spa/db/seed'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acceptApplication,
  automationOnSql,
  createBranch,
  DomainError,
  entitledSql,
  generateBillingSchedule,
  planByCode,
  provisionTenant,
  recordPlatformPayment,
  setBranchActive,
  setFeatureTier,
  setSubscriptionDiscounts,
  submitApplication,
  switchPlan,
  tenantEntitlements,
  updateBranch,
} from '../src'

const { platform, owner, app } = testDbs()
const today = '2026-10-09'
const ids: Record<string, string> = {}
const ALL = ['ai', 'marketing', 'multiBranch']
/** Tenant data through the app role (RLS), as the dashboard does. */
const asSpa = <T>(tenantId: string, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(tenantId, fn, app)

const invoicesOf = (tenantId: string, kind: 'plan' | 'setup') =>
  platform
    .select()
    .from(platformInvoices)
    .where(and(eq(platformInvoices.tenantId, tenantId), eq(platformInvoices.kind, kind)))
    .orderBy(platformInvoices.installment)

/** A live spa on `code` with an active subscription from `start` (12 months). */
async function spaOn(slug: string, code: string, start = '2026-10-01') {
  const plan = await planByCode(platform, code)
  const tenant = await provisionTenant(platform, {
    userId: ids.owner!,
    businessName: `Spa ${slug}`,
    slug,
    today,
    subscription: { planId: plan!.id, status: 'active', start },
  })
  return tenant.id
}

beforeAll(async () => {
  await resetTestDatabase()
  await seedPlatform(platform)
  await platform
    .insert(platformSettings)
    .values({ id: 1, vatRate: '5' })
    .onConflictDoUpdate({ target: platformSettings.id, set: { vatRate: '5' } })
  await platform.insert(user).values([
    { id: 'u-owner', name: 'Owner', email: 'owner@plans.test' },
    { id: 'u-admin', name: 'Admin', email: 'admin@plans.test' },
  ])
  ids.owner = 'u-owner'
  ids.admin = 'u-admin'
})
afterAll(closeAllDbs)

describe('seeded plans', () => {
  it('Premium and Standard are setup + monthly (excl. VAT), the yearly plan is inactive legacy', async () => {
    const rows = await platform.select().from(plans).orderBy(plans.sort)
    expect(rows.map((p) => [p.code, p.priceAed, p.setupFeeAed, p.billingInterval, p.active])).toEqual([
      ['premium', '36000.00', '14000.00', 'month', true],
      ['standard', '24000.00', '9000.00', 'month', true],
      ['legacy-yearly', '24000.00', '0.00', 'year', false],
    ])
    expect(rows.find((p) => p.code === 'standard')?.limits).toMatchObject({
      ai: false,
      marketing: false,
      multiBranch: false,
    })
  })

  it('the data migration renames the old plan to legacy (same id) and adds the new plans', async () => {
    const file = readFileSync(join(__dirname, '../../db/drizzle/0036_plans_premium_standard.sql'), 'utf8')
    const data = file
      .split('--> statement-breakpoint')
      .filter((s) => /UPDATE "plans"|INSERT INTO "plans"/.test(s))
    expect(data).toHaveLength(2)
    // An existing database: only the pre-§18.8 plan (code `standard`, yearly), with a spa on it.
    const scratch = 'mig_check'
    await owner.execute(sql.raw(`create schema ${scratch}`))
    try {
      await owner.execute(sql.raw(`create table ${scratch}.plans (like public.plans including all)`))
      await owner.execute(
        sql.raw(
          `insert into ${scratch}.plans (code, name, price_aed, billing_interval, limits) values ('standard', 'Standard', 24000, 'year', '{"branches": 3}')`,
        ),
      )
      const [before] = (
        await owner.execute<{ id: string }>(
          sql.raw(`select id from ${scratch}.plans where code = 'standard'`),
        )
      ).rows
      for (const stmt of data) await owner.execute(sql.raw(`set local search_path = ${scratch}; ${stmt}`))
      // Twice: the migration is idempotent (the second run changes nothing).
      for (const stmt of data) await owner.execute(sql.raw(`set local search_path = ${scratch}; ${stmt}`))
      const { rows } = await owner.execute<{
        id: string
        code: string
        active: boolean
        price_aed: string
        limits: Record<string, unknown>
      }>(sql.raw(`select id, code, active, price_aed, limits from ${scratch}.plans order by sort`))
      expect(rows.map((r) => r.code)).toEqual(['premium', 'standard', 'legacy-yearly'])
      const legacy = rows.find((r) => r.code === 'legacy-yearly')!
      expect(legacy).toMatchObject({ id: before!.id, active: false, price_aed: '24000.00' })
      expect(legacy.limits).toEqual({ branches: 3, ai: true, marketing: true, multiBranch: true })
    } finally {
      await owner.execute(sql.raw(`drop schema ${scratch} cascade`))
    }
  })
})

describe('effective entitlements', () => {
  it('Premium: every feature, no branch cap; Standard: none, one branch; legacy: every feature', async () => {
    ids.premium = await spaOn('ent-premium', 'premium')
    ids.standard = await spaOn('ent-standard', 'standard')
    ids.legacy = await spaOn('ent-legacy', 'legacy-yearly', '2026-01-15')
    const p = await tenantEntitlements(platform, ids.premium)
    expect(p).toMatchObject({ features: ALL, branchCap: null, override: null, plan: { tier: 'premium' } })
    const s = await tenantEntitlements(platform, ids.standard)
    expect(s).toMatchObject({ features: [], branchCap: 1, plan: { code: 'standard', tier: 'standard' } })
    const l = await tenantEntitlements(platform, ids.legacy)
    expect(l).toMatchObject({ features: ALL, branchCap: 3, plan: { code: 'legacy-yearly', active: false } })
  })

  it('the super-admin override wins (audited from → to) and can be cleared', async () => {
    expect(await setFeatureTier(platform, ids.standard!, 'premium')).toEqual({ from: null, to: 'premium' })
    expect((await tenantEntitlements(platform, ids.standard!)).features).toEqual(ALL)
    expect((await tenantEntitlements(platform, ids.standard!)).branchCap).toBeNull()
    expect(await setFeatureTier(platform, ids.premium!, 'standard')).toEqual({ from: null, to: 'standard' })
    expect((await tenantEntitlements(platform, ids.premium!)).features).toEqual([])
    expect(await setFeatureTier(platform, ids.premium!, null)).toEqual({ from: 'standard', to: null })
    expect((await tenantEntitlements(platform, ids.premium!)).features).toEqual(ALL)
  })

  it('worker SQL matches: gated automations skip spas without the feature', async () => {
    const entitled = async (feature: 'ai' | 'marketing' | 'multiBranch') =>
      (
        await platform
          .select({ id: tenants.id })
          .from(tenants)
          .where(and(inArray(tenants.id, [ids.premium!, ids.standard!, ids.legacy!]), entitledSql(feature)))
      )
        .map((r) => r.id)
        .sort()
    // Standard has Premium granted (previous test).
    expect(await entitled('ai')).toEqual([ids.premium, ids.standard, ids.legacy].sort())
    await setFeatureTier(platform, ids.standard!, null)
    expect(await entitled('marketing')).toEqual([ids.premium, ids.legacy].sort())
    const slot = await platform
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, ids.standard!), automationOnSql('slotFiller')))
    expect(slot).toEqual([])
    // Ungated automations still run for Standard.
    const digest = await platform
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, ids.standard!), automationOnSql('dailyDigest')))
    expect(digest).toHaveLength(1)
  })
})

describe('Standard = one branch', () => {
  const input = (name: string) => ({ name, businessDayCutoff: '05:00' })
  const rules = async (tenantId: string) => {
    const e = await tenantEntitlements(platform, tenantId)
    return { limit: e.branchCap, multiBranch: e.features.includes('multiBranch') }
  }

  it('refuses a second branch with the Premium message; Premium may add one', async () => {
    const r = await rules(ids.standard!)
    const err = await asSpa(ids.standard!, (tx) => createBranch(tx, ids.standard!, input('Second'), r)).catch(
      (e) => e,
    )
    expect(err).toBeInstanceOf(DomainError)
    expect(err.i18n).toMatchObject({ key: 'errors.domain.featureNotInPlan' })
    expect(err.message).toBe('More branches is available on the Premium plan.')
    const added = await asSpa(ids.premium!, async (tx) =>
      createBranch(tx, ids.premium!, input('Marina'), await rules(ids.premium!)),
    )
    expect(added.active).toBe(true)
  })

  it('a downgraded spa keeps its extra branches (edit, archive) but cannot restore one', async () => {
    const tenantId = await spaOn('ent-down', 'premium')
    const extra = await asSpa(tenantId, async (tx) =>
      createBranch(tx, tenantId, input('JBR'), await rules(tenantId)),
    )
    const third = await asSpa(tenantId, async (tx) =>
      createBranch(tx, tenantId, input('Mirdif'), await rules(tenantId)),
    )
    await setFeatureTier(platform, tenantId, 'standard')
    const r = await rules(tenantId)
    expect(r).toEqual({ limit: 1, multiBranch: false })
    const renamed = await asSpa(tenantId, (tx) => updateBranch(tx, extra.id, input('JBR Walk')))
    expect(renamed).toMatchObject({ name: 'JBR Walk', active: true })
    await asSpa(tenantId, (tx) => setBranchActive(tx, third.id, false, r))
    await expect(asSpa(tenantId, (tx) => setBranchActive(tx, third.id, true, r))).rejects.toMatchObject({
      i18n: { key: 'errors.domain.featureNotInPlan' },
    })
    const active = await asSpa(tenantId, (tx) =>
      tx.select({ name: branches.name }).from(branches).where(eq(branches.active, true)),
    )
    expect(active.map((b) => b.name).sort()).toEqual(['JBR Walk', 'Spa ent-down'])
  })
})

describe('discounts', () => {
  it('apply to the setup invoice at acceptance and to every monthly invoice', async () => {
    const premium = await planByCode(platform, 'premium')
    await platform.insert(user).values({ id: 'u-app', name: 'Applicant', email: 'app@plans.test' })
    const appRow = await submitApplication(platform, {
      userId: 'u-app',
      applicantName: 'Applicant',
      email: 'app@plans.test',
      phone: '+971501234567',
      spaName: 'Discount Spa',
      slug: 'discount-spa',
      emirate: 'dubai',
      streetAddress: 'Al Wasl Road',
      planId: premium!.id,
      preferredStart: '2026-10-15',
      notes: null,
      today,
    })
    const res = await acceptApplication(platform, {
      applicationId: appRow.id,
      reviewerId: ids.admin!,
      planId: premium!.id,
      startDate: '2026-10-15',
      today,
      payment: { kind: 'full', paidOn: today, method: 'bank_transfer', reference: null, note: null },
      discounts: { setup: { kind: 'percent', value: '10.00' }, monthly: { kind: 'amount', value: '500.00' } },
    })
    ids.discounted = res.tenant.id
    const [setup] = await invoicesOf(res.tenant.id, 'setup')
    expect(setup).toMatchObject({
      subtotalAed: '12600.00',
      vatAed: '630.00',
      totalAed: '13230.00',
      listAed: '14000.00',
      discountAed: '1400.00',
      discountLabel: '10%',
      status: 'paid',
    })
    expect(setup!.description).toBe('One-time setup fee · discount 10% (−AED 1400.00)')
    expect(res.setupPayment).toMatchObject({ discountAed: '1400.00', discountLabel: '10%' })
    const plan = await invoicesOf(res.tenant.id, 'plan')
    expect(plan).toHaveLength(12)
    for (const i of plan)
      expect(i).toMatchObject({
        subtotalAed: '2500.00',
        listAed: '3000.00',
        discountAed: '500.00',
        discountLabel: 'AED 500.00',
      })
    const [sub] = await platform.select().from(subscriptions).where(eq(subscriptions.tenantId, res.tenant.id))
    expect(sub!.discounts).toEqual({
      setup: { kind: 'percent', value: '10.00' },
      monthly: { kind: 'amount', value: '500.00' },
    })
    // The console button issues nothing more (idempotent).
    expect((await generateBillingSchedule(platform, res.tenant.id, today)).created).toBe(0)
  })

  it('a 100 % setup discount means no setup invoice', async () => {
    const standard = await planByCode(platform, 'standard')
    await platform.insert(user).values({ id: 'u-free', name: 'Free', email: 'free@plans.test' })
    const appRow = await submitApplication(platform, {
      userId: 'u-free',
      applicantName: 'Free',
      email: 'free@plans.test',
      phone: '+971501234568',
      spaName: 'Waived Spa',
      slug: 'waived-spa',
      emirate: 'sharjah',
      streetAddress: 'Corniche',
      planId: standard!.id,
      preferredStart: '2026-10-20',
      notes: null,
      today,
    })
    const res = await acceptApplication(platform, {
      applicationId: appRow.id,
      reviewerId: ids.admin!,
      planId: standard!.id,
      startDate: '2026-10-20',
      today,
      payment: null,
      discounts: { setup: { kind: 'percent', value: '100.00' } },
    })
    expect(await invoicesOf(res.tenant.id, 'setup')).toEqual([])
    expect(res.setupPayment).toMatchObject({ kind: 'none', discountAed: '9000.00' })
    expect((await invoicesOf(res.tenant.id, 'plan')).map((i) => i.subtotalAed)).toEqual(
      Array(12).fill('2000.00'),
    )
  })

  it('saving discounts later re-issues only unpaid invoices that are not due yet', async () => {
    const tenantId = await spaOn('disc-later', 'standard', '2026-09-01')
    await generateBillingSchedule(platform, tenantId, today)
    const before = await invoicesOf(tenantId, 'plan')
    // Sep (due, past) + Oct (paid) keep their amounts; Nov… are re-issued.
    await recordPlatformPayment(platform, {
      tenantId,
      amountAed: before[1]!.totalAed,
      method: 'cash',
      receivedAt: today,
      invoiceId: before[1]!.id,
      recordedBy: ids.admin!,
      today,
    })
    const r = await setSubscriptionDiscounts(platform, {
      tenantId,
      discounts: { monthly: { kind: 'percent', value: '25.00' } },
      today,
      reissue: true,
    })
    expect(r.from).toEqual({})
    expect(r.to).toEqual({ monthly: { kind: 'percent', value: '25.00' } })
    expect(r.reissued).toMatchObject({ voided: 10 + 1 }) // 10 future installments + the unpaid setup invoice
    const live = (await invoicesOf(tenantId, 'plan')).filter((i) => i.status !== 'void')
    expect(live).toHaveLength(12)
    const byN = new Map(live.map((i) => [i.installment, i.subtotalAed]))
    expect(byN.get(1)).toBe('2000.00')
    expect(byN.get(2)).toBe('2000.00')
    expect(byN.get(3)).toBe('1500.00')
    expect(byN.get(12)).toBe('1500.00')
    const setup = (await invoicesOf(tenantId, 'setup')).filter((i) => i.status !== 'void')
    expect(setup.map((i) => i.subtotalAed)).toEqual(['9000.00'])
  })
})

describe('plan switches', () => {
  it('Standard → Premium moves the price; unpaid future invoices re-issued on request', async () => {
    const tenantId = await spaOn('switch-up', 'standard', '2026-10-01')
    await generateBillingSchedule(platform, tenantId, today)
    const premium = await planByCode(platform, 'premium')
    const r = await switchPlan(platform, { tenantId, planId: premium!.id, today, reissue: true })
    expect(r.from).toMatchObject({ plan: 'standard', priceAed: '24000.00' })
    expect(r.to).toMatchObject({ plan: 'premium', priceAed: '36000.00' })
    expect(r.renewal).toBe(false)
    const live = (await invoicesOf(tenantId, 'plan')).filter((i) => i.status !== 'void')
    // Oct installment is due on 1 Oct (before today): kept at 2,000; the rest at 3,000.
    expect(live.map((i) => i.subtotalAed)).toEqual(['2000.00', ...Array(11).fill('3000.00')])
    expect((await tenantEntitlements(platform, tenantId)).features).toEqual(ALL)
    await expect(switchPlan(platform, { tenantId, planId: premium!.id, today })).rejects.toThrow(
      'The spa is already on this plan',
    )
    const legacy = await planByCode(platform, 'legacy-yearly')
    await expect(switchPlan(platform, { tenantId, planId: legacy!.id, today })).rejects.toThrow(
      'Choose a plan that is offered to spas',
    )
  })

  it('a legacy spa keeps its plan until renewal; then the new plan starts on the old end date', async () => {
    const tenantId = ids.legacy!
    await generateBillingSchedule(platform, tenantId, today)
    const legacyInvoices = await invoicesOf(tenantId, 'plan')
    const standard = await planByCode(platform, 'standard')
    // Period 2026-01-15 → 2027-01-15: from 16 Dec 2026 the console asks for the new plan.
    await expect(switchPlan(platform, { tenantId, planId: standard!.id, today })).rejects.toThrow(
      'The legacy yearly plan stays until its renewal on 2027-01-15: choose the new plan from 2026-12-16.',
    )
    const r = await switchPlan(platform, { tenantId, planId: standard!.id, today: '2026-12-20' })
    expect(r).toMatchObject({ renewal: true, from: { plan: 'legacy-yearly' }, to: { plan: 'standard' } })
    const [sub] = await platform.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId))
    expect(sub).toMatchObject({
      currentPeriodStart: '2027-01-15',
      currentPeriodEnd: '2028-01-15',
      priceAed: '24000.00',
      setupFeeAed: '0.00',
      billingInterval: 'month',
    })
    // No money moved: the legacy period's invoices are untouched; the new period is issued by the console button.
    expect(await invoicesOf(tenantId, 'plan')).toEqual(legacyInvoices)
    await generateBillingSchedule(platform, tenantId, '2026-12-20')
    const next = (await invoicesOf(tenantId, 'plan')).filter((i) => i.periodStart === '2027-01-15')
    expect(next).toHaveLength(12)
    expect(next[0]).toMatchObject({ subtotalAed: '2000.00', dueDate: '2027-01-15' })
    expect(await invoicesOf(tenantId, 'setup')).toEqual([])
  })

  it('new applications never get the legacy plan', async () => {
    const legacy = await planByCode(platform, 'legacy-yearly')
    await platform.insert(user).values({ id: 'u-old', name: 'Old', email: 'old@plans.test' })
    await expect(
      submitApplication(platform, {
        userId: 'u-old',
        applicantName: 'Old',
        email: 'old@plans.test',
        phone: '+971501234569',
        spaName: 'Old Spa',
        slug: 'old-spa',
        emirate: 'dubai',
        streetAddress: 'Satwa',
        planId: legacy!.id,
        preferredStart: '2026-10-20',
        notes: null,
        today,
      }),
    ).rejects.toThrow('Plan not found')
    // An application from before §18.8 that still points at the old plan can't be accepted on it either.
    const premium = await planByCode(platform, 'premium')
    const row = await submitApplication(platform, {
      userId: 'u-old',
      applicantName: 'Old',
      email: 'old@plans.test',
      phone: '+971501234569',
      spaName: 'Old Spa',
      slug: 'old-spa',
      emirate: 'dubai',
      streetAddress: 'Satwa',
      planId: premium!.id,
      preferredStart: '2026-10-20',
      notes: null,
      today,
    })
    await platform.update(spaApplications).set({ planId: legacy!.id }).where(eq(spaApplications.id, row.id))
    await expect(
      acceptApplication(platform, {
        applicationId: row.id,
        reviewerId: ids.admin!,
        planId: legacy!.id,
        startDate: '2026-10-20',
        today,
        payment: null,
      }),
    ).rejects.toThrow('Choose a plan that is offered to spas')
  })
})

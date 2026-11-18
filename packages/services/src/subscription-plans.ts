// Super-admin plan controls per spa (PLAN §18.8): plan switch (Premium ↔ Standard; the legacy yearly plan only at
// its renewal), per-spa discounts on the setup fee / monthly fee, and the feature-tier override. Platform role only;
// the caller checks super-admin rights and audits (every function returns `from` / `to`).
import { addDays, type FeatureTier, isFeatureTier, PLAN_CODES, type SubscriptionDiscounts } from '@spa/core'
import {
  type Db,
  type DbOrTx,
  plans,
  platformInvoices,
  platformPayments,
  spaApplications,
  subscriptions,
  type Tx,
  tenants,
} from '@spa/db'
import { and, asc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm'
import { isLegacyPlan } from './entitlements'
import { DomainError } from './errors'
import { addMonths, createPlatformInvoice, discounted, generateBillingScheduleTx } from './platform-billing'

/** The console asks for a new plan this many days before a legacy subscription's period ends. */
export const RENEWAL_WINDOW_DAYS = 30

/** Is the renewal (period end) close enough to choose the next plan? */
export const renewalDue = (sub: { currentPeriodEnd: string }, today: string) =>
  today >= addDays(sub.currentPeriodEnd, -RENEWAL_WINDOW_DAYS)

async function lockSubscription(tx: Tx, tenantId: string) {
  const [sub] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .for('update')
  if (!sub) throw new DomainError('Save a subscription for this spa first', 'not_found')
  return sub
}

/**
 * Re-issues the spa's UNPAID invoices that aren't due yet (plan installments of the current period due from today,
 * and an unpaid setup invoice) at the subscription's current price + discounts: they are voided (numbers kept) and
 * issued again — the setup invoice keeps its due date and VAT choice, plan installments come from the schedule
 * code. Invoices with any money received (even reversed), and installments already due, keep their amounts.
 */
export async function reissueUnpaidInvoices(tx: Tx, tenantId: string, today: string) {
  const sub = await lockSubscription(tx, tenantId)
  const candidates = await tx
    .select()
    .from(platformInvoices)
    .where(
      and(
        eq(platformInvoices.tenantId, tenantId),
        eq(platformInvoices.status, 'issued'),
        or(
          and(
            eq(platformInvoices.kind, 'plan'),
            eq(platformInvoices.periodStart, sub.currentPeriodStart),
            gte(platformInvoices.dueDate, today),
          ),
          eq(platformInvoices.kind, 'setup'),
        ),
      ),
    )
  if (!candidates.length) return { voided: 0, created: 0 }
  const paid = await tx
    .selectDistinct({ invoiceId: platformPayments.invoiceId })
    .from(platformPayments)
    .where(
      inArray(
        platformPayments.invoiceId,
        candidates.map((c) => c.id),
      ),
    )
  // Any payment row (even one reversed to 0 by "Mark unpaid") keeps the invoice: its history stays readable.
  const withPayments = new Set(paid.map((p) => p.invoiceId))
  const open = candidates.filter((c) => !withPayments.has(c.id))
  if (!open.length) return { voided: 0, created: 0 }
  await tx
    .update(platformInvoices)
    .set({ status: 'void' })
    .where(
      inArray(
        platformInvoices.id,
        open.map((c) => c.id),
      ),
    )
  let created = 0
  // The setup invoice first (same due date + VAT choice), so the schedule code below finds it and skips its own.
  const setup = open.find((c) => c.kind === 'setup')
  if (setup) {
    const d = discounted(sub.setupFeeAed, sub.discounts?.setup)
    if (Number(d.amountAed) > 0) {
      const row = await createPlatformInvoice(tx, tenantId, {
        description: `One-time setup fee${d.note}`,
        amountAed: d.amountAed,
        issueDate: today,
        dueDate: setup.dueDate,
        kind: 'setup',
        vat: Number(setup.vatAed) > 0,
        discount: d.discount,
      })
      if (row) created++
    }
  }
  const r = await generateBillingScheduleTx(tx, tenantId, today)
  return { voided: open.length, created: created + r.created }
}

const planView = (
  p: { code: string; name: string },
  sub: { priceAed: string; billingInterval: string; currentPeriodStart: string; currentPeriodEnd: string },
) => ({
  plan: p.code,
  name: p.name,
  priceAed: sub.priceAed,
  billingInterval: sub.billingInterval,
  period: `${sub.currentPeriodStart}..${sub.currentPeriodEnd}`,
})

/**
 * Moves a spa to another offered plan (super-admin). Price + payment plan follow the new plan; the setup fee and
 * the period stay (already-issued invoices keep their amounts unless `reissue`, see `reissueUnpaidInvoices`).
 * A spa on the legacy yearly plan keeps it until its renewal: allowed only from `RENEWAL_WINDOW_DAYS` before the
 * period end, and then the new plan starts a new 12-month period on the old end date (no setup fee: the spa is
 * already set up). No invoices are issued here — "Generate payment schedule" (or `reissue`) does that.
 */
export async function switchPlan(
  db: Db,
  r: { tenantId: string; planId: string; today: string; reissue?: boolean },
) {
  return db.transaction(async (tx) => {
    const sub = await lockSubscription(tx, r.tenantId)
    // FOR SHARE: a Delete on Plans & prices (R19, `removePlan`) running meanwhile finishes first and is seen here.
    const [target] = await tx.select().from(plans).where(eq(plans.id, r.planId)).for('share')
    if (!target?.active || isLegacyPlan(target))
      throw new DomainError('Choose a plan that is offered to spas', 'not_found')
    const [current] = await tx.select().from(plans).where(eq(plans.id, sub.planId))
    if (current?.id === target.id) throw new DomainError('The spa is already on this plan')
    const legacy = isLegacyPlan(current)
    if (legacy && !renewalDue(sub, r.today))
      throw new DomainError(
        `The legacy yearly plan stays until its renewal on ${sub.currentPeriodEnd}: choose the new plan from ${addDays(sub.currentPeriodEnd, -RENEWAL_WINDOW_DAYS)}.`,
      )
    const start = legacy
      ? sub.currentPeriodEnd > r.today
        ? sub.currentPeriodEnd
        : r.today
      : sub.currentPeriodStart
    const set = {
      planId: target.id,
      priceAed: target.priceAed,
      billingInterval: target.billingInterval,
      ...(legacy
        ? {
            status: 'active' as const,
            setupFeeAed: '0',
            currentPeriodStart: start,
            currentPeriodEnd: addMonths(start, 12),
          }
        : {}),
      updatedAt: new Date(),
    }
    const [updated] = await tx.update(subscriptions).set(set).where(eq(subscriptions.id, sub.id)).returning()
    await tx.update(tenants).set({ planId: target.id }).where(eq(tenants.id, r.tenantId))
    const reissued = r.reissue && !legacy ? await reissueUnpaidInvoices(tx, r.tenantId, r.today) : null
    return {
      from: current ? planView(current, sub) : null,
      to: planView(target, updated!),
      renewal: legacy,
      reissued,
    }
  })
}

/** Normalises stored discounts: only `setup` / `monthly` keys with a value. */
const cleanDiscounts = (d: SubscriptionDiscounts): SubscriptionDiscounts => ({
  ...(d.setup ? { setup: d.setup } : {}),
  ...(d.monthly ? { monthly: d.monthly } : {}),
})

/**
 * Saves the spa's discounts (super-admin). They apply to invoices generated from now on (the setup invoice, the
 * plan schedule); with `reissue`, unpaid invoices not yet due are issued again at the discounted amounts.
 */
export async function setSubscriptionDiscounts(
  db: Db,
  r: { tenantId: string; discounts: SubscriptionDiscounts; today: string; reissue?: boolean },
) {
  return db.transaction(async (tx) => {
    const sub = await lockSubscription(tx, r.tenantId)
    const to = cleanDiscounts(r.discounts)
    await tx
      .update(subscriptions)
      .set({ discounts: to, updatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id))
    const reissued = r.reissue ? await reissueUnpaidInvoices(tx, r.tenantId, r.today) : null
    return { from: cleanDiscounts(sub.discounts ?? {}), to, reissued }
  })
}

/** Feature-tier override (super-admin): 'premium' grants every feature whatever the plan; null = follow the plan. */
export async function setFeatureTier(db: DbOrTx, tenantId: string, tier: FeatureTier | null) {
  if (tier !== null && !isFeatureTier(tier)) throw new DomainError('Choose a feature tier')
  const [before] = await db
    .select({ tier: tenants.featureTier })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
  if (!before) throw new DomainError('Spa not found', 'not_found')
  await db.update(tenants).set({ featureTier: tier, updatedAt: new Date() }).where(eq(tenants.id, tenantId))
  return { from: before.tier ?? null, to: tier }
}

/** Plans a super-admin may move a spa to (offered, not legacy), in pricing order. */
export async function offeredPlans(db: DbOrTx) {
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.active, true), isNull(plans.archivedAt), ne(plans.code, PLAN_CODES.legacyYearly)))
  return rows.sort((a, b) => a.sort - b.sort)
}

/** R19: a plan new spas can get (pricing page, sign-up, approval): active, not archived, not the legacy yearly plan. */
export const offeredToNewSpas = (p: { code: string; active: boolean; archivedAt: Date | null }) =>
  p.active && !p.archivedAt && !isLegacyPlan(p)

/**
 * R19: the seeded plans (`PLAN_CODES`: premium, standard, legacy-yearly) are only ever archived, never deleted —
 * every deploy re-runs the seed, which would add a deleted one back (active, at the seed price).
 */
export const isBuiltInPlan = (p: { code: string }) => (Object.values(PLAN_CODES) as string[]).includes(p.code)

export type PlanUse = { spas: number; applications: number; pendingApplications: number }
export const NO_PLAN_USE: PlanUse = { spas: 0, applications: 0, pendingApplications: 0 }

/**
 * Who points at each plan (R19). `spas` = distinct spas whose `tenants.plan_id` or `subscriptions.plan_id` is the
 * plan (deleted spas too: restoring one brings its plan back); `applications` = `spa_applications` rows (any status;
 * reviewed ones are kept records), `pendingApplications` = those still waiting for review.
 */
export async function planUsage(db: DbOrTx, planIds?: string[]): Promise<Map<string, PlanUse>> {
  if (planIds && !planIds.length) return new Map()
  const only = planIds
    ? sql`where p.id in (${sql.join(
        planIds.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`
    : sql``
  const { rows } = await db.execute<{ id: string } & PlanUse>(sql`
    select p.id,
      (select count(*) from (
        select t.id from ${tenants} t where t.plan_id = p.id
        union select s.tenant_id from ${subscriptions} s where s.plan_id = p.id
      ) u)::int as spas,
      (select count(*) from ${spaApplications} a where a.plan_id = p.id)::int as applications,
      (select count(*) from ${spaApplications} a where a.plan_id = p.id and a.status = 'pending')::int
        as "pendingApplications"
    from ${plans} p ${only}`)
  return new Map(rows.map(({ id, ...use }) => [id, use]))
}

export type PlanRemoval = { code: string; name: string } & (
  | { outcome: 'deleted' }
  | ({ outcome: 'archived' } & PlanUse)
)

/**
 * R19 "Delete" on Console → Plans & prices (super-admin; the caller checks rights and audits). Every plan row is
 * locked (id order) for the transaction, so the counts and the last-plan check hold until commit: a spa,
 * subscription or application written for the plan meanwhile waits on the lock (its FK check) and is counted, or
 * fails on the deleted row; approvals and plan switches read their plan FOR SHARE, so they wait and then see it
 * archived or gone. Nothing points at the plan → the row is deleted; otherwise, and always for a built-in plan
 * (`isBuiltInPlan`), it is archived (inactive, `archived_at`) and those spas keep their plan and agreed price.
 * Refused for the last plan new spas can get, so the pricing page and sign-up never end up empty.
 */
export async function removePlan(tx: Tx, planId: string): Promise<PlanRemoval> {
  const all = await tx.select().from(plans).orderBy(asc(plans.id)).for('update')
  const plan = all.find((p) => p.id === planId)
  if (!plan) throw new DomainError('Plan not found', 'not_found')
  if (plan.archivedAt) throw new DomainError(`${plan.name} is already archived`)
  if (offeredToNewSpas(plan) && !all.some((p) => p.id !== plan.id && offeredToNewSpas(p)))
    throw new DomainError(
      `${plan.name} is the only plan new spas can get. Add another plan or make one available first.`,
    )
  const use = (await planUsage(tx, [plan.id])).get(plan.id) ?? NO_PLAN_USE
  const named = { code: plan.code, name: plan.name }
  if (!use.spas && !use.applications && !isBuiltInPlan(plan)) {
    await tx.delete(plans).where(eq(plans.id, plan.id))
    return { outcome: 'deleted', ...named }
  }
  await tx.update(plans).set({ active: false, archivedAt: new Date() }).where(eq(plans.id, plan.id))
  return { outcome: 'archived', ...named, ...use }
}

/** R19 "Restore" (super-admin; the caller audits): back on Plans & prices, still hidden until edited to active. */
export async function restorePlan(tx: Tx, planId: string) {
  const [plan] = await tx.select().from(plans).where(eq(plans.id, planId)).for('update')
  if (!plan) throw new DomainError('Plan not found', 'not_found')
  if (!plan.archivedAt) throw new DomainError(`${plan.name} is not archived`)
  await tx.update(plans).set({ archivedAt: null }).where(eq(plans.id, plan.id))
  return { code: plan.code, name: plan.name }
}

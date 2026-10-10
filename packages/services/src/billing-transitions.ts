// F22 automatic billing transitions (PLAN §17; rules in @spa/core billing-stages.ts). Platform role only: the
// worker job `billing-transitions` runs `runBillingTransitions` daily; every payment path (console mark paid /
// record payment, Stripe Checkout) runs `liftBillingHold` in its transaction and `billingTransitionEffects` after
// commit. Read-only = tenant status `read_only` (server/access.ts `guard` blocks staff writes; the Billing page,
// the public site and online booking keep working). A manual pause (status read_only without the stage) is left
// to the super-admin. Legacy yearly spas are included (their invoices are ordinary platform invoices).
import {
  type BillingRules,
  type BillingState,
  billingStageRank,
  DEFAULT_BILLING_RULES,
  addDays,
  nextBillingState,
  readOnlyFrom,
  resolveEmailConfig,
  sendStaffEmail,
} from '@spa/core'
import {
  auditLog,
  type Db,
  type DbOrTx,
  members,
  platformAdmins,
  platformInvoices,
  platformPayments,
  platformSettings,
  roles,
  subscriptions,
  tenants,
  user,
} from '@spa/db'
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { flagValues } from './feature-flags'
import { type NewNotification, notify } from './notifications'

type TenantStatus = (typeof tenants.$inferSelect)['status']

/** Console settings (Company → Billing rules); defaults when the settings row is missing. */
export async function billingRules(db: DbOrTx): Promise<BillingRules> {
  const [s] = await db
    .select({ a: platformSettings.billingOverdueAfterDays, g: platformSettings.billingGraceDays })
    .from(platformSettings)
    .where(eq(platformSettings.id, 1))
  return s ? { overdueAfterDays: s.a, graceDays: s.g } : DEFAULT_BILLING_RULES
}

export type LateInvoice = { id: string; number: string; dueDate: string; balanceAed: string }

/** The oldest unpaid invoice that is late today (balance = total − payments so far), or null. */
export async function oldestLateInvoice(
  db: DbOrTx,
  tenantId: string,
  today: string,
  rules: BillingRules,
): Promise<LateInvoice | null> {
  // late ⇔ today ≥ due + overdueAfterDays ⇔ due ≤ today − overdueAfterDays
  const [row] = await db
    .select({
      id: platformInvoices.id,
      number: platformInvoices.number,
      dueDate: platformInvoices.dueDate,
      balance: sql<string>`(${platformInvoices.totalAed} - coalesce((select sum(${platformPayments.amountAed})
        from ${platformPayments} where ${platformPayments.invoiceId} = ${platformInvoices.id}), 0))::numeric(12,2)::text`,
    })
    .from(platformInvoices)
    .where(
      and(
        eq(platformInvoices.tenantId, tenantId),
        eq(platformInvoices.status, 'issued'),
        lte(platformInvoices.dueDate, addDays(today, -rules.overdueAfterDays)),
      ),
    )
    .orderBy(asc(platformInvoices.dueDate), asc(platformInvoices.number))
    .limit(1)
  return row ? { id: row.id, number: row.number, dueDate: row.dueDate, balanceAed: row.balance } : null
}

export type BillingTransition = {
  tenantId: string
  slug: string
  name: string
  from: BillingState
  to: BillingState
  statusFrom: TenantStatus
  statusTo: TenantStatus
  invoice: LateInvoice | null
  /** First read-only day while late (null once lifted). */
  readOnlyFrom: string | null
  trigger: 'job' | 'payment'
}

const SKIP: TenantStatus[] = ['suspended', 'cancelled']

/**
 * Applies the rules to one spa inside the caller's platform transaction (tenant row locked). Returns what changed,
 * or null (no change, deleted / suspended / cancelled spa). `paused` = transitions paused for this spa (console
 * flag); `liftOnly` = payment paths. Idempotent: the same day gives the same state.
 */
export async function applyBillingTransition(
  tx: DbOrTx,
  tenantId: string,
  today: string,
  opts: { rules?: BillingRules; paused?: boolean; liftOnly?: boolean } = {},
): Promise<BillingTransition | null> {
  const [t] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).for('update')
  if (!t || t.deletedAt || SKIP.includes(t.status)) return null
  const rules = opts.rules ?? (await billingRules(tx))
  // Paused by hand (R12 "Pause spa"): the super-admin decides; the stage may still be cleared once paid.
  const manualPause = t.status === 'read_only' && t.billingStage !== 'read_only'
  const current: BillingState = { stage: t.billingStage, overdueSince: t.billingOverdueSince }
  const invoice = await oldestLateInvoice(tx, tenantId, today, rules)
  const next = nextBillingState(current, Boolean(invoice), today, rules, {
    paused: opts.paused || manualPause,
    liftOnly: opts.liftOnly,
  })
  if (next.stage === current.stage && next.overdueSince === current.overdueSince) return null
  let status = t.status
  if (!manualPause) {
    const autoReadOnly = t.status === 'read_only' && t.billingStage === 'read_only'
    if (next.stage === 'read_only') status = 'read_only'
    else if (next.stage) {
      if (t.status === 'trial' || t.status === 'active' || autoReadOnly) status = 'past_due'
    } else if (t.status === 'past_due' || autoReadOnly) {
      const [sub] = await tx
        .select({ status: subscriptions.status })
        .from(subscriptions)
        .where(eq(subscriptions.tenantId, tenantId))
      status = sub?.status === 'trialing' ? 'trial' : 'active'
    }
  }
  await tx
    .update(tenants)
    .set({
      billingStage: next.stage,
      billingOverdueSince: next.overdueSince,
      billingStageAt: new Date(),
      status,
    })
    .where(eq(tenants.id, tenantId))
  return {
    tenantId,
    slug: t.slug,
    name: t.name,
    from: current,
    to: next,
    statusFrom: t.status,
    statusTo: status,
    invoice,
    readOnlyFrom: next.overdueSince ? readOnlyFrom(next.overdueSince, rules) : null,
    trigger: opts.liftOnly ? 'payment' : 'job',
  }
}

/** Payment paths: lift (never escalate) once nothing is late any more. Same transaction as the payment. */
export const liftBillingHold = (tx: DbOrTx, tenantId: string, today: string) =>
  applyBillingTransition(tx, tenantId, today, { liftOnly: true })

type NoticeKind = 'billing.late' | 'billing.read_only' | 'billing.restored'

/** Which notice a transition sends (overdue → grace and lifts from overdue/grace are silent). */
export function transitionNotice(t: BillingTransition): NoticeKind | null {
  if (t.to.stage === 'read_only' && t.from.stage !== 'read_only') return 'billing.read_only'
  if (t.to.stage === 'overdue') return 'billing.late'
  if (!t.to.stage && t.from.stage === 'read_only' && t.statusTo !== 'read_only') return 'billing.restored'
  return null
}

const EMAIL: Record<NoticeKind, (t: BillingTransition) => { subject: string; text: string }> = {
  'billing.late': (t) => ({
    subject: `Payment overdue — ${t.name} becomes read-only on ${t.readOnlyFrom}`,
    text: `Invoice ${t.invoice?.number} (AED ${t.invoice?.balanceAed}) for ${t.name} is unpaid.\nPay before ${t.readOnlyFrom} to keep full access; after that the dashboard becomes read-only (the website and online booking keep working).\nPay from the dashboard's Billing page (bank transfer, cash or card).`,
  }),
  'billing.read_only': (t) => ({
    subject: `${t.name}: dashboard is read-only (invoice unpaid)`,
    text: `Invoice ${t.invoice?.number} (AED ${t.invoice?.balanceAed}) for ${t.name} is still unpaid after the grace period, so the dashboard is read-only. The website and online booking keep working.\nFull access comes back automatically once the invoice is paid (Billing page).`,
  }),
  'billing.restored': (t) => ({
    subject: `${t.name}: full access restored`,
    text: `The payment for ${t.name} was received; the dashboard works normally again. Thank you!`,
  }),
}

/**
 * After commit: the audit row (`platform.billing.stage`, system actor unless `actorUserId`), the in-dashboard
 * notification for billing.view holders, and — when staff email is configured — an email to the spa's owners and
 * every super-admin. Never throws for delivery problems (logged).
 */
export async function billingTransitionEffects(
  db: Db,
  t: BillingTransition,
  opts: { actorUserId?: string | null; send?: (n: NewNotification) => Promise<unknown> } = {},
) {
  await db.insert(auditLog).values({
    tenantId: t.tenantId,
    actorUserId: opts.actorUserId ?? null,
    action: 'platform.billing.stage',
    entity: 'tenant',
    entityId: t.tenantId,
    data: {
      from: t.from.stage,
      to: t.to.stage,
      status: { from: t.statusFrom, to: t.statusTo },
      overdueSince: t.to.overdueSince ?? t.from.overdueSince,
      readOnlyFrom: t.readOnlyFrom,
      invoice: t.invoice?.number ?? null,
      trigger: t.trigger,
    },
  })
  const kind = transitionNotice(t)
  if (!kind) return { kind: null, emailed: 0 }
  const episode = t.to.overdueSince ?? t.from.overdueSince
  try {
    await (opts.send ?? notify)({
      tenantId: t.tenantId,
      kind,
      params: t.invoice
        ? { number: t.invoice.number, amount: t.invoice.balanceAed, date: t.readOnlyFrom ?? '' }
        : {},
      url: `/${t.slug}/billing`,
      dedupeKey: `${kind}:${episode}`,
    })
  } catch (error) {
    console.error('billing notice failed', t.slug, error)
  }
  let emailed = 0
  if (!(await resolveEmailConfig()).apiKey) return { kind, emailed }
  const owners = await db
    .select({ email: user.email })
    .from(members)
    .innerJoin(roles, eq(roles.id, members.roleId))
    .innerJoin(user, eq(user.id, members.userId))
    .where(
      and(
        eq(members.tenantId, t.tenantId),
        eq(members.status, 'active'),
        eq(roles.key, 'owner'),
        isNull(user.disabledAt),
      ),
    )
  const admins = await db
    .select({ email: user.email })
    .from(platformAdmins)
    .innerJoin(user, eq(user.id, platformAdmins.userId))
    .where(isNull(user.disabledAt))
  const mail = EMAIL[kind](t)
  for (const to of new Set([...owners, ...admins].map((r) => r.email.toLowerCase())))
    try {
      await sendStaffEmail({ to, ...mail })
      emailed++
    } catch (error) {
      console.error('billing email failed', t.slug, error)
    }
  return { kind, emailed }
}

/**
 * The daily job: every spa with an unpaid invoice or a billing stage, one transaction each; one failing spa never
 * stops the others. Transitions paused by the `billing.autoTransitions` flag (default or per-spa override) only lift.
 */
export async function runBillingTransitions(db: Db, today: string) {
  const rules = await billingRules(db)
  const auto = await flagValues(db, 'billing.autoTransitions')
  const candidates = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(
      sql`${tenants.deletedAt} is null and ${tenants.status} not in ('suspended', 'cancelled') and (
        ${tenants.billingStage} is not null or exists (select 1 from ${platformInvoices}
          where ${platformInvoices.tenantId} = ${tenants.id} and ${platformInvoices.status} = 'issued'))`,
    )
  const changed: BillingTransition[] = []
  const failed: string[] = []
  for (const c of candidates) {
    try {
      const t = await db.transaction((tx) =>
        applyBillingTransition(tx, c.id, today, { rules, paused: !auto.on(c.id) }),
      )
      if (t) {
        changed.push(t)
        await billingTransitionEffects(db, t)
      }
    } catch (error) {
      failed.push(c.id)
      console.error('billing transition failed', c.id, error)
    }
  }
  return { checked: candidates.length, changed, failed }
}

/** Console "Billing rules" save (bounds: core BILLING_RULE_LIMITS, checked by the action's zod). */
export async function saveBillingRules(db: DbOrTx, rules: BillingRules, userId: string) {
  const before = await billingRules(db)
  if (rules.overdueAfterDays < 1 || rules.graceDays < 0) throw new DomainError('Days must be positive')
  await db
    .insert(platformSettings)
    .values({
      id: 1,
      billingOverdueAfterDays: rules.overdueAfterDays,
      billingGraceDays: rules.graceDays,
      updatedBy: userId,
    })
    .onConflictDoUpdate({
      target: platformSettings.id,
      set: {
        billingOverdueAfterDays: rules.overdueAfterDays,
        billingGraceDays: rules.graceDays,
        updatedBy: userId,
      },
    })
  return { before, after: rules }
}

/** Console list/detail label: "Grace · read-only from 2026-10-18" etc. */
export const billingStageSummary = (
  t: { billingStage: BillingState['stage']; billingOverdueSince: string | null },
  rules: BillingRules,
) =>
  t.billingStage && t.billingOverdueSince
    ? {
        stage: t.billingStage,
        rank: billingStageRank(t.billingStage),
        readOnlyFrom: readOnlyFrom(t.billingOverdueSince, rules),
      }
    : null

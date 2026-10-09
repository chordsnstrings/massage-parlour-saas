// SaaS billing for spas (PLAN §14.3, §14.8 R3/R11/R12). Payments are recorded by a super-admin (cash / bank
// transfer), or settled by Stripe Checkout for platform invoices; nothing here moves money.
// All functions run on the platform role (or a tenant-scoped tx for the read-only helpers) and take `tenantId`.
import {
  type Db,
  type DbOrTx,
  platformInvoices,
  platformPayments,
  platformReminders,
  platformSettings,
  subscriptions,
  type Tx,
  tenants,
} from '@spa/db'
import { and, asc, eq, isNotNull, isNull, lt, ne, sql, sum } from 'drizzle-orm'
import { DomainError } from './errors'

/** The annual price may be paid as this many monthly invoices (AED 24,000 → 12 × AED 2,000). */
export const MONTHLY_INSTALLMENTS = 12

export type PaymentPlan = 'month' | 'year'
export type ScheduleRow = {
  installment: number
  installments: number
  dueDate: string
  amountAed: string
}

/** `YYYY-MM-DD` + n months, clamped to the last day of the target month (31 Jan + 1 → 28/29 Feb). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const index = y * 12 + (m - 1) + n
  const ty = Math.floor(index / 12)
  const tm = index % 12
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate()
  return `${ty}-${String(tm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/**
 * The plan's invoices for one subscription period. `priceAed` is the annual price; `month` splits it into 12
 * monthly installments (cents rounding goes to the last one, so they always add up), `year` is one invoice.
 */
export function planSchedule(sub: {
  priceAed: string
  billingInterval: PaymentPlan
  currentPeriodStart: string
}): ScheduleRow[] {
  const cents = Math.round(Number(sub.priceAed) * 100)
  if (sub.billingInterval === 'year')
    return [
      {
        installment: 1,
        installments: 1,
        dueDate: sub.currentPeriodStart,
        amountAed: (cents / 100).toFixed(2),
      },
    ]
  const n = MONTHLY_INSTALLMENTS
  const base = Math.floor(cents / n)
  return Array.from({ length: n }, (_, i) => ({
    installment: i + 1,
    installments: n,
    dueDate: addMonths(sub.currentPeriodStart, i),
    amountAed: ((i === n - 1 ? cents - base * (n - 1) : base) / 100).toFixed(2),
  }))
}

/**
 * Subtotal / VAT / total for an entered amount, per the platform's VAT settings. `chargeVat: false` (a setup invoice
 * accepted without VAT, PLAN §18.3) → no VAT: the amount is the total.
 */
export function invoiceTotals(
  amount: number,
  s?: { vatRate: string; pricesIncludeVat: boolean } | null,
  chargeVat = true,
) {
  const rate = chargeVat ? Number(s?.vatRate ?? 5) : 0
  const vat = s?.pricesIncludeVat ? (amount * rate) / (100 + rate) : (amount * rate) / 100
  const subtotal = s?.pricesIncludeVat ? amount - vat : amount
  return { subtotalAed: subtotal.toFixed(2), vatAed: vat.toFixed(2), totalAed: (subtotal + vat).toFixed(2) }
}

type InvoiceInput = {
  description: string
  amountAed: string
  issueDate: string
  dueDate: string
  kind?: 'plan' | 'setup' | 'other'
  periodStart?: string | null
  installment?: number | null
  installments?: number | null
  /** false = no VAT on this invoice (default: VAT per the platform settings). */
  vat?: boolean
}

/**
 * Creates one numbered platform invoice (SM-2026-0001). Returns null when a schedule/setup invoice already exists —
 * checked BEFORE a number is drawn: sequences are not transactional, so a draw absorbed by the unique index (left
 * as the guard against a race) would leave a gap in the invoice numbers.
 */
export async function createPlatformInvoice(db: DbOrTx, tenantId: string, input: InvoiceInput) {
  const kind = input.kind ?? 'other'
  const live = and(eq(platformInvoices.tenantId, tenantId), ne(platformInvoices.status, 'void'))
  const same =
    kind === 'setup'
      ? and(live, eq(platformInvoices.kind, 'setup'))
      : kind === 'plan' && input.periodStart && input.installments && input.installment
        ? and(
            live,
            eq(platformInvoices.kind, 'plan'),
            eq(platformInvoices.periodStart, input.periodStart),
            eq(platformInvoices.installments, input.installments),
            eq(platformInvoices.installment, input.installment),
          )
        : null
  if (same) {
    const [exists] = await db.select({ id: platformInvoices.id }).from(platformInvoices).where(same).limit(1)
    if (exists) return null
  }
  const [settings] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1))
  const { rows } = await db.execute<{ n: string }>(sql`select nextval('platform_invoice_seq') as n`)
  const number = `${settings?.invoicePrefix ?? 'SM'}-${input.issueDate.slice(0, 4)}-${String(rows[0]!.n).padStart(4, '0')}`
  const [row] = await db
    .insert(platformInvoices)
    .values({
      tenantId,
      number,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      description: input.description,
      kind,
      periodStart: input.periodStart ?? null,
      installment: input.installment ?? null,
      installments: input.installments ?? null,
      ...invoiceTotals(Number(input.amountAed), settings, input.vat ?? true),
    })
    .onConflictDoNothing()
    .returning()
  return row ?? null
}

const scheduleLabel = (r: ScheduleRow, periodStart: string) => {
  const year = periodStart.slice(0, 4)
  return r.installments === 1
    ? `Annual subscription from ${periodStart} (one-time)`
    : `Subscription ${year}–${Number(year) + 1} · month ${r.installment} of ${r.installments}`
}

/**
 * Issues the plan invoices for the current subscription period (12 monthly or one annual) plus the one-off setup
 * fee when set. Idempotent: existing invoices are kept. Switching the payment plan voids the unpaid invoices of the
 * other plan for the same period; if any of them is already paid it refuses (sort that out by hand first).
 * Console "Generate payment schedule"; accepting an application runs the same code (`generateBillingScheduleTx`).
 */
export const generateBillingSchedule = (db: Db, tenantId: string, today: string) =>
  db.transaction((tx) => generateBillingScheduleTx(tx, tenantId, today))

/** `generateBillingSchedule` inside the caller's platform transaction. */
export async function generateBillingScheduleTx(tx: Tx, tenantId: string, today: string) {
  const [sub] = await tx
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.tenantId, tenantId))
    .for('update')
  if (!sub) throw new DomainError('Save a subscription for this spa first', 'not_found')
  const schedule = planSchedule(sub)
  const expected = schedule[0]!.installments
  const other = await tx
    .select()
    .from(platformInvoices)
    .where(
      and(
        eq(platformInvoices.tenantId, tenantId),
        eq(platformInvoices.kind, 'plan'),
        eq(platformInvoices.periodStart, sub.currentPeriodStart),
        ne(platformInvoices.installments, expected),
        ne(platformInvoices.status, 'void'),
      ),
    )
  if (other.some((i) => i.status === 'paid'))
    throw new DomainError(
      'Invoices of the other payment plan are already paid for this period — mark them unpaid or void them first',
    )
  for (const inv of other)
    await tx.update(platformInvoices).set({ status: 'void' }).where(eq(platformInvoices.id, inv.id))
  let created = 0
  if (Number(sub.priceAed) > 0)
    for (const r of schedule) {
      const row = await createPlatformInvoice(tx, tenantId, {
        description: scheduleLabel(r, sub.currentPeriodStart),
        amountAed: r.amountAed,
        issueDate: today,
        dueDate: r.dueDate,
        kind: 'plan',
        periodStart: sub.currentPeriodStart,
        installment: r.installment,
        installments: r.installments,
      })
      if (row) created++
    }
  if (Number(sub.setupFeeAed) > 0) {
    const row = await createPlatformInvoice(tx, tenantId, {
      description: 'One-time setup fee',
      amountAed: sub.setupFeeAed,
      issueDate: today,
      dueDate: today,
      kind: 'setup',
    })
    if (row) created++
  }
  return { created, voided: other.length }
}

/**
 * Super-admin marks an invoice paid (records a payment for the open balance) or unpaid again (records a
 * reversing payment so the payment history still adds up). Paying the last overdue invoice resolves reminders.
 */
export async function setInvoicePaid(
  db: Db,
  r: {
    tenantId: string
    invoiceId: string
    paid: boolean
    userId: string
    today: string
    method?: 'cash' | 'bank_transfer' | 'other'
    reference?: string | null
  },
) {
  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(platformInvoices)
      .where(and(eq(platformInvoices.id, r.invoiceId), eq(platformInvoices.tenantId, r.tenantId)))
      .for('update')
    if (!inv) throw new DomainError('Invoice not found', 'not_found')
    if (inv.status === 'void') throw new DomainError('This invoice is void')
    const [got] = await tx
      .select({ total: sum(platformPayments.amountAed) })
      .from(platformPayments)
      .where(eq(platformPayments.invoiceId, inv.id))
    const received = Number(got?.total ?? 0)
    if (r.paid) {
      if (inv.status === 'paid') return inv
      const open = Number(inv.totalAed) - received
      if (open > 0.004)
        await tx.insert(platformPayments).values({
          tenantId: r.tenantId,
          invoiceId: inv.id,
          amountAed: open.toFixed(2),
          method: r.method ?? 'bank_transfer',
          reference: r.reference ?? null,
          receivedAt: r.today,
          recordedBy: r.userId,
          notes: 'Marked paid by super-admin',
        })
      const [row] = await tx
        .update(platformInvoices)
        .set({ status: 'paid', paidAt: new Date() })
        .where(eq(platformInvoices.id, inv.id))
        .returning()
      if ((await overdueInvoices(tx, r.tenantId, r.today)).length === 0)
        await resolveReminders(tx, r.tenantId)
      return row!
    }
    if (inv.status !== 'paid') return inv
    if (received > 0.004)
      await tx.insert(platformPayments).values({
        tenantId: r.tenantId,
        invoiceId: inv.id,
        amountAed: (-received).toFixed(2),
        method: 'other',
        receivedAt: r.today,
        recordedBy: r.userId,
        notes: 'Reversal: marked unpaid by super-admin',
      })
    const [row] = await tx
      .update(platformInvoices)
      .set({ status: 'issued', paidAt: null })
      .where(eq(platformInvoices.id, inv.id))
      .returning()
    return row!
  })
}

export type PlatformPaymentMethod = 'cash' | 'bank_transfer' | 'card' | 'other'

/**
 * Records money received (console "Record a payment", the setup fee on accepting an application). Against an
 * invoice: the invoice becomes paid once its payments cover the total (else it stays issued with a balance due),
 * and paying the last overdue invoice resolves reminders. Run inside the caller's platform transaction.
 */
export async function recordPlatformPayment(
  tx: DbOrTx,
  p: {
    tenantId: string
    invoiceId?: string | null
    amountAed: string
    method: PlatformPaymentMethod
    reference?: string | null
    receivedAt: string
    recordedBy: string
    notes?: string | null
    /** Asia/Dubai today: reminders resolve only when nothing is overdue NOW (`receivedAt` may be back-dated). */
    today: string
  },
) {
  let inv: typeof platformInvoices.$inferSelect | undefined
  if (p.invoiceId) {
    ;[inv] = await tx
      .select()
      .from(platformInvoices)
      .where(and(eq(platformInvoices.id, p.invoiceId), eq(platformInvoices.tenantId, p.tenantId)))
      .for('update')
    if (!inv) throw new DomainError('Invoice not found', 'not_found')
    if (inv.status === 'void') throw new DomainError('This invoice is void')
  }
  const [payment] = await tx
    .insert(platformPayments)
    .values({
      tenantId: p.tenantId,
      invoiceId: inv?.id ?? null,
      amountAed: p.amountAed,
      method: p.method,
      reference: p.reference ?? null,
      receivedAt: p.receivedAt,
      recordedBy: p.recordedBy,
      notes: p.notes ?? null,
    })
    .returning()
  if (!inv) return { payment: payment!, invoice: null, paidAed: p.amountAed, balanceAed: '0.00' }
  const [got] = await tx
    .select({ total: sum(platformPayments.amountAed) })
    .from(platformPayments)
    .where(eq(platformPayments.invoiceId, inv.id))
  const paid = Number(got?.total ?? 0)
  const balance = Math.max(0, Number(inv.totalAed) - paid)
  if (balance < 0.005 && inv.status !== 'paid') {
    ;[inv] = await tx
      .update(platformInvoices)
      .set({ status: 'paid', paidAt: new Date() })
      .where(eq(platformInvoices.id, inv.id))
      .returning()
    if ((await overdueInvoices(tx, p.tenantId, p.today)).length === 0) await resolveReminders(tx, p.tenantId)
  }
  return { payment: payment!, invoice: inv!, paidAed: paid.toFixed(2), balanceAed: balance.toFixed(2) }
}

/** Money received per invoice (invoice id → AED), for "paid / balance due" columns. Tenant tx or platform role. */
export async function invoicePaidTotals(db: DbOrTx, tenantId: string) {
  const rows = await db
    .select({ invoiceId: platformPayments.invoiceId, total: sum(platformPayments.amountAed) })
    .from(platformPayments)
    .where(and(eq(platformPayments.tenantId, tenantId), isNotNull(platformPayments.invoiceId)))
    .groupBy(platformPayments.invoiceId)
  return new Map(rows.map((r) => [r.invoiceId!, Number(r.total ?? 0)]))
}

/** Issued (unpaid) invoices whose due date has passed. Works on a tenant-scoped tx or the platform role. */
export function overdueInvoices(db: DbOrTx, tenantId: string, today: string) {
  return db
    .select()
    .from(platformInvoices)
    .where(
      and(
        eq(platformInvoices.tenantId, tenantId),
        eq(platformInvoices.status, 'issued'),
        lt(platformInvoices.dueDate, today),
      ),
    )
    .orderBy(asc(platformInvoices.dueDate))
}

/**
 * What the spa's red bar / Billing page need: overdue invoices and the latest open reminder. A reminder only shows
 * while the spa still has an unpaid invoice (so paying by card hides it without a super-admin step).
 */
export async function billingAlert(db: DbOrTx, tenantId: string, today: string) {
  const overdue = await overdueInvoices(db, tenantId, today)
  const [reminder] = await db
    .select()
    .from(platformReminders)
    .where(and(eq(platformReminders.tenantId, tenantId), isNull(platformReminders.resolvedAt)))
    .orderBy(sql`${platformReminders.createdAt} desc`)
    .limit(1)
  const [unpaid] = reminder
    ? await db
        .select({ id: platformInvoices.id })
        .from(platformInvoices)
        .where(and(eq(platformInvoices.tenantId, tenantId), eq(platformInvoices.status, 'issued')))
        .limit(1)
    : []
  return {
    overdue,
    overdueAed: overdue.reduce((s, i) => s + Number(i.totalAed), 0),
    reminder: reminder && unpaid ? reminder : null,
  }
}

export async function resolveReminders(db: DbOrTx, tenantId: string) {
  await db
    .update(platformReminders)
    .set({ resolvedAt: new Date() })
    .where(and(eq(platformReminders.tenantId, tenantId), isNull(platformReminders.resolvedAt)))
}

const aed = (n: number) =>
  `AED ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const longDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Creates a payment reminder (shown in the spa's dashboard) and returns the ready-to-send message text. Covers the
 * overdue invoices, or the next unpaid one when nothing is overdue yet. Sending is click-to-send by a human.
 */
export async function createPaymentReminder(
  db: Db,
  r: { tenantId: string; userId: string; today: string; billingUrl: string },
) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, r.tenantId))
  if (!tenant) throw new DomainError('Spa not found', 'not_found')
  let due = await overdueInvoices(db, r.tenantId, r.today)
  if (due.length === 0)
    due = await db
      .select()
      .from(platformInvoices)
      .where(and(eq(platformInvoices.tenantId, r.tenantId), eq(platformInvoices.status, 'issued')))
      .orderBy(asc(platformInvoices.dueDate))
      .limit(1)
  if (due.length === 0) throw new DomainError('Nothing to remind — this spa has no unpaid invoices')
  const [settings] = await db.select().from(platformSettings).where(eq(platformSettings.id, 1))
  const total = due.reduce((s, i) => s + Number(i.totalAed), 0)
  const lines = due.map((i) => `• ${i.number} — ${aed(Number(i.totalAed))}, due ${longDate(i.dueDate)}`)
  const overdue = due[0]!.dueDate < r.today
  const message = [
    `Hello ${tenant.name},`,
    `This is a friendly reminder from ${settings?.companyName ?? 'spamanagement.co'}: ${
      overdue ? 'the following invoice is overdue' : 'the following invoice is due'
    }${due.length > 1 ? 's' : ''}.`,
    ...lines,
    `Total: ${aed(total)}.`,
    'Please pay to avoid your account being paused. You can pay by bank transfer, cash or card from your Billing page:',
    r.billingUrl,
    'Thank you!',
  ].join('\n')
  const [reminder] = await db
    .insert(platformReminders)
    .values({ tenantId: r.tenantId, message, amountAed: total.toFixed(2), createdBy: r.userId })
    .returning()
  return { reminder: reminder!, message }
}

/** Pause (late payment): the dashboard becomes read-only; the public site and online booking keep working. */
export async function pauseTenant(db: DbOrTx, tenantId: string) {
  const [row] = await db
    .update(tenants)
    .set({ status: 'read_only' })
    .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
    .returning()
  if (!row) throw new DomainError('Spa not found', 'not_found')
  return row
}

/** Resume a paused, suspended or deleted spa: back to trial while the subscription is trialing, else active. */
export async function resumeTenant(db: DbOrTx, tenantId: string) {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId))
  const [row] = await db
    .update(tenants)
    .set({ status: sub?.status === 'trialing' ? 'trial' : 'active', deletedAt: null })
    .where(eq(tenants.id, tenantId))
    .returning()
  if (!row) throw new DomainError('Spa not found', 'not_found')
  return row
}

/**
 * Soft delete: the super-admin types the spa's address (slug) to confirm. Status becomes 'cancelled' (site and
 * booking off, dashboard closed to members); every row is kept so the spa can be restored or exported.
 */
export async function deleteTenant(db: DbOrTx, tenantId: string, confirmSlug: string) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId))
  if (!tenant) throw new DomainError('Spa not found', 'not_found')
  if (confirmSlug.trim().toLowerCase() !== tenant.slug)
    throw new DomainError(`Type ${tenant.slug} to confirm`)
  const [row] = await db
    .update(tenants)
    .set({ status: 'cancelled', deletedAt: new Date() })
    .where(eq(tenants.id, tenantId))
    .returning()
  return row!
}

/**
 * One-off data fix (owner decision 2026-10-08, also in migration 0021): subscriptions stored as a monthly price
 * (12-month plan, or ≈ the plan's yearly price / 12) become the yearly price × 12 on the 12-month plan; yearly
 * ones are unchanged. Idempotent: a converted price is no longer below half the plan's yearly price.
 */
export async function convertMonthlySubscriptions(db: DbOrTx) {
  const rows = await db.execute<{ id: string }>(sql`
    UPDATE subscriptions s SET price_aed = round(s.price_aed * 12, 2), billing_interval = 'month', updated_at = now()
    FROM plans p
    WHERE p.id = s.plan_id AND s.price_aed > 0 AND s.price_aed * 2 < p.price_aed
      AND (s.billing_interval = 'month' OR abs(s.price_aed * 12 - p.price_aed) <= p.price_aed * 0.05)
    RETURNING s.id`)
  return rows.rows.map((r) => r.id)
}

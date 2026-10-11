import {
  closeAllDbs,
  plans,
  platformInvoices,
  platformPayments,
  platformReminders,
  platformSettings,
  subscriptions,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addMonths,
  billingAlert,
  cardPayableInvoice,
  createPaymentReminder,
  createPlatformInvoice,
  DomainError,
  deleteTenant,
  generateBillingSchedule,
  invoiceTotals,
  pauseTenant,
  planSchedule,
  recordPlatformPayment,
  resumeTenant,
  setInvoicePaid,
  settleCheckoutSession,
  toFils,
} from '../src'

describe('platform billing helpers', () => {
  it('adds months and clamps to the month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-10-08', 11)).toBe('2027-09-08')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
  })

  it('splits AED 24,000 into 12 × 2,000, or one annual invoice', () => {
    const monthly = planSchedule({
      priceAed: '24000',
      billingInterval: 'month',
      currentPeriodStart: '2026-10-08',
    })
    expect(monthly).toHaveLength(12)
    expect(monthly.every((r) => r.amountAed === '2000.00' && r.installments === 12)).toBe(true)
    expect(monthly[0]!.dueDate).toBe('2026-10-08')
    expect(monthly[11]!.dueDate).toBe('2027-09-08')
    const annual = planSchedule({
      priceAed: '24000',
      billingInterval: 'year',
      currentPeriodStart: '2026-10-08',
    })
    expect(annual).toEqual([
      { installment: 1, installments: 1, dueDate: '2026-10-08', amountAed: '24000.00' },
    ])
  })

  it('puts cents rounding on the last installment so the total is exact', () => {
    const rows = planSchedule({
      priceAed: '1000',
      billingInterval: 'month',
      currentPeriodStart: '2026-01-01',
    })
    expect(rows[0]!.amountAed).toBe('83.33')
    expect(rows[11]!.amountAed).toBe('83.37')
    expect(rows.reduce((s, r) => s + Math.round(Number(r.amountAed) * 100), 0)).toBe(100000)
  })

  it('adds or extracts VAT per platform settings', () => {
    expect(invoiceTotals(2000, { vatRate: '5', pricesIncludeVat: false })).toEqual({
      subtotalAed: '2000.00',
      vatAed: '100.00',
      totalAed: '2100.00',
    })
    expect(invoiceTotals(2100, { vatRate: '5', pricesIncludeVat: true }).subtotalAed).toBe('2000.00')
  })
})

describe('platform billing (db)', () => {
  const { platform, app } = testDbs()
  const ids = {} as { a: string; b: string; plan: string }
  const today = '2026-10-08'

  beforeAll(async () => {
    await resetTestDatabase()
    const now = new Date()
    await platform.insert(user).values({
      id: 'u-admin',
      name: 'Ops',
      email: 'ops@example.com',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    await platform
      .insert(platformSettings)
      .values({ id: 1, companyName: 'spamanagement.co', invoicePrefix: 'SM' })
    const [plan] = await platform
      .insert(plans)
      .values({ code: 'spa', name: 'Spa', priceAed: '24000' })
      .returning()
    ids.plan = plan!.id
    const [a] = await platform
      .insert(tenants)
      .values({ slug: 'bill-a', name: 'Serenity', status: 'active' })
      .returning()
    const [b] = await platform
      .insert(tenants)
      .values({ slug: 'bill-b', name: 'Other', status: 'active' })
      .returning()
    ids.a = a!.id
    ids.b = b!.id
  })
  afterAll(closeAllDbs)

  const sub = (billingInterval: 'month' | 'year', setupFeeAed = '0') =>
    platform
      .insert(subscriptions)
      .values({
        tenantId: ids.a,
        planId: ids.plan,
        status: 'active',
        priceAed: '24000',
        setupFeeAed,
        billingInterval,
        currentPeriodStart: '2026-09-20',
        currentPeriodEnd: '2027-08-31',
      })
      .onConflictDoUpdate({ target: subscriptions.tenantId, set: { billingInterval, setupFeeAed } })
  const planInvoices = () =>
    platform
      .select()
      .from(platformInvoices)
      .where(and(eq(platformInvoices.tenantId, ids.a), eq(platformInvoices.kind, 'plan')))
      .orderBy(platformInvoices.installment)

  it('refuses without a subscription', async () => {
    await expect(generateBillingSchedule(platform, ids.a, today)).rejects.toBeInstanceOf(DomainError)
  })

  it('issues 12 monthly invoices + one setup invoice, idempotently', async () => {
    await sub('month', '5000')
    expect(await generateBillingSchedule(platform, ids.a, today)).toEqual({ created: 13, voided: 0 })
    expect(await generateBillingSchedule(platform, ids.a, today)).toEqual({ created: 0, voided: 0 })
    // The idempotent re-run drew no invoice numbers: the next invoice continues the sequence without a gap.
    const seq = (n: string) => Number(n.slice(-4))
    const numbers = await platform.select({ n: platformInvoices.number }).from(platformInvoices)
    const next = await createPlatformInvoice(platform, ids.a, {
      description: 'Gap check',
      amountAed: '10',
      issueDate: today,
      dueDate: today,
    })
    expect(seq(next!.number)).toBe(Math.max(...numbers.map((r) => seq(r.n))) + 1)
    await platform.update(platformInvoices).set({ status: 'void' }).where(eq(platformInvoices.id, next!.id))
    const rows = await planInvoices()
    expect(rows).toHaveLength(12)
    expect(rows[0]).toMatchObject({
      installment: 1,
      installments: 12,
      dueDate: '2026-09-20',
      totalAed: '2100.00',
    })
    expect(rows[0]!.number).toMatch(/^SM-2026-\d{4}$/)
    const [setup] = await platform
      .select()
      .from(platformInvoices)
      .where(and(eq(platformInvoices.tenantId, ids.a), eq(platformInvoices.kind, 'setup')))
    expect(setup).toMatchObject({ subtotalAed: '5000.00', totalAed: '5250.00', dueDate: today })
  })

  it('the spa sees overdue invoices through RLS, other spas see nothing', async () => {
    const alertA = await withTenant(ids.a, (tx) => billingAlert(tx, ids.a, today), app)
    // Sept installment (due 2026-09-20) is overdue; month 2 (Oct 20) and setup (due today) are not yet.
    expect(alertA.overdue.map((i) => i.installment)).toEqual([1])
    expect(alertA.overdueAed).toBe(2100)
    const alertB = await withTenant(ids.b, (tx) => billingAlert(tx, ids.a, today), app)
    expect(alertB.overdue).toHaveLength(0)
  })

  it('creates a reminder with a ready message; paying the overdue invoice resolves it', async () => {
    const { reminder, message } = await createPaymentReminder(platform, {
      tenantId: ids.a,
      userId: 'u-admin',
      today,
      billingUrl: 'https://app.example/bill-a/billing',
    })
    expect(reminder.amountAed).toBe('2100.00')
    expect(message).toContain('Hello Serenity')
    expect(message).toContain('AED 2,100.00')
    expect(message).toContain('avoid your account being paused')
    expect(message).toContain('https://app.example/bill-a/billing')
    expect((await withTenant(ids.a, (tx) => billingAlert(tx, ids.a, today), app)).reminder?.id).toBe(
      reminder.id,
    )

    const [first] = await planInvoices()
    const paid = await setInvoicePaid(platform, {
      tenantId: ids.a,
      invoiceId: first!.id,
      paid: true,
      userId: 'u-admin',
      today,
    })
    expect(paid.status).toBe('paid')
    const pays = await platform
      .select()
      .from(platformPayments)
      .where(eq(platformPayments.invoiceId, first!.id))
    expect(pays.map((p) => p.amountAed)).toEqual(['2100.00'])
    const [rem] = await platform.select().from(platformReminders).where(eq(platformReminders.id, reminder.id))
    expect(rem!.resolvedAt).not.toBeNull()
    const alert = await billingAlert(platform, ids.a, today)
    expect(alert.overdue).toHaveLength(0)
    expect(alert.reminder).toBeNull()
  })

  it('marking unpaid records a reversal and reopens the invoice; wrong tenant is refused', async () => {
    const [first] = await planInvoices()
    await expect(
      setInvoicePaid(platform, {
        tenantId: ids.b,
        invoiceId: first!.id,
        paid: false,
        userId: 'u-admin',
        today,
      }),
    ).rejects.toBeInstanceOf(DomainError)
    const row = await setInvoicePaid(platform, {
      tenantId: ids.a,
      invoiceId: first!.id,
      paid: false,
      userId: 'u-admin',
      today,
    })
    expect(row).toMatchObject({ status: 'issued', paidAt: null })
    const pays = await platform
      .select()
      .from(platformPayments)
      .where(eq(platformPayments.invoiceId, first!.id))
    expect(pays.map((p) => p.amountAed).sort()).toEqual(['-2100.00', '2100.00'])
    // Paying again only records the open balance once more.
    await setInvoicePaid(platform, {
      tenantId: ids.a,
      invoiceId: first!.id,
      paid: true,
      userId: 'u-admin',
      today,
    })
    const again = await platform
      .select()
      .from(platformPayments)
      .where(eq(platformPayments.invoiceId, first!.id))
    expect(again.reduce((s, p) => s + Number(p.amountAed), 0)).toBe(2100)
  })

  it('switching to one-time refuses while a monthly invoice is paid, then voids the unpaid ones', async () => {
    await sub('year', '5000')
    await expect(generateBillingSchedule(platform, ids.a, today)).rejects.toThrow(/already paid/)
    const [first] = await planInvoices()
    await setInvoicePaid(platform, {
      tenantId: ids.a,
      invoiceId: first!.id,
      paid: false,
      userId: 'u-admin',
      today,
    })
    expect(await generateBillingSchedule(platform, ids.a, today)).toEqual({ created: 1, voided: 12 })
    const live = (await planInvoices()).filter((i) => i.status !== 'void')
    expect(live).toHaveLength(1)
    expect(live[0]).toMatchObject({ installments: 1, totalAed: '25200.00' })
  })

  it('reminder needs an unpaid invoice', async () => {
    await expect(
      createPaymentReminder(platform, { tenantId: ids.b, userId: 'u-admin', today, billingUrl: 'x' }),
    ).rejects.toThrow(/no unpaid invoices/)
  })

  it('a back-dated payment keeps the reminder while another invoice is still overdue today', async () => {
    const [c] = await platform
      .insert(tenants)
      .values({ slug: 'bill-c', name: 'Third', status: 'active' })
      .returning()
    const invoice = (description: string, dueDate: string) =>
      createPlatformInvoice(platform, c!.id, {
        description,
        amountAed: '100',
        issueDate: '2026-08-01',
        dueDate,
      })
    const later = await invoice('A', '2026-10-01')
    const earlier = await invoice('B', '2026-09-01')
    const { reminder } = await createPaymentReminder(platform, {
      tenantId: c!.id,
      userId: 'u-admin',
      today,
      billingUrl: 'x',
    })
    const pay = (inv: typeof later, receivedAt: string) =>
      platform.transaction((tx) =>
        recordPlatformPayment(tx, {
          tenantId: c!.id,
          invoiceId: inv!.id,
          amountAed: inv!.totalAed,
          method: 'bank_transfer',
          receivedAt,
          recordedBy: 'u-admin',
          today,
        }),
      )
    const resolvedAt = async () =>
      (await platform.select().from(platformReminders).where(eq(platformReminders.id, reminder.id)))[0]!
        .resolvedAt
    // B was paid on 15 Sep (nothing else due by then), but A is overdue today: the reminder stays.
    expect((await pay(earlier, '2026-09-15')).invoice?.status).toBe('paid')
    expect(await resolvedAt()).toBeNull()
    await pay(later, '2026-10-05')
    expect(await resolvedAt()).not.toBeNull()
  })

  it('card: only an untouched open invoice; a Checkout paid after a deposit is recorded and flagged', async () => {
    const [d] = await platform
      .insert(tenants)
      .values({ slug: 'bill-d', name: 'Fourth', status: 'active' })
      .returning()
    const inv = (await createPlatformInvoice(platform, d!.id, {
      description: 'One-time setup fee',
      amountAed: '1000',
      issueDate: today,
      dueDate: today,
      kind: 'setup',
    }))!
    expect(await cardPayableInvoice(platform, d!.id, inv.id)).toMatchObject({ invoice: { id: inv.id } })
    expect(await cardPayableInvoice(platform, ids.b, inv.id)).toEqual({ error: 'notFound' })
    await platform.transaction((tx) =>
      recordPlatformPayment(tx, {
        tenantId: d!.id,
        invoiceId: inv.id,
        amountAed: '400.00',
        method: 'cash',
        receivedAt: today,
        recordedBy: 'u-admin',
        today,
      }),
    )
    // Checkout would charge the full total on top of the deposit.
    expect(await cardPayableInvoice(platform, d!.id, inv.id)).toEqual({ error: 'partlyPaid' })
    // A Checkout opened before the deposit was recorded and paid afterwards: kept, flagged for a refund.
    const settled = await settleCheckoutSession(platform, inv, {
      id: 'cs_test_late',
      url: null,
      status: 'complete',
      payment_status: 'paid',
      amount_total: toFils(inv.totalAed),
      currency: 'aed',
      payment_intent: 'pi_late',
      metadata: { invoice_id: inv.id, tenant_id: d!.id },
    })
    expect(settled).toBe(true)
    const pays = await platform.select().from(platformPayments).where(eq(platformPayments.invoiceId, inv.id))
    const card = pays.find((p) => p.method === 'card')
    expect(card).toMatchObject({ amountAed: '1050.00', reference: 'stripe:pi_late' })
    expect(card?.notes).toContain('OVERPAID by AED 400.00')
    const [after] = await platform.select().from(platformInvoices).where(eq(platformInvoices.id, inv.id))
    expect(after?.status).toBe('paid')
    expect(await cardPayableInvoice(platform, d!.id, inv.id)).toEqual({ error: 'notOpen' })
  })

  it('pauses, resumes and soft-deletes (slug confirmation, data kept)', async () => {
    expect((await pauseTenant(platform, ids.a)).status).toBe('read_only')
    expect((await resumeTenant(platform, ids.a)).status).toBe('active')
    await expect(deleteTenant(platform, ids.a, 'wrong')).rejects.toThrow(/Type bill-a/)
    const deleted = await deleteTenant(platform, ids.a, ' Bill-A ')
    expect(deleted.status).toBe('cancelled')
    expect(deleted.deletedAt).not.toBeNull()
    await expect(pauseTenant(platform, ids.a)).rejects.toBeInstanceOf(DomainError)
    expect(await planInvoices()).not.toHaveLength(0)
    const restored = await resumeTenant(platform, ids.a)
    expect(restored).toMatchObject({ status: 'active', deletedAt: null })
  })
})

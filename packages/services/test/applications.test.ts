// Spa applications (PLAN §18.3): submit → accept (spa provisioned, active subscription, setup invoice + payment,
// full and deposit, VAT on/off, balance due on the start date or 10 days after, the plan's schedule from the start
// date, idempotent with "Generate payment schedule") / reject (login disabled, sessions revoked), slug held by a pending application, platform-only
// table (a spa's app role can neither read nor write it).

import { depositRule } from '@spa/core'
import {
  branches,
  closeAllDbs,
  members,
  plans,
  platformInvoices,
  platformPayments,
  platformSettings,
  roles,
  session,
  spaApplications,
  storedFiles,
  subscriptions,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { and, eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acceptApplication,
  DomainError,
  generateBillingSchedule,
  latestApplication,
  pendingApplicationCount,
  processLogo,
  recordPlatformPayment,
  rejectApplication,
  slugStatus,
  submitApplication,
} from '../src'

const { platform, app } = testDbs()
const today = '2026-10-09'
const ids: Record<string, string> = {}
const seq = (number: string) => Number(number.slice(-4))
// Money prints with a no-break space after "AED".
const plain = (s: string) => s.replace(/ /g, ' ')
const DEPOSIT_RANGE = depositRule(5250, true)
const drawn = async () =>
  Number(
    (await platform.execute<{ n: string }>(sql`select last_value as n from platform_invoice_seq`)).rows[0]!.n,
  )
const invoicesOf = (tenantId: string, kind: 'plan' | 'setup') =>
  platform
    .select()
    .from(platformInvoices)
    .where(and(eq(platformInvoices.tenantId, tenantId), eq(platformInvoices.kind, kind)))
    .orderBy(platformInvoices.installment)

async function newUser(key: string) {
  const id = `u-${key}`
  await platform.insert(user).values({ id, name: `Applicant ${key}`, email: `${key}@apply.test` })
  return id
}

const form = (
  userId: string,
  slug: string,
  extra: Partial<Parameters<typeof submitApplication>[1]> = {},
) => ({
  userId,
  applicantName: 'Aisha Rahman',
  email: `${userId}@apply.test`,
  phone: '+971501234567',
  spaName: 'Serenity Spa',
  slug,
  emirate: 'dubai',
  streetAddress: 'Marina Walk, Tower 2',
  planId: ids.feePlan!,
  preferredStart: '2026-10-15',
  notes: 'Two rooms',
  today,
  ...extra,
})

beforeAll(async () => {
  await resetTestDatabase()
  await platform.insert(platformSettings).values({ id: 1, invoicePrefix: 'SM', vatRate: '5' })
  const [fee] = await platform
    .insert(plans)
    .values({ code: 'std', name: 'Standard', priceAed: '24000', setupFeeAed: '5000' })
    .returning()
  const [free] = await platform
    .insert(plans)
    .values({ code: 'nofee', name: 'No fee', priceAed: '24000', setupFeeAed: '0', sort: 5 })
    .returning()
  const [monthly] = await platform
    .insert(plans)
    .values({
      code: 'monthly',
      name: 'Monthly',
      priceAed: '24000',
      setupFeeAed: '5000',
      billingInterval: 'month',
      sort: 6,
    })
    .returning()
  ids.feePlan = fee!.id
  ids.freePlan = free!.id
  ids.monthlyPlan = monthly!.id
  ids.admin = await newUser('admin')
})
afterAll(closeAllDbs)

describe('spa applications', () => {
  it('stores a pending application and holds its web address', async () => {
    ids.u1 = await newUser('u1')
    const logo = await processLogo(
      await sharp({ create: { width: 800, height: 800, channels: 3, background: '#0f3d3e' } })
        .png()
        .toBuffer(),
    )
    const row = await submitApplication(platform, {
      ...form(ids.u1, 'serenity'),
      logo: { bytes: logo.bytes, contentType: logo.contentType },
    })
    ids.app1 = row.id
    expect(row).toMatchObject({ status: 'pending', slug: 'serenity', phone: '+971501234567' })
    expect(await pendingApplicationCount(platform)).toBe(1)
    expect(await slugStatus(platform, 'serenity')).toBe('application')
    expect(await slugStatus(platform, 'serenity', { exceptApplicationId: row.id })).toBe('free')
    expect((await latestApplication(platform, ids.u1))?.id).toBe(row.id)
  })

  it('rejects a slug held by another pending application, a second pending one and past start dates', async () => {
    ids.u2 = await newUser('u2')
    await expect(submitApplication(platform, form(ids.u2, 'serenity'))).rejects.toThrow(
      'That address is taken.',
    )
    await expect(submitApplication(platform, form(ids.u1, 'other-spa'))).rejects.toThrow(
      'You already have an application waiting for approval',
    )
    await expect(
      submitApplication(platform, form(ids.u2, 'past-start', { preferredStart: '2026-10-08' })),
    ).rejects.toThrow('Choose a start date from today on')
    await expect(submitApplication(platform, form(ids.u2, 'x', {}))).rejects.toThrow(
      'Use 3–40 lowercase letters, numbers or hyphens.',
    )
    await expect(
      submitApplication(platform, form(ids.u2, 'bad-emirate', { emirate: 'oman' })),
    ).rejects.toThrow('Choose an emirate')
  })

  it('refuses a PLATFORM_ADMIN_EMAILS address (it joins on the admin host instead)', async () => {
    ids.listed = await newUser('listed')
    const listed = ['ahmed@arks.ae', 'u-listed@apply.test']
    const err = await submitApplication(
      platform,
      form(ids.listed, 'admin-spa', { email: 'U-Listed@apply.test' }),
      listed,
    )
      .then(() => null)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DomainError)
    expect((err as DomainError).i18n?.key).toBe('auth.signup.errors.adminEmailField')
    expect(await latestApplication(platform, ids.listed)).toBeFalsy()
    expect(await slugStatus(platform, 'admin-spa')).toBe('free')
  })

  it('accepts with the setup fee paid in full: active spa, owner, invoice paid', async () => {
    const res = await acceptApplication(platform, {
      applicationId: ids.app1!,
      reviewerId: ids.admin!,
      planId: ids.feePlan!,
      startDate: '2026-10-15',
      today,
      payment: { kind: 'full', paidOn: '2026-10-08', method: 'cash', reference: 'R-1', note: null },
    })
    const t = res.tenant
    expect(t).toMatchObject({ slug: 'serenity', name: 'Serenity Spa', status: 'active' })
    expect(t.logoFileId).toBeTruthy()
    expect(res.application).toMatchObject({
      status: 'approved',
      createdTenantId: t.id,
      reviewedBy: ids.admin,
    })
    const [sub] = await platform.select().from(subscriptions).where(eq(subscriptions.tenantId, t.id))
    expect(sub).toMatchObject({
      status: 'active',
      priceAed: '24000.00',
      setupFeeAed: '5000.00',
      currentPeriodStart: '2026-10-15',
      currentPeriodEnd: '2027-10-15',
    })
    const [branch] = await platform.select().from(branches).where(eq(branches.tenantId, t.id))
    expect(branch).toMatchObject({
      isDefault: true,
      address: 'Marina Walk, Tower 2, Dubai',
      phone: '+971501234567',
    })
    const [owner] = await platform
      .select({ key: roles.key })
      .from(members)
      .innerJoin(roles, eq(roles.id, members.roleId))
      .where(eq(members.userId, ids.u1!))
    expect(owner?.key).toBe('owner')
    const [inv] = await invoicesOf(t.id, 'setup')
    // Defaults: VAT as every platform invoice; due 10 days after the start date.
    expect(inv).toMatchObject({
      kind: 'setup',
      subtotalAed: '5000.00',
      vatAed: '250.00',
      totalAed: '5250.00',
      dueDate: '2026-10-25',
    })
    // Subscription fees start from the start date: the yearly plan's one invoice, due on it.
    expect(res.planInvoices).toBe(1)
    expect(await invoicesOf(t.id, 'plan')).toMatchObject([
      {
        periodStart: '2026-10-15',
        installment: 1,
        installments: 1,
        dueDate: '2026-10-15',
        issueDate: today,
        subtotalAed: '24000.00',
        vatAed: '1200.00',
        totalAed: '25200.00',
        status: 'issued',
      },
    ])
    expect(inv?.status).toBe('paid')
    expect(inv?.number).toMatch(/^SM-2026-\d{4}$/)
    const pays = await platform.select().from(platformPayments).where(eq(platformPayments.tenantId, t.id))
    expect(pays).toHaveLength(1)
    expect(pays[0]).toMatchObject({
      amountAed: '5250.00',
      method: 'cash',
      receivedAt: '2026-10-08',
      reference: 'R-1',
    })
    expect(res.setupPayment).toMatchObject({
      kind: 'full',
      amountAed: '5250.00',
      balanceAed: '0.00',
      vat: true,
      dueDate: '2026-10-25',
    })
    expect(res.balanceAed).toBe('0.00')
    // The logo is a public file of the new spa.
    const [file] = await platform.select().from(storedFiles).where(eq(storedFiles.id, t.logoFileId!))
    expect(file).toMatchObject({ tenantId: t.id, isPublic: true, purpose: 'logo' })
    expect(await slugStatus(platform, 'serenity')).toBe('tenant')
    await expect(
      acceptApplication(platform, {
        applicationId: ids.app1!,
        reviewerId: ids.admin!,
        planId: ids.feePlan!,
        startDate: '2026-10-15',
        today,
        payment: null,
      }),
    ).rejects.toThrow('This application was already reviewed')
  })

  it('"Generate payment schedule" after an accept creates nothing and draws no number (same schedule)', async () => {
    const [t] = await platform.select().from(tenants).where(eq(tenants.slug, 'serenity'))
    const [setup] = await invoicesOf(t!.id, 'setup')
    const planRows = await invoicesOf(t!.id, 'plan')
    // Gap-free: the plan invoice follows the setup invoice's number directly.
    expect(planRows.map((r) => seq(r.number))).toEqual([seq(setup!.number) + 1])
    expect(await drawn()).toBe(seq(planRows[0]!.number))
    expect(await generateBillingSchedule(platform, t!.id, today)).toEqual({ created: 0, voided: 0 })
    expect(await drawn()).toBe(seq(planRows[0]!.number))
    expect(await invoicesOf(t!.id, 'plan')).toHaveLength(1)
  })

  it('accepts with a deposit by bank transfer: invoice stays open with the balance; later payment settles it', async () => {
    const a = await submitApplication(platform, form(ids.u2!, 'lotus', { spaName: 'Lotus' }))
    const bad = (amountAed: string) =>
      acceptApplication(platform, {
        applicationId: a.id,
        reviewerId: ids.admin!,
        planId: ids.feePlan!,
        startDate: '2026-10-20',
        today,
        payment: { kind: 'deposit', amountAed, paidOn: today, method: 'bank_transfer' },
      })
    await expect(bad('0')).rejects.toThrow(DEPOSIT_RANGE)
    await expect(bad('5250')).rejects.toThrow(DEPOSIT_RANGE)
    await expect(
      acceptApplication(platform, {
        applicationId: a.id,
        reviewerId: ids.admin!,
        planId: ids.feePlan!,
        startDate: '2026-10-20',
        today,
        payment: { kind: 'full', paidOn: '2026-10-10', method: 'card' },
      }),
    ).rejects.toThrow('The payment date can’t be in the future')
    // Nothing was created by the refused attempts (one transaction).
    expect(await platform.select().from(tenants).where(eq(tenants.slug, 'lotus'))).toHaveLength(0)
    const res = await acceptApplication(platform, {
      applicationId: a.id,
      reviewerId: ids.admin!,
      planId: ids.feePlan!,
      startDate: '2026-10-20',
      today,
      payment: {
        kind: 'deposit',
        amountAed: '2000',
        paidOn: today,
        method: 'bank_transfer',
        reference: 'TT-77',
        balanceDue: 'start',
      },
    })
    expect(res.invoice).toMatchObject({ status: 'issued', totalAed: '5250.00', dueDate: '2026-10-20' })
    expect(res.balanceAed).toBe('3250.00')
    expect(res.setupPayment).toMatchObject({
      kind: 'deposit',
      amountAed: '2000.00',
      method: 'bank_transfer',
      reference: 'TT-77',
      balanceAed: '3250.00',
    })
    // The spa sees its own invoice with the balance (tenant role).
    const seen = await withTenant(res.tenant.id, (tx) => tx.select().from(platformInvoices), app)
    expect(seen.map((i) => `${i.kind}:${i.status}`).sort()).toEqual(['plan:issued', 'setup:issued'])
    // The rest arrives later through Record payment.
    const later = await platform.transaction((tx) =>
      recordPlatformPayment(tx, {
        tenantId: res.tenant.id,
        invoiceId: res.invoice!.id,
        amountAed: '3250.00',
        method: 'cash',
        receivedAt: '2026-10-19',
        recordedBy: ids.admin!,
        today,
      }),
    )
    expect(later).toMatchObject({ balanceAed: '0.00', paidAed: '5250.00' })
    expect(later.invoice?.status).toBe('paid')
    // Another spa's invoice id is refused.
    await expect(
      platform.transaction((tx) =>
        recordPlatformPayment(tx, {
          tenantId: '00000000-0000-4000-8000-000000000000',
          invoiceId: res.invoice!.id,
          amountAed: '1.00',
          method: 'cash',
          receivedAt: today,
          recordedBy: ids.admin!,
          today,
        }),
      ),
    ).rejects.toBeInstanceOf(DomainError)
  })

  it('accepts without VAT, balance due 10 days after start, monthly plan: 12 installments from the start date', async () => {
    ids.u6 = await newUser('u6')
    const a = await submitApplication(platform, form(ids.u6, 'novat', { planId: ids.monthlyPlan! }))
    const accept = (amountAed: string) =>
      acceptApplication(platform, {
        applicationId: a.id,
        reviewerId: ids.admin!,
        planId: ids.monthlyPlan!,
        startDate: '2026-11-30',
        today,
        payment: {
          kind: 'deposit',
          amountAed,
          paidOn: today,
          method: 'bank_transfer',
          chargeVat: false,
          balanceDue: 'start_plus_10',
        },
      })
    // Without VAT the bound is the fee itself (5,000), and the wording says so.
    const noVat = depositRule(5000, false)
    expect(plain(DEPOSIT_RANGE)).toBe(
      'A deposit must be more than AED 0 and less than the setup invoice total (AED 5,250 incl. VAT).',
    )
    expect(plain(noVat)).toBe(
      'A deposit must be more than AED 0 and less than the setup invoice total (AED 5,000, no VAT).',
    )
    await expect(accept('5000')).rejects.toThrow(noVat)
    await expect(accept('0')).rejects.toThrow(noVat)
    await expect(accept('-1')).rejects.toThrow(noVat)
    const before = await drawn()
    const res = await accept('4999.99')
    expect(res.invoice).toMatchObject({
      kind: 'setup',
      subtotalAed: '5000.00',
      vatAed: '0.00',
      totalAed: '5000.00',
      status: 'issued',
      dueDate: '2026-12-10',
    })
    expect(res.balanceAed).toBe('0.01')
    expect(res.setupPayment).toMatchObject({ vat: false, dueDate: '2026-12-10', invoiceTotalAed: '5000.00' })
    // Monthly: 12 x AED 2,000 (+ VAT per the settings; the choice is for the setup invoice only) from 30 Nov.
    const rows = await invoicesOf(res.tenant.id, 'plan')
    expect(res.planInvoices).toBe(12)
    expect(rows).toHaveLength(12)
    expect(rows.map((r) => r.dueDate).slice(0, 4)).toEqual([
      '2026-11-30',
      '2026-12-30',
      '2027-01-30',
      '2027-02-28',
    ])
    expect(new Set(rows.map((r) => r.totalAed))).toEqual(new Set(['2100.00']))
    expect(new Set(rows.map((r) => r.periodStart))).toEqual(new Set(['2026-11-30']))
    // 13 numbers drawn, in order, none burnt; the button afterwards changes nothing.
    expect(await drawn()).toBe(before + 13)
    expect(await generateBillingSchedule(platform, res.tenant.id, today)).toEqual({ created: 0, voided: 0 })
    expect(await drawn()).toBe(before + 13)
    expect(await invoicesOf(res.tenant.id, 'plan')).toHaveLength(12)
    expect(await invoicesOf(res.tenant.id, 'setup')).toHaveLength(1)
  })

  it('a start date before today keeps the setup invoice due today at the earliest', async () => {
    ids.u7 = await newUser('u7')
    const a = await submitApplication(platform, form(ids.u7, 'backdated'))
    const res = await acceptApplication(platform, {
      applicationId: a.id,
      reviewerId: ids.admin!,
      planId: ids.feePlan!,
      startDate: '2026-09-25',
      today,
      payment: { kind: 'deposit', amountAed: '100', paidOn: today, method: 'cash', balanceDue: 'start' },
    })
    expect(res.invoice?.dueDate).toBe(today)
    expect((await invoicesOf(res.tenant.id, 'plan'))[0]?.dueDate).toBe('2026-09-25')
  })

  it('an accept that fails (logo step) creates nothing and draws no invoice number', async () => {
    ids.u5 = await newUser('u5')
    // An empty stored logo makes the logo step (the last one) fail: "The file is empty".
    const a = await submitApplication(platform, {
      ...form(ids.u5, 'late-fail'),
      logo: { bytes: Buffer.alloc(0), contentType: 'image/webp' },
    })
    const count = async (table: typeof platformInvoices | typeof platformPayments | typeof subscriptions) =>
      (await platform.select({ n: sql<number>`count(*)::int` }).from(table))[0]!.n
    const before = [await count(platformInvoices), await count(platformPayments), await count(subscriptions)]
    const seqBefore = await drawn()
    await expect(
      acceptApplication(platform, {
        applicationId: a.id,
        reviewerId: ids.admin!,
        planId: ids.feePlan!,
        startDate: today,
        today,
        payment: { kind: 'deposit', amountAed: '1000', paidOn: today, method: 'cash' },
      }),
    ).rejects.toThrow('The file is empty')
    expect(await platform.select().from(tenants).where(eq(tenants.slug, 'late-fail'))).toHaveLength(0)
    expect(await platform.select().from(members).where(eq(members.userId, ids.u5!))).toEqual([])
    expect([
      await count(platformInvoices),
      await count(platformPayments),
      await count(subscriptions),
    ]).toEqual(before)
    // The logo step runs before any invoice is numbered: no gap.
    expect(await drawn()).toBe(seqBefore)
    const [still] = await platform.select().from(spaApplications).where(eq(spaApplications.id, a.id))
    expect(still).toMatchObject({ status: 'pending', createdTenantId: null, setupPayment: null })
  })

  it('skips the payment when the plan has no setup fee', async () => {
    ids.u3 = await newUser('u3')
    const a = await submitApplication(platform, form(ids.u3, 'nofee-spa', { planId: ids.freePlan! }))
    const res = await acceptApplication(platform, {
      applicationId: a.id,
      reviewerId: ids.admin!,
      planId: ids.freePlan!,
      startDate: today,
      today,
      payment: null,
    })
    expect(res.invoice).toBeNull()
    expect(res.setupPayment).toMatchObject({ kind: 'none' })
    expect(await invoicesOf(res.tenant.id, 'setup')).toEqual([])
    // The subscription invoice is still issued from the start date.
    expect(await invoicesOf(res.tenant.id, 'plan')).toMatchObject([{ dueDate: today, totalAed: '25200.00' }])
  })

  it('refuses a setup-fee plan without the payment', async () => {
    ids.u4 = await newUser('u4')
    const a = await submitApplication(platform, form(ids.u4, 'needs-pay'))
    await expect(
      acceptApplication(platform, {
        applicationId: a.id,
        reviewerId: ids.admin!,
        planId: ids.feePlan!,
        startDate: today,
        today,
        payment: null,
      }),
    ).rejects.toThrow('Record how the setup fee was paid')
    ids.app4 = a.id
  })

  it('rejects: the login is disabled and its sessions revoked; the reason is kept with its share flag', async () => {
    await platform.insert(session).values({
      id: 's-u4',
      token: 'tok-u4',
      userId: ids.u4!,
      expiresAt: new Date(Date.now() + 86_400_000),
    })
    const res = await rejectApplication(platform, {
      applicationId: ids.app4!,
      reviewerId: ids.admin!,
      reason: 'Outside our service area',
      shareReason: true,
    })
    expect(res).toMatchObject({ disabled: true, sessionsRevoked: 1 })
    expect(res.application).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Outside our service area',
      shareReason: true,
    })
    const [u] = await platform.select().from(user).where(eq(user.id, ids.u4!))
    expect(u?.disabledAt).toBeInstanceOf(Date)
    expect(await platform.select().from(session).where(eq(session.userId, ids.u4!))).toEqual([])
    // The address is free again once the application is closed.
    expect(await slugStatus(platform, 'needs-pay')).toBe('free')
    await expect(
      rejectApplication(platform, { applicationId: ids.app4!, reviewerId: ids.admin! }),
    ).rejects.toThrow('This application was already reviewed')
  })

  it('keeps a login that is already a member of another spa when its new application is rejected', async () => {
    // u1 owns "serenity" (accepted above) and applies for a second spa.
    const a = await submitApplication(platform, form(ids.u1!, 'serenity-two'))
    const res = await rejectApplication(platform, { applicationId: a.id, reviewerId: ids.admin!, reason: '' })
    expect(res.disabled).toBe(false)
    expect(res.application).toMatchObject({ rejectionReason: null, shareReason: false })
    const [u] = await platform.select().from(user).where(eq(user.id, ids.u1!))
    expect(u?.disabledAt).toBeNull()
  })

  it('is a platform-only table: a spa (app role) can neither read nor write applications', async () => {
    const [t] = await platform.select().from(tenants).where(eq(tenants.slug, 'serenity'))
    const rows = await withTenant(t!.id, (tx) => tx.select().from(spaApplications), app)
    expect(rows).toEqual([])
    await expect(
      withTenant(
        t!.id,
        (tx) =>
          tx.execute(
            sql`update spa_applications set status = 'approved' where status = 'pending' returning id`,
          ),
        app,
      ),
    ).resolves.toMatchObject({ rows: [] })
    await expect(
      app.execute(sql`insert into spa_applications (user_id, applicant_name, email, phone, spa_name, slug, emirate,
        street_address, preferred_start) values (${ids.u2}, 'x', 'x@x', '+971501234567', 'x', 'sneaky', 'dubai', 'x', ${today})`),
    ).rejects.toThrow()
  })
})

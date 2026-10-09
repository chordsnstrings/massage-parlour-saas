// Spa applications (PLAN §18.3): submit → accept (spa provisioned, active subscription, setup invoice + payment,
// full and deposit) / reject (login disabled, sessions revoked), slug held by a pending application, platform-only
// table (a spa's app role can neither read nor write it).
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
import { eq, sql } from 'drizzle-orm'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acceptApplication,
  DomainError,
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
  ids.feePlan = fee!.id
  ids.freePlan = free!.id
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
    const [inv] = await platform.select().from(platformInvoices).where(eq(platformInvoices.tenantId, t.id))
    expect(inv).toMatchObject({
      kind: 'setup',
      subtotalAed: '5000.00',
      vatAed: '250.00',
      totalAed: '5250.00',
    })
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
    expect(res.setupPayment).toMatchObject({ kind: 'full', amountAed: '5250.00', balanceAed: '0.00' })
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
    await expect(bad('0')).rejects.toThrow('A deposit must be more than 0 and less than the setup fee')
    await expect(bad('5250')).rejects.toThrow('A deposit must be more than 0 and less than the setup fee')
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
    const seen = await withTenant(res.tenant.id, (tx) => tx.select().from(platformInvoices))
    expect(seen.map((i) => i.status)).toEqual(['issued'])
    // The rest arrives later through Record payment.
    const later = await platform.transaction((tx) =>
      recordPlatformPayment(tx, {
        tenantId: res.tenant.id,
        invoiceId: res.invoice!.id,
        amountAed: '3250.00',
        method: 'cash',
        receivedAt: '2026-10-19',
        recordedBy: ids.admin!,
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
        }),
      ),
    ).rejects.toBeInstanceOf(DomainError)
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
    expect(
      await platform.select().from(platformInvoices).where(eq(platformInvoices.tenantId, res.tenant.id)),
    ).toEqual([])
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
    const rows = await withTenant(t!.id, (tx) => tx.select().from(spaApplications))
    expect(rows).toEqual([])
    await expect(
      withTenant(t!.id, (tx) =>
        tx.execute(
          sql`update spa_applications set status = 'approved' where status = 'pending' returning id`,
        ),
      ),
    ).resolves.toMatchObject({ rows: [] })
    await expect(
      app.execute(sql`insert into spa_applications (user_id, applicant_name, email, phone, spa_name, slug, emirate,
        street_address, preferred_start) values (${ids.u2}, 'x', 'x@x', '+971501234567', 'x', 'sneaky', 'dubai', 'x', ${today})`),
    ).rejects.toThrow()
  })
})

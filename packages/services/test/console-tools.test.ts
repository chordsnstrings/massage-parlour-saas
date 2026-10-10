// F20 (feature flags, announcements), F21 (console tenant usage list), F22 (automatic billing transitions).
import { DEFAULT_BILLING_RULES, nextBillingState, readOnlyFrom, stageFor } from '@spa/core'
import {
  aiUsage,
  announcementDismissals,
  auditLog,
  bookings,
  branches,
  closeAllDbs,
  members,
  notifications,
  plans,
  platformInvoices,
  platformSettings,
  roles,
  session,
  storedFiles,
  subscriptions,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  activeAnnouncements,
  applyBillingTransition,
  type BillingTransition,
  billingTransitionEffects,
  createPlatformInvoice,
  DomainError,
  deleteFlag,
  dismissAnnouncement,
  flagOn,
  flagValues,
  listFlags,
  type NewNotification,
  pauseTenant,
  recordPlatformPayment,
  resumeTenant,
  runBillingTransitions,
  saveAnnouncement,
  saveBillingRules,
  saveFlag,
  setFlagOverride,
  setInvoicePaid,
  tenantUsageList,
  transitionNotice,
} from '../src'

// Payment paths notify through the app role (`notify` → withTenant(appDb())).
process.env.DATABASE_URL_APP ??= testUrls.app

describe('billing stage rules (pure)', () => {
  const rules = DEFAULT_BILLING_RULES
  it('overdue the first late day, grace after, read-only after the grace days', () => {
    expect(stageFor('2026-10-11', '2026-10-11', rules)).toBe('overdue')
    expect(stageFor('2026-10-11', '2026-10-12', rules)).toBe('grace')
    expect(stageFor('2026-10-11', '2026-10-17', rules)).toBe('grace')
    expect(readOnlyFrom('2026-10-11', rules)).toBe('2026-10-18')
    expect(stageFor('2026-10-11', '2026-10-18', rules)).toBe('read_only')
    expect(stageFor('2026-10-11', '2026-10-11', { overdueAfterDays: 1, graceDays: 0 })).toBe('read_only')
  })
  it('pause / lift-only never escalate; paying always lifts', () => {
    const none = { stage: null, overdueSince: null }
    expect(nextBillingState(none, true, '2026-10-11', rules, { paused: true })).toEqual(none)
    expect(nextBillingState(none, true, '2026-10-11', rules, { liftOnly: true })).toEqual(none)
    const grace = { stage: 'grace' as const, overdueSince: '2026-10-11' }
    expect(nextBillingState(grace, true, '2026-10-20', rules, { paused: true })).toEqual(grace)
    expect(nextBillingState(grace, false, '2026-10-20', rules, { paused: true })).toEqual(none)
    // A longer grace period set later steps a read-only spa back.
    const ro = { stage: 'read_only' as const, overdueSince: '2026-10-11' }
    expect(nextBillingState(ro, true, '2026-10-19', { overdueAfterDays: 1, graceDays: 30 })).toEqual({
      stage: 'grace',
      overdueSince: '2026-10-11',
    })
  })
})

describe('console tools (db)', () => {
  const { platform, app } = testDbs()
  const ids = {} as Record<string, string>

  beforeAll(async () => {
    await resetTestDatabase()
    const now = new Date()
    await platform.insert(user).values([
      {
        id: 'u-admin',
        name: 'Ops',
        email: 'ops@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'u-owner',
        name: 'Owner',
        email: 'owner@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'u-staff',
        name: 'Staff',
        email: 'staff@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await platform.insert(platformSettings).values({ id: 1, invoicePrefix: 'SM' })
    const [premium, standard] = await platform
      .insert(plans)
      .values([
        { code: 'premium', name: 'Premium', priceAed: '36000', billingInterval: 'month' },
        { code: 'standard', name: 'Standard', priceAed: '24000', billingInterval: 'month' },
      ])
      .returning()
    ids.premium = premium!.id
    ids.standard = standard!.id
    const [a, b] = await platform
      .insert(tenants)
      .values([
        { slug: 'tools-a', name: 'Alpha Spa', status: 'active', planId: premium!.id },
        { slug: 'tools-b', name: 'Beta Spa', status: 'active', planId: standard!.id },
      ])
      .returning()
    ids.a = a!.id
    ids.b = b!.id
    await platform.insert(subscriptions).values(
      [a!, b!].map((t) => ({
        tenantId: t.id,
        planId: t.planId!,
        status: 'active' as const,
        priceAed: '36000',
        billingInterval: 'month' as const,
        currentPeriodStart: '2026-10-01',
        currentPeriodEnd: '2027-09-30',
      })),
    )
  })
  afterAll(closeAllDbs)

  describe('F20 feature flags', () => {
    it('code flags fall back until saved; overrides win; deleting a code flag is refused', async () => {
      expect(await flagOn(platform, 'billing.autoTransitions', ids.a!)).toBe(true)
      expect((await listFlags(platform)).find((f) => f.key === 'billing.autoTransitions')).toMatchObject({
        inCode: true,
        saved: false,
      })
      await setFlagOverride(platform, {
        key: 'billing.autoTransitions',
        tenantId: ids.b!,
        enabled: false,
        userId: 'u-admin',
      })
      expect(await flagOn(platform, 'billing.autoTransitions', ids.b!)).toBe(false)
      expect(await flagOn(platform, 'billing.autoTransitions', ids.a!)).toBe(true)
      const values = await flagValues(platform, 'billing.autoTransitions')
      expect([values.on(ids.a!), values.on(ids.b!)]).toEqual([true, false])
      await expect(deleteFlag(platform, 'billing.autoTransitions')).rejects.toBeInstanceOf(DomainError)
      const change = await setFlagOverride(platform, {
        key: 'billing.autoTransitions',
        tenantId: ids.b!,
        enabled: null,
        userId: 'u-admin',
      })
      expect(change).toEqual({ from: false, to: null })
      expect(await flagOn(platform, 'billing.autoTransitions', ids.b!)).toBe(true)
    })

    it('owner-defined flags: key format, default, delete with overrides', async () => {
      await expect(
        saveFlag(platform, { key: 'Bad Key', description: null, defaultOn: true, userId: 'u-admin' }),
      ).rejects.toBeInstanceOf(DomainError)
      const { before, after } = await saveFlag(platform, {
        key: 'calendar.newDayView',
        description: 'New day view',
        defaultOn: false,
        userId: 'u-admin',
      })
      expect(before).toBeNull()
      expect(after.defaultOn).toBe(false)
      await setFlagOverride(platform, {
        key: 'calendar.newDayView',
        tenantId: ids.a!,
        enabled: true,
        userId: 'u-admin',
      })
      const row = (await listFlags(platform)).find((f) => f.key === 'calendar.newDayView')
      expect(row).toMatchObject({ inCode: false, defaultOn: false })
      expect(row!.overrides).toEqual([expect.objectContaining({ slug: 'tools-a', enabled: true })])
      await deleteFlag(platform, 'calendar.newDayView')
      expect((await listFlags(platform)).some((f) => f.key === 'calendar.newDayView')).toBe(false)
      // A spa sees only its own overrides (tenant table).
      await setFlagOverride(platform, {
        key: 'billing.autoTransitions',
        tenantId: ids.b!,
        enabled: true,
        userId: 'u-admin',
      })
      const { featureFlagOverrides } = await import('@spa/db')
      expect(await withTenant(ids.a!, (tx) => tx.select().from(featureFlagOverrides), app)).toEqual([])
      await setFlagOverride(platform, {
        key: 'billing.autoTransitions',
        tenantId: ids.b!,
        enabled: null,
        userId: 'u-admin',
      })
    })
  })

  describe('F20 announcements', () => {
    const base = {
      titleTh: null,
      bodyTh: null,
      severity: 'info' as const,
      planCodes: [] as string[],
      tenantIds: [] as string[],
      startsAt: new Date(Date.now() - 60_000),
      endsAt: null,
    }
    it('validates audience and window', async () => {
      await expect(
        saveAnnouncement(platform, null, { ...base, titleEn: 'x', bodyEn: 'y', audience: 'plan' }, 'u-admin'),
      ).rejects.toBeInstanceOf(DomainError)
      await expect(
        saveAnnouncement(
          platform,
          null,
          { ...base, titleEn: 'x', bodyEn: 'y', audience: 'all', endsAt: new Date(Date.now() - 120_000) },
          'u-admin',
        ),
      ).rejects.toBeInstanceOf(DomainError)
    })

    it('targets all / plan / spas, honours the window and per-member dismissal', async () => {
      const all = await saveAnnouncement(
        platform,
        null,
        { ...base, titleEn: 'Maintenance', bodyEn: 'Tonight', audience: 'all', severity: 'warning' },
        'u-admin',
      )
      const premiumOnly = await saveAnnouncement(
        platform,
        null,
        { ...base, titleEn: 'Premium news', bodyEn: 'AI', audience: 'plan', planCodes: ['premium'] },
        'u-admin',
      )
      const betaOnly = await saveAnnouncement(
        platform,
        null,
        {
          ...base,
          titleEn: 'Beta',
          bodyEn: 'Hi',
          audience: 'tenants',
          tenantIds: [ids.b!],
          severity: 'critical',
        },
        'u-admin',
      )
      await saveAnnouncement(
        platform,
        null,
        {
          ...base,
          titleEn: 'Later',
          bodyEn: 'Soon',
          audience: 'all',
          startsAt: new Date(Date.now() + 3_600_000),
        },
        'u-admin',
      )
      const shown = async (tenantId: string, userId: string, planCode: string) =>
        (await activeAnnouncements(platform, { tenantId, userId, planCode })).map((a) => a.titleEn)
      expect(await shown(ids.a!, 'u-owner', 'premium')).toEqual(['Maintenance', 'Premium news'])
      // Most severe first.
      expect(await shown(ids.b!, 'u-owner', 'standard')).toEqual(['Beta', 'Maintenance'])
      await withTenant(
        ids.a!,
        (tx) => dismissAnnouncement(tx, { tenantId: ids.a!, userId: 'u-owner', announcementId: all.id }),
        app,
      )
      // Twice is harmless.
      await withTenant(
        ids.a!,
        (tx) => dismissAnnouncement(tx, { tenantId: ids.a!, userId: 'u-owner', announcementId: all.id }),
        app,
      )
      expect(await shown(ids.a!, 'u-owner', 'premium')).toEqual(['Premium news'])
      expect(await shown(ids.a!, 'u-staff', 'premium')).toEqual(['Maintenance', 'Premium news'])
      expect(await shown(ids.b!, 'u-owner', 'standard')).toEqual(['Beta', 'Maintenance'])
      // The app role can't record a dismissal for another spa.
      await expect(
        withTenant(
          ids.a!,
          (tx) =>
            dismissAnnouncement(tx, { tenantId: ids.b!, userId: 'u-owner', announcementId: betaOnly.id }),
          app,
        ),
      ).rejects.toThrow()
      expect(premiumOnly.tenantIds).toEqual([])
      const rows = await platform.select().from(announcementDismissals)
      expect(rows).toHaveLength(1)
    })
  })

  describe('F22 billing transitions', () => {
    const sent: NewNotification[] = []
    const send = async (n: NewNotification) => {
      sent.push(n)
    }
    const step = async (today: string, opts: { paused?: boolean } = {}) => {
      const t = await platform.transaction((tx) => applyBillingTransition(tx, ids.a!, today, opts))
      if (t) await billingTransitionEffects(platform, t, { send })
      return t
    }
    const tenant = async () => (await platform.select().from(tenants).where(eq(tenants.id, ids.a!)))[0]!

    it('overdue → grace → read-only, idempotent per day, then paying lifts it', async () => {
      const inv = await createPlatformInvoice(platform, ids.a!, {
        description: 'Month 1',
        amountAed: '3000',
        issueDate: '2026-10-01',
        dueDate: '2026-10-10',
        kind: 'other',
      })
      expect(await step('2026-10-10')).toBeNull()
      const first = await step('2026-10-11')
      expect(first).toMatchObject({
        to: { stage: 'overdue', overdueSince: '2026-10-11' },
        statusTo: 'past_due',
      })
      expect(first!.readOnlyFrom).toBe('2026-10-18')
      expect(transitionNotice(first!)).toBe('billing.late')
      expect(await step('2026-10-11')).toBeNull()
      expect((await step('2026-10-12'))?.to.stage).toBe('grace')
      expect(await step('2026-10-17')).toBeNull()
      // Paused: no escalation.
      expect(await step('2026-10-18', { paused: true })).toBeNull()
      const ro = await step('2026-10-18')
      expect(ro).toMatchObject({ to: { stage: 'read_only' }, statusTo: 'read_only' })
      expect((await tenant()).status).toBe('read_only')
      expect(sent.map((n) => n.kind)).toEqual(['billing.late', 'billing.read_only'])
      expect(sent[0]!.params).toMatchObject({ number: inv!.number, amount: '3150.00', date: '2026-10-18' })
      // Mark paid → lifted in the same transaction, status back to active, "restored" notice + audit.
      await setInvoicePaid(platform, {
        tenantId: ids.a!,
        invoiceId: inv!.id,
        paid: true,
        userId: 'u-admin',
        today: '2026-10-19',
      })
      const after = await tenant()
      expect([after.status, after.billingStage, after.billingOverdueSince]).toEqual(['active', null, null])
      const audits = await platform
        .select({ data: auditLog.data, actor: auditLog.actorUserId })
        .from(auditLog)
        .where(and(eq(auditLog.tenantId, ids.a!), eq(auditLog.action, 'platform.billing.stage')))
        .orderBy(auditLog.id)
      expect(audits.map((a) => (a.data as { to: string | null }).to)).toEqual([
        'overdue',
        'grace',
        'read_only',
        null,
      ])
      expect(audits.at(-1)!.actor).toBe('u-admin')
      const bell = await platform
        .select({ kind: notifications.kind })
        .from(notifications)
        .where(eq(notifications.tenantId, ids.a!))
      expect(bell.map((n) => n.kind)).toEqual(['billing.restored'])
    })

    it('a payment through recordPlatformPayment lifts too; a manual pause is left alone', async () => {
      const inv = await createPlatformInvoice(platform, ids.a!, {
        description: 'Month 2',
        amountAed: '1000',
        issueDate: '2026-11-01',
        dueDate: '2026-11-01',
      })
      await step('2026-11-02')
      expect((await tenant()).billingStage).toBe('overdue')
      const res = await platform.transaction((tx) =>
        recordPlatformPayment(tx, {
          tenantId: ids.a!,
          invoiceId: inv!.id,
          amountAed: '1050.00',
          method: 'cash',
          receivedAt: '2026-11-03',
          recordedBy: 'u-admin',
          today: '2026-11-03',
        }),
      )
      expect(res.billing).toMatchObject({
        from: { stage: 'overdue' },
        to: { stage: null },
        statusTo: 'active',
      })
      expect(transitionNotice(res.billing as BillingTransition)).toBeNull()
      // Manual pause (R12) with a late invoice: the job neither escalates nor lifts the status.
      const late = await createPlatformInvoice(platform, ids.a!, {
        description: 'Month 3',
        amountAed: '1000',
        issueDate: '2026-12-01',
        dueDate: '2026-12-01',
      })
      await pauseTenant(platform, ids.a!)
      expect(await step('2026-12-20')).toBeNull()
      expect((await tenant()).status).toBe('read_only')
      // Resume clears any stage; the next run starts a fresh grace period.
      await resumeTenant(platform, ids.a!)
      expect((await step('2026-12-20'))?.to).toEqual({ stage: 'overdue', overdueSince: '2026-12-20' })
      await setInvoicePaid(platform, {
        tenantId: ids.a!,
        invoiceId: late!.id,
        paid: true,
        userId: 'u-admin',
        today: '2026-12-21',
      })
      expect((await tenant()).billingStage).toBeNull()
    })

    it('runBillingTransitions: rules from the console, per-spa pause flag, other spas untouched', async () => {
      await saveBillingRules(platform, { overdueAfterDays: 3, graceDays: 2 }, 'u-admin')
      await createPlatformInvoice(platform, ids.b!, {
        description: 'B month',
        amountAed: '500',
        issueDate: '2027-01-01',
        dueDate: '2027-01-01',
      })
      await createPlatformInvoice(platform, ids.a!, {
        description: 'A month',
        amountAed: '500',
        issueDate: '2027-01-01',
        dueDate: '2027-01-01',
      })
      await setFlagOverride(platform, {
        key: 'billing.autoTransitions',
        tenantId: ids.b!,
        enabled: false,
        userId: 'u-admin',
      })
      // Due 1 Jan + 3 days → late from 4 Jan.
      expect((await runBillingTransitions(platform, '2027-01-03')).changed).toHaveLength(0)
      const run = await runBillingTransitions(platform, '2027-01-04')
      expect(run.changed.map((t) => [t.slug, t.to.stage])).toEqual([['tools-a', 'overdue']])
      expect((await runBillingTransitions(platform, '2027-01-06')).changed.map((t) => t.to.stage)).toEqual([
        'read_only',
      ])
      const [b] = await platform.select().from(tenants).where(eq(tenants.id, ids.b!))
      expect([b!.status, b!.billingStage]).toEqual(['active', null])
      await saveBillingRules(platform, DEFAULT_BILLING_RULES, 'u-admin')
    })
  })

  describe('F21 tenant usage list', () => {
    it('aggregates per spa without client data and sorts', async () => {
      const now = new Date('2027-02-15T08:00:00Z')
      const [branch] = await platform
        .insert(branches)
        .values({ tenantId: ids.b!, name: 'Main', isDefault: true })
        .returning()
      const booking = (ref: string, createdAt: Date) => ({
        tenantId: ids.b!,
        branchId: branch!.id,
        refCode: ref,
        source: 'walk_in' as const,
        businessDate: '2027-02-10',
        startsAt: createdAt,
        endsAt: createdAt,
        createdAt,
      })
      await platform
        .insert(bookings)
        .values([
          booking('B1', new Date('2027-02-14T10:00:00Z')),
          booking('B2', new Date('2027-02-01T10:00:00Z')),
          booking('B3', new Date('2026-12-01T10:00:00Z')),
        ])
      const [role] = await platform
        .insert(roles)
        .values({ tenantId: ids.b!, key: 'owner', name: 'Owner', isSystem: true })
        .returning()
      await platform.insert(members).values([
        { tenantId: ids.b!, userId: 'u-owner', roleId: role!.id },
        { tenantId: ids.b!, userId: 'u-staff', roleId: role!.id, status: 'disabled' },
      ])
      await platform
        .update(user)
        .set({ lastSignInAt: new Date('2027-02-10T09:00:00Z') })
        .where(eq(user.id, 'u-owner'))
      await platform.insert(session).values({
        id: 's1',
        token: 't1',
        userId: 'u-owner',
        expiresAt: new Date('2027-03-15T08:00:00Z'),
        createdAt: new Date('2027-02-12T09:00:00Z'),
        updatedAt: new Date('2027-02-12T09:00:00Z'),
      })
      // A disabled member's sign-in doesn't count.
      await platform
        .update(user)
        .set({ lastSignInAt: new Date('2027-02-15T07:00:00Z') })
        .where(eq(user.id, 'u-staff'))
      await platform.insert(storedFiles).values([
        { tenantId: ids.b!, contentType: 'image/png', size: 1000 },
        { tenantId: ids.b!, contentType: 'image/png', size: 2500 },
      ])
      await platform.insert(aiUsage).values([
        {
          tenantId: ids.b!,
          agentKey: 'x',
          modelId: 'm',
          costUsd: '1.25',
          createdAt: new Date('2027-02-03T00:00:00Z'),
        },
        {
          tenantId: ids.b!,
          agentKey: 'x',
          modelId: 'm',
          costUsd: '9',
          createdAt: new Date('2027-01-20T00:00:00Z'),
        },
      ])
      const rows = await tenantUsageList(platform, { now, sort: 'bookings30' })
      expect(rows.map((r) => r.slug)).toEqual(['tools-b', 'tools-a'])
      expect(rows[0]).toMatchObject({
        bookings30d: 2,
        activeMembers: 1,
        storageBytes: 3500,
        aiSpendUsd: '1.25',
        lastSignInAt: new Date('2027-02-12T09:00:00Z'),
        lastBookingAt: new Date('2027-02-14T10:00:00Z'),
      })
      expect(rows[1]).toMatchObject({ bookings30d: 0, activeMembers: 0, storageBytes: 0, lastSignInAt: null })
      expect(
        (await tenantUsageList(platform, { now, sort: 'name', dir: 'desc' })).map((r) => r.slug),
      ).toEqual(['tools-b', 'tools-a'])
      expect((await tenantUsageList(platform, { now, q: 'alpha' })).map((r) => r.slug)).toEqual(['tools-a'])
      // Nulls last whatever the direction.
      expect((await tenantUsageList(platform, { now, sort: 'signin', dir: 'asc' })).at(-1)!.slug).toBe(
        'tools-a',
      )
    })
  })
})

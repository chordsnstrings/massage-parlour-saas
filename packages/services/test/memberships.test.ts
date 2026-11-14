// Memberships sold and used through POS (PLAN §18 G15): sale → period + 2110, member discount, included sessions,
// renewal reminders (click-to-send outbox), renewal via POS, expiry recognition and refunds.
import { dubaiInstant } from '@spa/core'
import {
  branches,
  clientMemberships,
  clients,
  closeAllDbs,
  journalEntries,
  membershipPlans,
  outbox,
  services,
  serviceVariants,
  staff,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  accountTotals,
  createSale,
  membershipPeriodEnd,
  refundOptions,
  refundSale,
  runMembershipRenewals,
  voidSale,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06'
const NOON = dubaiInstant(D, 12 * 60)
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const base = () => ({ tenantId: ids.tenant!, branchId: ids.branch!, clientId: ids.client! })
const sellLine = () => ({
  kind: 'membership' as const,
  refId: ids.plan!,
  description: 'Gold membership',
  qty: 1,
  unitPriceAed: 600,
})
const swedish = (extra: Record<string, unknown> = {}) => ({
  kind: 'service' as const,
  refId: ids.variant!,
  description: 'Swedish massage 60 min',
  qty: 1,
  unitPriceAed: 350,
  staffId: ids.maya,
  ...extra,
})
const balance2110 = async (to = '2026-12-31') =>
  (await tx((db) => accountTotals(db, ids.tenant!, null, to))).find((a) => a.code === '2110')?.balance ?? 0
const period = async (saleId: string) =>
  (await tx((db) => db.select().from(clientMemberships).where(eq(clientMemberships.saleId, saleId))))[0]!

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'member', name: 'Member Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Marina', isDefault: true })
      .returning()
    ids.branch = b!.id
    const [s] = await db
      .insert(services)
      .values({ tenantId: ids.tenant!, name: { en: 'Swedish massage' } })
      .returning()
    ids.service = s!.id
    const [v] = await db
      .insert(serviceVariants)
      .values({ tenantId: ids.tenant!, serviceId: s!.id, durationMin: 60, priceAed: '350' })
      .returning()
    ids.variant = v!.id
    const [p] = await db
      .insert(staff)
      .values({
        tenantId: ids.tenant!,
        displayName: 'Maya',
        payType: 'sales_commission',
        commissionPct: '10',
      })
      .returning()
    ids.maya = p!.id
    const [c] = await db
      .insert(clients)
      .values({ tenantId: ids.tenant!, name: 'Fatima Ali', phoneE164: '971501234567' })
      .returning()
    ids.client = c!.id
    const [plan] = await db
      .insert(membershipPlans)
      .values({
        tenantId: ids.tenant!,
        name: { en: 'Gold' },
        monthlyAed: '600',
        benefits: { includedSessions: [{ serviceId: s!.id, quantity: 2 }], discountPct: 10 },
      })
      .returning()
    ids.plan = plan!.id
  })
})
afterAll(closeAllDbs)

describe('membership periods', () => {
  it('runs one month, clamped to the month end', () => {
    expect(membershipPeriodEnd('2026-10-06')).toBe('2026-11-05')
    expect(membershipPeriodEnd('2026-01-31')).toBe('2026-02-27')
    expect(membershipPeriodEnd('2026-12-01')).toBe('2026-12-31')
  })
})

describe('memberships through POS', () => {
  it('sells a membership: no VAT at sale, price held in 2110, period from the business date', async () => {
    await expect(
      tx((db) =>
        createSale(db, {
          ...base(),
          clientId: null,
          lines: [sellLine()],
          payments: [{ method: 'cash', amountAed: 600 }],
          now: NOON,
        }),
      ),
    ).rejects.toThrow(/client/)
    const { sale } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [sellLine()],
        payments: [{ method: 'card_terminal', amountAed: 600 }],
        now: NOON,
      }),
    )
    ids.sale = sale.id
    expect(Number(sale.vatAed)).toBe(0)
    const m = await period(sale.id)
    expect(m).toMatchObject({
      status: 'active',
      name: 'Gold',
      currentPeriodStart: D,
      currentPeriodEnd: '2026-11-05',
      pricePaidAed: '600.00',
      remainingValueAed: '600.00',
      discountPct: '10.00',
    })
    expect(m.balances).toEqual({ [ids.service!]: 2 })
    ids.membership = m.id
    expect(await balance2110()).toBe(600)
    await expect(tx((db) => voidSale(db, { saleId: sale.id, reason: 'Mistake' }))).rejects.toThrow(
      /memberships/,
    )
  })

  it('applies the member discount to a treatment, shown on the line', async () => {
    const { sale, lines } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [swedish({ discountAed: 5, membership: { id: ids.membership!, use: 'discount' } })],
        payments: [{ method: 'cash', amountAed: 310 }],
        now: NOON,
      }),
    )
    // 350 − 5 typed − 35 member (10%) = 310, VAT included as on any treatment.
    expect(lines[0]).toMatchObject({
      discountAed: '40.00',
      lineTotalAed: '310.00',
      description: 'Swedish massage 60 min · member −10%',
    })
    expect(Number(sale.vatAed)).toBeCloseTo(14.76, 2)
    // Another client can't use it; a plain treatment line keeps its price.
    const [other] = await tx((db) =>
      db.insert(clients).values({ tenantId: ids.tenant!, name: 'Omar' }).returning(),
    )
    await expect(
      tx((db) =>
        createSale(db, {
          ...base(),
          clientId: other!.id,
          lines: [swedish({ membership: { id: ids.membership!, use: 'discount' } })],
          payments: [{ method: 'cash', amountAed: 315 }],
          now: NOON,
        }),
      ),
    ).rejects.toThrow(/another client/)
  })

  it('redeems an included session: value moves from 2110 to revenue, commission on that value', async () => {
    await expect(
      tx((db) =>
        createSale(db, {
          ...base(),
          lines: [swedish({ membership: { id: ids.membership!, use: 'session' } })],
          payments: [{ method: 'cash', amountAed: 350 }],
          now: NOON,
        }),
      ),
    ).rejects.toThrow(/price must be 0/)
    const { sale, lines } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [swedish({ unitPriceAed: 0, membership: { id: ids.membership!, use: 'session' } })],
        payments: [],
        now: NOON,
      }),
    )
    expect(lines[0]!.description).toBe('Swedish massage 60 min · membership session')
    const m = await period(ids.sale!)
    expect(m.balances).toEqual({ [ids.service!]: 1 })
    expect(m.remainingValueAed).toBe('300.00')
    expect(await balance2110()).toBe(300)
    await expect(tx((db) => voidSale(db, { saleId: sale.id, reason: 'Mistake' }))).rejects.toThrow(/refund/)
  })

  it('flags renewals as due with a click-to-send reminder; renewing in POS chains the next period', async () => {
    const r = await tx((db) => runMembershipRenewals(db, ids.tenant!, dubaiInstant('2026-11-01', 12 * 60)))
    expect(r).toMatchObject({ due: 1, queued: 1, expired: 0 })
    expect((await period(ids.sale!)).status).toBe('due')
    const [msg] = await tx((db) =>
      db
        .select()
        .from(outbox)
        .where(and(eq(outbox.clientId, ids.client!), eq(outbox.kind, 'membership_renewal'))),
    )
    expect(msg).toMatchObject({ status: 'queued', phoneE164: '971501234567' })
    expect(msg!.text).toContain('Hi Fatima, your Gold membership at Member Spa ends on')
    // Running again does not queue a second reminder.
    expect(
      await tx((db) => runMembershipRenewals(db, ids.tenant!, dubaiInstant('2026-11-02', 12 * 60))),
    ).toMatchObject({ due: 0, queued: 0 })

    const { sale } = await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [sellLine()],
        payments: [{ method: 'cash', amountAed: 600 }],
        now: dubaiInstant('2026-11-03', 12 * 60),
      }),
    )
    ids.renewal = sale.id
    expect(await period(sale.id)).toMatchObject({
      currentPeriodStart: '2026-11-06',
      currentPeriodEnd: '2026-12-05',
      status: 'active',
    })
    expect((await period(ids.sale!)).status).toBe('active')
    const [after] = await tx((db) => db.select().from(outbox).where(eq(outbox.id, msg!.id)))
    expect(after!.status).toBe('skipped')
    // The renewed period is not flagged again.
    expect(
      await tx((db) => runMembershipRenewals(db, ids.tenant!, dubaiInstant('2026-11-04', 12 * 60))),
    ).toMatchObject({ due: 0 })
  })

  it('expires an ended period and recognises what was not used (with VAT)', async () => {
    const r = await tx((db) => runMembershipRenewals(db, ids.tenant!, dubaiInstant('2026-11-07', 12 * 60)))
    expect(r.expired).toBe(1)
    expect(await period(ids.sale!)).toMatchObject({ status: 'expired', remainingValueAed: '0.00' })
    const entries = await tx((db) =>
      db.select().from(journalEntries).where(eq(journalEntries.sourceType, 'membership_expiry')),
    )
    expect(entries).toHaveLength(1)
    // Only the renewal's 600 is still deferred.
    expect(await balance2110()).toBe(600)
    // Nothing unused is left to refund on the expired period.
    const opts = await tx((db) => refundOptions(db, ids.sale!))
    expect(opts.lines.find((l) => l.kind === 'membership')?.unitsAed).toEqual([])
  })

  it('refunds the unused renewal: 2110 reversed (append-only), period refunded', async () => {
    const before = await tx((db) =>
      db.select().from(journalEntries).where(eq(journalEntries.sourceId, ids.renewal!)),
    )
    const opts = await tx((db) => refundOptions(db, ids.renewal!))
    const line = opts.lines.find((l) => l.kind === 'membership')!
    expect(line.unitsAed).toEqual([600])
    await tx((db) =>
      refundSale(db, {
        saleId: ids.renewal!,
        lines: [{ saleLineId: line.saleLineId, qty: 1 }],
        method: 'cash',
        reason: 'Moving abroad',
        now: dubaiInstant('2026-11-07', 12 * 60),
      }),
    )
    expect(await period(ids.renewal!)).toMatchObject({
      status: 'refunded',
      remainingValueAed: '0.00',
      balances: {},
    })
    expect(await balance2110()).toBe(0)
    const after = await tx((db) =>
      db.select().from(journalEntries).where(eq(journalEntries.sourceId, ids.renewal!)),
    )
    // The sale entry stays; a refund entry is added.
    expect(after.length).toBe(before.length + 1)
    expect(after.some((e) => e.sourceType === 'refund')).toBe(true)
  })
})

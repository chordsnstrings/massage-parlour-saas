// PLAN §14.8 "R2 owner decisions" (2026-10-08): receptionist booking fee, therapist pay = booking commission
// only + Tips & advances payout, no auto-restock on re-open, monthly subscriptions → yearly price.
import { dubaiInstant, resolvePermissions } from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  closeAllDbs,
  members,
  payrollLines,
  plans,
  products,
  roles,
  sales,
  serviceConsumables,
  services,
  serviceVariants,
  staff,
  stockLevels,
  subscriptions,
  tenants,
  tips,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  accountTotals,
  buildPayroll,
  completeBooking,
  convertMonthlySubscriptions,
  finalisePayroll,
  receiveStock,
  recordAdvance,
  setBookingStatus,
  therapistTipsAdvances,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06'
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)

let refN = 0
async function booking(status: 'confirmed' | 'completed' | 'cancelled', createdBy: string | null, date = D) {
  return tx(async (db) => {
    const start = dubaiInstant(date, 10 * 60 + refN * 60)
    const [b] = await db
      .insert(bookings)
      .values({
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        refCode: `OD${++refN}`,
        source: 'phone',
        status,
        businessDate: date,
        startsAt: start,
        endsAt: new Date(start.getTime() + 3600_000),
        createdBy,
      })
      .returning()
    await db.insert(bookingItems).values({
      tenantId: ids.tenant!,
      bookingId: b!.id,
      serviceVariantId: ids.variant!,
      serviceName: 'Swedish',
      durationMin: 60,
      priceAed: '300',
      startsAt: start,
      endsAt: new Date(start.getTime() + 3600_000),
      staffIds: [ids.maya!],
    })
    return b!.id
  })
}

beforeAll(async () => {
  await resetTestDatabase()
  const now = new Date()
  await platform.insert(user).values([
    {
      id: 'u-rec',
      name: 'Sara',
      email: 'sara@example.com',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'u-own',
      name: 'Owner',
      email: 'own@example.com',
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    },
  ])
  const [t] = await platform
    .insert(tenants)
    .values({ slug: 'od', name: 'OD Spa', settings: { receptionistBookingFee: '15.00' } })
    .returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Main', isDefault: true })
      .returning()
    ids.branch = b!.id
    const [role] = await db
      .insert(roles)
      .values({ tenantId: ids.tenant!, key: 'receptionist', name: 'Receptionist', isSystem: true })
      .returning()
    const [m] = await db
      .insert(members)
      .values({ tenantId: ids.tenant!, userId: 'u-rec', roleId: role!.id })
      .returning()
    const people = await db
      .insert(staff)
      .values([
        { tenantId: ids.tenant!, displayName: 'Maya' },
        {
          tenantId: ids.tenant!,
          displayName: 'Sara',
          bookable: false,
          payType: 'booking_fee',
          memberId: m!.id,
        },
      ])
      .returning()
    ;[ids.maya, ids.sara] = people.map((p) => p.id)
    const [svc] = await db
      .insert(services)
      .values({ tenantId: ids.tenant!, name: { en: 'Swedish' } })
      .returning()
    const [v] = await db
      .insert(serviceVariants)
      .values({ tenantId: ids.tenant!, serviceId: svc!.id, durationMin: 60, priceAed: '300' })
      .returning()
    ids.variant = v!.id
  })
})
afterAll(closeAllDbs)

describe('R2 owner decisions', () => {
  it('pays the receptionist the fixed fee per completed booking she created; therapists commission only', async () => {
    await booking('completed', 'u-rec')
    await booking('completed', 'u-rec')
    await booking('cancelled', 'u-rec') // not completed → no fee
    await booking('completed', 'u-own') // someone else's
    await booking('completed', 'u-rec', '2026-11-02') // next month
    // Maya: a booking commission, a tip and an advance this month.
    const bId = await booking('confirmed', null)
    const [item] = await tx((db) => db.select().from(bookingItems).where(eq(bookingItems.bookingId, bId)))
    await tx((db) =>
      completeBooking(db, {
        bookingId: bId,
        amounts: [{ bookingItemId: item!.id, staffId: ids.maya!, amountAed: 40 }],
        now: dubaiInstant(D, 20 * 60),
      }),
    )
    await tx(async (db) => {
      const [s] = await db
        .insert(sales)
        .values({
          tenantId: ids.tenant!,
          branchId: ids.branch!,
          number: 1,
          businessDate: D,
          subtotalAed: '300',
          totalAed: '300',
          tipsAed: '25',
          status: 'paid',
        })
        .returning()
      await db
        .insert(tips)
        .values({ tenantId: ids.tenant!, saleId: s!.id, staffId: ids.maya!, amountAed: '25', method: 'cash' })
      await recordAdvance(db, {
        tenantId: ids.tenant!,
        staffId: ids.maya!,
        date: D,
        amountAed: 10,
        paidVia: 'cash',
      })
    })

    const run = await tx((db) =>
      buildPayroll(db, { tenantId: ids.tenant!, periodStart: '2026-10-01', periodEnd: '2026-10-31' }),
    )
    const lines = await tx((db) => db.select().from(payrollLines).where(eq(payrollLines.runId, run.id)))
    const by = (id: string) => {
      const l = lines.find((x) => x.staffId === id)!
      return [l.commissionAed, l.feeAed, l.tipsAed, l.advancesAed, l.netAed]
    }
    expect(by(ids.sara!)).toEqual(['0.00', '30.00', '0.00', '0.00', '30.00'])
    expect(by(ids.maya!)).toEqual(['40.00', '0.00', '0.00', '0.00', '40.00'])

    expect(
      await tx((db) => therapistTipsAdvances(db, { periodStart: '2026-10-01', periodEnd: '2026-10-31' })),
    ).toEqual([{ staffId: ids.maya, name: 'Maya', tipsAed: 25, advancesAed: 10, netAed: 15 }])

    await tx((db) => finalisePayroll(db, run.id, '2026-10-31'))
    const totals = await tx((db) => accountTotals(db, ids.tenant!, null, '2030-01-01'))
    const bal = (code: string) => totals.find((a) => a.code === code)?.balance ?? 0
    expect(bal('2300')).toBe(0) // booking commission accrued, then paid
    expect(bal('1150')).toBe(10) // Maya's advance is not recovered through payroll
  })

  it('never restocks consumables when a completed booking is re-opened', async () => {
    const [oil] = await tx((db) =>
      db
        .insert(products)
        .values({ tenantId: ids.tenant!, kind: 'consumable', name: { en: 'Oil' }, unit: 'ml' })
        .returning(),
    )
    await tx(async (db) => {
      await db
        .insert(serviceConsumables)
        .values({ tenantId: ids.tenant!, serviceVariantId: ids.variant!, productId: oil!.id, qty: '30' })
      await receiveStock(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        productId: oil!.id,
        qty: 100,
        unitCostAed: 0.1,
        vatAed: 0,
        paidVia: 'cash',
        date: D,
      })
    })
    const level = async () =>
      Number(
        (await tx((db) => db.select().from(stockLevels).where(eq(stockLevels.productId, oil!.id))))[0]!.qty,
      )
    const id = await booking('confirmed', null)
    await tx((db) => setBookingStatus(db, id, 'completed'))
    expect(await level()).toBe(70)
    await tx((db) => setBookingStatus(db, id, 'pending')) // re-open
    expect(await level()).toBe(70)
    await tx((db) => setBookingStatus(db, id, 'completed')) // drawn once per booking
    expect(await level()).toBe(70)
  })

  it('lets accountants, managers and receptionists restock and adjust stock', () => {
    for (const key of ['accountant', 'manager', 'receptionist'])
      expect(resolvePermissions({ key, permissions: [] }).has('inventory.adjust')).toBe(true)
    expect(resolvePermissions({ key: 'therapist', permissions: [] }).has('inventory.adjust')).toBe(false)
  })

  it('moves monthly-priced subscriptions to the yearly price on the 12-month plan, once', async () => {
    const [plan] = await platform
      .insert(plans)
      .values({ code: 'od-spa', name: 'Spa', priceAed: '24000' })
      .returning()
    const mk = async (slug: string, priceAed: string, billingInterval: 'month' | 'year') => {
      const [t] = await platform.insert(tenants).values({ slug, name: slug }).returning()
      await platform.insert(subscriptions).values({
        tenantId: t!.id,
        planId: plan!.id,
        status: 'active',
        priceAed,
        billingInterval,
        currentPeriodStart: '2026-09-01',
        currentPeriodEnd: '2027-08-31',
      })
      return t!.id
    }
    const monthly = await mk('od-m', '2000', 'month')
    const yearlyStoredMonthly = await mk('od-ym', '2000', 'year')
    const yearly = await mk('od-y', '24000', 'year')
    const twelve = await mk('od-12', '24000', 'month')
    const first = await convertMonthlySubscriptions(platform)
    expect(first).toHaveLength(2)
    expect(await convertMonthlySubscriptions(platform)).toEqual([])
    const row = async (tenantId: string) => {
      const [s] = await platform.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId))
      return [s!.priceAed, s!.billingInterval]
    }
    expect(await row(monthly)).toEqual(['24000.00', 'month'])
    expect(await row(yearlyStoredMonthly)).toEqual(['24000.00', 'month'])
    expect(await row(yearly)).toEqual(['24000.00', 'year'])
    expect(await row(twelve)).toEqual(['24000.00', 'month'])
  })
})

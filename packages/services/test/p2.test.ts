import { dubaiInstant } from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  campaigns,
  clientPackages,
  clients,
  closeAllDbs,
  journalEntries,
  outbox,
  packageDefinitions,
  payrollLines,
  products,
  saleLines,
  sales,
  serviceConsumables,
  services,
  serviceVariants,
  staff,
  staffDocuments,
  tenants,
  tips,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  accountTotals,
  accrueCommissions,
  adjustStock,
  buildPayroll,
  consumeForBooking,
  createSale,
  expirePackages,
  expiringDocuments,
  finalisePayroll,
  issueGiftCard,
  issuePackage,
  lowStock,
  nextCounter,
  queueCampaign,
  receiveStock,
  redeemGiftCard,
  redeemPackageSession,
  resolveSegment,
  reverseSource,
  wpsSif,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06'
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const bal = async (code: string) =>
  (await tx((db) => accountTotals(db, ids.tenant!, null, '2030-01-01'))).find((a) => a.code === code)
    ?.balance ?? 0

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'p2', name: 'P2 Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Main', isDefault: true })
      .returning()
    ids.branch = b!.id
    const [s] = await db
      .insert(services)
      .values({ tenantId: ids.tenant!, name: { en: 'Swedish' } })
      .returning()
    ids.service = s!.id
    const [v] = await db
      .insert(serviceVariants)
      .values({ tenantId: ids.tenant!, serviceId: s!.id, durationMin: 60, priceAed: '350' })
      .returning()
    ids.variant = v!.id
    const [st] = await db
      .insert(staff)
      .values({
        tenantId: ids.tenant!,
        displayName: 'Maya',
        payType: 'sales_commission',
        commissionPct: '10',
        baseSalaryAed: '3000',
      })
      .returning()
    ids.staff = st!.id
    const [c] = await db
      .insert(clients)
      .values({
        tenantId: ids.tenant!,
        name: 'Fatima Al Mansoori',
        phoneE164: '971501234567',
        tags: ['vip'],
        lastVisitAt: dubaiInstant('2026-06-01', 600),
      })
      .returning()
    ids.client = c!.id
    await db.insert(clients).values({
      tenantId: ids.tenant!,
      name: 'Opted Out',
      phoneE164: '971509999999',
      tags: ['vip'],
      marketingOptOutAt: new Date(),
    })
  })
})
afterAll(closeAllDbs)

describe('packages', () => {
  it('redeems sessions from the liability and recognises breakage on expiry', async () => {
    const [def] = await tx((db) =>
      db
        .insert(packageDefinitions)
        .values({
          tenantId: ids.tenant!,
          name: { en: '5 × Swedish' },
          priceAed: '1500',
          validityDays: 30,
          items: [{ serviceId: ids.service!, quantity: 5 }],
        })
        .returning(),
    )
    const pkg = await tx((db) =>
      issuePackage(db, {
        tenantId: ids.tenant!,
        clientId: ids.client!,
        definitionId: def!.id,
        now: dubaiInstant(D, 600),
      }),
    )
    const r = await tx((db) =>
      redeemPackageSession(db, {
        clientPackageId: pkg.id,
        serviceId: ids.service!,
        now: dubaiInstant(D, 700),
      }),
    )
    expect(r).toEqual({ valueAed: 300, sessionsLeft: 4, usedUp: false })
    expect(await bal('4000')).toBe(285.71)
    expect(await bal('2000')).toBe(14.29)
    const n = await tx((db) => expirePackages(db, ids.tenant!, dubaiInstant('2026-12-01', 600)))
    expect(n).toBe(1)
    expect(await bal('4300')).toBe(1200)
  })

  it('dates redemption and expiry by the branch cutoff (F5)', async () => {
    await tx((db) =>
      db.update(branches).set({ businessDayCutoff: '07:00' }).where(eq(branches.id, ids.branch!)),
    )
    try {
      const [def] = await tx((db) =>
        db
          .insert(packageDefinitions)
          .values({
            tenantId: ids.tenant!,
            name: { en: '2 × Swedish' },
            priceAed: '600',
            validityDays: 1,
            items: [{ serviceId: ids.service!, quantity: 2 }],
          })
          .returning(),
      )
      const pkg = await tx((db) =>
        issuePackage(db, {
          tenantId: ids.tenant!,
          clientId: ids.client!,
          definitionId: def!.id,
          now: dubaiInstant('2026-11-01', 600),
        }),
      )
      // 06:00 Dubai is still the previous business day with a 07:00 cutoff.
      await tx((db) =>
        redeemPackageSession(db, {
          clientPackageId: pkg.id,
          serviceId: ids.service!,
          branchId: ids.branch!,
          now: dubaiInstant('2026-11-02', 360),
        }),
      )
      await tx((db) => expirePackages(db, ids.tenant!, dubaiInstant('2026-11-03', 360)))
      const dates = await tx((db) =>
        db
          .select({ type: journalEntries.sourceType, date: journalEntries.entryDate })
          .from(journalEntries)
          .where(eq(journalEntries.sourceId, pkg.id)),
      )
      expect(dates.find((d) => d.type === 'redemption')?.date).toBe('2026-11-01')
      expect(dates.find((d) => d.type === 'package_expiry')?.date).toBe('2026-11-02')
    } finally {
      await tx((db) =>
        db.update(branches).set({ businessDayCutoff: '05:00' }).where(eq(branches.id, ids.branch!)),
      )
    }
  })
})

describe('gift cards', () => {
  it('issues and spends a balance, refusing overspend', async () => {
    const card = await tx((db) => issueGiftCard(db, { tenantId: ids.tenant!, amountAed: 500 }))
    expect(card.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    const res = await tx((db) =>
      redeemGiftCard(db, {
        tenantId: ids.tenant!,
        code: card.code.toLowerCase(),
        amountAed: 350,
        saleId: null as unknown as string,
      }),
    )
    expect(res.card.balanceAed).toBe('150.00')
    await expect(
      tx((db) =>
        redeemGiftCard(db, {
          tenantId: ids.tenant!,
          code: card.code,
          amountAed: 200,
          saleId: null as unknown as string,
        }),
      ),
    ).rejects.toThrow(/Only AED 150/)
  })
})

describe('commissions and payroll', () => {
  it('accrues commission on revenue net of VAT and pays it out through payroll', async () => {
    const saleId = await tx(async (db) => {
      const [s] = await db
        .insert(sales)
        .values({
          tenantId: ids.tenant!,
          branchId: ids.branch!,
          number: 1,
          businessDate: D,
          subtotalAed: '350',
          totalAed: '350',
          vatAed: '16.67',
          status: 'paid',
        })
        .returning()
      await db.insert(saleLines).values({
        tenantId: ids.tenant!,
        saleId: s!.id,
        kind: 'service',
        description: 'Swedish',
        unitPriceAed: '350',
        lineTotalAed: '350',
        staffId: ids.staff!,
      })
      await db.insert(tips).values({
        tenantId: ids.tenant!,
        saleId: s!.id,
        staffId: ids.staff!,
        amountAed: '20',
        method: 'cash',
      })
      return s!.id
    })
    const entries = await tx((db) => accrueCommissions(db, saleId))
    expect(entries.map((e) => e.amountAed)).toEqual(['33.33'])
    expect(await tx((db) => accrueCommissions(db, saleId))).toEqual([])
    const run = await tx((db) =>
      buildPayroll(db, { tenantId: ids.tenant!, periodStart: '2026-10-01', periodEnd: '2026-10-31' }),
    )
    const [line] = await tx((db) => db.select().from(payrollLines).where(eq(payrollLines.runId, run.id)))
    expect({
      base: line!.baseAed,
      commission: line!.commissionAed,
      tips: line!.tipsAed,
      net: line!.netAed,
    }).toEqual({ base: '0.00', commission: '33.33', tips: '20.00', net: '53.33' }) // % pay: no base salary
    await tx((db) => finalisePayroll(db, run.id, '2026-10-31'))
    expect(await bal('2300')).toBe(0)
    expect(await bal('6000')).toBe(0)
  })

  it('formats a WPS salary information file', () => {
    const sif = wpsSif({
      employerId: '0000123456789',
      employerBankRoutingCode: '803320101',
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      createdAt: new Date('2026-11-01T06:30:00Z'),
      lines: [
        {
          personId: '10012345678901',
          routingCode: '803320101',
          iban: 'AE070331234567890123456',
          days: 31,
          fixedAed: 3000,
          variableAed: 53.33,
        },
      ],
    })
    expect(sif.split('\n')).toEqual([
      'EDR,10012345678901,803320101,AE070331234567890123456,2026-10-01,2026-10-31,31,3000.00,53.33,0',
      'SCR,0000123456789,803320101,2026-11-01,0630,102026,1,3053.33,AED,',
    ])
  })
})

describe('inventory', () => {
  it('receives stock, consumes it per treatment and flags low stock', async () => {
    const [oil] = await tx((db) =>
      db
        .insert(products)
        .values({
          tenantId: ids.tenant!,
          kind: 'consumable',
          name: { en: 'Massage oil' },
          unit: 'ml',
          lowStockAt: '600',
        })
        .returning(),
    )
    await tx((db) =>
      db
        .insert(serviceConsumables)
        .values({ tenantId: ids.tenant!, serviceVariantId: ids.variant!, productId: oil!.id, qty: '30' }),
    )
    await tx((db) =>
      receiveStock(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        productId: oil!.id,
        qty: 1000,
        unitCostAed: 0.1,
        vatAed: 5,
        paidVia: 'bank',
        date: D,
      }),
    )
    const bookingId = await tx(async (db) => {
      const [b] = await db
        .insert(bookings)
        .values({
          tenantId: ids.tenant!,
          branchId: ids.branch!,
          refCode: 'INV01',
          source: 'phone',
          status: 'completed',
          businessDate: D,
          startsAt: dubaiInstant(D, 600),
          endsAt: dubaiInstant(D, 660),
        })
        .returning()
      await db.insert(bookingItems).values({
        tenantId: ids.tenant!,
        bookingId: b!.id,
        serviceVariantId: ids.variant!,
        serviceName: 'Swedish',
        durationMin: 60,
        priceAed: '350',
        startsAt: b!.startsAt,
        endsAt: b!.endsAt,
      })
      return b!.id
    })
    expect(
      await tx((db) =>
        consumeForBooking(db, { tenantId: ids.tenant!, branchId: ids.branch!, bookingId, date: D }),
      ),
    ).toBe(3)
    expect(
      await tx((db) =>
        consumeForBooking(db, { tenantId: ids.tenant!, branchId: ids.branch!, bookingId, date: D }),
      ),
    ).toBe(0)
    expect(await tx((db) => lowStock(db, ids.branch!))).toEqual([])
    expect(await bal('1200')).toBe(97)
  })

  it('posts receipts and adjustments with a source so they can be reversed (F6)', async () => {
    const [towel] = await tx((db) =>
      db
        .insert(products)
        .values({ tenantId: ids.tenant!, kind: 'consumable', name: { en: 'Towels' }, unit: 'pc' })
        .returning(),
    )
    const before = { inv: await bal('1200'), bank: await bal('1020'), cons: await bal('5100') }
    const received = await tx((db) =>
      receiveStock(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        productId: towel!.id,
        qty: 10,
        unitCostAed: 4,
        paidVia: 'bank',
        date: D,
      }),
    )
    const adjusted = await tx((db) =>
      adjustStock(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        productId: towel!.id,
        qty: -2,
        date: D,
      }),
    )
    expect(await bal('1200')).toBe(before.inv + 32)
    await tx(async (db) => {
      await reverseSource(db, ids.tenant!, 'stock_purchase', received, D)
      await reverseSource(db, ids.tenant!, 'stock_adjustment', adjusted, D)
    })
    expect(await bal('1200')).toBe(before.inv)
    expect(await bal('1020')).toBe(before.bank)
    expect(await bal('5100')).toBe(before.cons)
  })
})

describe('segments, campaigns and documents', () => {
  it('targets lapsed VIPs (never opted-out clients) and queues click-to-send messages', async () => {
    const people = await tx((db) =>
      resolveSegment(
        db,
        ids.tenant!,
        [
          { kind: 'tag', tag: 'vip' },
          { kind: 'lapsed', days: 60 },
        ],
        dubaiInstant(D, 600),
      ),
    )
    expect(people.map((p) => p.name)).toEqual(['Fatima Al Mansoori'])
    const [c] = await tx((db) =>
      db
        .insert(campaigns)
        .values({
          tenantId: ids.tenant!,
          name: 'We miss you',
          body: { en: 'Hi {first_name}, come back to {spa}!' },
        })
        .returning(),
    )
    expect(await tx((db) => queueCampaign(db, c!.id, [{ kind: 'tag', tag: 'vip' }]))).toBe(1)
    const queued = await tx((db) => db.select().from(outbox).where(eq(outbox.campaignId, c!.id)))
    expect(queued.map((q) => q.text)).toEqual(['Hi Fatima, come back to P2 Spa!'])
  })

  it('lists documents that expire soon', async () => {
    await tx((db) =>
      db
        .insert(staffDocuments)
        .values({ tenantId: ids.tenant!, staffId: ids.staff!, type: 'Visa', expiresOn: '2026-11-15' }),
    )
    const docs = await tx((db) => expiringDocuments(db, ids.tenant!, 60, dubaiInstant(D, 600)))
    expect(docs.map((d) => [d.type, d.owner])).toEqual([['Visa', 'Maya']])
  })
})

describe('discounted packages', () => {
  it('carries the discounted price paid, not the list price (F8)', async () => {
    const [def] = await tx((db) =>
      db
        .insert(packageDefinitions)
        .values({
          tenantId: ids.tenant!,
          name: { en: '5 × Swedish promo' },
          priceAed: '1500',
          validityDays: 30,
          items: [{ serviceId: ids.service!, quantity: 5 }],
        })
        .returning(),
    )
    // The payroll test above inserted sale #1 by hand; move the counter past it.
    await tx((db) => nextCounter(db, ids.tenant!, 'sale'))
    const { sale } = await tx((db) =>
      createSale(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        clientId: ids.client!,
        lines: [
          {
            kind: 'package',
            refId: def!.id,
            description: '5 × Swedish promo',
            qty: 2,
            unitPriceAed: 1500,
            discountAed: 100,
          },
        ],
        discountAed: 50.01,
        payments: [{ method: 'cash', amountAed: 2849.99 }],
        now: dubaiInstant(D, 720),
      }),
    )
    const pkgs = await tx((db) =>
      db
        .select()
        .from(clientPackages)
        .where(and(eq(clientPackages.saleId, sale.id), eq(clientPackages.definitionId, def!.id))),
    )
    expect(pkgs.map((p) => Number(p.pricePaidAed)).sort()).toEqual([1424.99, 1425])
    expect(pkgs.reduce((s, p) => s + Number(p.remainingValueAed) * 100, 0)).toBe(284999)
    const r = await tx((db) =>
      redeemPackageSession(db, {
        clientPackageId: pkgs[0]!.id,
        serviceId: ids.service!,
        branchId: ids.branch!,
      }),
    )
    expect(r.valueAed).toBe(Math.round((Number(pkgs[0]!.pricePaidAed) / 5) * 100) / 100)
  })
})

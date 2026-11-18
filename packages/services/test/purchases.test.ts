// R8 purchases + R9 warehouse stock: ledger postings, stock per location, transfers, counts and voids.
import {
  branches,
  closeAllDbs,
  journalEntries,
  products,
  purchaseLines,
  purchases,
  stockLevels,
  stockMovements,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { and, eq, isNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  accountTotals,
  countStock,
  lowStock,
  recordPurchase,
  setLocationLowStock,
  supplierByName,
  transferStock,
  voidPurchase,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06'
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const bal = async (code: string) =>
  (await tx((db) => accountTotals(db, ids.tenant!, null, '2030-01-01'))).find((a) => a.code === code)
    ?.balance ?? 0
const level = async (branchId: string | null, productId: string) =>
  Number(
    (
      await tx((db) =>
        db
          .select({ qty: stockLevels.qty })
          .from(stockLevels)
          .where(
            and(
              branchId ? eq(stockLevels.branchId, branchId) : isNull(stockLevels.branchId),
              eq(stockLevels.productId, productId),
            ),
          ),
      )
    )[0]?.qty ?? 0,
  )

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'w3', name: 'W3 Spa' }).returning()
  const [other] = await platform.insert(tenants).values({ slug: 'w3b', name: 'Other' }).returning()
  ids.tenant = t!.id
  ids.other = other!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Main', isDefault: true })
      .returning()
    ids.branch = b!.id
    const [oil] = await db
      .insert(products)
      .values({
        tenantId: ids.tenant!,
        kind: 'consumable',
        name: { en: 'Oil' },
        unit: 'ml',
        lowStockAt: '500',
      })
      .returning()
    ids.oil = oil!.id
  })
})
afterAll(closeAllDbs)

describe('purchases (R8)', () => {
  it('finds or adds suppliers by name, case-insensitively', async () => {
    const a = await tx((db) => supplierByName(db, { tenantId: ids.tenant!, name: 'Gulf Supplies' }))
    const b = await tx((db) => supplierByName(db, { tenantId: ids.tenant!, name: '  gulf supplies ' }))
    expect(b).toBe(a)
    ids.supplier = a
  })

  it('records a mixed purchase into the warehouse: Dr 1200 + 6150 + 1300, Cr cash; stock at the warehouse', async () => {
    const id = await tx((db) =>
      recordPurchase(db, {
        tenantId: ids.tenant!,
        branchId: null,
        supplierId: ids.supplier,
        date: D,
        category: 'cleaning',
        paidVia: 'cash',
        vatAed: 7.5,
        lines: [
          { productId: ids.oil, qty: 2000, unitCostAed: 0.05 },
          { description: 'Floor cleaner', qty: 2, unitCostAed: 25 },
        ],
        createdBy: null,
      }),
    )
    ids.purchase = id
    expect(await bal('1200')).toBe(100)
    expect(await bal('6150')).toBe(50)
    expect(await bal('1300')).toBe(7.5)
    expect(await bal('1000')).toBe(-157.5)
    expect(await level(null, ids.oil!)).toBe(2000)
    expect(await level(ids.branch!, ids.oil!)).toBe(0)
    const [row] = await tx((db) => db.select().from(purchases).where(eq(purchases.id, id)))
    expect([row!.subtotalAed, row!.vatAed, row!.totalAed, row!.branchId]).toEqual([
      '150.00',
      '7.50',
      '157.50',
      null,
    ])
    const lines = await tx((db) => db.select().from(purchaseLines).where(eq(purchaseLines.purchaseId, id)))
    const stockLine = lines.find((l) => l.productId)!
    expect(stockLine.accountCode).toBe('1200')
    expect(lines.find((l) => !l.productId)!.accountCode).toBe('6150')
    const [mv] = await tx((db) =>
      db.select().from(stockMovements).where(eq(stockMovements.id, stockLine.stockMovementId!)),
    )
    expect([mv!.kind, mv!.refType, mv!.refId, mv!.branchId]).toEqual(['purchase', 'purchase', id, null])
    const [oil] = await tx((db) => db.select().from(products).where(eq(products.id, ids.oil!)))
    expect(oil!.costAed).toBe('0.05')
  })

  it('card purchases into a branch credit the bank account', async () => {
    const before = await bal('1020')
    await tx((db) =>
      recordPurchase(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        date: D,
        category: 'equipment',
        paidVia: 'card',
        vatAed: 0,
        lines: [{ description: 'Hot stone heater', qty: 1, unitCostAed: 400 }],
      }),
    )
    expect(await bal('1020')).toBe(before - 400)
    expect(await bal('6170')).toBe(400)
  })

  it('rejects bad input', async () => {
    const base = {
      tenantId: ids.tenant!,
      branchId: null,
      date: D,
      category: 'other' as const,
      paidVia: 'cash' as const,
      vatAed: 0,
    }
    await expect(tx((db) => recordPurchase(db, { ...base, lines: [] }))).rejects.toThrow(
      'Add at least one item',
    )
    await expect(
      tx((db) =>
        recordPurchase(db, { ...base, vatAed: 20, lines: [{ description: 'x', qty: 1, unitCostAed: 10 }] }),
      ),
    ).rejects.toThrow('VAT is more than the subtotal')
    await expect(
      tx((db) => recordPurchase(db, { ...base, lines: [{ description: 'x', qty: 0, unitCostAed: 10 }] })),
    ).rejects.toThrow('Quantity must be positive')
    await expect(
      tx((db) =>
        recordPurchase(db, { ...base, lines: [{ productId: crypto.randomUUID(), qty: 1, unitCostAed: 1 }] }),
      ),
    ).rejects.toThrow('Product not found')
    await expect(
      tx((db) =>
        recordPurchase(db, {
          ...base,
          branchId: crypto.randomUUID(),
          lines: [{ description: 'x', qty: 1, unitCostAed: 1 }],
        }),
      ),
    ).rejects.toThrow('Branch not found')
    // Another spa's purchases are invisible (RLS).
    const seen = await withTenant(ids.other!, (db) => db.select().from(purchases), app)
    expect(seen).toEqual([])
  })
})

describe('warehouse stock (R9)', () => {
  it('transfers warehouse → branch and back without touching the ledger', async () => {
    const entries = (await tx((db) => db.select().from(journalEntries))).length
    const inv = await bal('1200')
    const ref = await tx((db) =>
      transferStock(db, {
        tenantId: ids.tenant!,
        from: null,
        to: ids.branch!,
        productId: ids.oil!,
        qty: 1500,
      }),
    )
    expect(await level(null, ids.oil!)).toBe(500)
    expect(await level(ids.branch!, ids.oil!)).toBe(1500)
    const moves = await tx((db) => db.select().from(stockMovements).where(eq(stockMovements.refId, ref)))
    expect(moves.map((m) => [m.kind, Number(m.qty)]).sort()).toEqual([
      ['transfer_in', 1500],
      ['transfer_out', -1500],
    ])
    await tx((db) =>
      transferStock(db, {
        tenantId: ids.tenant!,
        from: ids.branch!,
        to: null,
        productId: ids.oil!,
        qty: 300,
      }),
    )
    expect(await level(null, ids.oil!)).toBe(800)
    expect((await tx((db) => db.select().from(journalEntries))).length).toBe(entries)
    expect(await bal('1200')).toBe(inv)
  })

  it('never takes a location below zero, and needs two different locations', async () => {
    await expect(
      tx((db) =>
        transferStock(db, {
          tenantId: ids.tenant!,
          from: null,
          to: ids.branch!,
          productId: ids.oil!,
          qty: 801,
        }),
      ),
    ).rejects.toThrow('Only 800 of “Oil” in stock there')
    await expect(
      tx((db) =>
        transferStock(db, { tenantId: ids.tenant!, from: null, to: null, productId: ids.oil!, qty: 1 }),
      ),
    ).rejects.toThrow('Choose two different locations')
    await expect(
      tx((db) =>
        transferStock(db, {
          tenantId: ids.tenant!,
          from: null,
          to: ids.branch!,
          productId: ids.oil!,
          qty: -1,
        }),
      ),
    ).rejects.toThrow('Quantity must be positive')
  })

  it('low stock per location: the location threshold overrides the product one', async () => {
    // Warehouse 800 vs product threshold 500 → fine; branch 1200 → fine.
    expect(await tx((db) => lowStock(db, null))).toEqual([])
    await tx((db) =>
      setLocationLowStock(db, {
        tenantId: ids.tenant!,
        branchId: null,
        productId: ids.oil!,
        lowStockAt: 1000,
      }),
    )
    const low = await tx((db) => lowStock(db, null))
    expect(low.map((l) => [l.productId, Number(l.lowStockAt)])).toEqual([[ids.oil, 1000]])
    expect(await tx((db) => lowStock(db, ids.branch!))).toEqual([])
    await tx((db) =>
      setLocationLowStock(db, {
        tenantId: ids.tenant!,
        branchId: null,
        productId: ids.oil!,
        lowStockAt: null,
      }),
    )
    expect(await tx((db) => lowStock(db, null))).toEqual([])
  })

  it('counts stock at the warehouse, valuing the difference at cost', async () => {
    const before = { inv: await bal('1200'), cons: await bal('5100') }
    const res = await tx((db) =>
      countStock(db, { tenantId: ids.tenant!, branchId: null, productId: ids.oil!, counted: 700, date: D }),
    )
    expect(res.diff).toBe(-100)
    expect(await level(null, ids.oil!)).toBe(700)
    expect(await bal('1200')).toBe(before.inv - 5)
    expect(await bal('5100')).toBe(before.cons + 5)
    const same = await tx((db) =>
      countStock(db, { tenantId: ids.tenant!, branchId: null, productId: ids.oil!, counted: 700, date: D }),
    )
    expect(same).toEqual({ diff: 0, movementId: null })
  })
})

describe('voiding purchases', () => {
  it('blocks a void when the received stock is no longer there', async () => {
    // Purchase received 2000 ml; only 700 left at the warehouse.
    await expect(
      tx((db) => voidPurchase(db, { tenantId: ids.tenant!, purchaseId: ids.purchase!, date: D })),
    ).rejects.toThrow('Only 700 of “Oil” in stock there')
  })

  it('reverses the entry and takes the stock back out', async () => {
    const id = await tx((db) =>
      recordPurchase(db, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        date: D,
        category: 'materials',
        paidVia: 'bank',
        vatAed: 5,
        lines: [
          { productId: ids.oil, qty: 1000, unitCostAed: 0.06 },
          { description: 'Towels', qty: 10, unitCostAed: 4 },
        ],
      }),
    )
    const before = {
      inv: await bal('1200'),
      bank: await bal('1020'),
      vat: await bal('1300'),
      mat: await bal('6160'),
      stock: await level(ids.branch!, ids.oil!),
    }
    await tx((db) => voidPurchase(db, { tenantId: ids.tenant!, purchaseId: id, date: D }))
    expect(await bal('1200')).toBe(before.inv - 60)
    expect(await bal('6160')).toBe(before.mat - 40)
    expect(await bal('1300')).toBe(before.vat - 5)
    expect(await bal('1020')).toBe(before.bank + 105)
    expect(await level(ids.branch!, ids.oil!)).toBe(before.stock - 1000)
    const [row] = await tx((db) => db.select().from(purchases).where(eq(purchases.id, id)))
    expect(row!.status).toBe('void')
    const rev = await tx((db) =>
      db.select().from(journalEntries).where(eq(journalEntries.sourceType, 'purchase_reversal')),
    )
    expect(rev.map((r) => r.sourceId)).toEqual([id])
    await expect(
      tx((db) => voidPurchase(db, { tenantId: ids.tenant!, purchaseId: id, date: D })),
    ).rejects.toThrow('This purchase was already voided')
  })
})

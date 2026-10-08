// Stock: purchases, adjustments, retail sales and consumables used per treatment, with ledger postings at cost.
import { bookingItems, products, serviceConsumables, stockLevels, stockMovements, type Tx } from '@spa/db'
import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { post } from './ledger'

const r2 = (n: number) => Math.round(n * 100) / 100

async function move(
  tx: Tx,
  m: {
    tenantId: string
    branchId: string
    productId: string
    kind: (typeof stockMovements.$inferInsert)['kind']
    qty: number
    unitCostAed?: number
    refType?: string
    refId?: string
    note?: string
    createdBy?: string | null
  },
) {
  await tx.insert(stockMovements).values({
    tenantId: m.tenantId,
    branchId: m.branchId,
    productId: m.productId,
    kind: m.kind,
    qty: m.qty.toString(),
    unitCostAed: m.unitCostAed?.toFixed(2) ?? null,
    refType: m.refType ?? null,
    refId: m.refId ?? null,
    note: m.note ?? null,
    createdBy: m.createdBy ?? null,
  })
  await tx
    .insert(stockLevels)
    .values({ tenantId: m.tenantId, branchId: m.branchId, productId: m.productId, qty: m.qty.toString() })
    .onConflictDoUpdate({
      target: [stockLevels.branchId, stockLevels.productId],
      set: { qty: sql`${stockLevels.qty} + ${m.qty}` },
    })
}

/** Goods received: stock up, inventory asset up, paid by cash or bank (VAT recoverable). */
export async function receiveStock(
  tx: Tx,
  r: {
    tenantId: string
    branchId: string
    productId: string
    qty: number
    unitCostAed: number
    vatAed?: number
    paidVia: 'cash' | 'bank'
    date: string
    createdBy?: string | null
  },
) {
  if (r.qty <= 0) throw new DomainError('Quantity must be positive')
  await move(tx, { ...r, kind: 'purchase', refType: 'purchase' })
  await tx
    .update(products)
    .set({ costAed: r.unitCostAed.toFixed(2) })
    .where(eq(products.id, r.productId))
  const net = r2(r.qty * r.unitCostAed)
  const vat = r.vatAed ?? 0
  await post(tx, {
    tenantId: r.tenantId,
    branchId: r.branchId,
    date: r.date,
    sourceType: 'stock_purchase',
    memo: 'Stock received',
    createdBy: r.createdBy,
    lines: [
      { code: '1200', debit: net },
      { code: '1300', debit: vat },
      { code: r.paidVia === 'cash' ? '1000' : '1020', credit: r2(net + vat) },
    ],
  })
}

/**
 * Sold goods back on the shelf (voided sale, or a refund when `refundId` is given). The caller reverses the
 * cost of sales: void via `reverseSource('cogs')`, refunds pro rata.
 */
export async function returnSoldStock(
  tx: Tx,
  r: {
    tenantId: string
    branchId: string
    productId: string
    qty: number
    saleId: string
    refundId?: string
    date: string
    createdBy?: string | null
  },
) {
  await move(tx, {
    tenantId: r.tenantId,
    branchId: r.branchId,
    productId: r.productId,
    kind: 'adjustment',
    qty: r.qty,
    refType: r.refundId ? 'refund' : 'sale_void',
    refId: r.refundId ?? r.saleId,
    note: r.refundId ? 'Refunded' : 'Sale voided',
    createdBy: r.createdBy,
  })
}

/** Stock count correction (positive or negative), valued at cost. */
export async function adjustStock(
  tx: Tx,
  a: {
    tenantId: string
    branchId: string
    productId: string
    qty: number
    note?: string
    date: string
    createdBy?: string | null
  },
) {
  const [p] = await tx.select().from(products).where(eq(products.id, a.productId))
  if (!p) throw new DomainError('Product not found', 'not_found')
  await move(tx, { ...a, kind: 'adjustment', unitCostAed: Number(p.costAed) })
  const value = r2(Math.abs(a.qty) * Number(p.costAed))
  if (value > 0) {
    await post(tx, {
      tenantId: a.tenantId,
      branchId: a.branchId,
      date: a.date,
      sourceType: 'stock_adjustment',
      memo: a.note ?? 'Stock adjustment',
      createdBy: a.createdBy,
      lines:
        a.qty < 0
          ? [
              { code: '5100', debit: value },
              { code: '1200', credit: value },
            ]
          : [
              { code: '1200', debit: value },
              { code: '5100', credit: value },
            ],
    })
  }
}

/** Retail product sold: stock down and cost of goods sold at cost (revenue is posted by the sale). */
export async function sellStock(
  tx: Tx,
  s: { tenantId: string; branchId: string; productId: string; qty: number; saleId: string; date: string },
) {
  const [p] = await tx.select().from(products).where(eq(products.id, s.productId))
  if (!p) throw new DomainError('Product not found', 'not_found')
  await move(tx, {
    tenantId: s.tenantId,
    branchId: s.branchId,
    productId: s.productId,
    kind: 'sale',
    qty: -s.qty,
    unitCostAed: Number(p.costAed),
    refType: 'sale',
    refId: s.saleId,
  })
  const cost = r2(s.qty * Number(p.costAed))
  if (cost > 0) {
    await post(tx, {
      tenantId: s.tenantId,
      branchId: s.branchId,
      date: s.date,
      sourceType: 'cogs',
      sourceId: s.saleId,
      memo: 'Cost of retail goods',
      lines: [
        { code: '5000', debit: cost },
        { code: '1200', credit: cost },
      ],
    })
  }
}

/** Deducts the consumables configured for each treatment in a completed booking (idempotent per booking). */
export async function consumeForBooking(
  tx: Tx,
  b: { tenantId: string; branchId: string; bookingId: string; date: string },
) {
  const [already] = await tx
    .select({ id: stockMovements.id })
    .from(stockMovements)
    .where(and(eq(stockMovements.refType, 'booking'), eq(stockMovements.refId, b.bookingId)))
    .limit(1)
  if (already) return 0
  const items = await tx
    .select()
    .from(bookingItems)
    .where(and(eq(bookingItems.bookingId, b.bookingId), isNotNull(bookingItems.serviceVariantId)))
  const variantIds = items.map((i) => i.serviceVariantId!).filter(Boolean)
  if (!variantIds.length) return 0
  const uses = await tx
    .select({
      productId: serviceConsumables.productId,
      qty: serviceConsumables.qty,
      variantId: serviceConsumables.serviceVariantId,
      cost: products.costAed,
    })
    .from(serviceConsumables)
    .innerJoin(products, eq(products.id, serviceConsumables.productId))
    .where(inArray(serviceConsumables.serviceVariantId, variantIds))
  let value = 0
  for (const item of items) {
    for (const u of uses.filter((x) => x.variantId === item.serviceVariantId)) {
      await move(tx, {
        tenantId: b.tenantId,
        branchId: b.branchId,
        productId: u.productId,
        kind: 'consumption',
        qty: -Number(u.qty),
        unitCostAed: Number(u.cost),
        refType: 'booking',
        refId: b.bookingId,
      })
      value += Number(u.qty) * Number(u.cost)
    }
  }
  value = r2(value)
  if (value > 0) {
    await post(tx, {
      tenantId: b.tenantId,
      branchId: b.branchId,
      date: b.date,
      sourceType: 'consumption',
      sourceId: b.bookingId,
      memo: 'Consumables used',
      lines: [
        { code: '5100', debit: value },
        { code: '1200', credit: value },
      ],
    })
  }
  return value
}

/** Products at or below their low-stock threshold in a branch. */
export async function lowStock(tx: Tx, branchId: string) {
  return tx
    .select({
      productId: products.id,
      name: products.name,
      unit: products.unit,
      qty: stockLevels.qty,
      lowStockAt: products.lowStockAt,
    })
    .from(stockLevels)
    .innerJoin(products, eq(products.id, stockLevels.productId))
    .where(
      and(
        eq(stockLevels.branchId, branchId),
        isNotNull(products.lowStockAt),
        lte(stockLevels.qty, products.lowStockAt),
      ),
    )
}

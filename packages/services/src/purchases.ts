// Purchase records (R8): supplies, materials and equipment bought from suppliers, with VAT and how they were paid
// (recorded only — never processed). Stock products are received at a location through `inventory.stockIn`
// (warehouse = `branchId: null`, R9); other lines are expensed. One journal entry per purchase:
// Dr 1200 (stock) / Dr 6xxx (non-stock, by category) / Dr 1300 (input VAT) / Cr cash · bank.
import { branches, products, purchaseLines, purchases, suppliers, type Tx } from '@spa/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { lockedStock, type StockLocation, stockIn, stockOut } from './inventory'
import { EXPENSE_CREDIT, post, reverseSource } from './ledger'

export type PurchaseCategory = (typeof purchases.$inferSelect)['category']
export const PURCHASE_CATEGORIES = ['materials', 'cleaning', 'consumables', 'equipment', 'other'] as const
/** Expense account for non-stock lines, by purchase category. */
export const PURCHASE_ACCOUNT: Record<PurchaseCategory, string> = {
  materials: '6160',
  cleaning: '6150',
  consumables: '6160',
  equipment: '6170',
  other: '6900',
}
export const PURCHASE_PAID_VIA = ['cash', 'card', 'bank'] as const
export type PurchasePaidVia = (typeof PURCHASE_PAID_VIA)[number]

const fils = (n: number) => Math.round(n * 100)
const r3 = (n: number) => Math.round(n * 1000) / 1000

/** Finds an active supplier by name (case-insensitive) or adds it. */
export async function supplierByName(
  tx: Tx,
  s: { tenantId: string; name: string; phone?: string | null; trn?: string | null },
) {
  const name = s.name.trim()
  if (!name) throw new DomainError('Enter a name')
  const [found] = await tx
    .select({ id: suppliers.id })
    .from(suppliers)
    .where(and(eq(suppliers.active, true), sql`lower(${suppliers.name}) = lower(${name})`))
    .limit(1)
  if (found) return found.id
  const [row] = await tx
    .insert(suppliers)
    .values({ tenantId: s.tenantId, name, phone: s.phone || null, trn: s.trn || null })
    .returning({ id: suppliers.id })
  return row!.id
}

export type PurchaseLineInput = {
  /** A stock product (received into the location); omit for non-stock items. */
  productId?: string | null
  description?: string | null
  qty: number
  /** Net of VAT. */
  unitCostAed: number
}

export async function recordPurchase(
  tx: Tx,
  p: {
    tenantId: string
    /** Where stock lines are received: a branch, or `null` for the central warehouse. */
    branchId: StockLocation
    supplierId?: string | null
    date: string
    category: PurchaseCategory
    paidVia: PurchasePaidVia
    vatAed: number
    lines: PurchaseLineInput[]
    reference?: string | null
    notes?: string | null
    receiptUrl?: string | null
    ocr?: unknown
    createdBy?: string | null
  },
) {
  if (!p.lines.length) throw new DomainError('Add at least one item')
  if (!PURCHASE_PAID_VIA.includes(p.paidVia)) throw new DomainError('Unknown payment method')
  for (const l of p.lines) {
    if (!(l.qty > 0)) throw new DomainError('Quantity must be positive')
    if (!(l.unitCostAed >= 0)) throw new DomainError('Prices cannot be negative')
  }
  if (!(p.vatAed >= 0)) throw new DomainError('Amounts cannot be negative')
  if (p.branchId) {
    const [b] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, p.branchId))
    if (!b) throw new DomainError('Branch not found', 'not_found')
  }
  if (p.supplierId) {
    const [s] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, p.supplierId))
    if (!s) throw new DomainError('Supplier not found', 'not_found')
  }
  const productIds = [...new Set(p.lines.map((l) => l.productId).filter((x): x is string => !!x))]
  const found = productIds.length
    ? await tx.select().from(products).where(inArray(products.id, productIds))
    : []
  const byId = new Map(found.map((x) => [x.id, x]))
  if (productIds.some((id) => !byId.has(id))) throw new DomainError('Product not found', 'not_found')

  const expenseCode = PURCHASE_ACCOUNT[p.category]
  const lines = p.lines.map((l, i) => {
    const product = l.productId ? byId.get(l.productId)! : null
    const description = l.description?.trim() || product?.name.en || ''
    if (!description) throw new DomainError('Add at least one item')
    return {
      productId: product?.id ?? null,
      description,
      qty: r3(l.qty),
      unitCostAed: Math.round(l.unitCostAed * 100) / 100,
      lineFils: fils(r3(l.qty) * l.unitCostAed),
      accountCode: product ? '1200' : expenseCode,
      sort: i,
    }
  })
  const subtotalFils = lines.reduce((s, l) => s + l.lineFils, 0)
  const vatFils = fils(p.vatAed)
  if (vatFils > subtotalFils) throw new DomainError('VAT is more than the subtotal')
  const aed = (f: number) => (f / 100).toFixed(2)

  const [row] = await tx
    .insert(purchases)
    .values({
      tenantId: p.tenantId,
      supplierId: p.supplierId ?? null,
      branchId: p.branchId,
      purchaseDate: p.date,
      category: p.category,
      subtotalAed: aed(subtotalFils),
      vatAed: aed(vatFils),
      totalAed: aed(subtotalFils + vatFils),
      paidVia: p.paidVia,
      reference: p.reference || null,
      notes: p.notes || null,
      receiptUrl: p.receiptUrl ?? null,
      ocr: p.ocr ?? null,
      createdBy: p.createdBy ?? null,
    })
    .returning({ id: purchases.id })
  const purchaseId = row!.id

  for (const l of lines) {
    const stockMovementId = l.productId
      ? await stockIn(tx, {
          tenantId: p.tenantId,
          branchId: p.branchId,
          productId: l.productId,
          qty: l.qty,
          unitCostAed: l.unitCostAed,
          refType: 'purchase',
          refId: purchaseId,
          createdBy: p.createdBy,
        })
      : null
    await tx.insert(purchaseLines).values({
      tenantId: p.tenantId,
      purchaseId,
      productId: l.productId,
      description: l.description,
      qty: String(l.qty),
      unitCostAed: l.unitCostAed.toFixed(2),
      lineTotalAed: aed(l.lineFils),
      accountCode: l.accountCode,
      stockMovementId,
      sort: l.sort,
    })
  }

  const debits = new Map<string, number>()
  for (const l of lines) debits.set(l.accountCode, (debits.get(l.accountCode) ?? 0) + l.lineFils)
  await post(tx, {
    tenantId: p.tenantId,
    branchId: p.branchId,
    date: p.date,
    sourceType: 'purchase',
    sourceId: purchaseId,
    memo: 'Purchase',
    createdBy: p.createdBy,
    lines: [
      ...[...debits].map(([code, f]) => ({ code, debit: f / 100 })),
      { code: '1300', debit: vatFils / 100 },
      { code: EXPENSE_CREDIT[p.paidVia], credit: (subtotalFils + vatFils) / 100 },
    ],
  })
  return purchaseId
}

/**
 * Voids a purchase: reverses its journal entry (dated `date`) and takes received stock back out of the
 * location. Blocked when that stock has already been used, sold or moved (count or transfer it back first).
 */
export async function voidPurchase(
  tx: Tx,
  v: { tenantId: string; purchaseId: string; date: string; createdBy?: string | null },
) {
  const [row] = await tx.select().from(purchases).where(eq(purchases.id, v.purchaseId)).for('update')
  if (!row) throw new DomainError('Purchase not found', 'not_found')
  if (row.status === 'void') throw new DomainError('This purchase was already voided')
  const stock = await tx
    .select({ productId: purchaseLines.productId, qty: purchaseLines.qty, name: products.name })
    .from(purchaseLines)
    .innerJoin(products, eq(products.id, purchaseLines.productId))
    .where(eq(purchaseLines.purchaseId, row.id))
  const need = new Map<string, { qty: number; name: string }>()
  for (const s of stock) {
    const cur = need.get(s.productId!) ?? { qty: 0, name: s.name.en }
    need.set(s.productId!, { ...cur, qty: r3(cur.qty + Number(s.qty)) })
  }
  for (const [productId, n] of need) {
    const onHand = await lockedStock(tx, row.branchId, productId)
    if (onHand < n.qty) throw new DomainError(`Only ${r3(onHand)} of “${n.name}” in stock there`)
  }
  for (const [productId, n] of need) {
    await stockOut(tx, {
      tenantId: v.tenantId,
      branchId: row.branchId,
      productId,
      qty: n.qty,
      refType: 'purchase_void',
      refId: row.id,
      note: 'Purchase voided',
      createdBy: v.createdBy,
    })
  }
  await reverseSource(tx, v.tenantId, 'purchase', row.id, v.date, v.createdBy)
  await tx
    .update(purchases)
    .set({ status: 'void', voidedAt: new Date(), voidedBy: v.createdBy ?? null })
    .where(eq(purchases.id, row.id))
  return row
}

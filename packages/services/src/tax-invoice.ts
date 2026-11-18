// Full UAE tax invoice (PLAN §18 G16). The sale number is the invoice number: a per-tenant counter taken inside the
// sale's transaction (nextCounter), so numbers are sequential without gaps. Amounts on sales are VAT-inclusive;
// the invoice shows each line's taxable amount (excl. VAT) and VAT, which add up to the sale's stored totals.
import { includedVat } from '@spa/core'
import { type BillingDetails, clients, sales, type Tx } from '@spa/db'
import { eq } from 'drizzle-orm'
import { DomainError } from './errors'
import { normalizeTrn } from './receipts'
import { PREPAID, VAT_RATE_PCT } from './sales'

const fils = (aed: number) => Math.round(aed * 100)
const num = (v: string | number) => Number(v)

export type InvoiceLineInput = {
  kind: string
  qty: number
  unitPriceAed: string | number
  lineTotalAed: string | number
}
export type InvoiceLine = {
  qty: number
  /** VAT-inclusive, as charged. */
  unitPriceAed: number
  /** Everything off the line's list price: its own discount plus its share of a sale-wide discount. */
  discountAed: number
  /** Excl. VAT. */
  taxableAed: number
  vatRatePct: number
  vatAed: number
  /** Incl. VAT (= what the client paid for the line). */
  totalAed: number
}

/**
 * Per-line tax breakdown. Prepaid lines (packages, gift cards) are out of scope at sale (rate 0) — VAT is accounted
 * when the value is used — matching how createSale computes `sales.vat_aed`.
 */
export function taxInvoiceLines(lines: InvoiceLineInput[]) {
  const out: InvoiceLine[] = lines.map((l) => {
    const totalF = fils(num(l.lineTotalAed))
    const unitF = fils(num(l.unitPriceAed))
    const rate = PREPAID.has(l.kind) ? 0 : VAT_RATE_PCT
    const vatF = rate ? fils(includedVat(totalF / 100, rate)) : 0
    return {
      qty: l.qty,
      unitPriceAed: unitF / 100,
      discountAed: Math.max(0, unitF * l.qty - totalF) / 100,
      taxableAed: (totalF - vatF) / 100,
      vatRatePct: rate,
      vatAed: vatF / 100,
      totalAed: totalF / 100,
    }
  })
  const sum = (k: 'discountAed' | 'taxableAed' | 'vatAed' | 'totalAed') =>
    out.reduce((s, l) => s + fils(l[k]), 0) / 100
  return {
    lines: out,
    totals: {
      discountAed: sum('discountAed'),
      taxableAed: sum('taxableAed'),
      vatAed: sum('vatAed'),
      totalAed: sum('totalAed'),
    },
  }
}

/** Trimmed, validated billing details; TRN must be 15 digits (spaces/dashes ignored). */
export function normalizeBilling(input: {
  name: string
  address?: string | null
  trn?: string | null
}): BillingDetails {
  const name = input.name.trim()
  if (name.length < 2)
    throw new DomainError('Enter the customer’s billing name', 'invalid', {
      key: 'sales.invoice.errors.name',
    })
  const rawTrn = input.trn?.trim() ?? ''
  const trn = rawTrn ? normalizeTrn(rawTrn) : null
  if (rawTrn && !trn)
    throw new DomainError('A TRN has 15 digits', 'invalid', { key: 'sales.invoice.errors.trn' })
  return { name, address: input.address?.trim() || null, trn }
}

/**
 * Saves the customer's billing details on a sale (printed on its full tax invoice) and, when asked, on the
 * client's profile so the next invoice is pre-filled. A voided sale can't get an invoice.
 */
export async function saveSaleBilling(
  tx: Tx,
  saleId: string,
  input: { name: string; address?: string | null; trn?: string | null },
  opts: { saveToClient?: boolean } = {},
) {
  const billing = normalizeBilling(input)
  const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId))
  if (!sale) throw new DomainError('Sale not found', 'not_found', { key: 'sales.invoice.errors.notFound' })
  if (sale.status === 'void')
    throw new DomainError('A voided sale has no tax invoice', 'invalid', { key: 'sales.invoice.errors.void' })
  await tx.update(sales).set({ billing }).where(eq(sales.id, saleId))
  if (opts.saveToClient && sale.clientId)
    await tx.update(clients).set({ billing }).where(eq(clients.id, sale.clientId))
  return billing
}

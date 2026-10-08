import { includedVat } from '@spa/core'
import { journalEntries, journalLines, ledgerAccounts, periodLocks, type Tx } from '@spa/db'
import { and, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import { DomainError } from './errors'

type AccountType = (typeof ledgerAccounts.$inferSelect)['type']

/** Default chart of accounts for a UAE spa (codes are stable; names can be edited). */
export const DEFAULT_CHART: { code: string; name: string; type: AccountType }[] = [
  { code: '1000', name: 'Cash on hand', type: 'asset' },
  { code: '1010', name: 'Card terminal clearing', type: 'asset' },
  { code: '1020', name: 'Bank', type: 'asset' },
  { code: '1150', name: 'Staff advances', type: 'asset' },
  { code: '1200', name: 'Inventory', type: 'asset' },
  { code: '1300', name: 'VAT recoverable (input)', type: 'asset' },
  { code: '2000', name: 'VAT payable (output)', type: 'liability' },
  { code: '2100', name: 'Gift cards outstanding', type: 'liability' },
  { code: '2110', name: 'Packages & memberships (deferred revenue)', type: 'liability' },
  { code: '2200', name: 'Tips payable', type: 'liability' },
  { code: '2300', name: 'Commissions payable', type: 'liability' },
  { code: '2400', name: 'Salaries payable', type: 'liability' },
  { code: '3000', name: "Owner's equity", type: 'equity' },
  { code: '3100', name: 'Owner drawings', type: 'equity' },
  { code: '4000', name: 'Treatment revenue', type: 'revenue' },
  { code: '4100', name: 'Retail sales', type: 'revenue' },
  { code: '4300', name: 'Gift card & package breakage', type: 'revenue' },
  { code: '5000', name: 'Cost of retail goods', type: 'expense' },
  { code: '5100', name: 'Consumables used', type: 'expense' },
  { code: '6000', name: 'Salaries', type: 'expense' },
  { code: '6010', name: 'Commissions', type: 'expense' },
  { code: '6100', name: 'Rent', type: 'expense' },
  { code: '6150', name: 'Cleaning supplies', type: 'expense' },
  { code: '6160', name: 'Spa materials & supplies', type: 'expense' },
  { code: '6170', name: 'Small equipment', type: 'expense' },
  { code: '6200', name: 'Utilities (DEWA, internet)', type: 'expense' },
  { code: '6300', name: 'Marketing', type: 'expense' },
  { code: '6400', name: 'Staff accommodation & transport', type: 'expense' },
  { code: '6500', name: 'Visas & licensing', type: 'expense' },
  { code: '6600', name: 'Repairs & maintenance', type: 'expense' },
  { code: '6700', name: 'Bank & card charges', type: 'expense' },
  { code: '6800', name: 'Software & subscriptions', type: 'expense' },
  { code: '6900', name: 'Other expenses', type: 'expense' },
]

/** Expense categories offered in the expenses screen (ledger codes). */
export const EXPENSE_CODES = DEFAULT_CHART.filter(
  (a) => a.type === 'expense' && !['5000', '5100', '6010'].includes(a.code),
)

export async function ensureChart(tx: Tx, tenantId: string) {
  await tx
    .insert(ledgerAccounts)
    .values(DEFAULT_CHART.map((a) => ({ ...a, tenantId, system: true })))
    .onConflictDoNothing()
}

export type PostingLine = { code: string; debit?: number; credit?: number; memo?: string }
const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Posts one balanced journal entry. Zero lines are dropped; amounts are rounded to fils.
 * The database re-checks balance at commit and rejects entries in locked periods.
 */
export async function post(
  tx: Tx,
  e: {
    tenantId: string
    branchId?: string | null
    date: string
    sourceType: string
    sourceId?: string | null
    memo?: string
    createdBy?: string | null
    lines: PostingLine[]
    reversesId?: string
  },
) {
  const lines = e.lines
    .map((l) => ({ ...l, debit: r2(l.debit ?? 0), credit: r2(l.credit ?? 0) }))
    .flatMap((l) => {
      // Normalise negatives to the opposite side and split mixed lines.
      const net = l.debit - l.credit
      if (net === 0) return []
      return [{ code: l.code, memo: l.memo, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 }]
    })
  const d = r2(lines.reduce((s, l) => s + l.debit, 0))
  const c = r2(lines.reduce((s, l) => s + l.credit, 0))
  if (d !== c) throw new DomainError(`Unbalanced entry (${d} ≠ ${c})`)
  if (!lines.length) return null
  await ensureChart(tx, e.tenantId)
  const codes = [...new Set(lines.map((l) => l.code))]
  const accounts = await tx
    .select()
    .from(ledgerAccounts)
    .where(and(eq(ledgerAccounts.tenantId, e.tenantId), inArray(ledgerAccounts.code, codes)))
  const byCode = new Map(accounts.map((a) => [a.code, a.id]))
  for (const code of codes) if (!byCode.has(code)) throw new DomainError(`Unknown account ${code}`)
  const [entry] = await tx
    .insert(journalEntries)
    .values({
      tenantId: e.tenantId,
      branchId: e.branchId ?? null,
      entryDate: e.date,
      sourceType: e.sourceType,
      sourceId: e.sourceId ?? null,
      memo: e.memo ?? null,
      createdBy: e.createdBy ?? null,
      reversesId: e.reversesId ?? null,
    })
    .returning()
  await tx.insert(journalLines).values(
    lines.map((l) => ({
      tenantId: e.tenantId,
      entryId: entry!.id,
      accountId: byCode.get(l.code)!,
      debitAed: l.debit.toFixed(2),
      creditAed: l.credit.toFixed(2),
      memo: l.memo ?? null,
    })),
  )
  return entry!
}

/** Posts the mirror image of every entry for a source (e.g. a voided sale). */
export async function reverseSource(
  tx: Tx,
  tenantId: string,
  sourceType: string,
  sourceId: string,
  date: string,
  createdBy?: string | null,
) {
  const entries = await tx
    .select()
    .from(journalEntries)
    .where(and(eq(journalEntries.sourceType, sourceType), eq(journalEntries.sourceId, sourceId)))
  const done = new Set(
    (
      await tx
        .select({ reversesId: journalEntries.reversesId })
        .from(journalEntries)
        .where(
          and(eq(journalEntries.sourceType, `${sourceType}_reversal`), eq(journalEntries.sourceId, sourceId)),
        )
    ).map((r) => r.reversesId),
  )
  // Idempotent: entries that already have a reversal are skipped.
  for (const entry of entries.filter((x) => !x.reversesId && !done.has(x.id))) {
    const lines = await tx
      .select({ code: ledgerAccounts.code, debit: journalLines.debitAed, credit: journalLines.creditAed })
      .from(journalLines)
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(eq(journalLines.entryId, entry.id))
    await post(tx, {
      tenantId,
      branchId: entry.branchId,
      date,
      sourceType: `${sourceType}_reversal`,
      sourceId,
      reversesId: entry.id,
      memo: `Reversal: ${entry.memo ?? sourceType}`,
      createdBy,
      lines: lines.map((l) => ({ code: l.code, debit: Number(l.credit), credit: Number(l.debit) })),
    })
  }
}

export const PAYMENT_ACCOUNT: Record<string, string> = {
  cash: '1000',
  card_terminal: '1010',
  bank_transfer: '1020',
  gift_card: '2100',
  package_credit: '2110',
  other: '1020',
}

export type SaleForPosting = {
  id: string
  tenantId: string
  branchId: string
  businessDate: string
  createdBy?: string | null
  vatRatePct?: number
  lines: {
    kind: 'service' | 'product' | 'package' | 'gift_card' | 'other'
    lineTotalAed: number
    description?: string
  }[]
  payments: { method: string; amountAed: number }[]
  tips: { method: string; amountAed: number }[]
}

/**
 * Sale → ledger. Treatments and retail are revenue (net of the included VAT, which goes to 2000).
 * Packages and gift cards sold are liabilities until redeemed (VAT recognised on redemption).
 * Payments made with a gift card or package credit reduce those liabilities. Tips are owed to staff.
 */
export async function postSale(tx: Tx, s: SaleForPosting) {
  const rate = s.vatRatePct ?? 5
  const credits: PostingLine[] = []
  let vat = 0
  for (const l of s.lines) {
    if (l.kind === 'package') credits.push({ code: '2110', credit: l.lineTotalAed, memo: l.description })
    else if (l.kind === 'gift_card')
      credits.push({ code: '2100', credit: l.lineTotalAed, memo: l.description })
    else {
      const v = includedVat(l.lineTotalAed, rate)
      vat += v
      credits.push({
        code: l.kind === 'product' ? '4100' : '4000',
        credit: l.lineTotalAed - v,
        memo: l.description,
      })
    }
  }
  if (vat) credits.push({ code: '2000', credit: vat })
  const debits: PostingLine[] = s.payments.map((p) => ({
    code: PAYMENT_ACCOUNT[p.method] ?? '1020',
    debit: p.amountAed,
  }))
  const tipLines: PostingLine[] = s.tips.flatMap((t) => [
    { code: PAYMENT_ACCOUNT[t.method] ?? '1000', debit: t.amountAed },
    { code: '2200', credit: t.amountAed },
  ])
  return post(tx, {
    tenantId: s.tenantId,
    branchId: s.branchId,
    date: s.businessDate,
    sourceType: 'sale',
    sourceId: s.id,
    memo: 'Sale',
    createdBy: s.createdBy,
    lines: [...debits, ...credits, ...tipLines],
  })
}

export type RefundLineForPosting = {
  kind: SaleForPosting['lines'][number]['kind']
  /** VAT-inclusive amount given back for the line. */
  amountAed: number
  /** VAT included in `amountAed` (0 for prepaid lines). */
  vatAed: number
  description?: string
}

/**
 * Refund → ledger, mirroring `postSale` line by line: treatments/other 4000 and retail 4100 (net of VAT, which
 * comes off 2000); gift cards 2100 and packages 2110 with no VAT. The money goes out of the refund method's
 * account. Tips (2200) stay owed to staff.
 */
export async function postRefund(
  tx: Tx,
  r: {
    tenantId: string
    branchId: string
    saleId: string
    date: string
    method: string
    lines: RefundLineForPosting[]
    createdBy?: string | null
  },
) {
  const debits: PostingLine[] = []
  let vat = 0
  for (const l of r.lines) {
    if (l.kind === 'package') debits.push({ code: '2110', debit: l.amountAed, memo: l.description })
    else if (l.kind === 'gift_card') debits.push({ code: '2100', debit: l.amountAed, memo: l.description })
    else {
      vat += l.vatAed
      debits.push({
        code: l.kind === 'product' ? '4100' : '4000',
        debit: l.amountAed - l.vatAed,
        memo: l.description,
      })
    }
  }
  if (vat) debits.push({ code: '2000', debit: vat })
  const total = r.lines.reduce((s, l) => s + l.amountAed, 0)
  return post(tx, {
    tenantId: r.tenantId,
    branchId: r.branchId,
    date: r.date,
    sourceType: 'refund',
    sourceId: r.saleId,
    memo: 'Refund',
    createdBy: r.createdBy,
    lines: [...debits, { code: PAYMENT_ACCOUNT[r.method] ?? '1000', credit: total }],
  })
}

/** Account an expense or purchase is paid from (the spa's card settles from the bank; owner = equity). */
export const EXPENSE_CREDIT = { cash: '1000', bank: '1020', card: '1020', owner: '3000' } as const

export async function postExpense(
  tx: Tx,
  x: {
    tenantId: string
    branchId?: string | null
    id: string
    date: string
    accountCode: string
    amountAed: number
    vatAed: number
    paidVia: 'cash' | 'bank' | 'card' | 'owner'
    createdBy?: string | null
    memo?: string
  },
) {
  const credit = EXPENSE_CREDIT[x.paidVia]
  return post(tx, {
    tenantId: x.tenantId,
    branchId: x.branchId,
    date: x.date,
    sourceType: 'expense',
    sourceId: x.id,
    memo: x.memo ?? 'Expense',
    createdBy: x.createdBy,
    lines: [
      { code: x.accountCode, debit: x.amountAed - x.vatAed },
      { code: '1300', debit: x.vatAed },
      { code: credit, credit: x.amountAed },
    ],
  })
}

/** Package or membership session used: liability → revenue (+ output VAT). */
export async function postRedemption(
  tx: Tx,
  r: {
    tenantId: string
    branchId?: string | null
    sourceId: string
    date: string
    valueAed: number
    vatRatePct?: number
    createdBy?: string | null
  },
) {
  const vat = includedVat(r.valueAed, r.vatRatePct ?? 5)
  return post(tx, {
    tenantId: r.tenantId,
    branchId: r.branchId,
    date: r.date,
    sourceType: 'redemption',
    sourceId: r.sourceId,
    memo: 'Package / membership session',
    createdBy: r.createdBy,
    lines: [
      { code: '2110', debit: r.valueAed },
      { code: '4000', credit: r.valueAed - vat },
      { code: '2000', credit: vat },
    ],
  })
}

export async function lockPeriod(tx: Tx, tenantId: string, through: string, userId: string) {
  await tx
    .insert(periodLocks)
    .values({ tenantId, lockedThrough: through, lockedBy: userId })
    .onConflictDoUpdate({ target: periodLocks.tenantId, set: { lockedThrough: through, lockedBy: userId } })
}

export type AccountBalance = {
  code: string
  name: string
  type: AccountType
  debit: number
  credit: number
  balance: number
}

/** Per-account totals for a date range (balance is in the account's natural direction). */
export async function accountTotals(
  tx: Tx,
  tenantId: string,
  from: string | null,
  to: string,
  branchId?: string | null,
): Promise<AccountBalance[]> {
  const rows = await tx
    .select({
      code: ledgerAccounts.code,
      name: ledgerAccounts.name,
      type: ledgerAccounts.type,
      debit: sql<string>`coalesce(sum(${journalLines.debitAed}), 0)`,
      credit: sql<string>`coalesce(sum(${journalLines.creditAed}), 0)`,
    })
    .from(journalLines)
    .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
    .where(
      and(
        eq(journalEntries.tenantId, tenantId),
        lte(journalEntries.entryDate, to),
        from ? gte(journalEntries.entryDate, from) : undefined,
        branchId ? eq(journalEntries.branchId, branchId) : undefined,
      ),
    )
    .groupBy(ledgerAccounts.code, ledgerAccounts.name, ledgerAccounts.type)
    .orderBy(ledgerAccounts.code)
  return rows.map((r) => {
    const debit = Number(r.debit)
    const credit = Number(r.credit)
    const natural = r.type === 'asset' || r.type === 'expense' ? debit - credit : credit - debit
    return { code: r.code, name: r.name, type: r.type, debit, credit, balance: r2(natural) }
  })
}

export async function profitAndLoss(
  tx: Tx,
  tenantId: string,
  from: string,
  to: string,
  branchId?: string | null,
) {
  const totals = await accountTotals(tx, tenantId, from, to, branchId)
  const revenue = totals.filter((a) => a.type === 'revenue')
  const expenses = totals.filter((a) => a.type === 'expense')
  const totalRevenue = r2(revenue.reduce((s, a) => s + a.balance, 0))
  const totalExpenses = r2(expenses.reduce((s, a) => s + a.balance, 0))
  return { revenue, expenses, totalRevenue, totalExpenses, profit: r2(totalRevenue - totalExpenses) }
}

/** VAT return helper (UAE Form 201 shape): output tax on sales vs input tax on expenses. */
export async function vatSummary(tx: Tx, tenantId: string, from: string, to: string) {
  const totals = await accountTotals(tx, tenantId, from, to)
  const output = totals.find((a) => a.code === '2000')?.balance ?? 0
  const input = totals.find((a) => a.code === '1300')?.balance ?? 0
  const sales = totals.filter((a) => a.type === 'revenue').reduce((s, a) => s + a.balance, 0)
  return {
    taxableSalesAed: r2(sales),
    outputVatAed: r2(output),
    inputVatAed: r2(input),
    netVatDueAed: r2(output - input),
  }
}

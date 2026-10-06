import { journalEntries, journalLines, ledgerAccounts, type Tx } from '@spa/db'
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm'

export const SOURCE_LABELS: Record<string, string> = {
  sale: 'Sale',
  sale_reversal: 'Sale voided',
  refund: 'Refund',
  expense: 'Expense',
  expense_reversal: 'Expense voided',
  redemption: 'Package session',
  package_expiry: 'Expired package',
  commission: 'Commission',
  advance: 'Salary advance',
  payroll: 'Payroll',
  cogs: 'Cost of goods sold',
  consumption: 'Consumables used',
  stock_purchase: 'Stock received',
  stock_adjustment: 'Stock adjusted',
}

/** Journal entries with their lines for a date range, newest first. */
export async function journal(tx: Tx, from: string, to: string, limit = 300) {
  const entries = await tx
    .select()
    .from(journalEntries)
    .where(and(gte(journalEntries.entryDate, from), lte(journalEntries.entryDate, to)))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt))
    .limit(limit)
  if (entries.length === 0) return []
  const lines = await tx
    .select({
      id: journalLines.id,
      entryId: journalLines.entryId,
      code: ledgerAccounts.code,
      name: ledgerAccounts.name,
      debit: journalLines.debitAed,
      credit: journalLines.creditAed,
      memo: journalLines.memo,
    })
    .from(journalLines)
    .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
    .where(
      inArray(
        journalLines.entryId,
        entries.map((e) => e.id),
      ),
    )
    .orderBy(asc(journalLines.creditAed), asc(ledgerAccounts.code))
  return entries.map((e) => ({ ...e, lines: lines.filter((l) => l.entryId === e.id) }))
}

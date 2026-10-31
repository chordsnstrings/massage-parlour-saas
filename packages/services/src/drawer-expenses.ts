// R32 (D11): cash expenses reception pays from the drawer during the day (e.g. Laundry 58). They live in `expenses`
// (`from_drawer`, paid via cash, dated the branch business date), post Dr expense / Cr 1000 Cash, and come off that
// day's expected cash and the day sheet's cash total. A closed day changes only with `allowClosedDay` (pos.correct).
import { expenses, type Tx } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { DomainError } from './errors'
import { EXPENSE_CODES, postExpense, reverseSource } from './ledger'
import { branchBusinessDate, DAY_CLOSED, drawerExpenseRows, isDayClosed } from './sales'

/** Categories offered on Daily close (the Accounts expense list; 6180 Laundry included). */
export const DRAWER_EXPENSE_CODES = EXPENSE_CODES

export const drawerExpenses = drawerExpenseRows

export async function recordDrawerExpense(
  tx: Tx,
  i: {
    tenantId: string
    branchId: string
    date: string
    description: string
    accountCode: string
    amountAed: number
    createdBy?: string | null
    allowClosedDay?: boolean
    now?: Date
  },
) {
  const description = i.description.trim()
  if (!description || description.length > 80) throw new DomainError('Say what the expense was for')
  if (!DRAWER_EXPENSE_CODES.some((c) => c.code === i.accountCode)) throw new DomainError('Pick a category')
  if (!Number.isFinite(i.amountAed) || i.amountAed < 0.01 || i.amountAed > 100_000)
    throw new DomainError('Enter an amount between 0.01 and 100,000 AED')
  if (i.date > (await branchBusinessDate(tx, i.branchId, i.now)))
    throw new DomainError('That business day has not started yet')
  if ((await isDayClosed(tx, i.branchId, i.date, { lock: true })) && !i.allowClosedDay)
    throw new DomainError(DAY_CLOSED)
  const amount = Math.round(i.amountAed * 100) / 100
  const [row] = await tx
    .insert(expenses)
    .values({
      tenantId: i.tenantId,
      branchId: i.branchId,
      expenseDate: i.date,
      accountCode: i.accountCode,
      description,
      amountAed: amount.toFixed(2),
      vatAed: '0',
      paidVia: 'cash',
      fromDrawer: true,
      createdBy: i.createdBy ?? null,
    })
    .returning()
  await postExpense(tx, {
    tenantId: i.tenantId,
    branchId: i.branchId,
    id: row!.id,
    date: i.date,
    accountCode: i.accountCode,
    amountAed: amount,
    vatAed: 0,
    paidVia: 'cash',
    createdBy: i.createdBy,
    memo: `Drawer: ${description}`,
  })
  return row!
}

/** Reverses a drawer expense on its own date (append-only journal) and removes the row. */
export async function voidDrawerExpense(
  tx: Tx,
  i: { expenseId: string; userId?: string | null; allowClosedDay?: boolean },
) {
  const [row] = await tx.select().from(expenses).where(eq(expenses.id, i.expenseId)).for('update')
  if (!row?.fromDrawer || !row.branchId) throw new DomainError('Expense not found', 'not_found')
  if ((await isDayClosed(tx, row.branchId, row.expenseDate, { lock: true })) && !i.allowClosedDay)
    throw new DomainError(DAY_CLOSED)
  await reverseSource(tx, row.tenantId, 'expense', row.id, row.expenseDate, i.userId)
  await tx.delete(expenses).where(and(eq(expenses.id, row.id), eq(expenses.tenantId, row.tenantId)))
  return row
}

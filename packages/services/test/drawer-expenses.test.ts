// R32 (D11): cash expenses paid from the reception drawer on Daily close.
import { dubaiInstant } from '@spa/core'
import {
  branches,
  closeAllDbs,
  expenses,
  journalEntries,
  journalLines,
  ledgerAccounts,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  closeDay,
  createSale,
  DAY_CLOSED,
  DRAWER_EXPENSE_CODES,
  daySheet,
  daySummary,
  drawerExpenses,
  recordDrawerExpense,
  voidDrawerExpense,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-13'
const NOW = dubaiInstant(D, 22 * 60)
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(ids.tenant!, fn, app)
const base = () => ({ tenantId: ids.tenant!, branchId: ids.branch! })
/** Debit − credit per account code over the journal entries of one source. */
const posted = async (sourceId: string) => {
  const rows = await tx((db) =>
    db
      .select({
        code: ledgerAccounts.code,
        type: journalEntries.sourceType,
        date: journalEntries.entryDate,
        v: sql<string>`sum(${journalLines.debitAed} - ${journalLines.creditAed})`,
      })
      .from(journalLines)
      .innerJoin(journalEntries, eq(journalEntries.id, journalLines.entryId))
      .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
      .where(eq(journalEntries.sourceId, sourceId))
      .groupBy(ledgerAccounts.code, journalEntries.sourceType, journalEntries.entryDate),
  )
  return rows.map((r) => ({ ...r, v: Number(r.v) })).filter((r) => r.v !== 0)
}
const laundry = (o: Partial<Parameters<typeof recordDrawerExpense>[1]> = {}) =>
  tx((db) =>
    recordDrawerExpense(db, {
      ...base(),
      date: D,
      description: 'Laundry',
      accountCode: '6180',
      amountAed: 58,
      now: NOW,
      ...o,
    }),
  )

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'drawer', name: 'Drawer Spa' }).returning()
  ids.tenant = t!.id
  await tx(async (db) => {
    const [b] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Main', isDefault: true })
      .returning()
    ids.branch = b!.id
  })
})
afterAll(closeAllDbs)

describe('drawer expenses', () => {
  it('records a cash expense from the drawer: row + Dr 6180 / Cr 1000 on the business date', async () => {
    expect(DRAWER_EXPENSE_CODES.some((c) => c.code === '6180' && c.name === 'Laundry')).toBe(true)
    const row = await laundry()
    expect(row).toMatchObject({
      fromDrawer: true,
      paidVia: 'cash',
      expenseDate: D,
      amountAed: '58.00',
      vatAed: '0.00',
    })
    expect(await posted(row.id)).toEqual(
      expect.arrayContaining([
        { code: '6180', type: 'expense', date: D, v: 58 },
        { code: '1000', type: 'expense', date: D, v: -58 },
      ]),
    )
    const list = await tx((db) => drawerExpenses(db, ids.branch!, D))
    expect(list).toEqual([
      expect.objectContaining({ id: row.id, description: 'Laundry', accountCode: '6180', amountAed: 58 }),
    ])
  })

  it('validates the description, category, amount and day', async () => {
    await expect(laundry({ description: ' ' })).rejects.toThrow('Say what the expense was for')
    await expect(laundry({ accountCode: '4000' })).rejects.toThrow('Pick a category')
    await expect(laundry({ amountAed: 0 })).rejects.toThrow('Enter an amount between 0.01 and 100,000 AED')
    await expect(laundry({ date: '2026-10-14' })).rejects.toThrow('That business day has not started yet')
  })

  it('comes off expected cash; the close stores it; then the closed day refuses changes unless allowed', async () => {
    await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [{ kind: 'other', description: 'Session', qty: 1, unitPriceAed: 1460 }],
        payments: [{ method: 'cash', amountAed: 1460 }],
        now: NOW,
      }),
    )
    const s = await tx((db) => daySummary(db, ids.branch!, D, 0))
    expect(s.drawerExpensesAed).toBe(58)
    expect(s.drawerExpenses).toHaveLength(1)
    expect(s.expectedCashAed).toBe(1402)
    const close = await tx((db) =>
      closeDay(db, { ...base(), date: D, openingFloatAed: 0, countedCashAed: 1402 }),
    )
    expect(close.totals.expenses).toBe('58.00')
    expect(close.varianceAed).toBe('0.00')
    await expect(laundry({ description: 'Water', amountAed: 5 })).rejects.toThrow(DAY_CLOSED)
    const [row] = await tx((db) => db.select().from(expenses).where(eq(expenses.expenseDate, D)))
    await expect(tx((db) => voidDrawerExpense(db, { expenseId: row!.id }))).rejects.toThrow(DAY_CLOSED)
    const late = await laundry({ description: 'Water', amountAed: 5, allowClosedDay: true })
    expect(late.expenseDate).toBe(D)
  })

  it('keeps Accounts-page expenses (not from the drawer) out of the expected cash and the day sheet', async () => {
    const day = '2026-10-11'
    await tx((db) =>
      createSale(db, {
        ...base(),
        lines: [{ kind: 'other', description: 'Session', qty: 1, unitPriceAed: 300 }],
        payments: [{ method: 'cash', amountAed: 300 }],
        businessDate: day,
        now: NOW,
      }),
    )
    // Rent paid in cash on the same branch and day, entered on the Accounts page.
    await tx((db) =>
      db.insert(expenses).values({
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        expenseDate: day,
        accountCode: '6100',
        description: 'Rent',
        amountAed: '100.00',
        paidVia: 'cash',
      }),
    )
    const s = await tx((db) => daySummary(db, ids.branch!, day, 0))
    expect(s.drawerExpensesAed).toBe(0)
    expect(s.drawerExpenses).toHaveLength(0)
    expect(s.expectedCashAed).toBe(300)
    const sheet = await tx((db) => daySheet(db, ids.branch!, day))
    expect(sheet.expenses).toHaveLength(0)
    expect(sheet.totals).toMatchObject({ cashAed: 300, expensesAed: 0, totalCashAed: 300, totalSaleAed: 300 })
  })

  it('voids with a reversal on the expense date and removes the row', async () => {
    const day = '2026-10-12'
    const row = await laundry({ date: day, description: 'Towels', amountAed: 20 })
    await tx((db) => voidDrawerExpense(db, { expenseId: row.id }))
    expect(await tx((db) => db.select().from(expenses).where(eq(expenses.id, row.id)))).toHaveLength(0)
    const entries = await posted(row.id)
    expect(entries).toEqual(
      expect.arrayContaining([
        { code: '6180', type: 'expense_reversal', date: day, v: -20 },
        { code: '1000', type: 'expense_reversal', date: day, v: 20 },
      ]),
    )
    await expect(tx((db) => voidDrawerExpense(db, { expenseId: row.id }))).rejects.toThrow(
      'Expense not found',
    )
  })
})

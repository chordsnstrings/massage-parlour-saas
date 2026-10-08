import { closeAllDbs, journalLines, ledgerAccounts, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  accountTotals,
  lockPeriod,
  post,
  postExpense,
  postRedemption,
  postRefund,
  postSale,
  profitAndLoss,
  reverseSource,
  vatSummary,
} from '../src'

const { platform, app } = testDbs()
let tenantId = ''
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(tenantId, fn, app)
const D = '2026-10-06'

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'books', name: 'Books Spa' }).returning()
  tenantId = t!.id
})
afterAll(closeAllDbs)

describe('ledger', () => {
  it('posts a sale: revenue net of VAT, VAT payable, tips owed, packages deferred', async () => {
    await tx((db) =>
      postSale(db, {
        id: '00000000-0000-4000-8000-000000000001',
        tenantId,
        branchId: null as unknown as string,
        businessDate: D,
        lines: [
          { kind: 'service', lineTotalAed: 350 },
          { kind: 'package', lineTotalAed: 1500 },
        ],
        payments: [
          { method: 'cash', amountAed: 200 },
          { method: 'card_terminal', amountAed: 1650 },
        ],
        tips: [{ method: 'cash', amountAed: 20 }],
      }),
    )
    const t = await tx((db) => accountTotals(db, tenantId, null, D))
    const bal = (code: string) => t.find((a) => a.code === code)?.balance ?? 0
    expect(bal('1000')).toBe(220)
    expect(bal('1010')).toBe(1650)
    expect(bal('4000')).toBe(333.33)
    expect(bal('2000')).toBe(16.67)
    expect(bal('2110')).toBe(1500)
    expect(bal('2200')).toBe(20)
    const debit = t.reduce((s, a) => s + a.debit, 0)
    const credit = t.reduce((s, a) => s + a.credit, 0)
    expect(Math.round(debit * 100)).toBe(Math.round(credit * 100))
  })

  it('recognises package sessions and expenses in the P&L and VAT summary', async () => {
    await tx((db) =>
      postRedemption(db, {
        tenantId,
        sourceId: '00000000-0000-4000-8000-000000000002',
        date: D,
        valueAed: 150,
      }),
    )
    await tx((db) =>
      postExpense(db, {
        tenantId,
        id: '00000000-0000-4000-8000-000000000003',
        date: D,
        accountCode: '6100',
        amountAed: 10500,
        vatAed: 500,
        paidVia: 'bank',
      }),
    )
    const pl = await tx((db) => profitAndLoss(db, tenantId, D, D))
    expect(pl.totalRevenue).toBeCloseTo(333.33 + 142.86, 2)
    expect(pl.totalExpenses).toBe(10000)
    const vat = await tx((db) => vatSummary(db, tenantId, D, D))
    expect(vat.outputVatAed).toBeCloseTo(16.67 + 7.14, 2)
    expect(vat.inputVatAed).toBe(500)
  })

  it('rejects unbalanced entries (service check and DB constraint)', async () => {
    await expect(
      tx((db) => post(db, { tenantId, date: D, sourceType: 'manual', lines: [{ code: '1000', debit: 10 }] })),
    ).rejects.toThrow(/Unbalanced/)
    // bypass the service check: the deferred trigger still refuses at commit
    await expect(
      tx(async (db) => {
        const e = await post(db, {
          tenantId,
          date: D,
          sourceType: 'manual',
          lines: [
            { code: '1000', debit: 5 },
            { code: '3000', credit: 5 },
          ],
        })
        await db.execute(
          sql`insert into journal_lines (tenant_id, entry_id, account_id, debit_aed, credit_aed) select tenant_id, entry_id, account_id, 1, 0 from journal_lines where entry_id = ${e!.id} limit 1`,
        )
      }),
    ).rejects.toThrow()
  })

  it('is append-only for the app role and reversible', async () => {
    await expect(tx((db) => db.update(journalLines).set({ memo: 'edited' }))).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/append-only/) },
    })
    await tx((db) => reverseSource(db, tenantId, 'expense', '00000000-0000-4000-8000-000000000003', D))
    const pl = await tx((db) => profitAndLoss(db, tenantId, D, D))
    expect(pl.totalExpenses).toBe(0)
  })

  it('refuses entries in locked periods', async () => {
    await tx((db) => lockPeriod(db, tenantId, D, null as unknown as string))
    await expect(
      tx((db) =>
        post(db, {
          tenantId,
          date: D,
          sourceType: 'manual',
          lines: [
            { code: '1000', debit: 1 },
            { code: '3000', credit: 1 },
          ],
        }),
      ),
    ).rejects.toMatchObject({
      cause: { message: expect.stringMatching(/locked/) },
    })
  })
})

describe('refund postings (F1)', () => {
  const D2 = '2026-10-07' // after the period locked above
  let n = 100
  const id = () => `00000000-0000-4000-8000-${String(n++).padStart(12, '0')}`
  const sale = (lines: { kind: 'service' | 'product' | 'package' | 'gift_card'; lineTotalAed: number }[]) => {
    const saleId = id()
    const total = lines.reduce((s, l) => s + l.lineTotalAed, 0)
    return tx((db) =>
      postSale(db, {
        id: saleId,
        tenantId,
        branchId: null as unknown as string,
        businessDate: D2,
        lines,
        payments: [{ method: 'card_terminal', amountAed: total }],
        tips: [{ method: 'cash', amountAed: 10 }],
      }),
    ).then(() => saleId)
  }
  /** Posts a refund and returns its lines as code → debit − credit (AED); asserts the entry balances. */
  const refund = async (saleId: string, amountAed: number, method = 'cash') => {
    const entry = await tx((db) =>
      postRefund(db, {
        tenantId,
        branchId: null as unknown as string,
        saleId,
        date: D2,
        amountAed,
        method,
        vatRatePct: 5,
      }),
    )
    const rows = await tx((db) =>
      db
        .select({ code: ledgerAccounts.code, debit: journalLines.debitAed, credit: journalLines.creditAed })
        .from(journalLines)
        .innerJoin(ledgerAccounts, eq(ledgerAccounts.id, journalLines.accountId))
        .where(eq(journalLines.entryId, entry!.id)),
    )
    const fils = (v: string) => Math.round(Number(v) * 100)
    expect(rows.reduce((s, r) => s + fils(r.debit), 0)).toBe(rows.reduce((s, r) => s + fils(r.credit), 0))
    const net: Record<string, number> = {}
    for (const r of rows) net[r.code] = ((net[r.code] ?? 0) * 100 + fils(r.debit) - fils(r.credit)) / 100
    return net
  }

  it('refunds a retail-only sale against retail revenue (4100), leaving tips owed', async () => {
    const s = await sale([{ kind: 'product', lineTotalAed: 105 }])
    expect(await refund(s, 105)).toEqual({ '4100': 100, '2000': 5, '1000': -105 })
  })

  it('prorates a partial refund of a mixed service + product sale', async () => {
    // Sale credits: 4000 200, 4100 100, 2000 15 (of 315).
    const s = await sale([
      { kind: 'service', lineTotalAed: 210 },
      { kind: 'product', lineTotalAed: 105 },
    ])
    expect(await refund(s, 100, 'card_terminal')).toEqual({
      '4000': 63.49,
      '4100': 31.75,
      '2000': 4.76,
      '1010': -100,
    })
    // Every share of 1 fils rounds to 0; the remainder lands on the largest line (4000 100.95).
    const t = await sale([
      { kind: 'service', lineTotalAed: 106 },
      { kind: 'product', lineTotalAed: 105 },
    ])
    expect(await refund(t, 0.01)).toEqual({ '4000': 0.01, '1000': -0.01 })
  })

  it('refunds prepaid lines to their liabilities (2100/2110) with no VAT', async () => {
    const s = await sale([
      { kind: 'gift_card', lineTotalAed: 500 },
      { kind: 'package', lineTotalAed: 1000 },
    ])
    expect(await refund(s, 1500, 'card_terminal')).toEqual({ '2100': 500, '2110': 1000, '1010': -1500 })
  })

  it('falls back to treatment revenue + VAT for sales without a ledger entry', async () => {
    expect(await refund(id(), 105)).toEqual({ '4000': 100, '2000': 5, '1000': -105 })
  })
})

// R32 daily sales sheet query: the owner's paper sheet BE RELAX 13-10-26 rebuilt through the real booking flow
// (createBooking + finishBooking + recordDrawerExpense), plus the edge rules (design §6).
import { dubaiInstant } from '@spa/core'
import { createFormat } from '@spa/core/i18n'
import { bookingItems, branches, closeAllDbs, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createBooking,
  createSale,
  daySheet,
  daySheetFilename,
  finishBooking,
  setBookingStatus,
  voidSale,
} from '../src'
import {
  SHEET_PANEL,
  SHEET_ROWS,
  SHEET_THERAPISTS,
  SHEET_TOTALS,
  seedDaySheetDay,
} from './fixtures/day-sheet-13-10-26'

const { platform, app } = testDbs()
const D = '2026-10-13'
const E = '2026-10-11'
const NOW = dubaiInstant(D, 23 * 60 + 30)
const ids = {} as Record<string, string>
let fx: Awaited<ReturnType<typeof seedDaySheetDay>>
const run = <T>(fn: (tx: Parameters<Parameters<typeof withTenant<T>>[1]>[0]) => Promise<T>) =>
  withTenant(ids.tenant!, fn, app)
const fmt = createFormat('en')

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'berelax', name: 'BE RELAX Spa' }).returning()
  ids.tenant = t!.id
  await run(async (tx) => {
    const [b] = await tx
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Main', isDefault: true })
      .returning()
    ids.branch = b!.id
  })
  fx = await seedDaySheetDay(run, {
    tenantId: ids.tenant!,
    branchId: ids.branch!,
    date: D,
    now: NOW,
    expense: true,
    tips: true,
  })
})
afterAll(closeAllDbs)

/** A confirmed one-treatment (60 min) booking on `date` at `hm` (Dubai) for a fixture therapist in room 8. */
async function bookOn(
  date: string,
  hm: string,
  therapist: string,
  status: 'confirmed' | 'pending' = 'confirmed',
) {
  return run((tx) =>
    createBooking(tx, {
      tenantId: ids.tenant!,
      branchId: ids.branch!,
      clientId: fx.client,
      source: 'walk_in',
      status,
      allowOffShift: true,
      items: [
        {
          serviceVariantId: fx.variant.get(60)!,
          start: dubaiInstant(date, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))),
          staffIds: [fx.staff.get(therapist)!],
          roomId: fx.room.get('8')!,
          feeAed: 100,
          commissionAed: 30,
        },
      ],
    }),
  )
}
const finish = (bookingId: string, now: Date, method: 'cash' | 'bank_transfer' = 'cash') =>
  run(async (tx) => {
    const [item] = await tx.select().from(bookingItems).where(eq(bookingItems.bookingId, bookingId))
    return finishBooking(tx, {
      tenantId: ids.tenant!,
      branchId: ids.branch!,
      bookingId,
      lines: [
        {
          kind: 'service',
          refId: item!.serviceVariantId,
          description: 'Thai massage 60 min',
          qty: 1,
          unitPriceAed: 100,
          staffId: item!.staffIds[0],
        },
      ],
      payments: [{ method, amountAed: 100 }],
      now,
    })
  })

describe('R32 daySheet — the 13-10-26 paper sheet', () => {
  it('lists the 13 sessions as on the paper: No., therapist, Q, time, room, code, cash, card, pink rows', async () => {
    const sheet = await run((tx) => daySheet(tx, ids.branch!, D))
    expect(sheet).toMatchObject({
      date: D,
      spaName: 'BE RELAX Spa',
      branch: { name: 'Main', cutoff: '05:00' },
    })
    expect(sheet.rows).toHaveLength(13)
    for (const [i, want] of SHEET_ROWS.entries()) {
      const row = sheet.rows[i]!
      expect(row).toMatchObject({
        no: want.no,
        therapist: want.therapist,
        q: want.q,
        room: want.room,
        code: want.code,
        ownLead: want.own,
        first: true,
        paid: 'here',
        cashAed: want.pay === 'cash' ? want.amount : 0,
        cardAed: want.pay === 'card_terminal' ? want.amount : 0,
        otherAed: 0,
      })
      expect(`${fmt.time(row.startsAt)}–${fmt.time(row.endsAt)}`).toBe(`${want.from}–${want.to}`)
    }
    expect(sheet.rows.filter((r) => r.ownLead).map((r) => r.no)).toEqual([5, 7, 12])
    expect(sheet.unfinished).toBe(0)
    expect(sheet.otherSales).toEqual([])
    expect(sheet.expenses).toMatchObject([{ description: 'Laundry', amountAed: 58 }])
  })

  it('adds up like the paper: 1460 + 1080 - 58 = 2482, cash 1402 (tips stay out)', async () => {
    const sheet = await run((tx) => daySheet(tx, ids.branch!, D))
    expect(sheet.totals).toMatchObject({
      cashAed: SHEET_TOTALS.cash,
      cardAed: SHEET_TOTALS.card,
      otherAed: 0,
      expensesAed: SHEET_TOTALS.expenses,
      totalSaleAed: SHEET_TOTALS.totalSale,
      totalCardAed: SHEET_TOTALS.card,
      totalCashAed: SHEET_TOTALS.totalCash,
      tipsAed: 20,
      cashRefundsAed: 0,
    })
    // The totals are the rows plus the other sales.
    const sum = (k: 'cashAed' | 'cardAed' | 'otherAed') =>
      sheet.rows.reduce((s, r) => s + (r[k] ?? 0), 0) + sheet.otherSales.reduce((s, o) => s + o[k], 0)
    expect([sum('cashAed'), sum('cardAed'), sum('otherAed')]).toEqual([
      sheet.totals.cashAed,
      sheet.totals.cardAed,
      sheet.totals.otherAed,
    ])
  })

  it('shows every therapist in the turn panel with her turns, own leads, OFF, tips and commission', async () => {
    const sheet = await run((tx) => daySheet(tx, ids.branch!, D))
    expect(sheet.panel.map((p) => p.name)).toEqual(SHEET_THERAPISTS.map(([n]) => n))
    for (const p of sheet.panel) expect(p, p.name).toMatchObject(SHEET_PANEL[p.name]!)
    const of = (name: string) => sheet.panel.find((p) => p.name === name)!
    expect(of('Lisa')).toMatchObject({ tipsAed: 20, commissionAed: 80 })
    expect(of('Luna')).toMatchObject({ tipsAed: 0, commissionAed: 120 })
    expect(of('Linda')).toMatchObject({ commissionAed: 0, off: false })
  })
})

describe('R32 daySheet — rules', () => {
  it('leaves out pending, cancelled and no-show bookings; unfinished and voided sessions show no money', async () => {
    const open = await bookOn(E, '13:00', 'Linda')
    await bookOn(E, '14:00', 'Linda', 'pending')
    const cancelled = await bookOn(E, '15:00', 'Linda')
    await run((tx) => setBookingStatus(tx, cancelled.id, 'cancelled'))
    const noShow = await bookOn(E, '16:00', 'Linda')
    await run((tx) => setBookingStatus(tx, noShow.id, 'no_show'))
    const voided = await bookOn(E, '17:00', 'Qamar')
    const evening = dubaiInstant(E, 23 * 60)
    const { sale } = await finish(voided.id, evening)
    await run((tx) => voidSale(tx, { saleId: sale.id, reason: 'Wrong client' }))
    const sheet = await run((tx) => daySheet(tx, ids.branch!, E))
    expect(sheet.rows.map((r) => [r.bookingId, r.paid])).toEqual([
      [open.id, 'no'],
      [voided.id, 'no'],
    ])
    expect(sheet.rows[0]).toMatchObject({ cashAed: null, cardAed: null, q: 1 })
    expect(sheet.unfinished).toBe(2)
    expect(sheet.totals.cashAed).toBe(0)
    // Linda (no sessions billed but rows) is not OFF; nobody has a shift on E, so the rest are OFF.
    expect(sheet.panel.find((p) => p.name === 'Linda')).toMatchObject({ off: false, turns: [1] })
    expect(sheet.panel.find((p) => p.name === 'Bella')).toMatchObject({ off: true, turns: [] })
  })

  it('lists retail sales and another day’s booking under Other sales, in the totals; Other = non cash/card', async () => {
    const evening = dubaiInstant(E, 23 * 60 + 5)
    const retail = await run((tx) =>
      createSale(tx, {
        tenantId: ids.tenant!,
        branchId: ids.branch!,
        lines: [{ kind: 'other', description: 'Massage oil', qty: 1, unitPriceAed: 45 }],
        payments: [{ method: 'bank_transfer', amountAed: 45 }],
        now: evening,
      }),
    )
    // A booking on the 12th paid on the 11th (its day had not started): money on the 11th, row on the 12th.
    const early = await bookOn('2026-10-12', '13:00', 'Miney')
    const paid = await finish(early.id, evening)
    expect(paid.saleDate).toBe(E)
    const sheet = await run((tx) => daySheet(tx, ids.branch!, E))
    expect(sheet.otherSales).toEqual([
      expect.objectContaining({
        saleId: retail.sale.id,
        label: 'Massage oil',
        cashAed: 0,
        cardAed: 0,
        otherAed: 45,
      }),
      expect.objectContaining({ saleId: paid.sale.id, label: 'Thai massage 60 min', cashAed: 100 }),
    ])
    expect(sheet.totals).toMatchObject({
      cashAed: 100,
      cardAed: 0,
      otherAed: 45,
      otherByMethod: { bank_transfer: 45 },
      totalSaleAed: 145,
      totalCashAed: 100,
    })
    const next = await run((tx) => daySheet(tx, ids.branch!, '2026-10-12'))
    expect(next.rows).toMatchObject([
      { bookingId: early.id, paid: 'other_day', paidOn: E, cashAed: null, saleNumber: paid.sale.number },
    ])
    expect(next.unfinished).toBe(0)
    expect(next.totals.cashAed).toBe(0)
  })

  it('names the file by date (and branch when the spa has more than one)', () => {
    expect(daySheetFilename(D, 'Main', false)).toBe('day-sheet-2026-10-13.pdf')
    expect(daySheetFilename(D, 'Jumeirah Beach Rd', true)).toBe('day-sheet-2026-10-13-jumeirah-beach-rd.pdf')
  })
})

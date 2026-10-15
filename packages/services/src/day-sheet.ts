// R32 daily sales sheet (owner 2026-10-14, PLAN §14.8 R32; paper reference: BE RELAX 13-10-26). One branch business
// day as the reception's paper sheet: every session in start order (No., therapist, Q = her turn number that day,
// own leads 0, time, room, code P1–P4/W/B + /R /N, cash, card), the therapists' turn panel (OFF when not on shift),
// drawer expenses and the paper totals (sale = cash + card + other − expenses; cash − expenses). Bundle-safe: the PDF
// renderer lives in pdf/day-sheet-pdf.ts (`@spa/services/day-sheet-pdf`).
import { businessDayWindow, sheetCode, sheetTotals, turnNumbers } from '@spa/core'
import {
  bookingCommissions,
  bookingItems,
  bookings,
  branches,
  dayCloses,
  payments,
  refunds,
  rooms,
  saleLines,
  sales,
  staff,
  type Tx,
  tenants,
  tips,
} from '@spa/db'
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm'
import { loadDay } from './bookings'
import { DomainError } from './errors'
import { drawerExpenseRows } from './sales'

/** Private stored file purpose of the day-sheet PDF kept with a close (read with pos.close; files/serve.ts). */
export const DAY_SHEET_PDF_PURPOSE = 'day_sheet_pdf'

/** Statuses that make a session on the sheet (pending / cancelled / no-show are not sessions, D14). */
export const DAY_SHEET_STATUSES = ['confirmed', 'checked_in', 'in_service', 'completed'] as const

export type DaySheetRow = {
  no: number
  key: string
  bookingId: string
  refCode: string
  bookingItemId: string
  staffId: string | null
  therapist: string
  q: number | null
  startsAt: Date
  endsAt: Date
  room: string | null
  code: string
  ownLead: boolean
  /** The booking's first row on the sheet (where its money is written). */
  first: boolean
  paid: 'here' | 'other_day' | 'no'
  paidOn: string | null
  saleNumber: number | null
  cashAed: number | null
  cardAed: number | null
  otherAed: number | null
}

export type DaySheetPanelRow = {
  staffId: string
  name: string
  off: boolean
  turns: number[]
  own: number
  tipsAed: number
  commissionAed: number
}

export type DaySheet = {
  date: string
  branch: { id: string; name: string; cutoff: string }
  spaName: string
  logoFileId: string | null
  /** More than one branch: file names carry the branch. */
  multiBranch: boolean
  rows: DaySheetRow[]
  otherSales: {
    saleId: string
    number: number
    label: string
    cashAed: number
    cardAed: number
    otherAed: number
  }[]
  panel: DaySheetPanelRow[]
  expenses: { id: string; description: string; amountAed: number }[]
  totals: {
    cashAed: number
    cardAed: number
    otherAed: number
    otherByMethod: Record<string, number>
    expensesAed: number
    totalSaleAed: number
    totalCardAed: number
    totalCashAed: number
    tipsAed: number
    cashRefundsAed: number
  }
  /** Sessions on this day with no payment yet (booking not finished). */
  unfinished: number
  close: {
    id: string
    closedAt: Date
    closedBy: string | null
    /** Filled by the caller (user names are platform data). */
    closedByName: string | null
    expectedCashAed: number
    countedCashAed: number
    varianceAed: number
    amendedAt: Date | null
    pdfFileId: string | null
  } | null
}

const fils = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100)
const aed = (f: number) => f / 100

type Money = { cash: number; card: number; other: number; byMethod: Record<string, number> }
const emptyMoney = (): Money => ({ cash: 0, card: 0, other: 0, byMethod: {} })
const addPayment = (m: Money, method: string, f: number) => {
  if (method === 'cash') m.cash += f
  else if (method === 'card_terminal') m.card += f
  else {
    m.other += f
    m.byMethod[method] = (m.byMethod[method] ?? 0) + f
  }
}

/**
 * The daily sales sheet of one branch business day (rules: PLAN §14.8 R32 / design §6). Every source is already
 * dated with the branch business_day_cutoff: sessions by `bookings.business_date`, money by `sales.business_date`,
 * expenses by `expense_date`.
 */
export async function daySheet(tx: Tx, branchId: string, date: string): Promise<DaySheet> {
  const [branch] = await tx.select().from(branches).where(eq(branches.id, branchId))
  if (!branch) throw new DomainError('Branch not found', 'not_found')
  const [tenant] = await tx
    .select({ name: tenants.name, logoFileId: tenants.logoFileId })
    .from(tenants)
    .where(eq(tenants.id, branch.tenantId))
  const [{ n: branchCount } = { n: 1 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(branches)
    .where(eq(branches.tenantId, branch.tenantId))
  const cutoff = branch.businessDayCutoff.slice(0, 5)

  // 1–2. Sessions: one row per (item, therapist), in start order.
  // R32 OPEN (owner 2026-10-14 "ask me later"): cancelled bookings — how they count on the sheet is not decided.
  // Until then today's behaviour stays: cancelled, no-show and pending bookings are not sessions and not sales.
  const items = await tx
    .select({
      itemId: bookingItems.id,
      bookingId: bookings.id,
      refCode: bookings.refCode,
      source: bookings.source,
      phoneLine: bookings.phoneLine,
      clientType: bookings.clientType,
      ownLead: bookings.ownLead,
      createdAt: bookings.createdAt,
      startsAt: bookingItems.startsAt,
      endsAt: bookingItems.endsAt,
      staffIds: bookingItems.staffIds,
      room: rooms.name,
    })
    .from(bookingItems)
    .innerJoin(bookings, eq(bookings.id, bookingItems.bookingId))
    .leftJoin(rooms, eq(rooms.id, bookingItems.roomId))
    .where(
      and(
        eq(bookings.branchId, branchId),
        eq(bookings.businessDate, date),
        inArray(bookings.status, [...DAY_SHEET_STATUSES]),
      ),
    )
    .orderBy(asc(bookingItems.startsAt), asc(bookings.createdAt), asc(bookings.refCode), asc(bookingItems.id))
  const staffIdsOnRows = [...new Set(items.flatMap((i) => i.staffIds))]
  const names = new Map(
    staffIdsOnRows.length
      ? (
          await tx
            .select({ id: staff.id, name: staff.displayName })
            .from(staff)
            .where(inArray(staff.id, staffIdsOnRows))
        ).map((s) => [s.id, s.name])
      : [],
  )

  // 5. Money: each booking's live sale; its payments go on the booking's first row when the sale is dated today.
  const bookingIds = [...new Set(items.map((i) => i.bookingId))]
  const bookingSales = bookingIds.length
    ? await tx
        .select({
          id: sales.id,
          bookingId: sales.bookingId,
          number: sales.number,
          businessDate: sales.businessDate,
          branchId: sales.branchId,
        })
        .from(sales)
        .where(and(inArray(sales.bookingId, bookingIds), ne(sales.status, 'void')))
    : []
  const saleOf = new Map(bookingSales.map((s) => [s.bookingId!, s]))

  // All live sales of the branch on the day (totals and "Other sales").
  const live = and(eq(sales.branchId, branchId), eq(sales.businessDate, date), ne(sales.status, 'void'))
  const daySales = await tx
    .select({ id: sales.id, number: sales.number, bookingId: sales.bookingId })
    .from(sales)
    .where(live)
    .orderBy(asc(sales.number))
  const payRows = await tx
    .select({
      saleId: payments.saleId,
      method: payments.method,
      v: sql<string>`sum(${payments.amountAed})`,
    })
    .from(payments)
    .innerJoin(sales, eq(sales.id, payments.saleId))
    .where(live)
    .groupBy(payments.saleId, payments.method)
  const moneyOf = new Map<string, Money>()
  for (const p of payRows) {
    const m = moneyOf.get(p.saleId) ?? emptyMoney()
    addPayment(m, p.method, fils(p.v))
    moneyOf.set(p.saleId, m)
  }

  const keyed = items.flatMap((i) =>
    (i.staffIds.length ? i.staffIds : [null]).map((staffId, idx) => ({
      ...i,
      key: `${i.itemId}:${idx}`,
      staffId,
    })),
  )
  const q = turnNumbers(keyed)
  const seenBooking = new Set<string>()
  const onRows = new Set<string>()
  let unfinished = 0
  const rows: DaySheetRow[] = keyed.map((r, i) => {
    const first = !seenBooking.has(r.bookingId)
    seenBooking.add(r.bookingId)
    const sale = saleOf.get(r.bookingId) ?? null
    const here = sale && sale.businessDate === date && sale.branchId === branchId
    if (!sale) unfinished += 1
    if (here) onRows.add(sale.id)
    const m = here && first ? (moneyOf.get(sale.id) ?? emptyMoney()) : null
    return {
      no: i + 1,
      key: r.key,
      bookingId: r.bookingId,
      refCode: r.refCode,
      bookingItemId: r.itemId,
      staffId: r.staffId,
      therapist: r.staffId ? (names.get(r.staffId) ?? '—') : '—',
      q: q.get(r.key) ?? null,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      room: r.room ?? null,
      code: sheetCode(r),
      ownLead: r.ownLead,
      first,
      paid: !sale ? 'no' : here ? 'here' : 'other_day',
      paidOn: sale && !here ? sale.businessDate : null,
      saleNumber: sale?.number ?? null,
      cashAed: m ? aed(m.cash) : null,
      cardAed: m ? aed(m.card) : null,
      otherAed: m ? aed(m.other) : null,
    }
  })

  // 6. Other sales: live sales of the day not written on a session row (retail, another day's booking …).
  const others = daySales.filter((s) => !onRows.has(s.id))
  const firstLines = others.length
    ? await tx
        .select({ saleId: saleLines.saleId, description: saleLines.description, id: saleLines.id })
        .from(saleLines)
        .where(
          inArray(
            saleLines.saleId,
            others.map((s) => s.id),
          ),
        )
        .orderBy(asc(saleLines.saleId), asc(saleLines.id))
    : []
  const lineOf = new Map<string, string>()
  for (const l of firstLines) if (!lineOf.has(l.saleId)) lineOf.set(l.saleId, l.description)
  const otherSales = others.map((s) => {
    const m = moneyOf.get(s.id) ?? emptyMoney()
    return {
      saleId: s.id,
      number: s.number,
      label: lineOf.get(s.id) ?? '',
      cashAed: aed(m.cash),
      cardAed: aed(m.card),
      otherAed: aed(m.other),
    }
  })

  // 7. Totals: every payment of the day's live sales; tips and refunds stay out of them.
  const total = emptyMoney()
  for (const p of payRows) addPayment(total, p.method, fils(p.v))
  const drawer = await drawerExpenseRows(tx, branchId, date)
  const expensesF = drawer.reduce((s, e) => s + fils(e.amountAed), 0)
  const paper = sheetTotals({ cash: total.cash, card: total.card, other: total.other, expenses: expensesF })
  const tipRows = await tx
    .select({ staffId: tips.staffId, v: sql<string>`sum(${tips.amountAed})` })
    .from(tips)
    .innerJoin(sales, eq(sales.id, tips.saleId))
    .where(live)
    .groupBy(tips.staffId)
  const tipsOf = new Map(tipRows.map((t) => [t.staffId, fils(t.v)]))
  const [cashRefunds] = await tx
    .select({ v: sql<string>`coalesce(sum(${refunds.amountAed}), 0)` })
    .from(refunds)
    .where(and(eq(refunds.branchId, branchId), eq(refunds.businessDate, date), eq(refunds.method, 'cash')))
  const commissionRows = await tx
    .select({ staffId: bookingCommissions.staffId, v: sql<string>`sum(${bookingCommissions.amountAed})` })
    .from(bookingCommissions)
    .innerJoin(bookings, eq(bookings.id, bookingCommissions.bookingId))
    .where(and(eq(bookingCommissions.businessDate, date), eq(bookings.branchId, branchId)))
    .groupBy(bookingCommissions.staffId)
  const commissionOf = new Map(commissionRows.map((c) => [c.staffId, fils(c.v)]))

  // 8. Panel: every bookable therapist of the branch (sheet order), OFF when she has no session and no shift that day
  // (or approved leave); then anyone with sessions who is no longer on that list.
  const day = await loadDay(tx, branchId, date)
  const window = businessDayWindow(date, cutoff)
  const overlaps = (iv: { start: Date; end: Date }) => iv.start < window.end && iv.end > window.start
  const panelIds = day.staff.map((s) => ({ id: s.id, name: s.name, shifts: s.shifts, leave: s.leave }))
  for (const id of staffIdsOnRows)
    if (!panelIds.some((p) => p.id === id))
      panelIds.push({ id, name: names.get(id) ?? '—', shifts: [], leave: [] })
  const panel: DaySheetPanelRow[] = panelIds.map((p) => {
    const mine = rows.filter((r) => r.staffId === p.id)
    const onShift = p.shifts.some(overlaps) && !(p.leave ?? []).some(overlaps)
    return {
      staffId: p.id,
      name: p.name,
      off: mine.length === 0 && !onShift,
      turns: mine.flatMap((r) => (r.q ? [r.q] : [])),
      own: mine.filter((r) => r.q === 0).length,
      tipsAed: aed(tipsOf.get(p.id) ?? 0),
      commissionAed: aed(commissionOf.get(p.id) ?? 0),
    }
  })

  // 9. The close (if any).
  const [close] = await tx
    .select()
    .from(dayCloses)
    .where(and(eq(dayCloses.branchId, branchId), eq(dayCloses.businessDate, date)))

  return {
    date,
    branch: { id: branch.id, name: branch.name, cutoff },
    spaName: tenant?.name ?? '',
    logoFileId: tenant?.logoFileId ?? null,
    multiBranch: (branchCount ?? 1) > 1,
    rows,
    otherSales,
    panel,
    expenses: drawer.map((e) => ({ id: e.id, description: e.description, amountAed: e.amountAed })),
    totals: {
      cashAed: aed(total.cash),
      cardAed: aed(total.card),
      otherAed: aed(total.other),
      otherByMethod: Object.fromEntries(Object.entries(total.byMethod).map(([k, v]) => [k, aed(v)])),
      expensesAed: aed(expensesF),
      totalSaleAed: aed(paper.totalSale),
      totalCardAed: aed(paper.totalCard),
      totalCashAed: aed(paper.totalCash),
      tipsAed: aed([...tipsOf.values()].reduce((s, v) => s + v, 0)),
      cashRefundsAed: aed(fils(cashRefunds?.v)),
    },
    unfinished,
    close: close
      ? {
          id: close.id,
          closedAt: close.closedAt,
          closedBy: close.closedBy,
          closedByName: null,
          expectedCashAed: Number(close.expectedCashAed),
          countedCashAed: Number(close.countedCashAed),
          varianceAed: Number(close.varianceAed),
          amendedAt: close.amendedAt,
          pdfFileId: close.pdfFileId,
        }
      : null,
  }
}

/** 'day-sheet-2026-10-13.pdf' (+ '-{branch}' when the spa has more than one branch). */
export function daySheetFilename(date: string, branchName: string, multi: boolean) {
  const slug = branchName
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return `day-sheet-${date}${multi && slug ? `-${slug}` : ''}.pdf`
}

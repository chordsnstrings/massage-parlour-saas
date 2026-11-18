// R32 daily sales sheet PDF (owner 2026-10-14, PLAN §14.8 R32), server-only (`@spa/services/day-sheet-pdf`; pdfkit is
// external in next.config). Laid out like the reception's paper sheet (BE RELAX 13-10-26): sessions table on the
// left (pink own-lead rows, cash/card sums), the therapists' turn panel, expenses and the paper totals on the right.
// Labels come from the spa dashboard catalogue (`sales.sheet.*`, EN or TH); typed names are drawn as typed.

import { daySheetColumns } from '@spa/core'
import {
  createFormat,
  type en,
  enumLabel,
  type MessageKey,
  type Translator,
  translator,
} from '@spa/core/i18n'
import { dayCloses, type Tx, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import { DAY_SHEET_PDF_PURPOSE, type DaySheet, daySheet, daySheetFilename } from '../day-sheet'
import { DomainError } from '../errors'
import { sha256Hex } from '../intake'
import { deleteFile, putFile } from '../storage'
import { A4, ACCENT, createPdf, INK, LINE, logoForPdf, MUTED, makeDrawLine } from './kit'
import { baseRtl } from './text'

export type DaySheetPdfInput = DaySheet & {
  lang: 'en' | 'th'
  columns: { tips: boolean; commission: boolean }
  /** PNG or JPEG bytes (logoForPdf). */
  logo?: Buffer | null
  generatedAt: Date
}

const MINT = '#EAF4EE'
const PINK = '#F8D7E6'
const MARGIN = 28
const CONTENT_W = A4.w - 2 * MARGIN
const ROW_H = 15
const HEAD_H = 16
const TABLE_TOP = MARGIN + 54
const FOOTER_Y = A4.h - MARGIN + 6
const BOTTOM = A4.h - MARGIN - 16
const RIGHT_W = 194
const RIGHT_X = MARGIN + CONTENT_W - RIGHT_W
const BODY = 8

const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const dec = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Latin digits, en-US grouping; whole dirhams without decimals, fils with two (no "AED": the headers carry it). */
export const sheetAmount = (v: number) => {
  const f = Math.round(Math.abs(v) * 100)
  const body = f % 100 === 0 ? int.format(f / 100) : dec.format(f / 100)
  return `${v < 0 && f > 0 ? '-' : ''}${body}`
}

const dayDate = (date: string) => new Date(`${date}T12:00:00+04:00`)

type SheetKey = keyof typeof en.sales.sheet
type Col = { key: string; label: string; w: number; align: 'left' | 'center' | 'right' }

/** Renders the day sheet as an A4 portrait PDF (EN or TH labels). */
export async function renderDaySheetPdf(input: DaySheetPdfInput): Promise<Buffer> {
  const t: Translator = translator(input.lang)
  const fmt = createFormat(input.lang)
  const L = (key: SheetKey, params?: Record<string, string | number>) =>
    t(`sales.sheet.${key}` as MessageKey, params)
  const day = dayDate(input.date)
  const dateLabel = `${fmt.weekdayDate(day)} ${day.getUTCFullYear()}`
  const { doc, finish } = createPdf({
    margins: { top: MARGIN, bottom: 8, left: MARGIN, right: MARGIN },
    lang: input.lang,
    info: {
      Title: `${L('title')} — ${input.branch.name} — ${input.date}`,
      Author: input.spaName,
      Subject: `${L('title')} ${input.date}`,
      Keywords: `day-sheet ${input.date} ${input.branch.id}`,
      Creator: 'spamanagement.co',
      Producer: 'spamanagement.co',
      CreationDate: input.generatedAt,
    },
  })
  const { drawLine, widthOf } = makeDrawLine(doc)

  /** One line of text fitted into `w`: shrinks to 6 pt, then shortens with an ellipsis. */
  const cell = (
    text: string,
    x: number,
    baseline: number,
    w: number,
    o: { size?: number; bold?: boolean; color?: string; align?: 'left' | 'center' | 'right'; pad?: number },
  ) => {
    if (!text) return
    const pad = o.pad ?? 3
    const inner = w - 2 * pad
    const rtl = baseRtl(text, false)
    let size = o.size ?? BODY
    while (size > 6 && widthOf(text, { size, bold: o.bold, rtl }) > inner) size -= 0.5
    let shown = text
    while (shown.length > 1 && widthOf(shown, { size, bold: o.bold, rtl }) > inner)
      shown = `${[...shown].slice(0, -2).join('')}…`
    drawLine(
      shown,
      { x: x + pad, y: baseline, w: inner },
      {
        size,
        bold: o.bold,
        color: o.color,
        rtl,
        right: o.align === 'right',
        center: o.align === 'center',
      },
    )
  }
  const hline = (x1: number, x2: number, y: number, color = LINE, width = 0.5) =>
    doc.moveTo(x1, y).lineTo(x2, y).lineWidth(width).strokeColor(color).stroke()
  const vline = (x: number, y1: number, y2: number, color = LINE) =>
    doc.moveTo(x, y1).lineTo(x, y2).lineWidth(0.5).strokeColor(color).stroke()
  const fill = (x: number, y: number, w: number, h: number, color: string) =>
    doc.rect(x, y, w, h).fillColor(color).fill()

  // Page header (every page): logo + spa + branch on the start side, title + date on the end side.
  const header = () => {
    const y = MARGIN
    let offset = 0
    if (input.logo) {
      try {
        doc.image(input.logo, MARGIN, y, { fit: [24, 24], align: 'center', valign: 'center' })
        offset = 32
      } catch {
        offset = 0
      }
    }
    const nameW = CONTENT_W / 2 - offset
    cell(input.spaName, MARGIN + offset - 3, y + 12, nameW, { size: 13, bold: true })
    // The branch line only when it says something the spa name does not (one-branch spas often share the name).
    if (input.branch.name.trim().toLowerCase() !== input.spaName.trim().toLowerCase())
      cell(input.branch.name, MARGIN + offset - 3, y + 23, nameW, { color: MUTED })
    const endX = MARGIN + CONTENT_W / 2
    const endW = CONTENT_W / 2
    drawLine(L('title'), { x: endX, y: y + 11, w: endW }, { size: 11, bold: true, rtl: false, right: true })
    drawLine(dateLabel, { x: endX, y: y + 23, w: endW }, { size: 9, rtl: false, right: true })
    drawLine(
      L('dayEnds', { time: input.branch.cutoff }),
      { x: MARGIN, y: y + 38, w: CONTENT_W },
      { size: 7, color: MUTED, rtl: false },
    )
    hline(MARGIN, MARGIN + CONTENT_W, y + 44, ACCENT, 0.8)
  }

  // Pages are created on demand (left table and right column flow independently).
  let pages = 0
  const goTo = (i: number) => {
    while (pages <= i) {
      if (pages > 0) doc.addPage()
      pages += 1
      header()
    }
    doc.switchToPage(i)
  }
  goTo(0)

  // ── Left: the sessions table ──
  const anyOther = input.totals.otherAed !== 0
  const cols: Col[] = [
    { key: 'no', label: L('no'), w: 16, align: 'center' },
    { key: 'therapist', label: L('therapist'), w: 60, align: 'left' },
    { key: 'q', label: L('q'), w: 14, align: 'center' },
    { key: 'time', label: L('time'), w: 58, align: 'center' },
    { key: 'room', label: L('room'), w: 26, align: 'center' },
    { key: 'code', label: L('code'), w: 32, align: 'center' },
    { key: 'cash', label: L('cash'), w: 38, align: 'right' },
    { key: 'card', label: L('card'), w: 38, align: 'right' },
    ...(anyOther ? [{ key: 'other', label: L('other'), w: 38, align: 'right' as const }] : []),
  ]
  const tableW = cols.reduce((s, c) => s + c.w, 0)
  const colX = (key: string) => {
    let x = MARGIN
    for (const c of cols) {
      if (c.key === key) return x
      x += c.w
    }
    return x
  }
  const colW = (key: string) => cols.find((c) => c.key === key)?.w ?? 0
  const moneyX = colX('cash')

  let page = 0
  let y = TABLE_TOP
  const tableHead = () => {
    fill(MARGIN, y, tableW, HEAD_H, MINT)
    for (const c of cols)
      cell(c.label, colX(c.key), y + 10.5, c.w, {
        size: 7,
        bold: true,
        color: ACCENT,
        align: c.align,
        pad: 2,
      })
    drawLine(
      L('amounts'),
      { x: moneyX, y: y - 3, w: tableW - (moneyX - MARGIN) },
      { size: 6, color: MUTED, rtl: false, right: true },
    )
    y += HEAD_H
  }
  const grid = (top: number, bottom: number) => {
    let x = MARGIN
    vline(x, top, bottom)
    for (const c of cols) {
      x += c.w
      vline(x, top, bottom)
    }
  }
  let blockTop = y
  const nextRow = (h = ROW_H) => {
    if (y + h > BOTTOM) {
      grid(blockTop, y)
      page += 1
      goTo(page)
      y = TABLE_TOP
      tableHead()
      blockTop = y - HEAD_H
    }
  }
  tableHead()
  blockTop = TABLE_TOP

  const money = (v: number | null) => (v ? sheetAmount(v) : '')
  for (const r of input.rows) {
    nextRow()
    if (r.ownLead) fill(MARGIN, y, tableW, ROW_H, PINK)
    const base = y + 10.5
    cell(String(r.no), colX('no'), base, colW('no'), { align: 'center', color: MUTED, pad: 1 })
    cell(r.therapist, colX('therapist'), base, colW('therapist'), { bold: true })
    cell(r.q == null ? '' : String(r.q), colX('q'), base, colW('q'), { align: 'center', pad: 1 })
    cell(`${fmt.time(r.startsAt)}–${fmt.time(r.endsAt)}`, colX('time'), base, colW('time'), {
      align: 'center',
      pad: 1,
    })
    cell(r.room ?? '—', colX('room'), base, colW('room'), { align: 'center', pad: 1 })
    cell(r.code, colX('code'), base, colW('code'), { align: 'center', bold: true, pad: 1 })
    if (!r.first) {
      for (const k of ['cash', 'card', ...(anyOther ? ['other'] : [])])
        cell('·', colX(k), base, colW(k), { align: 'center', color: MUTED })
    } else if (r.paid === 'no') {
      for (const k of ['cash', 'card']) cell('—', colX(k), base, colW(k), { align: 'center', color: MUTED })
    } else if (r.paid === 'other_day') {
      cell(
        L('paidOn', { date: fmt.dateShort(dayDate(r.paidOn!)) }),
        moneyX,
        base,
        tableW - (moneyX - MARGIN),
        { size: 6.5, color: MUTED, align: 'center' },
      )
    } else {
      cell(money(r.cashAed), colX('cash'), base, colW('cash'), { align: 'right' })
      cell(money(r.cardAed), colX('card'), base, colW('card'), { align: 'right' })
      if (anyOther) cell(money(r.otherAed), colX('other'), base, colW('other'), { align: 'right' })
    }
    y += ROW_H
    hline(MARGIN, MARGIN + tableW, y)
  }
  if (input.rows.length === 0) {
    nextRow()
    cell(L('noSessions'), MARGIN, y + 10.5, moneyX - MARGIN, { color: MUTED })
    y += ROW_H
    hline(MARGIN, MARGIN + tableW, y)
  }
  if (input.otherSales.length) {
    nextRow()
    fill(MARGIN, y, tableW, ROW_H, MINT)
    cell(L('otherSales'), MARGIN, y + 10.5, moneyX - MARGIN, { size: 7, bold: true, color: ACCENT })
    y += ROW_H
    hline(MARGIN, MARGIN + tableW, y)
    for (const o of input.otherSales) {
      nextRow()
      const base = y + 10.5
      const label = [L('saleLabel', { number: o.number }), o.label].filter(Boolean).join(' · ')
      cell(label, colX('therapist'), base, moneyX - colX('therapist'), {})
      cell(money(o.cashAed), colX('cash'), base, colW('cash'), { align: 'right' })
      cell(money(o.cardAed), colX('card'), base, colW('card'), { align: 'right' })
      if (anyOther) cell(money(o.otherAed), colX('other'), base, colW('other'), { align: 'right' })
      y += ROW_H
      hline(MARGIN, MARGIN + tableW, y)
    }
  }
  grid(blockTop, y)
  // Column sums under Cash / Card / Other (the paper's "1460 | 1080").
  nextRow(ROW_H + 2)
  hline(moneyX, MARGIN + tableW, y + 1, INK, 0.9)
  const sumBase = y + 12
  cell(sheetAmount(input.totals.cashAed), colX('cash'), sumBase, colW('cash'), { align: 'right', bold: true })
  cell(sheetAmount(input.totals.cardAed), colX('card'), sumBase, colW('card'), { align: 'right', bold: true })
  if (anyOther)
    cell(sheetAmount(input.totals.otherAed), colX('other'), sumBase, colW('other'), {
      align: 'right',
      bold: true,
    })

  // ── Right: turn panel, expenses, formula, totals ──
  let rPage = 0
  let ry = TABLE_TOP
  const rNext = (h: number) => {
    if (ry + h > BOTTOM) {
      rPage += 1
      ry = TABLE_TOP
    }
    goTo(rPage)
  }
  const TURN_W = 12
  const pCols = [
    { key: 'name', w: 56 },
    { key: 'turns', w: TURN_W * 5 },
    { key: 'own', w: 14 },
    ...(input.columns.tips ? [{ key: 'tips', w: 32 }] : []),
    ...(input.columns.commission ? [{ key: 'commission', w: 32 }] : []),
  ]
  const panelW = pCols.reduce((s, c) => s + c.w, 0)
  const pX = (key: string) => {
    let x = RIGHT_X
    for (const c of pCols) {
      if (c.key === key) return x
      x += c.w
    }
    return x
  }
  const panelHead = () => {
    fill(RIGHT_X, ry, panelW, HEAD_H, MINT)
    const b = ry + 10.5
    const head = { size: 7, bold: true, color: ACCENT, pad: 2 } as const
    cell(L('therapist'), pX('name'), b, 56, head)
    cell(L('turns'), pX('turns'), b, TURN_W * 5, { ...head, align: 'center' })
    cell('0', pX('own'), b, 14, { ...head, align: 'center' })
    if (input.columns.tips) cell(L('tips'), pX('tips'), b, 32, { ...head, align: 'right' })
    if (input.columns.commission) cell(L('commission'), pX('commission'), b, 32, { ...head, align: 'right' })
    ry += HEAD_H
  }
  rNext(HEAD_H + ROW_H)
  panelHead()
  let pTop = ry - HEAD_H
  const pGrid = (top: number, bottom: number) => {
    vline(RIGHT_X, top, bottom)
    for (const c of pCols) {
      const x = pX(c.key) + c.w
      vline(x, top, bottom)
    }
  }
  for (const p of input.panel) {
    if (ry + ROW_H > BOTTOM) {
      pGrid(pTop, ry)
      rNext(ROW_H + HEAD_H)
      panelHead()
      pTop = ry - HEAD_H
    }
    const b = ry + 10.5
    cell(p.name, pX('name'), b, 56, { bold: true })
    if (p.off) {
      cell(L('off'), pX('turns'), b, TURN_W * 5, { align: 'center', color: MUTED, bold: true })
    } else {
      // Turn cells (1, 2, 3 … as on the paper); an OFF row spans them.
      for (let k = 1; k < 5; k++) vline(pX('turns') + k * TURN_W, ry, ry + ROW_H, '#E6ECE8')
      const shown =
        p.turns.length > 5
          ? [...p.turns.slice(0, 4).map(String), `+${p.turns.length - 4}`]
          : p.turns.map(String)
      shown.forEach((v, k) => {
        cell(v, pX('turns') + k * TURN_W, b, TURN_W, {
          align: 'center',
          pad: 0,
          size: v.length > 2 ? 6.5 : BODY,
        })
      })
    }
    if (p.own)
      cell(p.own <= 2 ? Array(p.own).fill('0').join(' ') : `0×${p.own}`, pX('own'), b, 14, {
        align: 'center',
        pad: 0,
        color: '#B0306A',
        bold: true,
      })
    if (input.columns.tips)
      cell(p.tipsAed ? sheetAmount(p.tipsAed) : '', pX('tips'), b, 32, { align: 'right' })
    if (input.columns.commission)
      cell(p.commissionAed ? sheetAmount(p.commissionAed) : '', pX('commission'), b, 32, { align: 'right' })
    ry += ROW_H
    hline(RIGHT_X, RIGHT_X + panelW, ry)
  }
  pGrid(pTop, ry)

  /** A label + amount line in the right column. */
  const kv = (label: string, value: string, o: { bold?: boolean; size?: number; color?: string } = {}) => {
    const size = o.size ?? BODY
    rNext(size + 6)
    const b = ry + size + 1
    cell(label, RIGHT_X, b, RIGHT_W - 72, { size, bold: o.bold, color: o.color, pad: 0 })
    cell(value, RIGHT_X + RIGHT_W - 70, b, 70, { size, bold: o.bold, color: o.color, align: 'right', pad: 0 })
    ry += size + 6
  }
  const heading = (text: string) => {
    ry += 14
    rNext(18)
    drawLine(
      text,
      { x: RIGHT_X, y: ry + 9, w: RIGHT_W },
      { size: 8.5, bold: true, color: ACCENT, rtl: false },
    )
    ry += 13
  }

  heading(L('expenses'))
  if (!input.expenses.length) kv(L('noExpenses'), '', { color: MUTED })
  for (const e of input.expenses) kv(e.description, sheetAmount(e.amountAed))

  // The paper formula, ASCII "-" (the DM Sans subset has no U+2212).
  const T = input.totals
  const parts = [
    sheetAmount(T.cashAed),
    sheetAmount(T.cardAed),
    ...(T.otherAed ? [sheetAmount(T.otherAed)] : []),
  ]
  const formula = `${parts.join(' + ')} - ${sheetAmount(T.expensesAed)} = ${sheetAmount(T.totalSaleAed)}`
  ry += 12
  rNext(20)
  cell(formula, RIGHT_X, ry + 11, RIGHT_W, { size: 10, pad: 0 })
  ry += 18
  hline(RIGHT_X, RIGHT_X + RIGHT_W, ry, LINE, 0.6)
  ry += 6
  kv(L('totalSale'), sheetAmount(T.totalSaleAed), { bold: true, size: 9 })
  kv(L('totalCard'), sheetAmount(T.totalCardAed), { bold: true, size: 9 })
  kv(L('totalCash'), sheetAmount(T.totalCashAed), { bold: true, size: 9 })
  const others = Object.entries(T.otherByMethod).filter(([, v]) => v)
  if (others.length || input.columns.tips || T.cashRefundsAed) ry += 6
  if (others.length) {
    kv(L('otherPayments'), sheetAmount(T.otherAed), { color: MUTED })
    for (const [m, v] of others)
      kv(`· ${enumLabel(t, 'paymentMethodKind', m)}`, sheetAmount(v), { color: MUTED })
  }
  if (input.columns.tips) kv(L('tipsNote'), sheetAmount(T.tipsAed), { color: MUTED })
  if (T.cashRefundsAed) kv(L('refundsNote'), sheetAmount(-T.cashRefundsAed), { color: MUTED })

  // Footer on every page: the close (or "not closed yet") and the page number.
  const stamp = (d: Date) => `${fmt.dateShort(d)} ${fmt.time(d)}`
  const c = input.close
  const closeText = c
    ? [
        L('closedBy', {
          time: stamp(c.closedAt),
          name: c.closedByName ?? '—',
          counted: sheetAmount(c.countedCashAed),
          variance: `${c.varianceAed > 0 ? '+' : ''}${sheetAmount(c.varianceAed)}`,
        }),
        ...(c.amendedAt ? [L('amended', { time: stamp(c.amendedAt) })] : []),
      ].join(' · ')
    : L('notClosed')
  for (let i = 0; i < pages; i++) {
    doc.switchToPage(i)
    hline(MARGIN, MARGIN + CONTENT_W, FOOTER_Y - 9, LINE, 0.4)
    const right = `${L('page', { n: i + 1, total: pages })} · spamanagement.co · ${fmt.date(input.generatedAt)} ${fmt.time(input.generatedAt)}`
    const rightW = widthOf(right, { size: 7, rtl: false }) + 4
    cell(closeText, MARGIN, FOOTER_Y, CONTENT_W - rightW - 8, {
      size: 7,
      color: c?.amendedAt ? '#9A5B00' : MUTED,
      pad: 0,
    })
    drawLine(
      right,
      { x: MARGIN, y: FOOTER_Y, w: CONTENT_W },
      { size: 7, color: MUTED, rtl: false, right: true },
    )
  }
  return finish()
}

/**
 * Renders a closed day's sheet (spa defaults for the optional columns) and stores it as a private file on the close
 * (`day_closes.pdf_*`); the previous file is deleted. Runs in the caller's tenant transaction.
 */
export async function generateDaySheetPdf(
  tx: Tx,
  dayCloseId: string,
  o: {
    lang: 'en' | 'th'
    /** Missing: the spa's defaults (Settings → Daily sales sheet). */
    columns?: { tips: boolean; commission: boolean }
    closedByName?: string | null
    createdBy?: string | null
    now?: Date
  },
) {
  const [close] = await tx.select().from(dayCloses).where(eq(dayCloses.id, dayCloseId)).for('update')
  if (!close) throw new DomainError('Day close not found', 'not_found')
  const now = o.now ?? new Date()
  const sheet = await daySheet(tx, close.branchId, close.businessDate)
  if (sheet.close) sheet.close.closedByName = o.closedByName ?? null
  const [tenant] = await tx
    .select({ settings: tenants.settings })
    .from(tenants)
    .where(eq(tenants.id, close.tenantId))
  const pdf = await renderDaySheetPdf({
    ...sheet,
    lang: o.lang,
    columns: o.columns ?? daySheetColumns(tenant?.settings),
    logo: await logoForPdf(tx, sheet.logoFileId),
    generatedAt: now,
  })
  const file = await putFile(tx, {
    tenantId: close.tenantId,
    bytes: pdf,
    contentType: 'application/pdf',
    filename: daySheetFilename(close.businessDate, sheet.branch.name, sheet.multiBranch),
    isPublic: false,
    purpose: DAY_SHEET_PDF_PURPOSE,
    createdBy: o.createdBy ?? null,
  })
  const sha = sha256Hex(pdf)
  await tx
    .update(dayCloses)
    .set({ pdfFileId: file.id, pdfSha256: sha, pdfGeneratedAt: now })
    .where(eq(dayCloses.id, close.id))
  if (close.pdfFileId) await deleteFile(tx, close.pdfFileId)
  return { fileId: file.id, size: file.size, sha256: sha }
}

export { DAY_SHEET_PDF_PURPOSE, daySheetFilename, logoForPdf }

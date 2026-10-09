// Commissions, salary advances, payroll runs and the UAE WPS salary information file (SIF).
import { includedVat } from '@spa/core'
import {
  bookingCommissions,
  bookings,
  commissionEntries,
  members,
  payrollLines,
  payrollRuns,
  salaryAdvances,
  saleLines,
  sales,
  staff,
  type Tx,
  tenants,
  tips,
} from '@spa/db'
import { and, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import { DomainError } from './errors'
import { post } from './ledger'
import { overlapDays, unpaidLeaveDays, workedMinutes } from './timeclock'

const r2 = (n: number) => Math.round(n * 100) / 100

/**
 * Accrues % commission for a paid sale: each line attributed to a `sales_commission` person earns their
 * commission % on the line's revenue net of VAT. Therapists (`booking_commission`) and salaried staff earn
 * nothing here — therapists are paid the AED typed per completed booking (PLAN §14.8 R2). Idempotent per line.
 */
export async function accrueCommissions(tx: Tx, saleId: string, vatRatePct = 5) {
  const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId))
  if (sale?.status !== 'paid') return []
  const lines = await tx.select().from(saleLines).where(eq(saleLines.saleId, saleId))
  const staffIds = [...new Set(lines.map((l) => l.staffId).filter((x): x is string => Boolean(x)))]
  if (!staffIds.length) return []
  const people = await tx.select().from(staff).where(inArray(staff.id, staffIds))
  const existing = await tx
    .select({ lineId: commissionEntries.saleLineId })
    .from(commissionEntries)
    .where(
      inArray(
        commissionEntries.saleLineId,
        lines.map((l) => l.id),
      ),
    )
  const done = new Set(existing.map((e) => e.lineId))
  const created = []
  for (const line of lines) {
    if (!line.staffId || done.has(line.id) || (line.kind !== 'service' && line.kind !== 'product')) continue
    const person = people.find((p) => p.id === line.staffId)
    if (person?.payType !== 'sales_commission') continue
    const rate = Number(person.commissionPct)
    if (rate <= 0) continue
    const gross = Number(line.lineTotalAed)
    const base = r2(gross - includedVat(gross, vatRatePct))
    const amount = r2((base * rate) / 100)
    const [row] = await tx
      .insert(commissionEntries)
      .values({
        tenantId: sale.tenantId,
        staffId: line.staffId,
        saleLineId: line.id,
        businessDate: sale.businessDate,
        baseAed: base.toFixed(2),
        ratePct: rate.toFixed(2),
        amountAed: amount.toFixed(2),
      })
      .returning()
    created.push(row!)
  }
  const total = r2(created.reduce((s, c) => s + Number(c.amountAed), 0))
  if (total > 0) {
    await post(tx, {
      tenantId: sale.tenantId,
      branchId: sale.branchId,
      date: sale.businessDate,
      sourceType: 'commission',
      sourceId: sale.id,
      memo: 'Sales commission',
      lines: [
        { code: '6010', debit: total },
        { code: '2300', credit: total },
      ],
    })
  }
  return created
}

export async function recordAdvance(
  tx: Tx,
  a: {
    tenantId: string
    staffId: string
    date: string
    amountAed: number
    note?: string
    paidVia: 'cash' | 'bank'
    createdBy?: string | null
  },
) {
  if (a.amountAed <= 0) throw new DomainError('Enter an amount')
  const [row] = await tx
    .insert(salaryAdvances)
    .values({
      tenantId: a.tenantId,
      staffId: a.staffId,
      advanceDate: a.date,
      amountAed: a.amountAed.toFixed(2),
      note: a.note ?? null,
      createdBy: a.createdBy ?? null,
    })
    .returning()
  await post(tx, {
    tenantId: a.tenantId,
    date: a.date,
    sourceType: 'advance',
    sourceId: row!.id,
    memo: 'Salary advance',
    createdBy: a.createdBy,
    lines: [
      { code: '1150', debit: a.amountAed },
      { code: a.paidVia === 'cash' ? '1000' : '1020', credit: a.amountAed },
    ],
  })
  return row!
}

/**
 * Bookings a person created (their member's user = `bookings.created_by`) that ended completed in the period,
 * per staff id — the basis of the receptionist booking fee (R2 owner decision).
 */
export async function completedBookingsCreated(
  tx: Tx,
  p: { staffIds: string[]; periodStart: string; periodEnd: string },
) {
  if (!p.staffIds.length) return new Map<string, number>()
  const rows = await tx
    .select({ staffId: staff.id, n: sql<number>`count(${bookings.id})::int` })
    .from(staff)
    .innerJoin(members, eq(members.id, staff.memberId))
    .innerJoin(bookings, eq(bookings.createdBy, members.userId))
    .where(
      and(
        inArray(staff.id, p.staffIds),
        eq(bookings.status, 'completed'),
        gte(bookings.businessDate, p.periodStart),
        lte(bookings.businessDate, p.periodEnd),
      ),
    )
    .groupBy(staff.id)
  return new Map(rows.map((r) => [r.staffId, Number(r.n)]))
}

/**
 * Tips & advances payout per therapist (R2 owner decision): therapists' payroll is booking commission only, so
 * their tips received and advances taken in the period are settled separately: Net = tips − advances.
 */
export async function therapistTipsAdvances(tx: Tx, p: { periodStart: string; periodEnd: string }) {
  const people = await tx
    .select({ id: staff.id, name: staff.displayName })
    .from(staff)
    .where(and(eq(staff.active, true), eq(staff.payType, 'booking_commission')))
  const ids = people.map((x) => x.id)
  if (!ids.length) return []
  const tipRows = await tx
    .select({ staffId: tips.staffId, v: sql<string>`sum(${tips.amountAed})` })
    .from(tips)
    .innerJoin(sales, eq(sales.id, tips.saleId))
    .where(
      and(
        inArray(tips.staffId, ids),
        eq(sales.status, 'paid'),
        gte(sales.businessDate, p.periodStart),
        lte(sales.businessDate, p.periodEnd),
      ),
    )
    .groupBy(tips.staffId)
  const advRows = await tx
    .select({ staffId: salaryAdvances.staffId, v: sql<string>`sum(${salaryAdvances.amountAed})` })
    .from(salaryAdvances)
    .where(
      and(
        inArray(salaryAdvances.staffId, ids),
        gte(salaryAdvances.advanceDate, p.periodStart),
        lte(salaryAdvances.advanceDate, p.periodEnd),
      ),
    )
    .groupBy(salaryAdvances.staffId)
  const tip = new Map(tipRows.map((r) => [r.staffId, Number(r.v ?? 0)]))
  const adv = new Map(advRows.map((r) => [r.staffId, Number(r.v ?? 0)]))
  return people
    .map((x) => {
      const tipsAed = r2(tip.get(x.id) ?? 0)
      const advancesAed = r2(adv.get(x.id) ?? 0)
      return { staffId: x.id, name: x.name, tipsAed, advancesAed, netAed: r2(tipsAed - advancesAed) }
    })
    .filter((x) => x.tipsAed || x.advancesAed)
}

/**
 * Builds a draft payroll run per person. Therapists (`booking_commission`): unpaid booking commissions only —
 * tips and advances settle in the Tips & advances payout. Everyone else: base (salary only) + unpaid %
 * commissions (incl. older accruals) + receptionist booking fees (`booking_fee`) + tips − unrecovered advances −
 * unpaid leave (salary only: base ÷ days in the period × approved unpaid days). Lines also carry the clocked
 * minutes and unpaid leave days (information; WPS leave days).
 */
export async function buildPayroll(
  tx: Tx,
  p: { tenantId: string; periodStart: string; periodEnd: string; createdBy?: string | null },
) {
  const [run] = await tx
    .insert(payrollRuns)
    .values({
      tenantId: p.tenantId,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      createdBy: p.createdBy ?? null,
    })
    .returning()
  const people = await tx.select().from(staff).where(eq(staff.active, true))
  const [settings] = await tx.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, p.tenantId))
  const feeEach = Number(settings?.s.receptionistBookingFee ?? 0)
  const created = await completedBookingsCreated(tx, {
    staffIds: people.filter((x) => x.payType === 'booking_fee').map((x) => x.id),
    periodStart: p.periodStart,
    periodEnd: p.periodEnd,
  })
  const everyone = { staffIds: people.map((x) => x.id), periodStart: p.periodStart, periodEnd: p.periodEnd }
  const leaveDays = await unpaidLeaveDays(tx, everyone)
  const worked = await workedMinutes(tx, everyone)
  const periodDays = overlapDays(p.periodStart, p.periodEnd, p.periodStart, p.periodEnd)
  const sum = async (q: Promise<{ v: string | null }[]>) => Number((await q)[0]?.v ?? 0)
  for (const s of people) {
    const therapist = s.payType === 'booking_commission'
    const commission = await sum(
      tx
        .select({ v: sql<string>`sum(${commissionEntries.amountAed})` })
        .from(commissionEntries)
        .where(
          and(
            eq(commissionEntries.staffId, s.id),
            isNull(commissionEntries.payrollRunId),
            lte(commissionEntries.businessDate, p.periodEnd),
          ),
        ),
    )
    const perBooking = await sum(
      tx
        .select({ v: sql<string>`sum(${bookingCommissions.amountAed})` })
        .from(bookingCommissions)
        .where(
          and(
            eq(bookingCommissions.staffId, s.id),
            isNull(bookingCommissions.payrollRunId),
            lte(bookingCommissions.businessDate, p.periodEnd),
          ),
        ),
    )
    const tipTotal = therapist
      ? 0
      : await sum(
          tx
            .select({ v: sql<string>`sum(${tips.amountAed})` })
            .from(tips)
            .innerJoin(sales, eq(sales.id, tips.saleId))
            .where(
              and(
                eq(tips.staffId, s.id),
                gte(sales.businessDate, p.periodStart),
                lte(sales.businessDate, p.periodEnd),
                eq(sales.status, 'paid'),
              ),
            ),
        )
    const advances = therapist
      ? 0
      : await sum(
          tx
            .select({ v: sql<string>`sum(${salaryAdvances.amountAed})` })
            .from(salaryAdvances)
            .where(
              and(
                eq(salaryAdvances.staffId, s.id),
                isNull(salaryAdvances.payrollRunId),
                lte(salaryAdvances.advanceDate, p.periodEnd),
              ),
            ),
        )
    const base = s.payType === 'salary' ? Number(s.baseSalaryAed) : 0
    const earned = commission + perBooking
    const fee = s.payType === 'booking_fee' ? r2(feeEach * (created.get(s.id) ?? 0)) : 0
    // Unpaid leave (B5.4): salaried staff lose base ÷ days in the period per approved unpaid day.
    const unpaid = leaveDays.get(s.id) ?? 0
    const deduction = base && periodDays ? Math.min(base, r2((base / periodDays) * unpaid)) : 0
    const workedMin = worked.get(s.id) ?? 0
    if (!base && !earned && !fee && !tipTotal && !advances) continue
    await tx.insert(payrollLines).values({
      tenantId: p.tenantId,
      runId: run!.id,
      staffId: s.id,
      baseAed: base.toFixed(2),
      commissionAed: r2(earned).toFixed(2),
      feeAed: fee.toFixed(2),
      tipsAed: r2(tipTotal).toFixed(2),
      advancesAed: r2(advances).toFixed(2),
      deductionsAed: deduction.toFixed(2),
      unpaidLeaveDays: unpaid,
      workedMinutes: workedMin,
      netAed: r2(base + earned + fee + tipTotal - advances - deduction).toFixed(2),
    })
  }
  return run!
}

/** Finalises a run: links commissions/advances to it and posts salaries paid from the bank. */
export async function finalisePayroll(tx: Tx, runId: string, paidOn: string, createdBy?: string | null) {
  const [run] = await tx.select().from(payrollRuns).where(eq(payrollRuns.id, runId)).for('update')
  if (!run) throw new DomainError('Payroll run not found', 'not_found')
  if (run.status === 'finalised') throw new DomainError('Already finalised')
  const lines = await tx.select().from(payrollLines).where(eq(payrollLines.runId, runId))
  const staffIds = lines.map((l) => l.staffId)
  // Therapists' advances settle in the Tips & advances payout, not payroll: only link what a line deducted.
  const advanceIds = lines.filter((l) => Number(l.advancesAed) > 0).map((l) => l.staffId)
  if (staffIds.length) {
    await tx
      .update(commissionEntries)
      .set({ payrollRunId: runId })
      .where(
        and(
          inArray(commissionEntries.staffId, staffIds),
          isNull(commissionEntries.payrollRunId),
          lte(commissionEntries.businessDate, run.periodEnd),
        ),
      )
    await tx
      .update(bookingCommissions)
      .set({ payrollRunId: runId })
      .where(
        and(
          inArray(bookingCommissions.staffId, staffIds),
          isNull(bookingCommissions.payrollRunId),
          lte(bookingCommissions.businessDate, run.periodEnd),
        ),
      )
    if (advanceIds.length)
      await tx
        .update(salaryAdvances)
        .set({ payrollRunId: runId })
        .where(
          and(
            inArray(salaryAdvances.staffId, advanceIds),
            isNull(salaryAdvances.payrollRunId),
            lte(salaryAdvances.advanceDate, run.periodEnd),
          ),
        )
  }
  const t = (
    k: 'baseAed' | 'commissionAed' | 'feeAed' | 'tipsAed' | 'advancesAed' | 'deductionsAed' | 'netAed',
  ) => r2(lines.reduce((s, l) => s + Number(l[k]), 0))
  await post(tx, {
    tenantId: run.tenantId,
    date: paidOn,
    sourceType: 'payroll',
    sourceId: runId,
    memo: `Payroll ${run.periodStart} – ${run.periodEnd}`,
    createdBy,
    lines: [
      { code: '6000', debit: t('baseAed') },
      { code: '2300', debit: t('commissionAed') },
      { code: '6010', debit: t('feeAed') },
      { code: '2200', debit: t('tipsAed') },
      { code: '1150', credit: t('advancesAed') },
      { code: '6900', credit: t('deductionsAed') },
      { code: '1020', credit: t('netAed') },
    ],
  })
  await tx
    .update(payrollRuns)
    .set({ status: 'finalised', finalisedAt: new Date() })
    .where(eq(payrollRuns.id, runId))
}

/**
 * UAE Wage Protection System Salary Information File (CSV): one EDR line per employee and a closing SCR line.
 * Fields follow the common MOHRE layout; banks may require minor variations, so review before uploading.
 */
export function wpsSif(input: {
  employerId: string
  employerBankRoutingCode: string
  periodStart: string
  periodEnd: string
  createdAt?: Date
  lines: {
    personId: string
    routingCode: string
    iban: string
    days: number
    fixedAed: number
    variableAed: number
    leaveDays?: number
  }[]
}) {
  const ymd = (d: string) => d
  const created = input.createdAt ?? new Date()
  const hhmm = created.toISOString().slice(11, 16).replace(':', '')
  const edr = input.lines.map((l) =>
    [
      'EDR',
      l.personId,
      l.routingCode,
      l.iban,
      ymd(input.periodStart),
      ymd(input.periodEnd),
      l.days,
      l.fixedAed.toFixed(2),
      l.variableAed.toFixed(2),
      l.leaveDays ?? 0,
    ].join(','),
  )
  const total = r2(input.lines.reduce((s, l) => s + l.fixedAed + l.variableAed, 0))
  const scr = [
    'SCR',
    input.employerId,
    input.employerBankRoutingCode,
    created.toISOString().slice(0, 10),
    hhmm,
    input.periodEnd.slice(5, 7) + input.periodEnd.slice(0, 4),
    input.lines.length,
    total.toFixed(2),
    'AED',
    '',
  ].join(',')
  return [...edr, scr].join('\n')
}

'use server'
import { clientPackages, clients, expenses, sales, withTenant } from '@spa/db'
import {
  closeDay,
  createSale,
  DomainError,
  DRAWER_EXPENSE_CODES,
  findOrCreateClient,
  finishBooking,
  isDayClosed,
  liveMemberships,
  markDayAmended,
  PAY_METHODS,
  POS_METHODS,
  recordDrawerExpense,
  refundSale,
  saveSaleBilling,
  voidDrawerExpense,
  voidSale,
} from '@spa/services'
import { and, asc, eq, gt, ilike, or } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { maskPhone } from '@/components/calendar/time'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { formatAed } from '@/lib/utils'
import { can, guard } from '@/server/access'
import { audit } from '@/server/audit'
import { afterDayChange, editDay, periodLocked } from '@/server/day-lock'
import { pickBranch } from './data'

const money = z.coerce
  .number({ error: 'sales.v.amount' })
  .min(0, 'sales.v.negative')
  .max(1_000_000, 'sales.v.tooLarge')
const method = z.enum(POS_METHODS)
const payMethod = z.enum(PAY_METHODS)
const optionalUuid = z
  .string()
  .nullish()
  .transform((v) => v || undefined)
  .pipe(z.uuid().optional())

const revalidate = (slug: string) => revalidatePath(`/dashboard/${slug}/sales`, 'layout')

const handle = (e: unknown): ActionResult => {
  if (e instanceof DomainError) return failDomain(e)
  if (periodLocked(e)) return fail('accounts.result.lockedDate')
  throw e
}

// ---------------------------------------------------------------------------
// Client search (checkout)
// ---------------------------------------------------------------------------

export async function searchPosClientsAction(slug: string, query: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'pos.use')
  if (error) return fail(error)
  const parsed = z.string().trim().min(2).max(60).safeParse(query)
  if (!parsed.success) return ok(undefined, { clients: [] })
  const seePhone = can(ctx, 'clients.phone')
  const like = `%${parsed.data.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
  const digits = parsed.data.replace(/\D/g, '').replace(/^0+/, '')
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({ id: clients.id, name: clients.name, phone: clients.phoneE164 })
      .from(clients)
      .where(
        seePhone && digits.length >= 3
          ? or(ilike(clients.name, like), ilike(clients.phoneE164, `%${digits}%`))
          : ilike(clients.name, like),
      )
      .orderBy(asc(clients.name))
      .limit(8),
  )
  return ok(undefined, {
    clients: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phone: r.phone ? (seePhone ? `+${r.phone}` : maskPhone(r.phone)) : null,
    })),
  })
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------

const saleSchema = z.object({
  branchId: z.uuid(),
  bookingId: optionalUuid,
  clientId: optionalUuid,
  newClient: z
    .object({ name: z.string().trim().min(2, 'sales.v.name').max(120), phone: z.string().trim().max(30) })
    .nullish(),
  lines: z
    .array(
      z.object({
        kind: z.enum(['service', 'product', 'package', 'gift_card', 'other', 'membership']),
        refId: optionalUuid,
        clientPackageId: optionalUuid,
        membership: z.object({ id: z.uuid(), use: z.enum(['session', 'discount']) }).nullish(),
        description: z.string().trim().min(1, 'sales.v.describe').max(200),
        qty: z.coerce.number().int().min(1).max(99),
        // No coercion: a blank price (service with "price on request", R4) arrives as null and must be typed.
        unitPriceAed: z.preprocess(
          (v: number | null) => v,
          z
            .number({ error: 'sales.v.priceRequired' })
            .min(0, 'sales.v.negative')
            .max(1_000_000, 'sales.v.tooLarge'),
        ),
        discountAed: money.default(0),
        staffId: optionalUuid,
      }),
    )
    .min(1, 'sales.v.addItem'),
  discountAed: money.default(0),
  payments: z
    // F15: up to 300 so a scanned voucher QR (its check-page URL) fits; services resolve it to the card's code.
    .array(z.object({ method: payMethod, amountAed: money, reference: z.string().trim().max(300).nullish() }))
    .max(8),
  tips: z.array(z.object({ staffId: z.uuid('sales.v.therapist'), amountAed: money, method })).max(12),
  /** R32 Finish of a booking: commission per item × therapist (blank rows = the booking's planned amount). */
  commissions: z
    .array(
      z.object({
        bookingItemId: z.uuid(),
        staffId: z.uuid(),
        amountAed: money.max(100_000, 'bookings.errors.amount'),
      }),
    )
    .max(24)
    .optional(),
})
export type SalePayload = z.input<typeof saleSchema>

export async function createSaleAction(slug: string, payload: SalePayload): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'pos.use')
  if (error) return fail(error)
  const parsed = saleSchema.safeParse(payload)
  if (!parsed.success) return fromZod(parsed.error)
  const v = parsed.data
  // R32 (D6): new money on a closed day only with pos.correct (owners/managers).
  const allowClosedDay = can(ctx, 'pos.correct')
  try {
    const { sale, finished, closed } = await withTenant(ctx.tenant.id, async (tx) => {
      const picked = await pickBranch(tx, ctx, v.branchId)
      if (!picked || picked.branch.id !== v.branchId) throw new DomainError('Branch not found', 'not_found')
      let clientId = v.clientId ?? null
      if (!clientId && v.newClient?.name) {
        clientId = (await findOrCreateClient(tx, ctx.tenant.id, { ...v.newClient, source: 'walk_in' })).id
      }
      const input = {
        tenantId: ctx.tenant.id,
        branchId: v.branchId,
        bookingId: v.bookingId ?? null,
        clientId,
        lines: v.lines,
        discountAed: v.discountAed,
        payments: v.payments.filter((p) => p.amountAed > 0),
        tips: v.tips.filter((t) => t.amountAed > 0),
        createdBy: ctx.user.id,
        allowClosedDay,
      }
      // FINISH (R32 D3): a booking's checkout = its sale + the therapist commission, one transaction.
      const done = v.bookingId
        ? await finishBooking(tx, {
            ...input,
            bookingId: v.bookingId,
            commissions: can(ctx, 'calendar.commission') ? v.commissions : undefined,
            userId: ctx.user.id,
          })
        : { ...(await createSale(tx, input)), saleDate: null, commissions: null }
      const closed = await isDayClosed(tx, v.branchId, done.sale.businessDate)
      if (closed) await markDayAmended(tx, v.branchId, done.sale.businessDate, ctx.user.id)
      return { sale: done.sale, finished: done.saleDate ? done : null, closed }
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'sale.created',
      entity: 'sale',
      entityId: sale.id,
      data: { number: sale.number, total: sale.totalAed, booking: v.bookingId ?? null },
    })
    if (finished && v.bookingId)
      await audit({
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        action: 'booking.finished',
        entity: 'booking',
        entityId: v.bookingId,
        data: { sale: sale.number, saleDate: finished.saleDate, commissions: finished.commissions },
      })
    await afterDayChange(ctx, { branchId: v.branchId, date: sale.businessDate, closed })
    revalidate(slug)
    if (v.bookingId) revalidatePath(`/dashboard/${slug}/bookings`, 'layout')
    if (v.bookingId) revalidatePath(`/dashboard/${slug}/calendar`)
    return ok({ key: 'sales.toast.recorded', params: { number: sale.number } }, { id: sale.id })
  } catch (e) {
    return handle(e)
  }
}

// ---------------------------------------------------------------------------
// Void / refund
// ---------------------------------------------------------------------------

const reason = z.string().trim().min(3, 'sales.v.reason').max(300)

export async function voidSaleAction(slug: string, saleId: string, _p: ActionResult, formData: FormData) {
  const { ctx, error } = await guard(slug, 'pos.refund')
  if (error) return fail(error)
  const parsed = z.object({ saleId: z.uuid(), reason }).safeParse({ ...formObject(formData), saleId })
  if (!parsed.success) return fromZod(parsed.error)
  try {
    const sale = await withTenant(ctx.tenant.id, (tx) =>
      voidSale(tx, { saleId, reason: parsed.data.reason, userId: ctx.user.id }),
    )
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'sale.voided',
      entity: 'sale',
      entityId: saleId,
      data: { number: sale.number, reason: parsed.data.reason },
    })
    revalidate(slug)
    return ok({ key: 'sales.toast.voided', params: { number: sale.number } })
  } catch (e) {
    return handle(e)
  }
}

const refundInput = z.object({
  method,
  reason,
  lines: z
    .array(z.object({ saleLineId: z.uuid(), qty: z.coerce.number().int('sales.v.whole').min(0).max(1000) }))
    .transform((lines) => lines.filter((l) => l.qty > 0))
    .refine((lines) => lines.length > 0, 'sales.v.chooseRefund'),
})

/** Line-level refund: the form sends `qty.<saleLineId>` per line (0 = not refunded). */
export async function refundSaleAction(slug: string, saleId: string, _p: ActionResult, formData: FormData) {
  const { ctx, error } = await guard(slug, 'pos.refund')
  if (error) return fail(error)
  const form = formObject(formData)
  const lines = Object.entries(form)
    .filter(([key]) => key.startsWith('qty.'))
    .map(([key, qty]) => ({ saleLineId: key.slice(4), qty: String(qty || 0) }))
  const parsed = refundInput.safeParse({ ...form, lines })
  if (!parsed.success) return fromZod(parsed.error)
  try {
    const refund = await withTenant(ctx.tenant.id, (tx) =>
      refundSale(tx, {
        saleId,
        lines: parsed.data.lines,
        method: parsed.data.method,
        reason: parsed.data.reason,
        createdBy: ctx.user.id,
      }),
    )
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'sale.refunded',
      entity: 'sale',
      entityId: saleId,
      data: {
        amount: refund.amountAed,
        method: refund.method,
        reason: refund.reason,
        lines: parsed.data.lines,
      },
    })
    revalidate(slug)
    return ok({ key: 'sales.toast.refunded', params: { amount: formatAed(refund.amountAed) } })
  } catch (e) {
    return handle(e)
  }
}

// ---------------------------------------------------------------------------
// Daily close
// ---------------------------------------------------------------------------

export async function closeDayAction(
  slug: string,
  branchId: string,
  date: string,
  _p: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'pos.close')
  if (error) return fail(error)
  const parsed = z
    .object({
      branchId: z.uuid(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      openingFloatAed: money,
      countedCashAed: money,
      notes: z.string().trim().max(1000).optional(),
    })
    .safeParse({ ...formObject(formData), branchId, date })
  if (!parsed.success) return fromZod(parsed.error)
  const v = parsed.data
  try {
    const row = await withTenant(ctx.tenant.id, async (tx) => {
      const picked = await pickBranch(tx, ctx, v.branchId)
      if (!picked || picked.branch.id !== v.branchId) throw new DomainError('Branch not found', 'not_found')
      if (v.date > picked.today) throw new DomainError('That business day has not started yet')
      return closeDay(tx, { tenantId: ctx.tenant.id, ...v, closedBy: ctx.user.id })
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'day.closed',
      entity: 'day_close',
      entityId: row.id,
      data: {
        date: v.date,
        expected: row.expectedCashAed,
        counted: row.countedCashAed,
        variance: row.varianceAed,
        expenses: row.totals.expenses ?? '0.00',
        // R32 PART 2 stores the day-sheet PDF with the close.
        pdf: false,
      },
    })
    revalidate(slug)
    return ok('sales.toast.dayClosed')
  } catch (e) {
    return handle(e)
  }
}

/**
 * A client's active packages and memberships live on the branch's business date (for "use a package /
 * membership session" and the automatic member discount at checkout).
 */
export async function clientPackagesAction(
  slug: string,
  clientId: string,
  branchId: string,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'pos.use')
  if (error) return fail(error)
  if (!z.uuid().safeParse(clientId).success || !z.uuid().safeParse(branchId).success)
    return ok(undefined, { packages: [], memberships: [] })
  const { packages, memberships } = await withTenant(ctx.tenant.id, async (tx) => {
    const picked = await pickBranch(tx, ctx, branchId)
    const packages = await tx
      .select({ id: clientPackages.id, name: clientPackages.name, balances: clientPackages.balances })
      .from(clientPackages)
      .where(
        and(
          eq(clientPackages.clientId, clientId),
          eq(clientPackages.status, 'active'),
          gt(clientPackages.expiresAt, new Date()),
        ),
      )
      .orderBy(asc(clientPackages.expiresAt))
    const memberships = picked ? await liveMemberships(tx, clientId, picked.today) : []
    return { packages, memberships }
  })
  return ok(undefined, {
    packages,
    memberships: memberships.map((m) => ({
      id: m.id,
      name: m.name,
      discountPct: Number(m.discountPct),
      balances: m.balances,
      endsOn: m.currentPeriodEnd,
    })),
  })
}

const billingInput = z.object({
  name: z.string().trim().min(2, 'sales.invoice.errors.name').max(160),
  address: z.string().trim().max(400).optional().default(''),
  trn: z.string().trim().max(40).optional().default(''),
  saveToClient: z.literal('on').optional(),
})

/** Customer billing details for the full tax invoice (G16); optionally saved on the client's profile. */
export async function saveBillingAction(slug: string, saleId: string, _p: ActionResult, formData: FormData) {
  const { ctx, error } = await guard(slug, 'pos.use')
  if (error) return fail(error)
  if (!z.uuid().safeParse(saleId).success) return fail('sales.invoice.errors.notFound')
  const parsed = billingInput.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const saveToClient = parsed.data.saveToClient === 'on' && can(ctx, 'clients.manage')
  try {
    const billing = await withTenant(ctx.tenant.id, async (tx) => {
      const [sale] = await tx.select({ branchId: sales.branchId }).from(sales).where(eq(sales.id, saleId))
      if (!sale || (ctx.member && !ctx.member.allBranches && !ctx.member.branchIds.includes(sale.branchId)))
        throw new DomainError('Sale not found', 'not_found', { key: 'sales.invoice.errors.notFound' })
      return saveSaleBilling(tx, saleId, parsed.data, { saveToClient })
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: 'sale.billing_saved',
      entity: 'sale',
      entityId: saleId,
      data: { ...billing, savedToClient: saveToClient },
    })
    revalidate(slug)
    return ok('sales.invoice.saved')
  } catch (e) {
    return handle(e)
  }
}

// ---------------------------------------------------------------------------
// R32 (D11) expenses paid from the drawer on Daily close
// ---------------------------------------------------------------------------

const drawerExpenseSchema = z.object({
  branchId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description: z.string().trim().min(1, 'sales.v.describe').max(80, 'sales.v.describe'),
  accountCode: z.enum(DRAWER_EXPENSE_CODES.map((a) => a.code) as [string, ...string[]], {
    message: 'accounts.validation.pickCategory',
  }),
  amountAed: z.coerce
    .number({ error: 'sales.v.amount' })
    .min(0.01, 'sales.v.amount')
    .max(100_000, 'sales.v.tooLarge'),
})

export async function addDrawerExpenseAction(
  slug: string,
  branchId: string,
  date: string,
  _p: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'pos.close')
  if (error) return fail(error)
  const parsed = drawerExpenseSchema.safeParse({ ...formObject(formData), branchId, date })
  if (!parsed.success) return fromZod(parsed.error)
  const v = parsed.data
  try {
    const { row, lock } = await withTenant(ctx.tenant.id, async (tx) => {
      const picked = await pickBranch(tx, ctx, v.branchId)
      if (!picked || picked.branch.id !== v.branchId) throw new DomainError('Branch not found', 'not_found')
      if (v.date > picked.today) throw new DomainError('That business day has not started yet')
      const lock = await editDay(tx, ctx, v.branchId, v.date)
      const row = await recordDrawerExpense(tx, {
        tenantId: ctx.tenant.id,
        branchId: v.branchId,
        date: v.date,
        description: v.description,
        accountCode: v.accountCode,
        amountAed: v.amountAed,
        createdBy: ctx.user.id,
        allowClosedDay: lock.closed,
      })
      return { row, lock }
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'expense.recorded',
      entity: 'expense',
      entityId: row.id,
      data: {
        date: v.date,
        branch: v.branchId,
        description: v.description,
        amountAed: row.amountAed,
        accountCode: v.accountCode,
        fromDrawer: true,
        closedDay: lock.closed,
      },
    })
    await afterDayChange(ctx, lock)
    revalidate(slug)
    revalidatePath(`/dashboard/${slug}/accounts`, 'layout')
    return ok('sales.toast.expenseAdded')
  } catch (e) {
    return handle(e)
  }
}

export async function voidDrawerExpenseAction(slug: string, expenseId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'pos.close')
  if (error) return fail(error)
  if (!z.uuid().safeParse(expenseId).success) return fail('errors.generic')
  try {
    const { row, lock } = await withTenant(ctx.tenant.id, async (tx) => {
      const [found] = await tx.select().from(expenses).where(eq(expenses.id, expenseId))
      if (!found?.fromDrawer || !found.branchId) throw new DomainError('Expense not found', 'not_found')
      const picked = await pickBranch(tx, ctx, found.branchId)
      if (!picked || picked.branch.id !== found.branchId)
        throw new DomainError('Expense not found', 'not_found')
      const lock = await editDay(tx, ctx, found.branchId, found.expenseDate)
      const row = await voidDrawerExpense(tx, { expenseId, userId: ctx.user.id, allowClosedDay: lock.closed })
      return { row, lock }
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'expense.voided',
      entity: 'expense',
      entityId: expenseId,
      data: {
        date: row.expenseDate,
        branch: row.branchId,
        description: row.description,
        amountAed: row.amountAed,
        accountCode: row.accountCode,
        fromDrawer: true,
        closedDay: lock.closed,
      },
    })
    await afterDayChange(ctx, lock)
    revalidate(slug)
    revalidatePath(`/dashboard/${slug}/accounts`, 'layout')
    return ok('sales.toast.expenseVoided')
  } catch (e) {
    return handle(e)
  }
}

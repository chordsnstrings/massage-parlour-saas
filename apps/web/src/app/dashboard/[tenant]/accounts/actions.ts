'use server'
import { includedVat } from '@spa/core'
import { branches, expenses, withTenant } from '@spa/db'
import { DomainError, EXPENSE_CODES, lockPeriod, postExpense, reverseSource } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { todayDubai } from '@/lib/utils'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
import { receiptColumns, receiptFields } from './expenses/receipt'

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date')
const lockedMessage = (e: unknown) => {
  const msg = `${e instanceof Error ? e.message : ''} ${(e as { cause?: Error })?.cause?.message ?? ''}`
  return /locked/i.test(msg) ? 'That date is in a closed period. Pick a date after the lock date.' : null
}

const expenseSchema = z.object({
  expenseDate: date,
  accountCode: z.enum(EXPENSE_CODES.map((a) => a.code) as [string, ...string[]], {
    message: 'Pick a category',
  }),
  vendor: z.string().trim().max(120).optional(),
  description: z.string().trim().max(300).optional(),
  amountAed: z.coerce.number({ message: 'Enter the amount' }).positive('Enter the amount').max(10_000_000),
  hasVat: z.preprocess((v) => v === 'on', z.boolean()),
  paidVia: z.enum(['cash', 'bank', 'card', 'owner']),
  ...receiptFields,
})

export async function addExpenseAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'accounting.manage')
  if (error) return fail(error)
  const parsed = expenseSchema.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const vatAed = d.hasVat ? includedVat(d.amountAed) : 0
  try {
    await withTenant(ctx.tenant.id, async (tx) => {
      const [branch] = await tx
        .select({ id: branches.id })
        .from(branches)
        .where(eq(branches.isDefault, true))
        .limit(1)
      const [row] = await tx
        .insert(expenses)
        .values({
          tenantId: ctx.tenant.id,
          branchId: branch?.id ?? null,
          expenseDate: d.expenseDate,
          accountCode: d.accountCode,
          vendor: d.vendor || null,
          description: d.description || null,
          amountAed: String(d.amountAed),
          vatAed: String(vatAed),
          paidVia: d.paidVia,
          createdBy: ctx.user.id,
          ...(await receiptColumns(tx, d.receiptFileId, d.ocr)),
        })
        .returning({ id: expenses.id })
      await postExpense(tx, {
        tenantId: ctx.tenant.id,
        branchId: branch?.id ?? null,
        id: row!.id,
        date: d.expenseDate,
        accountCode: d.accountCode,
        amountAed: d.amountAed,
        vatAed,
        paidVia: d.paidVia,
        createdBy: ctx.user.id,
        memo: [d.vendor, d.description].filter(Boolean).join(' — ') || undefined,
      })
    })
  } catch (e) {
    const locked = lockedMessage(e)
    if (locked) return fail(locked, { expenseDate: locked })
    throw e
  }
  revalidatePath(`/dashboard/${slug}/accounts`, 'layout')
  return ok('Expense recorded')
}

/** Voiding posts a reversal dated today (the original stays in the journal) and removes the expense row. */
export async function voidExpenseAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'accounting.manage')
  if (error) return fail(error)
  try {
    const removed = await withTenant(ctx.tenant.id, async (tx) => {
      const [row] = await tx.select().from(expenses).where(eq(expenses.id, id))
      if (!row) throw new DomainError('Expense not found', 'not_found')
      await reverseSource(tx, ctx.tenant.id, 'expense', id, todayDubai(), ctx.user.id)
      await tx.delete(expenses).where(and(eq(expenses.id, id), eq(expenses.tenantId, ctx.tenant.id)))
      return row
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'expense.voided',
      entityId: id,
      data: { amountAed: removed.amountAed, accountCode: removed.accountCode, date: removed.expenseDate },
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    const locked = lockedMessage(e)
    if (locked) return fail('Today is inside a closed period, so this expense can’t be voided.')
    throw e
  }
  revalidatePath(`/dashboard/${slug}/accounts`, 'layout')
  return ok('Expense voided — a reversal was posted')
}

export async function lockPeriodAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'accounting.manage')
  if (error) return fail(error)
  const parsed = z.object({ through: date }).safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  if (parsed.data.through >= todayDubai())
    return fail('You can only close days that are over.', { through: 'Pick a past date' })
  await withTenant(ctx.tenant.id, (tx) => lockPeriod(tx, ctx.tenant.id, parsed.data.through, ctx.user.id))
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'period.locked',
    data: parsed.data,
  })
  revalidatePath(`/dashboard/${slug}/accounts`, 'layout')
  return ok(`Books closed through ${parsed.data.through}`)
}

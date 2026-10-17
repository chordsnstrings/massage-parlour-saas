'use server'
import { withTenant } from '@spa/db'
import {
  DomainError,
  PURCHASE_CATEGORIES,
  PURCHASE_PAID_VIA,
  recordPurchase,
  supplierByName,
  voidPurchase,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { todayDubai } from '@/lib/utils'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
import { receiptColumns, receiptFields } from '../accounts/expenses/receipt'

const locked = (e: unknown) =>
  /locked/i.test(`${e instanceof Error ? e.message : ''} ${(e as { cause?: Error })?.cause?.message ?? ''}`)

const line = z.object({
  productId: z
    .uuid()
    .nullish()
    .or(z.literal('').transform(() => null)),
  description: z.string().trim().max(120).nullish(),
  qty: z.coerce.number().positive('purchases.v.qty').max(1_000_000),
  unitCostAed: z.coerce.number().min(0, 'purchases.v.cost').max(1_000_000),
})

const schema = z.object({
  purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'purchases.v.date'),
  category: z.enum(PURCHASE_CATEGORIES),
  location: z.union([z.literal('warehouse'), z.uuid()], { message: 'purchases.v.location' }),
  supplier: z.string().trim().max(80).optional(),
  paidVia: z.enum(PURCHASE_PAID_VIA),
  vatAed: z.preprocess((v) => (v === '' ? 0 : v), z.coerce.number().min(0, 'purchases.v.vat').max(1_000_000)),
  reference: z.string().trim().max(60).optional(),
  notes: z.string().trim().max(500).optional(),
  lines: z.preprocess(
    (v) => {
      try {
        return JSON.parse(String(v ?? '[]'))
      } catch {
        return []
      }
    },
    z
      .array(line)
      .min(1, 'purchases.v.lines')
      .max(50)
      .refine((ls) => ls.every((l) => l.productId || l.description), 'purchases.v.lines'),
  ),
  ...receiptFields,
})

export async function recordPurchaseAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'inventory.purchase')
  if (error) return fail(error)
  const parsed = schema.safeParse(formObject(fd))
  if (!parsed.success) {
    // Line errors have no field of their own in the sheet: show the first one as the form message.
    const lineIssue = parsed.error.issues.find((i) => i.path[0] === 'lines')
    if (lineIssue)
      return fail(lineIssue.message.startsWith('purchases.') ? lineIssue.message : 'purchases.v.lines')
    return fromZod(parsed.error)
  }
  const d = parsed.data
  if (d.purchaseDate > todayDubai()) return fail('purchases.v.future', { purchaseDate: 'purchases.v.future' })
  let id: string
  try {
    id = await withTenant(ctx.tenant.id, async (tx) => {
      const supplierId = d.supplier
        ? await supplierByName(tx, { tenantId: ctx.tenant.id, name: d.supplier })
        : null
      const receipt = await receiptColumns(tx, d.receiptFileId, d.ocr)
      return recordPurchase(tx, {
        tenantId: ctx.tenant.id,
        branchId: d.location === 'warehouse' ? null : d.location,
        supplierId,
        date: d.purchaseDate,
        category: d.category,
        paidVia: d.paidVia,
        vatAed: d.vatAed,
        lines: d.lines,
        reference: d.reference,
        notes: d.notes,
        receiptUrl: receipt.receiptUrl,
        ocr: receipt.ocr,
        createdBy: ctx.user.id,
      })
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    if (locked(e)) return fail('purchases.result.locked', { purchaseDate: 'purchases.result.locked' })
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'purchase.recorded',
    entity: 'purchase',
    entityId: id,
    data: { date: d.purchaseDate, category: d.category, lines: d.lines.length, vatAed: d.vatAed },
  })
  revalidatePath(`/dashboard/${slug}`, 'layout')
  return ok('purchases.result.recorded')
}

/** Voiding posts a reversal dated today and takes received stock back out; the record stays, marked void. */
export async function voidPurchaseAction(slug: string, id: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'inventory.purchase')
  if (error) return fail(error)
  try {
    const row = await withTenant(ctx.tenant.id, (tx) =>
      voidPurchase(tx, {
        tenantId: ctx.tenant.id,
        purchaseId: id,
        date: todayDubai(),
        createdBy: ctx.user.id,
      }),
    )
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'purchase.voided',
      entity: 'purchase',
      entityId: id,
      data: { totalAed: row.totalAed, date: row.purchaseDate },
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    if (locked(e)) return fail('purchases.result.locked')
    throw e
  }
  revalidatePath(`/dashboard/${slug}`, 'layout')
  return ok('purchases.result.voided')
}

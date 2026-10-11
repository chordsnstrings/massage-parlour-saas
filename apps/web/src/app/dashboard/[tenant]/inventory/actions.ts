'use server'
import { includedVat } from '@spa/core'
import { branches, products, serviceConsumables, type Tx, withTenant } from '@spa/db'
import { adjustStock, DomainError, receiveStock } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, type Msg, ok } from '@/lib/action'
import { todayDubai } from '@/lib/utils'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const done = (slug: string, message: Msg) => {
  revalidatePath(`/dashboard/${slug}/inventory`)
  return ok(message)
}
const handle = (e: unknown) => {
  if (e instanceof DomainError) return failDomain(e)
  const msg = `${e instanceof Error ? e.message : ''} ${(e as { cause?: Error })?.cause?.message ?? ''}`
  if (/locked/i.test(msg)) return fail('inventory.errors.locked')
  throw e
}
const optMoney = z.preprocess(
  (v) => (v === '' ? undefined : v),
  z.coerce.number().min(0).max(1_000_000).optional(),
)
const defaultBranch = async (tx: Tx) =>
  (await tx.select({ id: branches.id }).from(branches).where(eq(branches.isDefault, true)).limit(1))[0]?.id

export async function saveProductAction(
  slug: string,
  id: string | null,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'inventory.manage')
  if (error) return fail(error)
  const parsed = z
    .object({
      kind: z.enum(['retail', 'consumable']),
      nameEn: z.string().trim().min(2, 'inventory.v.name').max(80),
      nameAr: z.string().trim().max(80).optional(),
      sku: z.string().trim().max(40).optional(),
      unit: z.string().trim().min(1).max(12),
      costAed: optMoney,
      priceAed: optMoney,
      lowStockAt: optMoney,
    })
    .refine((d) => d.kind !== 'retail' || (d.priceAed ?? 0) > 0, {
      path: ['priceAed'],
      message: 'inventory.v.sellingPrice',
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const values = {
    kind: d.kind,
    name: { en: d.nameEn, ar: d.nameAr || undefined },
    sku: d.sku || null,
    unit: d.unit,
    costAed: (d.costAed ?? 0).toFixed(2),
    priceAed: d.kind === 'retail' && d.priceAed ? d.priceAed.toFixed(2) : null,
    lowStockAt: d.lowStockAt != null ? String(d.lowStockAt) : null,
  }
  const saved = await withTenant(ctx.tenant.id, async (tx) =>
    id
      ? (await tx.update(products).set(values).where(eq(products.id, id)).returning())[0]
      : (
          await tx
            .insert(products)
            .values({ tenantId: ctx.tenant.id, ...values })
            .returning()
        )[0],
  )
  if (!saved) return fail('inventory.errors.notFound')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: id ? 'product.updated' : 'product.created',
    entityId: saved.id,
    data: values,
  })
  return done(slug, id ? 'inventory.saved.updated' : 'inventory.saved.added')
}

export async function receiveStockAction(
  slug: string,
  productId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'inventory.adjust')
  if (error) return fail(error)
  const parsed = z
    .object({
      qty: z.coerce.number({ message: 'inventory.v.qty' }).positive('inventory.v.qty').max(100_000),
      totalAed: z.coerce.number({ message: 'inventory.v.paid' }).min(0).max(1_000_000),
      hasVat: z.preprocess((v) => v === 'on', z.boolean()),
      paidVia: z.enum(['cash', 'bank']),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  const vatAed = d.hasVat ? includedVat(d.totalAed) : 0
  try {
    await withTenant(ctx.tenant.id, async (tx) => {
      const branchId = await defaultBranch(tx)
      if (!branchId)
        throw new DomainError('Set up a branch first', 'invalid', { key: 'inventory.errors.noBranch' })
      await receiveStock(tx, {
        tenantId: ctx.tenant.id,
        branchId,
        productId,
        qty: d.qty,
        unitCostAed: Math.round(((d.totalAed - vatAed) / d.qty) * 100) / 100,
        vatAed,
        paidVia: d.paidVia,
        date: d.date,
        createdBy: ctx.user.id,
      })
    })
  } catch (e) {
    return handle(e)
  }
  return done(slug, { key: 'inventory.receive.done', params: { qty: d.qty } })
}

export async function adjustStockAction(
  slug: string,
  productId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'inventory.adjust')
  if (error) return fail(error)
  const parsed = z
    .object({
      counted: z.coerce.number({ message: 'inventory.v.count' }).min(0, 'inventory.v.count').max(100_000),
      current: z.coerce.number(),
      note: z.string().trim().max(120).optional(),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const diff = Math.round((parsed.data.counted - parsed.data.current) * 1000) / 1000
  if (diff === 0) return ok('inventory.count.matches')
  try {
    await withTenant(ctx.tenant.id, async (tx) => {
      const branchId = await defaultBranch(tx)
      if (!branchId)
        throw new DomainError('Set up a branch first', 'invalid', { key: 'inventory.errors.noBranch' })
      await adjustStock(tx, {
        tenantId: ctx.tenant.id,
        branchId,
        productId,
        qty: diff,
        note: parsed.data.note || 'Stock count',
        date: todayDubai(),
        createdBy: ctx.user.id,
      })
    })
  } catch (e) {
    return handle(e)
  }
  return done(slug, {
    key: diff > 0 ? 'inventory.count.increased' : 'inventory.count.reduced',
    params: { qty: Math.abs(diff) },
  })
}

export async function saveUsageAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'inventory.manage')
  if (error) return fail(error)
  const parsed = z
    .object({
      serviceVariantId: z.string().uuid('inventory.v.treatment'),
      productId: z.string().uuid('inventory.v.product'),
      qty: z.coerce.number({ message: 'inventory.v.amount' }).positive('inventory.v.amount').max(1000),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  await withTenant(ctx.tenant.id, (tx) =>
    tx
      .insert(serviceConsumables)
      .values({ tenantId: ctx.tenant.id, ...d, qty: String(d.qty) })
      .onConflictDoUpdate({
        target: [serviceConsumables.serviceVariantId, serviceConsumables.productId],
        set: { qty: String(d.qty) },
      }),
  )
  return done(slug, 'inventory.usage.saved')
}

export async function removeUsageAction(slug: string, serviceVariantId: string, productId: string) {
  const { ctx, error } = await guard(slug, 'inventory.manage')
  if (error) return
  await withTenant(ctx.tenant.id, (tx) =>
    tx
      .delete(serviceConsumables)
      .where(
        and(
          eq(serviceConsumables.serviceVariantId, serviceVariantId),
          eq(serviceConsumables.productId, productId),
        ),
      ),
  )
  revalidatePath(`/dashboard/${slug}/inventory`)
}

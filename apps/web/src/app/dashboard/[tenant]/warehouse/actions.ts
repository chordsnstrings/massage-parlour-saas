'use server'
import { branches, products, withTenant } from '@spa/db'
import { countStock, DomainError, setLocationLowStock, transferStock } from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, type Msg, ok } from '@/lib/action'
import { todayDubai } from '@/lib/utils'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const done = (slug: string, message: Msg) => {
  revalidatePath(`/dashboard/${slug}/warehouse`)
  revalidatePath(`/dashboard/${slug}/inventory`)
  return ok(message)
}
const handle = (e: unknown) => {
  if (e instanceof DomainError) return failDomain(e)
  const msg = `${e instanceof Error ? e.message : ''} ${(e as { cause?: Error })?.cause?.message ?? ''}`
  if (/locked/i.test(msg)) return fail('inventory.errors.locked')
  throw e
}

/** Warehouse → branch ("out") or branch → warehouse ("in"). */
export async function transferStockAction(
  slug: string,
  productId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'inventory.manage')
  if (error) return fail(error)
  const parsed = z
    .object({
      direction: z.enum(['out', 'in']),
      branchId: z.uuid('warehouse.v.branch'),
      qty: z.coerce.number({ message: 'warehouse.v.qty' }).positive('warehouse.v.qty').max(1_000_000),
      note: z.string().trim().max(120).optional(),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  try {
    await withTenant(ctx.tenant.id, async (tx) => {
      const [b] = await tx.select({ id: branches.id }).from(branches).where(eq(branches.id, d.branchId))
      if (!b) throw new DomainError('Branch not found', 'not_found')
      return transferStock(tx, {
        tenantId: ctx.tenant.id,
        from: d.direction === 'out' ? null : d.branchId,
        to: d.direction === 'out' ? d.branchId : null,
        productId,
        qty: d.qty,
        note: d.note,
        createdBy: ctx.user.id,
      })
    })
  } catch (e) {
    return handle(e)
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'stock.transferred',
    entity: 'product',
    entityId: productId,
    data: { direction: d.direction, branchId: d.branchId, qty: d.qty },
  })
  return done(slug, {
    key: d.direction === 'out' ? 'warehouse.transfer.sent' : 'warehouse.transfer.returned',
    params: { qty: d.qty },
  })
}

export async function countWarehouseAction(
  slug: string,
  productId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'inventory.manage')
  if (error) return fail(error)
  const parsed = z
    .object({
      counted: z.coerce.number({ message: 'inventory.v.count' }).min(0, 'inventory.v.count').max(1_000_000),
      note: z.string().trim().max(120).optional(),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  let diff: number
  try {
    diff = (
      await withTenant(ctx.tenant.id, (tx) =>
        countStock(tx, {
          tenantId: ctx.tenant.id,
          branchId: null,
          productId,
          counted: parsed.data.counted,
          note: parsed.data.note || 'Warehouse count',
          date: todayDubai(),
          createdBy: ctx.user.id,
        }),
      )
    ).diff
  } catch (e) {
    return handle(e)
  }
  if (diff === 0) return ok('inventory.count.matches')
  return done(slug, {
    key: diff > 0 ? 'inventory.count.increased' : 'inventory.count.reduced',
    params: { qty: Math.abs(diff) },
  })
}

export async function setWarehouseLowAction(
  slug: string,
  productId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'inventory.manage')
  if (error) return fail(error)
  const parsed = z
    .object({
      lowStockAt: z.preprocess(
        (v) => (v === '' || v == null ? null : v),
        z.coerce.number({ message: 'warehouse.v.low' }).min(0, 'warehouse.v.low').max(1_000_000).nullable(),
      ),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const found = await withTenant(ctx.tenant.id, async (tx) => {
    const [p] = await tx.select({ id: products.id }).from(products).where(eq(products.id, productId))
    if (!p) return false
    await setLocationLowStock(tx, {
      tenantId: ctx.tenant.id,
      branchId: null,
      productId,
      lowStockAt: parsed.data.lowStockAt,
    })
    return true
  })
  if (!found) return fail('inventory.errors.notFound')
  return done(slug, 'warehouse.low.saved')
}

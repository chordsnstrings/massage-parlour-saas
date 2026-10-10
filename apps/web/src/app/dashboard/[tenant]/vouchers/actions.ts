'use server'
import { toUaeE164 } from '@spa/core'
import { withTenant } from '@spa/db'
import { DomainError, updateVoucher } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)

/** F15: edits what a gift voucher shows (recipient, message, treatment). Premium (marketing) feature. */
export async function saveVoucherAction(
  slug: string,
  id: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'pos.use', 'marketing')
  if (error) return fail(error)
  const raw = formObject(fd)
  const parsed = z
    .object({
      id: z.uuid(),
      recipientName: optional(80),
      recipientPhone: optional(30).refine(
        (v) => v === null || toUaeE164(v) !== null,
        'growth.voucher.v.phone',
      ),
      message: optional(200),
      voucherServiceId: z
        .uuid()
        .optional()
        .or(z.literal('').transform(() => undefined))
        .transform((v) => v ?? null),
    })
    .safeParse({ ...raw, id })
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  // Phone numbers are for phone roles only (clients.phone); others keep the stored one.
  const phoneAllowed = ctx.permissions.has('clients.phone')
  try {
    const card = await withTenant(ctx.tenant.id, (tx) =>
      updateVoucher(tx, d.id, {
        recipientName: d.recipientName,
        message: d.message,
        voucherServiceId: d.voucherServiceId,
        ...(phoneAllowed ? { recipientPhone: d.recipientPhone ? toUaeE164(d.recipientPhone) : null } : {}),
      }),
    )
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: 'gift_card.voucher_updated',
      entity: 'gift_card',
      entityId: card.id,
      data: { code: card.code, treatment: d.voucherServiceId, recipient: Boolean(d.recipientName) },
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  revalidatePath(`/dashboard/${slug}/vouchers/${id}`)
  return ok('growth.voucher.saved')
}

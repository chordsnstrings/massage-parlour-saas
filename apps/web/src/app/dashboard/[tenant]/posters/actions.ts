'use server'
import { withTenant } from '@spa/db'
import { createPartner, DomainError, setPartnerActive } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const done = (slug: string, key: string) => {
  revalidatePath(`/dashboard/${slug}/posters`)
  return ok(key)
}

/** F16: adds a partner (hotel concierge…) with its own tracked booking link. Premium (marketing). */
export async function createPartnerAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.campaigns', 'marketing')
  if (error) return fail(error)
  const parsed = z
    .object({ name: z.string().trim().min(2, 'growth.poster.v.name').max(80) })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  try {
    const partner = await withTenant(ctx.tenant.id, (tx) =>
      createPartner(tx, ctx.tenant.id, parsed.data.name, ctx.user.id),
    )
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: 'booking_partner.created',
      entity: 'booking_partner',
      entityId: partner.id,
      data: { name: partner.name, code: partner.code },
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  return done(slug, 'growth.poster.created')
}

/** Pauses / resumes a partner: a paused partner's link still books, without the partner attribution. */
export async function setPartnerActiveAction(
  slug: string,
  id: string,
  active: boolean,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.campaigns', 'marketing')
  if (error) return fail(error)
  const parsed = z.object({ id: z.uuid(), active: z.boolean() }).safeParse({ id, active })
  if (!parsed.success) return fail('growth.poster.notFound')
  try {
    const partner = await withTenant(ctx.tenant.id, (tx) =>
      setPartnerActive(tx, parsed.data.id, parsed.data.active),
    )
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: active ? 'booking_partner.resumed' : 'booking_partner.paused',
      entity: 'booking_partner',
      entityId: partner.id,
      data: { name: partner.name },
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  return done(slug, active ? 'growth.poster.resumedToast' : 'growth.poster.pausedToast')
}

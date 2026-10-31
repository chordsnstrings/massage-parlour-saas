'use server'
// F15 Inbox → Enquiries: moving a website enquiry (new → replied → closed, or back to new). clients.manage; audited.
// Replies themselves are WhatsApp click-to-send links (no sending API).
import { withTenant } from '@spa/db'
import { SITE_ENQUIRY_STATUSES, setSiteEnquiryStatus } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const input = z.object({ id: z.uuid(), status: z.enum(SITE_ENQUIRY_STATUSES) })

export async function setEnquiryStatusAction(
  slug: string,
  id: string,
  status: (typeof SITE_ENQUIRY_STATUSES)[number],
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'clients.manage')
  if (error) return fail(error)
  const parsed = input.safeParse({ id, status })
  if (!parsed.success) return fromZod(parsed.error)
  const moved = await withTenant(ctx.tenant.id, (tx) =>
    setSiteEnquiryStatus(tx, parsed.data.id, parsed.data.status, ctx.user.id),
  )
  if (!moved) return fail('errors.notFound')
  if (moved.from !== parsed.data.status)
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: 'site.enquiry.status',
      entity: 'site_enquiry',
      entityId: parsed.data.id,
      data: { from: moved.from, to: parsed.data.status },
    })
  revalidatePath(`/dashboard/${slug}/enquiries`)
  revalidatePath(`/dashboard/${slug}`, 'layout')
  return ok('enquiries.moved')
}

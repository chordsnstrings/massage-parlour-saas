'use server'
import { AUTOMATIONS } from '@spa/core'
import { withTenant } from '@spa/db'
import { setAutomation } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const schema = z.object({ key: z.enum(AUTOMATIONS), on: z.boolean() })

/** Flips one per-spa automation switch (B3). Backups and domain checks are platform duties and not switchable. */
export async function setAutomationAction(slug: string, key: string, on: boolean): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  const parsed = schema.safeParse({ key, on })
  if (!parsed.success) return fail('automations.errors.unknown')
  const d = parsed.data
  await withTenant(ctx.tenant.id, (tx) => setAutomation(tx, ctx.tenant.id, d.key, d.on))
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'automation.updated',
    entity: 'automation',
    data: d,
  })
  revalidatePath(`/dashboard/${slug}/automations`)
  return ok({
    key: d.on ? 'automations.switchedOn' : 'automations.switchedOff',
    params: { name: { key: `automations.items.${d.key}.name` } },
  })
}

'use server'
import { AUTOMATIONS, CLIENT_DRAFT_LIMITS, HHMM } from '@spa/core'
import { withTenant } from '@spa/db'
import { saveClientDraftSettings, setAutomation } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
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

const draftSchema = z.object({
  quietStart: z.string().trim().regex(HHMM, 'growth.drafts.v.time'),
  quietEnd: z.string().trim().regex(HHMM, 'growth.drafts.v.time'),
  reviewLink: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https:\/\/\S+$/.test(v), 'growth.drafts.v.link'),
  reviewDelayHours: z.coerce
    .number()
    .int('growth.drafts.v.delay')
    .min(CLIENT_DRAFT_LIMITS.reviewDelayHours.min, 'growth.drafts.v.delay')
    .max(CLIENT_DRAFT_LIMITS.reviewDelayHours.max, 'growth.drafts.v.delay'),
  winbackDays: z.coerce
    .number()
    .int('growth.drafts.v.days')
    .min(CLIENT_DRAFT_LIMITS.winbackDays.min, 'growth.drafts.v.days')
    .max(CLIENT_DRAFT_LIMITS.winbackDays.max, 'growth.drafts.v.days'),
})

/** F15: timing of the automatic review / birthday / win-back drafts (quiet hours, review link, delays). Premium. */
export async function saveClientDraftsAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage', 'marketing')
  if (error) return fail(error)
  const parsed = draftSchema.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  await withTenant(ctx.tenant.id, (tx) => saveClientDraftSettings(tx, ctx.tenant.id, d))
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'automation.client_drafts_updated',
    entity: 'automation',
    data: { ...d, reviewLink: Boolean(d.reviewLink) },
  })
  revalidatePath(`/dashboard/${slug}/automations`)
  return ok('growth.drafts.saved')
}

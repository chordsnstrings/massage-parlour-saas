'use server'
import { messageTemplates, outbox, withTenant } from '@spa/db'
import { DEFAULT_TEMPLATES, markOutbox } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { TEMPLATE_KINDS, unknownVariables } from '@/components/messages/shared'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const markSchema = z.object({
  id: z.uuid(),
  status: z.enum(['opened', 'sent', 'skipped']),
})

/** Opened in WhatsApp / sent / skipped — a human pressed send; we only record it. */
export async function markMessageAction(
  slug: string,
  input: { id: string; status: 'opened' | 'sent' | 'skipped' },
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send')
  if (error) return fail(error)
  const parsed = markSchema.safeParse(input)
  if (!parsed.success) return fromZod(parsed.error)
  const { id, status } = parsed.data
  const problem = await withTenant(ctx.tenant.id, async (tx) => {
    const [row] = await tx.select({ status: outbox.status }).from(outbox).where(eq(outbox.id, id))
    if (!row) return 'Message not found.'
    if (row.status === 'sent' || row.status === 'skipped') return 'This message was already handled.'
    // Opening twice is harmless; don't rewrite the row.
    if (status === 'opened' && row.status === 'opened') return null
    await markOutbox(tx, id, status, ctx.user.id)
    return null
  })
  if (problem) return fail(problem)
  if (status !== 'opened') {
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: `outbox.${status}`,
      entity: 'outbox',
      entityId: id,
    })
  }
  revalidatePath(`/dashboard/${slug}/messages`)
  return ok(status === 'sent' ? 'Marked as sent' : status === 'skipped' ? 'Skipped' : undefined)
}

const body = z
  .string()
  .trim()
  .min(1, 'Write a message (or reset to the default)')
  .max(1000, 'Keep it under 1,000 characters so the WhatsApp link works')
  .refine((v) => unknownVariables(v).length === 0, {
    message: 'Unknown variable — use the chips above',
  })

const templateSchema = z.object({
  kind: z.enum(TEMPLATE_KINDS as [string, ...string[]]),
  en: body,
  ar: body,
})

export async function saveTemplateAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send')
  if (error) return fail(error)
  const parsed = templateSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const kind = parsed.data.kind as keyof typeof DEFAULT_TEMPLATES
  await withTenant(ctx.tenant.id, async (tx) => {
    for (const lang of ['en', 'ar'] as const) {
      const text = parsed.data[lang]
      const where = and(eq(messageTemplates.kind, kind), eq(messageTemplates.lang, lang))
      if (text === DEFAULT_TEMPLATES[kind][lang]) {
        // Matching the default: drop the override so future default improvements apply.
        await tx.delete(messageTemplates).where(where)
        continue
      }
      await tx
        .insert(messageTemplates)
        .values({ tenantId: ctx.tenant.id, kind, lang, body: text })
        .onConflictDoUpdate({
          target: [messageTemplates.tenantId, messageTemplates.kind, messageTemplates.lang],
          set: { body: text },
        })
    }
  })
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'message_template.saved',
    entity: 'message_template',
    data: { kind },
  })
  revalidatePath(`/dashboard/${slug}/messages/templates`)
  return ok('Template saved')
}

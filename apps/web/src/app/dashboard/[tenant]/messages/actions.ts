'use server'
import { messageTemplates, outbox, withTenant } from '@spa/db'
import { assignOutbox, DEFAULT_TEMPLATES, DomainError, markOutbox } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { TEMPLATE_KINDS, unknownVariables } from '@/components/messages/shared'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
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
    if (!row) return 'messages.results.notFound' as const
    if (row.status === 'sent' || row.status === 'skipped') return 'messages.results.handled' as const
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
  return ok(
    status === 'sent'
      ? 'messages.results.markedSent'
      : status === 'skipped'
        ? 'messages.results.skipped'
        : undefined,
  )
}

const assignSchema = z.object({
  ids: z.array(z.uuid()).min(1).max(200),
  memberId: z.uuid().nullable(),
})

/**
 * F28: assigns messages to a team member who can send WhatsApp messages (or clears it). Anyone with
 * marketing.send may assign; every change is audited with the previous assignee. Click-to-send is unchanged.
 */
export async function assignMessagesAction(
  slug: string,
  input: { ids: string[]; memberId: string | null },
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send')
  if (error) return fail(error)
  const parsed = assignSchema.safeParse(input)
  if (!parsed.success) return fail('messages.results.notFound')
  const { ids, memberId } = parsed.data
  try {
    const { changed, skipped } = await withTenant(ctx.tenant.id, (tx) =>
      assignOutbox(tx, { ids, memberId, byUserId: ctx.user.id }),
    )
    for (const c of changed)
      await audit({
        tenantId: ctx.tenant.id,
        actorUserId: ctx.user.id,
        impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
        action: memberId ? 'outbox.assigned' : 'outbox.unassigned',
        entity: 'outbox',
        entityId: c.id,
        data: { from: c.from, to: memberId, bulk: ids.length > 1 },
      })
    revalidatePath(`/dashboard/${slug}/messages`)
    if (!changed.length)
      return skipped
        ? fail({ key: 'messages.assign.skipped', params: { count: skipped } })
        : ok('messages.assign.nothing')
    return ok(
      {
        key: memberId ? 'messages.assign.assigned' : 'messages.assign.unassigned',
        params: { count: changed.length },
      },
      { skipped },
    )
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
}

const body = z
  .string()
  .trim()
  .min(1, 'messages.validation.bodyRequired')
  .max(1000, 'messages.validation.bodyTooLong')
  .refine((v) => unknownVariables(v).length === 0, {
    message: 'messages.validation.unknownVariable',
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
  return ok('messages.results.templateSaved')
}

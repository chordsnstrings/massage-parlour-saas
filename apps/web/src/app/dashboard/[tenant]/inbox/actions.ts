'use server'
import { conversationMessages, conversations, withTenant } from '@spa/db'
import {
  DomainError,
  deliverReply,
  discardDraft,
  linkConversationClient,
  markConversationRead,
  setConversationFlag,
  setConversationMode,
} from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { can, guard } from '@/server/access'
import { audit } from '@/server/audit'

const uuid = z.uuid()
const Text = z.string().trim().min(1, 'Write a message first').max(2000)
const inboxPath = (slug: string) => `/dashboard/${slug}/inbox`

/** Delivery problems are not errors for the action: the message is saved with a note the thread shows. */
const delivered = (r: Awaited<ReturnType<typeof deliverReply>>): ActionResult =>
  r.ok ? ok('Sent', { sent: true }) : ok(`Saved, not sent — ${r.error}`, { sent: false })

export async function sendReplyAction(
  slug: string,
  conversationId: string,
  text: string,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send')
  if (error) return fail(error)
  const parsed = z.object({ conversationId: uuid, text: Text }).safeParse({ conversationId, text })
  if (!parsed.success) return fromZod(parsed.error)
  try {
    // A staff reply takes the thread over so the bot doesn't answer in parallel.
    await withTenant(ctx.tenant.id, (tx) =>
      tx
        .update(conversations)
        .set({ mode: 'human' })
        .where(and(eq(conversations.id, parsed.data.conversationId), eq(conversations.mode, 'bot'))),
    )
    const r = await deliverReply(ctx.tenant.id, parsed.data.conversationId, parsed.data.text, {
      sender: 'staff',
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'inbox.reply',
      entity: 'conversation',
      entityId: parsed.data.conversationId,
      data: { delivered: r.ok },
    })
    revalidatePath(inboxPath(slug))
    return delivered(r)
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message)
    throw e
  }
}

/** Sends an AI draft as-is (sender bot) or edited (sender staff). */
export async function approveDraftAction(
  slug: string,
  messageId: string,
  text: string,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send')
  if (error) return fail(error)
  const parsed = z.object({ messageId: uuid, text: Text }).safeParse({ messageId, text })
  if (!parsed.success) return fromZod(parsed.error)
  const [draft] = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select()
      .from(conversationMessages)
      .where(
        and(eq(conversationMessages.id, parsed.data.messageId), eq(conversationMessages.sender, 'ai_draft')),
      ),
  )
  if (!draft) return fail('This draft was already handled.')
  const edited = draft.text.trim() !== parsed.data.text
  const r = await deliverReply(ctx.tenant.id, draft.conversationId, parsed.data.text, {
    sender: edited ? 'staff' : 'bot',
    messageId: draft.id,
  })
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'inbox.draft.approve',
    entity: 'conversation',
    entityId: draft.conversationId,
    data: { edited, delivered: r.ok },
  })
  revalidatePath(inboxPath(slug))
  return delivered(r)
}

export async function discardDraftAction(slug: string, messageId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send')
  if (error) return fail(error)
  const parsed = uuid.safeParse(messageId)
  if (!parsed.success) return fail('Unknown draft')
  const done = await withTenant(ctx.tenant.id, (tx) => discardDraft(tx, parsed.data))
  if (!done) return fail('This draft was already handled.')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'inbox.draft.discard',
    entityId: messageId,
  })
  revalidatePath(inboxPath(slug))
  return ok('Draft discarded')
}

/** Re-sends an outbound message that wasn't delivered. */
export async function retryMessageAction(slug: string, messageId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send')
  if (error) return fail(error)
  const parsed = uuid.safeParse(messageId)
  if (!parsed.success) return fail('Unknown message')
  const [msg] = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select()
      .from(conversationMessages)
      .where(and(eq(conversationMessages.id, parsed.data), eq(conversationMessages.direction, 'out'))),
  )
  if (!msg?.error || msg.sender === 'ai_draft' || msg.sender === 'customer') return fail('Nothing to resend.')
  const r = await deliverReply(ctx.tenant.id, msg.conversationId, msg.text, {
    sender: msg.sender,
    messageId: msg.id,
  })
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'inbox.retry',
    entity: 'conversation',
    entityId: msg.conversationId,
    data: { delivered: r.ok },
  })
  revalidatePath(inboxPath(slug))
  return delivered(r)
}

const MODE_MESSAGES = {
  human: 'You’re handling this conversation',
  bot: 'Handed back to the AI receptionist',
  closed: 'Conversation closed',
} as const

export async function setModeAction(
  slug: string,
  conversationId: string,
  mode: 'bot' | 'human' | 'closed',
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send')
  if (error) return fail(error)
  const parsed = z
    .object({ conversationId: uuid, mode: z.enum(['bot', 'human', 'closed']) })
    .safeParse({ conversationId, mode })
  if (!parsed.success) return fail('Unknown conversation')
  try {
    await withTenant(ctx.tenant.id, (tx) =>
      setConversationMode(tx, parsed.data.conversationId, parsed.data.mode),
    )
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message)
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: `inbox.mode.${parsed.data.mode}`,
    entity: 'conversation',
    entityId: parsed.data.conversationId,
  })
  revalidatePath(inboxPath(slug))
  return ok(MODE_MESSAGES[parsed.data.mode])
}

export async function setFlagAction(
  slug: string,
  conversationId: string,
  flagged: boolean,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send')
  if (error) return fail(error)
  const parsed = z
    .object({ conversationId: uuid, flagged: z.boolean() })
    .safeParse({ conversationId, flagged })
  if (!parsed.success) return fail('Unknown conversation')
  await withTenant(ctx.tenant.id, (tx) =>
    setConversationFlag(tx, parsed.data.conversationId, parsed.data.flagged),
  )
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: parsed.data.flagged ? 'inbox.flag' : 'inbox.unflag',
    entity: 'conversation',
    entityId: parsed.data.conversationId,
  })
  revalidatePath(inboxPath(slug))
  return ok(parsed.data.flagged ? 'Flagged for review' : 'Flag cleared')
}

/** Opening a thread clears its unread dot (read receipts aren't audited). */
export async function markReadAction(slug: string, conversationId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send')
  if (error) return fail(error)
  const parsed = uuid.safeParse(conversationId)
  if (!parsed.success) return fail('Unknown conversation')
  await withTenant(ctx.tenant.id, (tx) => markConversationRead(tx, parsed.data))
  return ok()
}

const LinkClient = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  phone: z.string().trim().max(30).optional(),
})

export async function linkClientAction(
  slug: string,
  conversationId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send')
  if (error) return fail(error)
  if (!can(ctx, 'clients.manage')) return fail("You don't have permission to do that.")
  const id = uuid.safeParse(conversationId)
  if (!id.success) return fail('Unknown conversation')
  const parsed = LinkClient.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  let clientId: string
  try {
    clientId = await withTenant(ctx.tenant.id, (tx) =>
      linkConversationClient(tx, ctx.tenant.id, id.data, {
        name: parsed.data.name,
        phone: parsed.data.phone || null,
      }),
    )
  } catch (e) {
    if (e instanceof DomainError) return fail(e.message, { phone: e.message })
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'inbox.link_client',
    entity: 'conversation',
    entityId: id.data,
    data: { clientId },
  })
  revalidatePath(inboxPath(slug))
  return ok('Client linked')
}

'use server'
import { draftPrivateReply } from '@spa/ai'
import { conversationMessages, conversations, withTenant } from '@spa/db'
import {
  bookingLink,
  claimDraft,
  DomainError,
  deliverReply,
  discardDraft,
  linkConversationClient,
  markConversationRead,
  sendPrivateReply,
  setConversationFlag,
  setConversationMode,
} from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { can, guard } from '@/server/access'
import { audit } from '@/server/audit'
import { publicSiteUrl } from '@/server/sites'

const uuid = z.uuid()
const Text = z.string().trim().min(1, 'inbox.validation.writeFirst').max(2000)
const inboxPath = (slug: string) => `/dashboard/${slug}/inbox`

/** Delivery problems are not errors for the action: the message is saved with a note the thread shows. */
const delivered = (r: Awaited<ReturnType<typeof deliverReply>>): ActionResult =>
  r.ok
    ? ok('inbox.results.sent', { sent: true })
    : ok({ key: 'inbox.results.notSent', params: { reason: r.error } }, { sent: false })

export async function sendReplyAction(
  slug: string,
  conversationId: string,
  text: string,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send', 'ai')
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
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
}

/** Sends an AI draft as-is (sender bot) or edited (sender staff). */
export async function approveDraftAction(
  slug: string,
  messageId: string,
  text: string,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send', 'ai')
  if (error) return fail(error)
  const parsed = z.object({ messageId: uuid, text: Text }).safeParse({ messageId, text })
  if (!parsed.success) return fromZod(parsed.error)
  try {
    // Claimed atomically first, so two approvals of the same draft can't both send it.
    const draft = await withTenant(ctx.tenant.id, (tx) =>
      claimDraft(tx, parsed.data.messageId, parsed.data.text),
    )
    if (!draft) return fail('inbox.results.draftHandled')
    const r = await deliverReply(ctx.tenant.id, draft.conversationId, parsed.data.text, {
      sender: draft.sender,
      messageId: draft.messageId,
    })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      action: 'inbox.draft.approve',
      entity: 'conversation',
      entityId: draft.conversationId,
      data: { edited: draft.edited, delivered: r.ok },
    })
    revalidatePath(inboxPath(slug))
    return delivered(r)
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
}

export async function discardDraftAction(slug: string, messageId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send', 'ai')
  if (error) return fail(error)
  const parsed = uuid.safeParse(messageId)
  if (!parsed.success) return fail('inbox.results.unknownDraft')
  const done = await withTenant(ctx.tenant.id, (tx) => discardDraft(tx, parsed.data))
  if (!done) return fail('inbox.results.draftHandled')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'inbox.draft.discard',
    entityId: messageId,
  })
  revalidatePath(inboxPath(slug))
  return ok('inbox.results.draftDiscarded')
}

/** Re-sends an outbound message that wasn't delivered. */
export async function retryMessageAction(slug: string, messageId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send', 'ai')
  if (error) return fail(error)
  const parsed = uuid.safeParse(messageId)
  if (!parsed.success) return fail('inbox.results.unknownMessage')
  const [msg] = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select()
      .from(conversationMessages)
      .where(and(eq(conversationMessages.id, parsed.data), eq(conversationMessages.direction, 'out'))),
  )
  // A private reply is never re-sent from here (it would go out as a public comment reply): use the private box.
  if (!msg?.error || msg.sender === 'ai_draft' || msg.sender === 'customer' || msg.kind === 'private_reply')
    return fail('inbox.results.nothingToResend')
  let r: Awaited<ReturnType<typeof deliverReply>>
  try {
    r = await deliverReply(ctx.tenant.id, msg.conversationId, msg.text, {
      sender: msg.sender,
      messageId: msg.id,
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
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
  human: 'inbox.results.modeHuman',
  bot: 'inbox.results.modeBot',
  closed: 'inbox.results.modeClosed',
} as const

export async function setModeAction(
  slug: string,
  conversationId: string,
  mode: 'bot' | 'human' | 'closed',
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send', 'ai')
  if (error) return fail(error)
  const parsed = z
    .object({ conversationId: uuid, mode: z.enum(['bot', 'human', 'closed']) })
    .safeParse({ conversationId, mode })
  if (!parsed.success) return fail('inbox.results.unknownConversation')
  try {
    await withTenant(ctx.tenant.id, (tx) =>
      setConversationMode(tx, parsed.data.conversationId, parsed.data.mode),
    )
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
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
  const { ctx, error } = await guard(slug, 'marketing.send', 'ai')
  if (error) return fail(error)
  const parsed = z
    .object({ conversationId: uuid, flagged: z.boolean() })
    .safeParse({ conversationId, flagged })
  if (!parsed.success) return fail('inbox.results.unknownConversation')
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
  return ok(parsed.data.flagged ? 'inbox.results.flagged' : 'inbox.results.flagCleared')
}

/** Opening a thread clears its unread dot (read receipts aren't audited). */
export async function markReadAction(slug: string, conversationId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send', 'ai')
  if (error) return fail(error)
  const parsed = uuid.safeParse(conversationId)
  if (!parsed.success) return fail('inbox.results.unknownConversation')
  await withTenant(ctx.tenant.id, (tx) => markConversationRead(tx, parsed.data))
  return ok()
}

const LinkClient = z.object({
  name: z.string().trim().min(1, 'inbox.validation.enterName').max(120),
  phone: z.string().trim().max(30).optional(),
})

export async function linkClientAction(
  slug: string,
  conversationId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send', 'ai')
  if (error) return fail(error)
  if (!can(ctx, 'clients.manage')) return fail('errors.forbidden')
  const id = uuid.safeParse(conversationId)
  if (!id.success) return fail('inbox.results.unknownConversation')
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
    if (e instanceof DomainError) return failDomain(e, { phone: e.message })
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
  return ok('inbox.results.clientLinked')
}

/**
 * F18: the comment's one private reply (Instagram Private Replies API, within 7 days). Always typed or approved by
 * staff — the AI only fills the box (`draftPrivateReplyAction`). Failures keep nothing, so the text stays in the box.
 */
export async function sendPrivateReplyAction(
  slug: string,
  conversationId: string,
  text: string,
  aiDrafted = false,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send', 'ai')
  if (error) return fail(error)
  const parsed = z
    .object({ conversationId: uuid, text: Text, aiDrafted: z.boolean() })
    .safeParse({ conversationId, text, aiDrafted })
  if (!parsed.success) return fromZod(parsed.error)
  let r: Awaited<ReturnType<typeof sendPrivateReply>>
  try {
    r = await sendPrivateReply(ctx.tenant.id, parsed.data.conversationId, parsed.data.text)
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'inbox.private_reply',
    entity: 'conversation',
    entityId: parsed.data.conversationId,
    data: { delivered: r.ok, aiDrafted: parsed.data.aiDrafted },
  })
  revalidatePath(inboxPath(slug))
  return r.ok ? ok('inbox.private.sent') : fail({ key: 'inbox.private.notSent', params: { reason: r.error } })
}

/** AI draft of the private reply (gateway: budget + kill switch apply). Returns the text; nothing is sent or stored. */
export async function draftPrivateReplyAction(slug: string, conversationId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'marketing.send', 'ai')
  if (error) return fail(error)
  const id = uuid.safeParse(conversationId)
  if (!id.success) return fail('inbox.results.unknownConversation')
  const [comment] = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({ text: conversationMessages.text, channel: conversations.channel })
      .from(conversationMessages)
      .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
      .where(and(eq(conversationMessages.conversationId, id.data), eq(conversationMessages.direction, 'in')))
      .orderBy(conversationMessages.createdAt)
      .limit(1),
  )
  if (comment?.channel !== 'instagram_comment') return fail('inbox.results.unknownConversation')
  let draft: Awaited<ReturnType<typeof draftPrivateReply>>
  try {
    draft = await draftPrivateReply({
      tenantId: ctx.tenant.id,
      comment: comment.text,
      bookingUrl: bookingLink(await publicSiteUrl(ctx.tenant), 'ig'),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return fail(
      /budget/i.test(msg) ? 'ai.errBudget' : /disabled/i.test(msg) ? 'ai.errDisabled' : 'ai.errBusy',
    )
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'inbox.private_reply.drafted',
    entity: 'conversation',
    entityId: id.data,
    data: { inappropriate: draft.inappropriate },
  })
  return ok('inbox.private.drafted', { text: draft.reply, inappropriate: draft.inappropriate })
}

// R7 "AI tools via Meta MCP": the domain functions behind the first-party meta MCP server's tools
// (packages/ai/src/mcp/meta-server.ts registers them, checks the allow-list and writes the audit log).
// WhatsApp stays click-to-send: there is deliberately no WhatsApp send function here — drafts go to the outbox.
import {
  appDb,
  clients,
  conversationMessages,
  conversations,
  outbox,
  socialAccounts,
  socialPosts,
  type Tx,
  withTenant,
} from '@spa/db'
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import { normalisePhone } from './data-io'
import { DomainError } from './errors'
import { facebookPageClient, MetaApiError, metaConfig } from './integrations/meta'
import { decryptSecret } from './secrets'
import {
  type Channel,
  getInstagramAccount,
  isPublishing,
  isUnread,
  PUBLISHING_NOTE,
  publicImageUrl,
  type SocialOpts,
} from './social'

const appOf = (o: SocialOpts) => o.app ?? appDb()
const nowOf = (o: SocialOpts) => o.now ?? new Date()
const clip = (s: string | null | undefined, n: number) => (s ?? '').slice(0, n)

const tokenOf = (a: { tokenEnc: string | null } | null) => {
  if (!a?.tokenEnc) return null
  try {
    return decryptSecret(a.tokenEnc)
  } catch {
    return null
  }
}

// ── Connected Meta accounts ─────────────────────────────────────────────────

/** The spa's connected Facebook Page (platform `facebook`, externalId = Page id, token = Page access token). */
export async function getFacebookPageAccount(tx: Tx) {
  const [row] = await tx
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.platform, 'facebook'), eq(socialAccounts.status, 'connected')))
    .orderBy(desc(socialAccounts.updatedAt))
    .limit(1)
  return row ?? null
}

/** What the MCP tools can reach for this spa (no tokens leave this function). */
export async function metaAvailability(tx: Tx, env?: Record<string, string | undefined>) {
  const ig = await getInstagramAccount(tx)
  const fb = await getFacebookPageAccount(tx)
  const configured = metaConfig(env) !== null
  return {
    configured,
    instagram: ig && tokenOf(ig) ? { username: ig.username, id: ig.externalId } : null,
    facebookPage: fb && tokenOf(fb) ? { name: fb.username, id: fb.externalId } : null,
  }
}

// ── Inbox threads (Instagram DMs / comments from the webhook) ───────────────

/** Recent threads of one channel with the last customer message — data for the model, never instructions. */
export async function listSocialThreads(tx: Tx, channel: Channel, limit = 15) {
  const lastIn = sql<
    string | null
  >`(select m.text from conversation_messages m where m.conversation_id = ${conversations.id} and m.direction = 'in' order by m.created_at desc limit 1)`
  const rows = await tx
    .select({
      id: conversations.id,
      participant: conversations.participant,
      mode: conversations.mode,
      flagged: conversations.flagged,
      lastCustomerMsgAt: conversations.lastCustomerMsgAt,
      readAt: conversations.readAt,
      lastIn,
      hasDraft: sql<boolean>`exists (select 1 from conversation_messages d where d.conversation_id = ${conversations.id} and d.sender = 'ai_draft')`,
    })
    .from(conversations)
    .where(and(eq(conversations.channel, channel), inArray(conversations.mode, ['bot', 'human'])))
    .orderBy(desc(conversations.updatedAt))
    .limit(Math.min(Math.max(limit, 1), 50))
  return rows.map((r) => ({
    thread_id: r.id,
    from: r.participant,
    mode: r.mode,
    flagged: r.flagged,
    unread: isUnread(r.lastCustomerMsgAt, r.readAt),
    last_customer_message: clip(r.lastIn, 600),
    last_customer_at: r.lastCustomerMsgAt?.toISOString() ?? null,
    has_pending_draft: r.hasDraft,
  }))
}

/** The thread for a reply tool: must exist, be of `channel` and not be closed or flagged. */
export async function replyableThread(tx: Tx, threadId: string, channel: Channel) {
  const [conv] = await tx
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, threadId), eq(conversations.channel, channel)))
  if (!conv) throw new DomainError('Thread not found', 'not_found')
  if (conv.mode === 'closed') throw new DomainError('This thread is closed.')
  if (conv.flagged) throw new DomainError('This thread is flagged for staff review.')
  return conv
}

/** Has the conversation an unsent AI draft? (helper for tests and the inbox) */
export async function pendingDraft(tx: Tx, threadId: string) {
  const [row] = await tx
    .select({ id: conversationMessages.id, text: conversationMessages.text })
    .from(conversationMessages)
    .where(
      and(eq(conversationMessages.conversationId, threadId), eq(conversationMessages.sender, 'ai_draft')),
    )
  return row ?? null
}

// ── Posts ───────────────────────────────────────────────────────────────────

export type PostPlatform = 'instagram' | 'facebook'

/** An AI post draft waiting for staff approval (AI studio → Content). Never published from here. */
export async function createSocialPostDraft(
  tx: Tx,
  p: {
    tenantId: string
    platform: PostPlatform
    caption: string
    imageUrl?: string | null
    createdBy?: string | null
  },
) {
  const caption = p.caption.trim().slice(0, 2200)
  if (!caption) throw new DomainError('Write a caption first')
  const image = p.imageUrl?.trim()
  if (image && !/^https:\/\//i.test(image) && !image.startsWith('/files/'))
    throw new DomainError('Images must be an https link or a media-library file')
  const [post] = await tx
    .insert(socialPosts)
    .values({
      tenantId: p.tenantId,
      platform: p.platform,
      caption,
      media: image ? [{ url: image }] : [],
      status: 'pending_approval',
      createdBy: p.createdBy ?? null,
    })
    .returning({ id: socialPosts.id, status: socialPosts.status })
  return post!
}

/** Approved posts (status scheduled) of a platform, soonest first. */
export async function listApprovedPosts(tx: Tx, platform: PostPlatform) {
  const rows = await tx
    .select({
      id: socialPosts.id,
      caption: socialPosts.caption,
      scheduledAt: socialPosts.scheduledAt,
    })
    .from(socialPosts)
    .where(and(eq(socialPosts.platform, platform), eq(socialPosts.status, 'scheduled')))
    .orderBy(socialPosts.scheduledAt)
    .limit(20)
  return rows.map((r) => ({
    post_id: r.id,
    caption: clip(r.caption, 200),
    scheduled_at: r.scheduledAt?.toISOString() ?? null,
  }))
}

/** Only approved posts whose time has come (or with no time) may be published by a tool. */
export async function assertPublishable(tx: Tx, postId: string, platform: PostPlatform, now = new Date()) {
  const [post] = await tx
    .select()
    .from(socialPosts)
    .where(and(eq(socialPosts.id, postId), eq(socialPosts.platform, platform)))
  if (!post) throw new DomainError('Post not found', 'not_found')
  if (post.status !== 'scheduled')
    throw new DomainError('Only posts staff approved can be published — this one is not approved.')
  if (post.scheduledAt && post.scheduledAt > now)
    throw new DomainError(`Scheduled for ${post.scheduledAt.toISOString()} — it will go out then.`)
  return post
}

/** Publishes one approved Facebook Page post (claim → Graph → record, like publishInstagramPost). */
export async function publishFacebookPost(tenantId: string, postId: string, o: SocialOpts = {}) {
  const now = nowOf(o)
  const claim = await withTenant(
    tenantId,
    async (tx) => {
      const post = await assertPublishable(tx, postId, 'facebook', now)
      if (isPublishing(post, now)) throw new DomainError('This post is being published right now.')
      const page = await getFacebookPageAccount(tx)
      const token = tokenOf(page)
      if (!page || !token) throw new DomainError('No Facebook Page is connected.')
      const image = post.media[0]?.url
      const imageUrl = image ? publicImageUrl(image) : null
      if (image && !imageUrl) throw new DomainError('The image is not on a public https link.')
      await tx
        .update(socialPosts)
        .set({ status: 'failed', error: PUBLISHING_NOTE, publishedAt: now })
        .where(eq(socialPosts.id, post.id))
      return { post, page, token, imageUrl }
    },
    appOf(o),
  )
  let result: { ok: true; externalId: string } | { ok: false; error: string }
  try {
    const r = await facebookPageClient(o.fetch).publish({
      pageId: claim.page.externalId,
      caption: claim.post.caption,
      imageUrl: claim.imageUrl,
      accessToken: claim.token,
    })
    result = { ok: true, externalId: r.id }
  } catch (e) {
    result = {
      ok: false,
      error: e instanceof MetaApiError ? `Facebook said: ${e.message}` : 'Publishing failed — try again.',
    }
  }
  await withTenant(
    tenantId,
    (tx) =>
      tx
        .update(socialPosts)
        .set(
          result.ok
            ? { status: 'published', publishedAt: nowOf(o), externalId: result.externalId, error: null }
            : { status: 'failed', error: result.error, publishedAt: null },
        )
        .where(eq(socialPosts.id, postId)),
    appOf(o),
  )
  return result
}

/** Recent comments on the Page (live Graph read). */
export async function facebookPageComments(tenantId: string, limit: number, o: SocialOpts = {}) {
  const page = await withTenant(tenantId, (tx) => getFacebookPageAccount(tx), appOf(o))
  const token = tokenOf(page)
  if (!page || !token) throw new DomainError('No Facebook Page is connected.')
  return facebookPageClient(o.fetch).recentComments({ pageId: page.externalId, accessToken: token, limit })
}

export async function replyFacebookComment(
  tenantId: string,
  commentId: string,
  text: string,
  o: SocialOpts = {},
) {
  const body = text.trim().slice(0, 1000)
  if (!body) throw new DomainError('Write a reply first')
  const page = await withTenant(tenantId, (tx) => getFacebookPageAccount(tx), appOf(o))
  const token = tokenOf(page)
  if (!page || !token) throw new DomainError('No Facebook Page is connected.')
  try {
    return await facebookPageClient(o.fetch).replyToComment({ commentId, text: body, accessToken: token })
  } catch (e) {
    throw new DomainError(e instanceof MetaApiError ? `Facebook said: ${e.message}` : 'Reply failed')
  }
}

// ── WhatsApp (click-to-send outbox only) ────────────────────────────────────

/** Outbox counts + the next queued messages (names, kind, excerpt — phone numbers masked). */
export async function whatsappInboxSummary(tx: Tx, now = new Date()) {
  const since = new Date(now.getTime() - 7 * 86_400_000)
  const [counts] = await tx
    .select({
      queued: sql<number>`count(*) filter (where ${outbox.status} = 'queued')::int`,
      opened: sql<number>`count(*) filter (where ${outbox.status} = 'opened')::int`,
      sent7d: sql<number>`count(*) filter (where ${outbox.status} = 'sent' and ${outbox.sentAt} >= ${since})::int`,
    })
    .from(outbox)
  const next = await tx
    .select({
      id: outbox.id,
      kind: outbox.kind,
      text: outbox.text,
      dueAt: outbox.dueAt,
      phone: outbox.phoneE164,
      client: clients.name,
    })
    .from(outbox)
    .leftJoin(clients, eq(clients.id, outbox.clientId))
    .where(and(inArray(outbox.status, ['queued', 'opened']), gte(outbox.dueAt, since)))
    .orderBy(outbox.dueAt)
    .limit(20)
  return {
    note: 'Staff send WhatsApp messages themselves (click-to-send). You can only draft.',
    queued: counts?.queued ?? 0,
    opened: counts?.opened ?? 0,
    sent_last_7_days: counts?.sent7d ?? 0,
    next: next.map((r) => ({
      id: r.id,
      kind: r.kind,
      client: r.client,
      phone: `…${r.phone.slice(-4)}`,
      due_at: r.dueAt.toISOString(),
      text: clip(r.text, 200),
    })),
  }
}

/** Queues a WhatsApp draft in the outbox for staff to tap-send (status `queued`). Never sends. */
export async function draftWhatsAppMessage(
  tx: Tx,
  p: { tenantId: string; clientId?: string; phone?: string; text: string },
) {
  const text = p.text.trim().slice(0, 1000)
  if (!text) throw new DomainError('Write a message first')
  let phone: string | null = null
  let clientId: string | null = null
  if (p.clientId) {
    const [c] = await tx
      .select({ id: clients.id, phone: clients.phoneE164 })
      .from(clients)
      .where(eq(clients.id, p.clientId))
    if (!c) throw new DomainError('Client not found', 'not_found')
    clientId = c.id
    phone = c.phone
  } else if (p.phone) {
    phone = normalisePhone(p.phone)
  }
  if (!phone) throw new DomainError('A UAE mobile number or a client with one is needed')
  const [row] = await tx
    .insert(outbox)
    .values({ tenantId: p.tenantId, clientId, kind: 'custom', phoneE164: phone, text, status: 'queued' })
    .returning({ id: outbox.id })
  return { outbox_id: row!.id, status: 'queued for staff to send' }
}

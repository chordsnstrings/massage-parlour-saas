// Instagram: connected account, DM/comment inbox, replies, publishing and token upkeep.
// Platform lookups (webhook → tenant by IG account id, cross-tenant jobs) use platformDb; every tenant write runs in withTenant.
import {
  appDb,
  bookings,
  clients,
  conversationMessages,
  conversations,
  type Db,
  platformDb,
  socialAccounts,
  socialPosts,
  type Tx,
  tenants,
  withTenant,
} from '@spa/db'
import { and, asc, desc, eq, inArray, isNull, lte, ne, sql } from 'drizzle-orm'
import { findOrCreateClient } from './clients'
import { DomainError } from './errors'
import {
  appOrigin,
  clipBytes,
  dmTooLong,
  dmWindowOpen,
  type InstagramEvent,
  instagramClient,
  MetaApiError,
  metaConfig,
  parseInstagramWebhook,
} from './integrations/meta'
import { decryptSecret, encryptSecret } from './secrets'

export * from './integrations/meta'

export type SocialOpts = {
  /** Overrides for tests; default to the env-configured pools. */
  platform?: Db
  app?: Db
  fetch?: typeof fetch
  now?: Date
  env?: Record<string, string | undefined>
  sleep?: (ms: number) => Promise<void>
}

const platformOf = (o: SocialOpts) => o.platform ?? platformDb()
const appOf = (o: SocialOpts) => o.app ?? appDb()
const nowOf = (o: SocialOpts) => o.now ?? new Date()

export type Channel = 'instagram_dm' | 'instagram_comment'
export const CHANNELS: Channel[] = ['instagram_dm', 'instagram_comment']

/** Spas the platform acts for (AI replies, scheduled publishing) — same set as the other tenant jobs. */
const LIVE_STATUSES = ['trial', 'active', 'past_due'] as const
const liveTenantIds = (o: SocialOpts) =>
  platformOf(o)
    .select({ id: tenants.id })
    .from(tenants)
    .where(inArray(tenants.status, [...LIVE_STATUSES]))

// ── Connected account ───────────────────────────────────────────────────────

export type SocialAccount = typeof socialAccounts.$inferSelect

/** The tenant's live Instagram account (inside withTenant). */
export async function getInstagramAccount(tx: Tx) {
  const [row] = await tx
    .select()
    .from(socialAccounts)
    .where(and(eq(socialAccounts.platform, 'instagram'), eq(socialAccounts.status, 'connected')))
    .orderBy(desc(socialAccounts.updatedAt))
    .limit(1)
  return row ?? null
}

/** Token-free view for the settings card (latest connected or expired account). */
export async function instagramStatus(tx: Tx) {
  const [row] = await tx
    .select()
    .from(socialAccounts)
    .where(
      and(eq(socialAccounts.platform, 'instagram'), inArray(socialAccounts.status, ['connected', 'expired'])),
    )
    .orderBy(desc(socialAccounts.updatedAt))
    .limit(1)
  if (!row) return null
  return {
    id: row.id,
    status: row.status as 'connected' | 'expired',
    igUserId: row.externalId,
    username: row.username,
    profilePictureUrl: row.meta.profilePictureUrl ?? null,
    tokenExpiresAt: row.tokenExpiresAt,
    scopes: row.scopes,
    webhooks: row.meta.webhooks ?? null,
    connectedAt: row.createdAt,
  }
}

const tokenOf = (a: SocialAccount | null) => {
  if (!a?.tokenEnc) return null
  try {
    return decryptSecret(a.tokenEnc)
  } catch {
    return null
  }
}

/** Upserts the account after OAuth; any other Instagram account of this spa is disconnected. */
export async function saveInstagramConnection(
  tx: Tx,
  tenantId: string,
  c: {
    igUserId: string
    /** App-scoped id from the code exchange; Meta's deauthorize / data-deletion callbacks may send this one. */
    appUserId?: string
    username?: string
    profilePictureUrl?: string
    accessToken: string
    expiresIn: number
    scopes: string[]
    webhooks: 'subscribed' | 'failed'
  },
  now = new Date(),
) {
  const meta: Record<string, string> = {
    igUserId: c.igUserId,
    tokenIssuedAt: now.toISOString(),
    webhooks: c.webhooks,
  }
  if (c.profilePictureUrl) meta.profilePictureUrl = c.profilePictureUrl
  if (c.appUserId && c.appUserId !== c.igUserId) meta.appUserId = c.appUserId
  const values = {
    username: c.username ?? null,
    tokenEnc: encryptSecret(c.accessToken),
    tokenExpiresAt: new Date(now.getTime() + c.expiresIn * 1000),
    meta,
    scopes: c.scopes,
    status: 'connected',
  }
  await tx
    .update(socialAccounts)
    .set({ status: 'disconnected', tokenEnc: null, tokenExpiresAt: null })
    .where(and(eq(socialAccounts.platform, 'instagram'), ne(socialAccounts.externalId, c.igUserId)))
  const [row] = await tx
    .insert(socialAccounts)
    .values({ tenantId, platform: 'instagram', externalId: c.igUserId, ...values })
    .onConflictDoUpdate({
      target: [socialAccounts.tenantId, socialAccounts.platform, socialAccounts.externalId],
      set: values,
    })
    .returning({ id: socialAccounts.id })
  return row!.id
}

export async function disconnectInstagram(tx: Tx) {
  const rows = await tx
    .update(socialAccounts)
    .set({ status: 'disconnected', tokenEnc: null, tokenExpiresAt: null })
    .where(and(eq(socialAccounts.platform, 'instagram'), ne(socialAccounts.status, 'disconnected')))
    .returning({ id: socialAccounts.id })
  return rows.length
}

/** Tenants that have this Instagram account connected, with whether the spa is live (platform lookup for webhooks / OAuth). */
async function instagramOwners(igUserId: string, o: SocialOpts) {
  const rows = await platformOf(o)
    .select({ tenantId: socialAccounts.tenantId, status: tenants.status })
    .from(socialAccounts)
    .innerJoin(tenants, eq(tenants.id, socialAccounts.tenantId))
    .where(
      and(
        eq(socialAccounts.platform, 'instagram'),
        eq(socialAccounts.externalId, igUserId),
        eq(socialAccounts.status, 'connected'),
      ),
    )
  const live = new Set<string>(LIVE_STATUSES)
  return [...new Map(rows.map((r) => [r.tenantId, live.has(r.status)])).entries()].map(
    ([tenantId, isLive]) => ({
      tenantId,
      live: isLive,
    }),
  )
}

/** Every tenant with this Instagram account connected, whatever its billing status (OAuth "already in use" check). */
export async function instagramAccountTenants(igUserId: string, o: SocialOpts = {}) {
  return (await instagramOwners(igUserId, o)).map((r) => r.tenantId)
}

/**
 * Meta deauthorize / data-deletion callback: drop the token and profile data for this IG user everywhere.
 * Matches the Instagram user id or the app-scoped id from the code exchange. Returns the number of accounts cleared.
 */
export async function forgetInstagramUser(igUserId: string, o: SocialOpts = {}) {
  const matches = and(
    eq(socialAccounts.platform, 'instagram'),
    sql`(${socialAccounts.externalId} = ${igUserId} or ${socialAccounts.meta}->>'appUserId' = ${igUserId})`,
  )
  const rows = await platformOf(o)
    .select({ tenantId: socialAccounts.tenantId })
    .from(socialAccounts)
    .where(matches)
  for (const tenantId of new Set(rows.map((r) => r.tenantId))) {
    await withTenant(
      tenantId,
      (tx) =>
        tx
          .update(socialAccounts)
          .set({ status: 'disconnected', tokenEnc: null, tokenExpiresAt: null, meta: {}, username: null })
          .where(matches),
      appOf(o),
    )
  }
  return rows.length
}

// ── Webhook ingest ──────────────────────────────────────────────────────────

export type InboundItem = {
  tenantId: string
  conversationId: string
  messageId: string
  channel: Channel
  text: string
}

/**
 * Verified webhook body → stored conversations/messages (deduped by Meta id). Returns the new inbound messages the AI
 * should answer: messages for spas that aren't live (read-only, suspended, cancelled) are kept for staff but get no AI turn.
 */
export async function ingestInstagramWebhook(body: unknown, o: SocialOpts = {}) {
  return ingestInstagramEvents(parseInstagramWebhook(body, nowOf(o)), o)
}

export async function ingestInstagramEvents(events: InstagramEvent[], o: SocialOpts = {}) {
  const owners = new Map<string, { tenantId: string; live: boolean }[]>()
  const items: InboundItem[] = []
  for (const ev of events) {
    let tenantsOf = owners.get(ev.accountId)
    if (!tenantsOf) {
      tenantsOf = await instagramOwners(ev.accountId, o)
      owners.set(ev.accountId, tenantsOf)
    }
    for (const { tenantId, live } of tenantsOf) {
      const item = await withTenant(tenantId, (tx) => storeInbound(tx, tenantId, ev), appOf(o))
      if (item && live) items.push(item)
    }
  }
  return items
}

async function storeInbound(tx: Tx, tenantId: string, ev: InstagramEvent): Promise<InboundItem | null> {
  const channel: Channel = ev.kind === 'dm' ? 'instagram_dm' : 'instagram_comment'
  const externalId = ev.kind === 'dm' ? ev.mid : ev.commentId
  const [dup] = await tx
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(eq(conversationMessages.externalId, externalId))
    .limit(1)
  if (dup) return null
  const participant = ev.kind === 'comment' && ev.fromUsername ? `@${ev.fromUsername}` : null
  const [conv] = await tx
    .insert(conversations)
    .values({
      tenantId,
      channel,
      externalThreadId: ev.kind === 'dm' ? ev.senderId : ev.commentId,
      participant,
      lastCustomerMsgAt: ev.at,
    })
    .onConflictDoUpdate({
      target: [conversations.tenantId, conversations.channel, conversations.externalThreadId],
      set: {
        lastCustomerMsgAt: sql`greatest(${conversations.lastCustomerMsgAt}, excluded.last_customer_msg_at)`,
        participant: sql`coalesce(${conversations.participant}, excluded.participant)`,
        // A new message reopens a closed thread; bot/human hand-over is kept.
        mode: sql`case when ${conversations.mode} = 'closed' then 'bot'::conversation_mode else ${conversations.mode} end`,
      },
    })
    .returning({ id: conversations.id })
  const [msg] = await tx
    .insert(conversationMessages)
    .values({
      tenantId,
      conversationId: conv!.id,
      direction: 'in',
      sender: 'customer',
      text: ev.text,
      externalId,
      createdAt: ev.at,
    })
    .onConflictDoNothing()
    .returning({ id: conversationMessages.id })
  if (!msg) return null
  return { tenantId, conversationId: conv!.id, messageId: msg.id, channel, text: ev.text }
}

/** What the agent needs for one inbound message: the thread state and prior turns (sent messages only). */
export async function loadAgentTurn(item: InboundItem, o: SocialOpts = {}) {
  return withTenant(
    item.tenantId,
    async (tx) => {
      const [conv] = await tx.select().from(conversations).where(eq(conversations.id, item.conversationId))
      if (!conv) return null
      const rows = await tx
        .select({
          id: conversationMessages.id,
          sender: conversationMessages.sender,
          text: conversationMessages.text,
        })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conv.id),
            ne(conversationMessages.sender, 'ai_draft'),
            isNull(conversationMessages.error),
          ),
        )
        .orderBy(desc(conversationMessages.createdAt))
        .limit(21)
      const history = rows
        .filter((r) => r.id !== item.messageId)
        .slice(0, 20)
        .reverse()
        .map((r) => ({
          from: r.sender === 'customer' ? ('customer' as const) : ('spa' as const),
          text: r.text,
        }))
      return { conversation: conv, history }
    },
    appOf(o),
  )
}

/** Best effort: show the customer's @username instead of an opaque id. */
export async function fillParticipant(tenantId: string, conversationId: string, o: SocialOpts = {}) {
  if (!metaConfig(o.env)) return
  const state = await withTenant(
    tenantId,
    async (tx) => {
      const [conv] = await tx.select().from(conversations).where(eq(conversations.id, conversationId))
      return { conv, account: await getInstagramAccount(tx) }
    },
    appOf(o),
  )
  const token = tokenOf(state.account)
  if (!state.conv || state.conv.participant || state.conv.channel !== 'instagram_dm' || !token) return
  try {
    const p = await instagramClient(o.fetch).userProfile(state.conv.externalThreadId, token)
    const name = p.username ? `@${p.username}` : p.name
    if (!name) return
    await withTenant(
      tenantId,
      (tx) => tx.update(conversations).set({ participant: name }).where(eq(conversations.id, conversationId)),
      appOf(o),
    )
  } catch {
    // profile lookups are optional
  }
}

// ── Replies ─────────────────────────────────────────────────────────────────

export type AgentOutcome = { reply?: string; handoff?: string; flagged?: string; bookingRef?: string }

export const TAKEN_OVER_NOTE =
  'Not sent automatically — the team took this conversation over while the AI was replying.'

/**
 * Applies a DM/comment agent turn: hand-off, flag and booking link first, then the reply —
 * sent straight away on autopilot (kept as a draft if it can't be delivered), or stored as an `ai_draft` for approval.
 * The thread is re-read here, after the model turn: if staff took it over or flagged it meanwhile, the reply becomes a draft.
 */
export async function applyAgentOutcome(
  tenantId: string,
  conversationId: string,
  outcome: AgentOutcome,
  mode: 'approve' | 'autopilot',
  o: SocialOpts = {},
): Promise<'sent' | 'drafted' | 'none'> {
  const stillBot = await withTenant(
    tenantId,
    async (tx) => {
      const [conv] = await tx
        .select({ mode: conversations.mode, flagged: conversations.flagged })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for('update')
      if (!conv) return false
      const patch: Partial<typeof conversations.$inferInsert> = {}
      if (outcome.handoff) patch.mode = 'human'
      if (outcome.flagged) patch.flagged = true
      if (outcome.bookingRef) {
        const [b] = await tx
          .select({ id: bookings.id, clientId: bookings.clientId })
          .from(bookings)
          .where(eq(bookings.refCode, outcome.bookingRef))
        if (b) {
          patch.bookingId = b.id
          if (b.clientId) patch.clientId = b.clientId
        }
      }
      if (Object.keys(patch).length)
        await tx.update(conversations).set(patch).where(eq(conversations.id, conversationId))
      return conv.mode === 'bot' && !conv.flagged
    },
    appOf(o),
  )
  const reply = outcome.reply?.trim()
  if (!reply) return 'none'
  if (mode === 'autopilot' && stillBot) {
    const r = await deliverReply(tenantId, conversationId, reply, { ...o, sender: 'bot', draftOnFail: true })
    return r.ok ? 'sent' : 'drafted'
  }
  await storeDraft(tenantId, conversationId, reply, mode === 'autopilot' ? TAKEN_OVER_NOTE : null, o)
  return 'drafted'
}

/** Keeps one pending AI draft per thread (a newer draft replaces the older one). */
export async function storeDraft(
  tenantId: string,
  conversationId: string,
  text: string,
  note: string | null,
  o: SocialOpts = {},
) {
  return withTenant(
    tenantId,
    async (tx) => {
      await tx
        .delete(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversationId),
            eq(conversationMessages.sender, 'ai_draft'),
          ),
        )
      const [row] = await tx
        .insert(conversationMessages)
        .values({ tenantId, conversationId, direction: 'out', sender: 'ai_draft', text, error: note })
        .returning({ id: conversationMessages.id })
      return row!.id
    },
    appOf(o),
  )
}

export type DeliverResult = { ok: true; messageId: string } | { ok: false; messageId: string; error: string }

/** Why a reply can't go out right now (null = OK to call Instagram). */
export function replyBlocker(
  s: {
    channel: string
    lastCustomerMsgAt: Date | null
    account: SocialAccount | null
    token: string | null
  },
  now: Date,
  env?: Record<string, string | undefined>,
) {
  if (!metaConfig(env)) return "Instagram isn't set up on this server yet (sandbox) — saved here only."
  if (!s.account || !s.token)
    return "Instagram isn't connected — connect it in Settings → Instagram & Google."
  if (s.account.tokenExpiresAt && s.account.tokenExpiresAt <= now)
    return 'The Instagram connection expired — reconnect it in Settings → Instagram & Google.'
  if (s.channel === 'instagram_dm' && !dmWindowOpen(s.lastCustomerMsgAt, now))
    return "More than 24 hours since the customer's last message — Instagram only allows replies from the Instagram app now."
  return null
}

/**
 * Sends a DM (or public comment reply) and records it. Never throws for delivery problems:
 * the message is stored with an `error` the inbox shows (not configured, not connected, 24-hour window, API errors).
 * `messageId` re-sends an existing outbound row (approving a draft, retrying a failed message).
 */
export async function deliverReply(
  tenantId: string,
  conversationId: string,
  text: string,
  opts: SocialOpts & { sender: 'bot' | 'staff'; messageId?: string; draftOnFail?: boolean },
): Promise<DeliverResult> {
  const now = nowOf(opts)
  const state = await withTenant(
    tenantId,
    async (tx) => {
      const [conv] = await tx.select().from(conversations).where(eq(conversations.id, conversationId))
      if (!conv) throw new DomainError('Conversation not found', 'not_found')
      return { conv, account: await getInstagramAccount(tx) }
    },
    appOf(opts),
  )
  const { conv, account } = state
  const isDm = conv.channel === 'instagram_dm'
  // Staff text is never cut silently (the actions check it first); AI text is already byte-limited, clip as a backstop.
  const tooLong = isDm && opts.sender === 'staff' ? dmTooLong(text.trim()) : null
  if (tooLong) throw new DomainError(tooLong)
  const body = isDm ? clipBytes(text.trim()) : text.trim().slice(0, 2000)
  if (!body) throw new DomainError('Write a message first')
  const token = tokenOf(account)
  let error = replyBlocker(
    { channel: conv.channel, lastCustomerMsgAt: conv.lastCustomerMsgAt, account, token },
    now,
    opts.env,
  )
  let externalId: string | null = null
  let expired = false
  if (!error && account && token) {
    try {
      const client = instagramClient(opts.fetch)
      externalId = isDm
        ? ((
            await client.sendMessage({
              igUserId: account.externalId,
              recipientId: conv.externalThreadId,
              text: body,
              accessToken: token,
            })
          ).messageId ?? null)
        : ((await client.replyToComment({ commentId: conv.externalThreadId, text: body, accessToken: token }))
            .id ?? null)
    } catch (e) {
      error =
        e instanceof MetaApiError ? `Instagram said: ${e.message}` : 'Something went wrong while sending.'
      expired = e instanceof MetaApiError && e.code === 190
    }
  }
  const sender: 'bot' | 'staff' | 'ai_draft' = error && opts.draftOnFail ? 'ai_draft' : opts.sender
  const messageId = await withTenant(
    tenantId,
    async (tx) => {
      if (expired && account)
        await tx.update(socialAccounts).set({ status: 'expired' }).where(eq(socialAccounts.id, account.id))
      const values = { sender, text: body, error, externalId }
      await tx.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, conversationId))
      if (opts.messageId) {
        // An approved draft / retried message moves to "now" so the thread, list preview and AI history stay in order.
        const [row] = await tx
          .update(conversationMessages)
          .set({ ...values, createdAt: now })
          .where(
            and(
              eq(conversationMessages.id, opts.messageId),
              eq(conversationMessages.conversationId, conversationId),
              eq(conversationMessages.direction, 'out'),
            ),
          )
          .returning({ id: conversationMessages.id })
        if (row) return row.id
      }
      if (sender === 'ai_draft')
        await tx
          .delete(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, conversationId),
              eq(conversationMessages.sender, 'ai_draft'),
            ),
          )
      const [row] = await tx
        .insert(conversationMessages)
        .values({ tenantId, conversationId, direction: 'out', ...values })
        .returning({ id: conversationMessages.id })
      return row!.id
    },
    appOf(opts),
  )
  return error ? { ok: false, messageId, error } : { ok: true, messageId }
}

// ── Inbox (inside withTenant) ───────────────────────────────────────────────

export type InboxFilter = 'open' | 'flagged' | 'closed' | 'all'

export async function listInbox(tx: Tx, filter: InboxFilter = 'open', limit = 100) {
  const last = (col: string) =>
    sql.raw(
      `(select m.${col} from conversation_messages m where m.conversation_id = conversations.id and m.sender <> 'ai_draft' order by m.created_at desc limit 1)`,
    )
  const where =
    filter === 'open'
      ? ne(conversations.mode, 'closed')
      : filter === 'closed'
        ? eq(conversations.mode, 'closed')
        : filter === 'flagged'
          ? eq(conversations.flagged, true)
          : undefined
  const rows = await tx
    .select({
      id: conversations.id,
      channel: conversations.channel,
      participant: conversations.participant,
      externalThreadId: conversations.externalThreadId,
      mode: conversations.mode,
      flagged: conversations.flagged,
      lastCustomerMsgAt: conversations.lastCustomerMsgAt,
      readAt: conversations.readAt,
      createdAt: conversations.createdAt,
      clientName: clients.name,
      lastText: sql<string | null>`${last('text')}`,
      lastSender: sql<string | null>`${last('sender')}`,
      lastAt: sql<string | null>`${last('created_at')}`,
      hasDraft: sql<boolean>`exists (select 1 from conversation_messages d where d.conversation_id = ${conversations.id} and d.sender = 'ai_draft')`,
    })
    .from(conversations)
    .leftJoin(clients, eq(clients.id, conversations.clientId))
    .where(and(inArray(conversations.channel, CHANNELS), where))
    .orderBy(sql`coalesce(${last('created_at')}, ${conversations.createdAt}) desc`)
    .limit(limit)
  return rows.map((r) => ({
    ...r,
    lastAt: r.lastAt ? new Date(r.lastAt) : r.createdAt,
    unread: isUnread(r.lastCustomerMsgAt, r.readAt),
  }))
}

export const isUnread = (lastCustomerMsgAt: Date | null, readAt: Date | null) =>
  Boolean(lastCustomerMsgAt && (!readAt || lastCustomerMsgAt > readAt))

export async function inboxCounts(tx: Tx) {
  const [row] = await tx
    .select({
      total: sql<number>`count(*)::int`,
      open: sql<number>`count(*) filter (where ${conversations.mode} <> 'closed')::int`,
      unread: sql<number>`count(*) filter (where ${conversations.lastCustomerMsgAt} is not null and (${conversations.readAt} is null or ${conversations.lastCustomerMsgAt} > ${conversations.readAt}))::int`,
      flagged: sql<number>`count(*) filter (where ${conversations.flagged})::int`,
    })
    .from(conversations)
    .where(inArray(conversations.channel, CHANNELS))
  return row ?? { total: 0, open: 0, unread: 0, flagged: 0 }
}

export async function getThread(tx: Tx, conversationId: string) {
  const [conv] = await tx
    .select({
      conversation: conversations,
      clientName: clients.name,
      bookingRef: bookings.refCode,
      bookingDate: bookings.businessDate,
      bookingStatus: bookings.status,
      bookingStartsAt: bookings.startsAt,
    })
    .from(conversations)
    .leftJoin(clients, eq(clients.id, conversations.clientId))
    .leftJoin(bookings, eq(bookings.id, conversations.bookingId))
    .where(and(eq(conversations.id, conversationId), inArray(conversations.channel, CHANNELS)))
  if (!conv) return null
  const recent = await tx
    .select()
    .from(conversationMessages)
    .where(eq(conversationMessages.conversationId, conversationId))
    .orderBy(desc(conversationMessages.createdAt))
    .limit(200)
  return { ...conv, messages: recent.reverse() }
}

export async function setConversationMode(tx: Tx, conversationId: string, mode: 'bot' | 'human' | 'closed') {
  const [row] = await tx
    .update(conversations)
    .set({ mode })
    .where(eq(conversations.id, conversationId))
    .returning({ id: conversations.id })
  if (!row) throw new DomainError('Conversation not found', 'not_found')
}

export async function setConversationFlag(tx: Tx, conversationId: string, flagged: boolean) {
  await tx.update(conversations).set({ flagged }).where(eq(conversations.id, conversationId))
}

export async function markConversationRead(tx: Tx, conversationId: string, now = new Date()) {
  await tx.update(conversations).set({ readAt: now }).where(eq(conversations.id, conversationId))
}

/** Shown on a message while it is being sent; it stays (with Retry) only if the send never finished. */
export const SENDING_NOTE = 'Sending… if this stays, check Instagram before retrying.'

/**
 * Claims an AI draft for sending: locks it and turns it into an outbound message, so a second approval (another
 * staff member, a retried request) finds nothing to send. Null when already handled; DomainError when a DM is too long.
 */
export async function claimDraft(tx: Tx, messageId: string, text: string) {
  const [draft] = await tx
    .select()
    .from(conversationMessages)
    .where(and(eq(conversationMessages.id, messageId), eq(conversationMessages.sender, 'ai_draft')))
    .for('update', { skipLocked: true })
  if (!draft) return null
  const [conv] = await tx
    .select({ channel: conversations.channel })
    .from(conversations)
    .where(eq(conversations.id, draft.conversationId))
  const tooLong = conv?.channel === 'instagram_dm' ? dmTooLong(text.trim()) : null
  if (tooLong) throw new DomainError(tooLong)
  const edited = draft.text.trim() !== text.trim()
  const sender: 'bot' | 'staff' = edited ? 'staff' : 'bot'
  await tx
    .update(conversationMessages)
    .set({ sender, error: SENDING_NOTE })
    .where(eq(conversationMessages.id, draft.id))
  return { messageId: draft.id, conversationId: draft.conversationId, sender, edited }
}

export async function discardDraft(tx: Tx, messageId: string) {
  const rows = await tx
    .delete(conversationMessages)
    .where(and(eq(conversationMessages.id, messageId), eq(conversationMessages.sender, 'ai_draft')))
    .returning({ id: conversationMessages.id })
  return rows.length > 0
}

/** Links the thread to a client: by UAE mobile when given, else an existing client with that exact name, else a new one. */
export async function linkConversationClient(
  tx: Tx,
  tenantId: string,
  conversationId: string,
  input: { name: string; phone?: string | null },
) {
  const name = input.name.trim()
  if (!name) throw new DomainError('Enter a name')
  let clientId: string
  if (input.phone?.trim()) {
    clientId = (await findOrCreateClient(tx, tenantId, { name, phone: input.phone, source: 'instagram' })).id
  } else {
    const [existing] = await tx
      .select({ id: clients.id })
      .from(clients)
      .where(sql`lower(${clients.name}) = lower(${name})`)
      .orderBy(desc(clients.createdAt))
      .limit(1)
    clientId =
      existing?.id ??
      (
        await tx.insert(clients).values({ tenantId, name, source: 'instagram' }).returning({ id: clients.id })
      )[0]!.id
  }
  await tx.update(conversations).set({ clientId }).where(eq(conversations.id, conversationId))
  return clientId
}

// ── Publishing ──────────────────────────────────────────────────────────────

/** Instagram fetches the image itself, so it must be a public https URL (relative URLs resolve against APP_URL). */
export function publicImageUrl(url: string | undefined, origin = appOrigin()) {
  if (!url) return null
  try {
    const u = new URL(url, origin)
    return u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export type PublishResult = { ok: true; externalId: string } | { ok: false; error: string }

/** Marks a post while Instagram is publishing it (status stays `failed` so the job never picks it up twice). */
export const PUBLISHING_NOTE = 'Publishing to Instagram… if this stays, check Instagram before trying again.'
const PUBLISH_CLAIM_MS = 3 * 60_000

/** True while another request is publishing this post (claimed less than 3 minutes ago). */
export const isPublishing = (
  p: { status: string; error: string | null; publishedAt: Date | null },
  now = new Date(),
) =>
  p.status === 'failed' &&
  p.error === PUBLISHING_NOTE &&
  Boolean(p.publishedAt && now.getTime() - p.publishedAt.getTime() < PUBLISH_CLAIM_MS)

/**
 * Publishes one post (image + caption) to the connected account in three steps, so no transaction is held during the
 * Graph calls: (1) a short transaction checks the post and claims it, (2) Instagram creates and publishes the media,
 * (3) a second short transaction records the outcome. A claimed post is skipped by the 5-minute job and by a second
 * click; if step 3 never happens the post shows "check Instagram" instead of being published again automatically.
 * API failures mark the post `failed` with the reason. `recordBlockers` also marks posts failed for setup problems
 * (used by the job so it doesn't retry forever).
 */
export async function publishInstagramPost(
  tenantId: string,
  postId: string,
  o: SocialOpts & { recordBlockers?: boolean } = {},
): Promise<PublishResult> {
  const now = nowOf(o)
  const sleep = o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  const claim = await withTenant(
    tenantId,
    async (tx) => {
      const [post] = await tx.select().from(socialPosts).where(eq(socialPosts.id, postId)).for('update')
      if (!post) return { ok: false as const, error: 'Post not found.' }
      if (post.status === 'published') return { ok: false as const, error: 'This post is already published.' }
      if (isPublishing(post, now))
        return { ok: false as const, error: 'This post is being published right now.' }
      const fail = async (error: string, record: boolean) => {
        if (record)
          await tx
            .update(socialPosts)
            .set({ status: 'failed', error, publishedAt: null })
            .where(eq(socialPosts.id, post.id))
        return { ok: false as const, error }
      }
      if (post.platform !== 'instagram') return fail('Only Instagram posts can be published here.', false)
      const account = await getInstagramAccount(tx)
      const token = tokenOf(account)
      if (!metaConfig(o.env))
        return fail("Instagram isn't set up on this server yet — copy the caption instead.", false)
      if (!account || !token) return fail("Instagram isn't connected — connect it in Settings first.", false)
      if (post.status !== 'scheduled' && post.status !== 'failed')
        return fail('Approve the post before publishing it.', false)
      const image = post.media[0]?.url
      const imageUrl = publicImageUrl(image)
      if (!image) return fail('Instagram posts need an image — add one first.', Boolean(o.recordBlockers))
      if (!imageUrl)
        return fail(
          'The image is not on a public https link, so Instagram cannot fetch it. Save it to the media library on the live site and try again.',
          Boolean(o.recordBlockers),
        )
      await tx
        .update(socialPosts)
        .set({ status: 'failed', error: PUBLISHING_NOTE, publishedAt: now })
        .where(eq(socialPosts.id, post.id))
      return { ok: true as const, post, account, token, imageUrl }
    },
    appOf(o),
  )
  if (!claim.ok) return claim

  const { post, account, token, imageUrl } = claim
  const client = instagramClient(o.fetch)
  let result: PublishResult
  let expired = false
  try {
    const container = await client.createMediaContainer({
      igUserId: account.externalId,
      imageUrl,
      caption: post.caption.slice(0, 2200),
      accessToken: token,
    })
    for (let i = 0; i < 8; i++) {
      const status = await client.containerStatus(container.id, token)
      if (status === 'FINISHED' || status === 'PUBLISHED') break
      if (status === 'ERROR' || status === 'EXPIRED')
        throw new MetaApiError(422, 'Instagram could not process the image (use a JPEG under 8 MB).')
      await sleep(1500)
    }
    const published = await client.publishMedia({
      igUserId: account.externalId,
      creationId: container.id,
      accessToken: token,
    })
    result = { ok: true, externalId: published.id }
  } catch (e) {
    expired = e instanceof MetaApiError && e.code === 190
    result = {
      ok: false,
      error: e instanceof MetaApiError ? `Instagram said: ${e.message}` : 'Publishing failed — try again.',
    }
  }

  await withTenant(
    tenantId,
    async (tx) => {
      if (expired)
        await tx.update(socialAccounts).set({ status: 'expired' }).where(eq(socialAccounts.id, account.id))
      await tx
        .update(socialPosts)
        .set(
          result.ok
            ? { status: 'published', publishedAt: nowOf(o), externalId: result.externalId, error: null }
            : { status: 'failed', error: result.error, publishedAt: null },
        )
        .where(eq(socialPosts.id, post.id))
    },
    appOf(o),
  )
  return result
}

/** Job (every 5 min): publish approved posts whose scheduled time has come, for spas with Instagram connected. */
export async function publishDueInstagramPosts(o: SocialOpts = {}) {
  const result = { attempted: 0, published: 0, failed: 0 }
  if (!metaConfig(o.env)) return result
  const connected = platformOf(o)
    .select({ tenantId: socialAccounts.tenantId })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.platform, 'instagram'),
        eq(socialAccounts.status, 'connected'),
        inArray(socialAccounts.tenantId, liveTenantIds(o)),
      ),
    )
  const due = await platformOf(o)
    .select({ id: socialPosts.id, tenantId: socialPosts.tenantId })
    .from(socialPosts)
    .where(
      and(
        eq(socialPosts.platform, 'instagram'),
        eq(socialPosts.status, 'scheduled'),
        lte(socialPosts.scheduledAt, nowOf(o)),
        inArray(socialPosts.tenantId, connected),
      ),
    )
    .orderBy(asc(socialPosts.scheduledAt))
    .limit(25)
  for (const p of due) {
    result.attempted++
    const r = await publishInstagramPost(p.tenantId, p.id, { ...o, recordBlockers: true })
    if (r.ok) result.published++
    else result.failed++
  }
  return result
}

const DAY = 86_400_000

/**
 * Job (daily): refresh long-lived tokens older than 7 days; mark expired ones so the card asks to reconnect.
 * Read-only spas keep their connection alive (no AI or publishing happens for them); suspended / cancelled ones don't.
 */
export async function refreshInstagramTokens(o: SocialOpts = {}) {
  const result = { refreshed: 0, expired: 0, failed: 0 }
  if (!metaConfig(o.env)) return result
  const now = nowOf(o)
  const accounts = await platformOf(o)
    .select({ id: socialAccounts.id, tenantId: socialAccounts.tenantId })
    .from(socialAccounts)
    .innerJoin(tenants, eq(tenants.id, socialAccounts.tenantId))
    .where(
      and(
        eq(socialAccounts.platform, 'instagram'),
        eq(socialAccounts.status, 'connected'),
        inArray(tenants.status, [...LIVE_STATUSES, 'read_only']),
      ),
    )
  const client = instagramClient(o.fetch)
  for (const a of accounts) {
    const row = await withTenant(
      a.tenantId,
      async (tx) => (await tx.select().from(socialAccounts).where(eq(socialAccounts.id, a.id)))[0],
      appOf(o),
    )
    const token = tokenOf(row ?? null)
    if (!row || !token) continue
    const markExpired = () =>
      withTenant(
        a.tenantId,
        (tx) => tx.update(socialAccounts).set({ status: 'expired' }).where(eq(socialAccounts.id, a.id)),
        appOf(o),
      )
    if (row.tokenExpiresAt && row.tokenExpiresAt <= now) {
      await markExpired()
      result.expired++
      continue
    }
    const issued = row.meta.tokenIssuedAt
      ? new Date(row.meta.tokenIssuedAt)
      : row.tokenExpiresAt
        ? new Date(row.tokenExpiresAt.getTime() - 60 * DAY)
        : new Date(0)
    if (now.getTime() - issued.getTime() < 7 * DAY) continue
    try {
      const next = await client.refreshToken(token)
      await withTenant(
        a.tenantId,
        (tx) =>
          tx
            .update(socialAccounts)
            .set({
              tokenEnc: encryptSecret(next.accessToken),
              tokenExpiresAt: new Date(now.getTime() + next.expiresIn * 1000),
              meta: { ...row.meta, tokenIssuedAt: now.toISOString() },
            })
            .where(eq(socialAccounts.id, a.id)),
        appOf(o),
      )
      result.refreshed++
    } catch (e) {
      if (e instanceof MetaApiError && e.code === 190) {
        await markExpired()
        result.expired++
      } else result.failed++
    }
  }
  return result
}

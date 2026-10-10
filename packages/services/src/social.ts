// Instagram: connected account, DM/comment inbox, replies, publishing and token upkeep.
// Platform lookups (webhook → tenant by IG account id, cross-tenant jobs) use platformDb; every tenant write runs in withTenant.
import {
  appDb,
  bookings,
  clients,
  conversationMessages,
  conversations,
  type Db,
  instagramReplyQueue,
  platformDb,
  socialAccounts,
  socialPosts,
  type Tx,
  tenants,
  withTenant,
} from '@spa/db'
import { and, asc, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm'
import { automationOnSql } from './automations'
import { findOrCreateClient } from './clients'
import { entitledSql } from './entitlements'
import { DomainError } from './errors'
import {
  appOrigin,
  type ContainerParams,
  clipBytes,
  dmTooLong,
  dmWindowOpen,
  type InstagramEvent,
  type InstagramHost,
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

/**
 * Where Instagram calls go out from: the Instagram Login connection, else a connected Facebook Page (F19) with a
 * linked Instagram professional account — the same account, reached on graph.facebook.com with the Page token.
 */
export type InstagramSender = {
  via: InstagramHost
  row: SocialAccount
  igUserId: string
  token: string
}

export async function getInstagramSender(tx: Tx): Promise<InstagramSender | null> {
  const ig = await getInstagramAccount(tx)
  const igToken = tokenOf(ig)
  if (ig && igToken) return { via: 'instagram', row: ig, igUserId: ig.externalId, token: igToken }
  const [fb] = await tx
    .select()
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.platform, 'facebook'),
        eq(socialAccounts.status, 'connected'),
        sql`${socialAccounts.meta} ->> 'igUserId' is not null`,
      ),
    )
    .orderBy(desc(socialAccounts.updatedAt))
    .limit(1)
  const fbToken = tokenOf(fb ?? null)
  if (fb && fbToken && fb.meta.igUserId)
    return { via: 'facebook', row: fb, igUserId: fb.meta.igUserId, token: fbToken }
  return null
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
        eq(socialAccounts.status, 'connected'),
        sql`((${socialAccounts.platform} = 'instagram' and ${socialAccounts.externalId} = ${igUserId})
          or (${socialAccounts.platform} = 'facebook' and ${socialAccounts.meta} ->> 'igUserId' = ${igUserId}))`,
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
  // Facebook Login (F19) callbacks send the app-scoped Facebook user id stored on the Page row.
  const matches = sql`((${socialAccounts.platform} = 'instagram' and (${socialAccounts.externalId} = ${igUserId}
      or ${socialAccounts.meta}->>'appUserId' = ${igUserId}))
    or (${socialAccounts.platform} = 'facebook' and ${socialAccounts.meta}->>'fbUserId' = ${igUserId}))`
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
      const item = await withTenant(
        tenantId,
        async (tx) => {
          const stored = await storeInbound(tx, tenantId, ev)
          // Same transaction as the message: the worker's instagram-reply job picks it up (never lost on a restart).
          if (stored && live)
            await tx
              .insert(instagramReplyQueue)
              .values({ tenantId, messageId: stored.messageId })
              .onConflictDoNothing()
          return stored
        },
        appOf(o),
      )
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
/** instagram-reply backoff: 30 s, 1 min, 2 min … capped at 30 min; after 5 failed tries the row is marked failed. */
export const INSTAGRAM_REPLY_RETRY = { retryLimit: 5, retryDelay: 30, retryDelayMax: 1800 } as const
/** A claimed row is leased this long (a crashed worker's rows come back after it). */
const REPLY_LEASE_MS = 5 * 60_000

/**
 * Tenants with due instagram-reply rows (cross-tenant discovery for the worker; platform role). `ai: false` = the
 * spa's plan has no AI (PLAN §18.8): the worker drops its rows unanswered (the messages stay for staff).
 */
export async function tenantsWithDueReplies(now = new Date(), o: SocialOpts = {}) {
  const rows = await (o.platform ?? platformDb())
    .selectDistinct({ tenantId: instagramReplyQueue.tenantId, ai: sql<boolean>`${entitledSql('ai')}` })
    .from(instagramReplyQueue)
    .innerJoin(tenants, eq(tenants.id, instagramReplyQueue.tenantId))
    .where(and(isNull(instagramReplyQueue.failedAt), lte(instagramReplyQueue.nextAt, now)))
  return rows.map((r) => ({ tenantId: r.tenantId, ai: Boolean(r.ai) }))
}

/** Claims up to `limit` due rows for one spa (lease via next_at, SKIP LOCKED) and returns them as agent items. */
export async function claimDueReplies(tenantId: string, now = new Date(), limit = 20, o: SocialOpts = {}) {
  return withTenant(
    tenantId,
    async (tx) => {
      const due = await tx
        .select({ messageId: instagramReplyQueue.messageId })
        .from(instagramReplyQueue)
        .where(and(isNull(instagramReplyQueue.failedAt), lte(instagramReplyQueue.nextAt, now)))
        .orderBy(asc(instagramReplyQueue.createdAt))
        .limit(limit)
        .for('update', { skipLocked: true })
      if (!due.length) return []
      const ids = due.map((d) => d.messageId)
      await tx
        .update(instagramReplyQueue)
        .set({ nextAt: new Date(now.getTime() + REPLY_LEASE_MS) })
        .where(inArray(instagramReplyQueue.messageId, ids))
      const rows = await tx
        .select({
          messageId: conversationMessages.id,
          conversationId: conversationMessages.conversationId,
          channel: conversations.channel,
          text: conversationMessages.text,
          attempts: instagramReplyQueue.attempts,
        })
        .from(instagramReplyQueue)
        .innerJoin(conversationMessages, eq(conversationMessages.id, instagramReplyQueue.messageId))
        .innerJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
        .where(inArray(instagramReplyQueue.messageId, ids))
      return rows.map((r) => ({
        item: {
          tenantId,
          conversationId: r.conversationId,
          messageId: r.messageId,
          channel: r.channel as Channel,
          text: r.text,
        } satisfies InboundItem,
        attempts: r.attempts,
      }))
    },
    appOf(o),
  )
}

/** Done (answered, drafted or nothing to do): the row goes. */
export async function finishReply(item: Pick<InboundItem, 'tenantId' | 'messageId'>, o: SocialOpts = {}) {
  await withTenant(
    item.tenantId,
    (tx) => tx.delete(instagramReplyQueue).where(eq(instagramReplyQueue.messageId, item.messageId)),
    appOf(o),
  )
}

/** A failed try: exponential backoff, or marked failed after the last retry (stays unread for staff). */
export async function failReply(
  item: Pick<InboundItem, 'tenantId' | 'messageId'>,
  attempts: number,
  error: string,
  now = new Date(),
  o: SocialOpts = {},
) {
  const n = attempts + 1
  const { retryLimit, retryDelay, retryDelayMax } = INSTAGRAM_REPLY_RETRY
  const delay = Math.min(retryDelay * 2 ** (n - 1), retryDelayMax) * 1000
  await withTenant(
    item.tenantId,
    (tx) =>
      tx
        .update(instagramReplyQueue)
        .set({
          attempts: n,
          lastError: error.slice(0, 200),
          nextAt: new Date(now.getTime() + delay),
          failedAt: n >= retryLimit ? now : null,
        })
        .where(eq(instagramReplyQueue.messageId, item.messageId)),
    appOf(o),
  )
  return { attempts: n, failed: n >= retryLimit }
}

/**
 * True when the thread already has a spa-side message (bot, staff or AI draft) at or after this inbound message —
 * the instagram-reply job's idempotency check, so a retried or duplicated job never answers twice.
 */
export async function inboundAnswered(item: InboundItem, o: SocialOpts = {}) {
  return withTenant(
    item.tenantId,
    async (tx) => {
      const [msg] = await tx
        .select({ createdAt: conversationMessages.createdAt })
        .from(conversationMessages)
        .where(eq(conversationMessages.id, item.messageId))
      if (!msg) return true
      const [later] = await tx
        .select({ id: conversationMessages.id })
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, item.conversationId),
            ne(conversationMessages.sender, 'customer'),
            gte(conversationMessages.createdAt, msg.createdAt),
          ),
        )
        .limit(1)
      return Boolean(later)
    },
    appOf(o),
  )
}

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
      return { conv, sender: await getInstagramSender(tx) }
    },
    appOf(o),
  )
  const sender = state.sender
  if (!state.conv || state.conv.participant || state.conv.channel !== 'instagram_dm' || !sender) return
  try {
    const p = await instagramClient(o.fetch, sender.via).userProfile(
      state.conv.externalThreadId,
      sender.token,
    )
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
      return { conv, ig: await getInstagramSender(tx) }
    },
    appOf(opts),
  )
  const { conv, ig } = state
  const account = ig?.row ?? null
  const isDm = conv.channel === 'instagram_dm'
  // Staff text is never cut silently (the actions check it first); AI text is already byte-limited, clip as a backstop.
  const tooLong = isDm && opts.sender === 'staff' ? dmTooLong(text.trim()) : null
  if (tooLong) throw new DomainError(tooLong)
  const body = isDm ? clipBytes(text.trim()) : text.trim().slice(0, 2000)
  if (!body) throw new DomainError('Write a message first')
  const token = ig?.token ?? null
  let error = replyBlocker(
    { channel: conv.channel, lastCustomerMsgAt: conv.lastCustomerMsgAt, account, token },
    now,
    opts.env,
  )
  let externalId: string | null = null
  let expired = false
  if (!error && ig && token) {
    try {
      const client = instagramClient(opts.fetch, ig.via)
      externalId = isDm
        ? ((
            await client.sendMessage({
              igUserId: ig.igUserId,
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

// ── Private replies (F18: one DM answer per comment, within 7 days) ────────

export const PRIVATE_REPLY_WINDOW_MS = 7 * 86_400_000
/** Shown on a private reply while it is being sent; a send that never finished frees the slot after 3 minutes. */
const PRIVATE_SENDING_MS = 3 * 60_000

export type PrivateReplyState =
  | { status: 'available'; until: Date }
  | { status: 'sent'; at: Date; text: string }
  | { status: 'sending' }
  | { status: 'expired' }
  | { status: 'not_comment' }

type MsgLike = { kind: string; direction: string; error: string | null; createdAt: Date; text: string }

/** Whether the comment thread can still get its one private reply (pure; `messages` = the thread's messages). */
export function privateReplyState(
  conv: { channel: string; createdAt: Date },
  messages: MsgLike[],
  now = new Date(),
): PrivateReplyState {
  if (conv.channel !== 'instagram_comment') return { status: 'not_comment' }
  const mine = messages.filter((m) => m.kind === 'private_reply' && m.direction === 'out')
  const sent = mine.find((m) => !m.error)
  if (sent) return { status: 'sent', at: sent.createdAt, text: sent.text }
  if (
    mine.some((m) => m.error === SENDING_NOTE && now.getTime() - m.createdAt.getTime() < PRIVATE_SENDING_MS)
  )
    return { status: 'sending' }
  const commentAt =
    messages
      .filter((m) => m.direction === 'in')
      .map((m) => m.createdAt)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? conv.createdAt
  const until = new Date(commentAt.getTime() + PRIVATE_REPLY_WINDOW_MS)
  return now < until ? { status: 'available', until } : { status: 'expired' }
}

export type PrivateReplyResult = { ok: true; messageId: string } | { ok: false; error: string }

/**
 * Sends the comment's private reply (Instagram Private Replies API) and keeps it in the comment thread as
 * `kind = private_reply`. Claimed first (a `SENDING_NOTE` row under a row lock on the thread), so two staff members
 * can't both send one; a failed send removes the claim and returns the reason (nothing is stored), so the text stays in
 * the composer. Throws DomainError for rule problems (not a comment, already sent, 7 days passed, too long).
 */
export async function sendPrivateReply(
  tenantId: string,
  conversationId: string,
  text: string,
  o: SocialOpts = {},
): Promise<PrivateReplyResult> {
  const now = nowOf(o)
  const body = text.trim()
  if (!body) throw new DomainError('Write a message first')
  const tooLong = dmTooLong(body)
  if (tooLong) throw new DomainError(tooLong)
  const claim = await withTenant(
    tenantId,
    async (tx) => {
      const [conv] = await tx
        .select()
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .for('update')
      if (!conv) throw new DomainError('Conversation not found', 'not_found')
      const msgs = await tx
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversationId))
      const state = privateReplyState(conv, msgs, now)
      if (state.status === 'not_comment') throw new DomainError('Private replies are only for comments.')
      if (state.status === 'sent' || state.status === 'sending')
        throw new DomainError('A private reply was already sent for this comment.')
      if (state.status === 'expired')
        throw new DomainError('Instagram only allows a private reply within 7 days of the comment.')
      const sender = await getInstagramSender(tx)
      if (!metaConfig(o.env))
        return { ok: false as const, error: "Instagram isn't set up on this server yet." }
      if (!sender)
        return { ok: false as const, error: "Instagram isn't connected — connect it in Settings first." }
      if (sender.row.tokenExpiresAt && sender.row.tokenExpiresAt <= now)
        return { ok: false as const, error: 'The Instagram connection expired — reconnect it in Settings.' }
      // A stale claim from a send that never finished is dropped (Instagram rejects a second private reply anyway).
      await tx
        .delete(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, conversationId),
            eq(conversationMessages.kind, 'private_reply'),
            ne(sql`coalesce(${conversationMessages.error}, '')`, ''),
          ),
        )
      const [row] = await tx
        .insert(conversationMessages)
        .values({
          tenantId,
          conversationId,
          direction: 'out',
          sender: 'staff',
          kind: 'private_reply',
          text: body,
          error: SENDING_NOTE,
          createdAt: now,
        })
        .returning({ id: conversationMessages.id })
      if (conv.mode === 'bot')
        await tx.update(conversations).set({ mode: 'human' }).where(eq(conversations.id, conversationId))
      return { ok: true as const, messageId: row!.id, sender, commentId: conv.externalThreadId }
    },
    appOf(o),
  )
  if (!claim.ok) return claim
  const { sender, messageId, commentId } = claim
  let externalId: string | null = null
  let error: string | null = null
  let expired = false
  try {
    externalId =
      (
        await instagramClient(o.fetch, sender.via).sendPrivateReply({
          igUserId: sender.igUserId,
          commentId,
          text: body,
          accessToken: sender.token,
        })
      ).messageId ?? null
  } catch (e) {
    error = e instanceof MetaApiError ? `Instagram said: ${e.message}` : 'Something went wrong while sending.'
    expired = e instanceof MetaApiError && e.code === 190
  }
  await withTenant(
    tenantId,
    async (tx) => {
      if (expired)
        await tx.update(socialAccounts).set({ status: 'expired' }).where(eq(socialAccounts.id, sender.row.id))
      if (error) await tx.delete(conversationMessages).where(eq(conversationMessages.id, messageId))
      else {
        await tx
          .update(conversationMessages)
          .set({ error: null, externalId })
          .where(eq(conversationMessages.id, messageId))
        await tx.update(conversations).set({ updatedAt: now }).where(eq(conversations.id, conversationId))
      }
    },
    appOf(o),
  )
  return error ? { ok: false, error } : { ok: true, messageId }
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

export type PublishResult =
  | { ok: true; externalId: string }
  | { ok: false; error: string; processing?: boolean }

/** Marks a post while Instagram is publishing it (status stays `failed` so the job never picks it up twice). */
export const PUBLISHING_NOTE = 'Publishing to Instagram… if this stays, check Instagram before trying again.'
/** A video (reel, story, carousel with videos) Instagram is still processing: the 5-minute job finishes it. */
export const PROCESSING_NOTE =
  'Instagram is still processing the video — it is published automatically within a few minutes.'
const PUBLISH_CLAIM_MS = 3 * 60_000
/** Containers expire after 24 h; one older than this is recreated (and a video still processing after 1 h fails). */
const CONTAINER_TTL_MS = 23 * 3600_000
const PROCESSING_LIMIT_MS = 3600_000

/** True while another request is publishing this post (claimed less than 3 minutes ago). */
export const isPublishing = (
  p: { status: string; error: string | null; publishedAt: Date | null },
  now = new Date(),
) =>
  p.status === 'failed' &&
  p.error === PUBLISHING_NOTE &&
  Boolean(p.publishedAt && now.getTime() - p.publishedAt.getTime() < PUBLISH_CLAIM_MS)

/** True while Instagram processes the post's video (it goes out with the next 5-minute run). */
export const isProcessing = (p: { status: string; error: string | null }) =>
  p.status === 'scheduled' && p.error === PROCESSING_NOTE

// ── Post formats (F18): feed image, reel, story, carousel ───────────────────

export const IG_POST_TYPES = ['feed', 'reel', 'story', 'carousel'] as const
export type IgPostType = (typeof IG_POST_TYPES)[number]
export const isIgPostType = (v: unknown): v is IgPostType =>
  typeof v === 'string' && (IG_POST_TYPES as readonly string[]).includes(v)
export const CAROUSEL_MIN = 2
export const CAROUSEL_MAX = 10

export type PostMedia = { url: string; alt?: string; type?: 'image' | 'video' }
/** Image or video: the stored type, else guessed from the file extension. */
export const mediaKind = (m: PostMedia): 'image' | 'video' =>
  m.type ?? (/\.(mp4|mov|m4v)(?:[?#]|$)/i.test(m.url) ? 'video' : 'image')

/** Why a post can't be published in its format (null = ready); the dashboard translates the code. */
export type PublishProblem =
  | 'no_media'
  | 'not_https'
  | 'needs_image'
  | 'needs_video'
  | 'carousel_count'
  | 'unknown_type'

export const PUBLISH_PROBLEM_TEXT: Record<PublishProblem, string> = {
  no_media: 'Instagram posts need an image — add one first.',
  not_https:
    'The image is not on a public https link, so Instagram cannot fetch it. Save it to the media library on the live site and try again.',
  needs_image: 'Feed posts need an image — choose Reel to post a video.',
  needs_video: 'Reels need a video (an .mp4 on a public https link).',
  carousel_count: `Carousels need ${CAROUSEL_MIN}–${CAROUSEL_MAX} images or videos.`,
  unknown_type: 'This post type cannot be published to Instagram.',
}

export type PublishPlan = { children: ContainerParams[]; main: ContainerParams; video: boolean }

/**
 * The containers a post needs (Content Publishing API): feed = one image; REELS = one video (shared to the feed,
 * optional image cover); STORIES = one image or video (no caption); CAROUSEL = 2–10 items (`is_carousel_item`,
 * videos as media_type VIDEO) + the parent with `children`.
 */
export function instagramPublishPlan(
  post: { type: string; caption: string; media: PostMedia[] },
  origin = appOrigin(),
): { ok: true; plan: PublishPlan } | { ok: false; problem: PublishProblem } {
  const type = post.type === 'gbp_post' ? 'feed' : post.type || 'feed'
  if (!isIgPostType(type)) return { ok: false, problem: 'unknown_type' }
  const media = post.media.filter((m) => m?.url)
  if (!media.length) return { ok: false, problem: type === 'reel' ? 'needs_video' : 'no_media' }
  const items = media.map((m) => ({ kind: mediaKind(m), url: publicImageUrl(m.url, origin) }))
  const caption = post.caption.slice(0, 2200)
  const first = items[0]!
  if (type === 'carousel') {
    if (items.length < CAROUSEL_MIN || items.length > CAROUSEL_MAX)
      return { ok: false, problem: 'carousel_count' }
    if (items.some((i) => !i.url)) return { ok: false, problem: 'not_https' }
    return {
      ok: true,
      plan: {
        children: items.map(
          (i): ContainerParams =>
            i.kind === 'video'
              ? { media_type: 'VIDEO', video_url: i.url!, is_carousel_item: true }
              : { image_url: i.url!, is_carousel_item: true },
        ),
        main: { media_type: 'CAROUSEL', caption },
        video: items.some((i) => i.kind === 'video'),
      },
    }
  }
  if (!first.url) return { ok: false, problem: 'not_https' }
  if (type === 'reel') {
    if (first.kind !== 'video') return { ok: false, problem: 'needs_video' }
    const cover = items[1]?.kind === 'image' ? items[1].url : null
    return {
      ok: true,
      plan: {
        children: [],
        main: {
          media_type: 'REELS',
          video_url: first.url,
          caption,
          share_to_feed: true,
          ...(cover ? { cover_url: cover } : {}),
        },
        video: true,
      },
    }
  }
  if (type === 'story')
    return {
      ok: true,
      plan: {
        children: [],
        main:
          first.kind === 'video'
            ? { media_type: 'STORIES', video_url: first.url }
            : { media_type: 'STORIES', image_url: first.url },
        video: first.kind === 'video',
      },
    }
  if (first.kind !== 'image') return { ok: false, problem: 'needs_image' }
  return { ok: true, plan: { children: [], main: { image_url: first.url, caption }, video: false } }
}

/** Container progress kept on the post between runs while Instagram processes a video. */
type ContainerMeta = { containerId?: string; childIds?: string; containerAt?: string }

class StillProcessing extends Error {
  constructor(readonly state: ContainerMeta) {
    super('processing')
  }
}

/**
 * Publishes one post (feed image, reel, story or carousel) to the connected account in three steps, so no
 * transaction is held during the Graph calls: (1) a short transaction checks the post and claims it, (2) Instagram
 * creates the container(s), each polled until FINISHED, then media_publish, (3) a second short transaction records the
 * outcome. A video Instagram is still processing after the poll budget is parked (`PROCESSING_NOTE`, container ids
 * in `social_posts.meta`) and the 5-minute job resumes it with the same containers. A claimed post is skipped by the
 * job and by a second click; if step 3 never happens the post shows "check Instagram" instead of being published
 * again automatically. API failures mark the post `failed` with the reason. `recordBlockers` also marks posts failed
 * for setup problems (used by the job so it doesn't retry forever).
 */
export async function publishInstagramPost(
  tenantId: string,
  postId: string,
  o: SocialOpts & { recordBlockers?: boolean; maxPolls?: number } = {},
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
            .set({ status: 'failed', error, publishedAt: null, meta: {} })
            .where(eq(socialPosts.id, post.id))
        return { ok: false as const, error }
      }
      if (post.platform !== 'instagram') return fail('Only Instagram posts can be published here.', false)
      const sender = await getInstagramSender(tx)
      if (!metaConfig(o.env))
        return fail("Instagram isn't set up on this server yet — copy the caption instead.", false)
      if (!sender) return fail("Instagram isn't connected — connect it in Settings first.", false)
      if (post.status !== 'scheduled' && post.status !== 'failed')
        return fail('Approve the post before publishing it.', false)
      const planned = instagramPublishPlan(post)
      if (!planned.ok) return fail(PUBLISH_PROBLEM_TEXT[planned.problem], Boolean(o.recordBlockers))
      const meta = (post.meta ?? {}) as ContainerMeta
      const at = meta.containerAt ? new Date(meta.containerAt) : null
      const resume = at && now.getTime() - at.getTime() < CONTAINER_TTL_MS ? meta : null
      if (resume && at && now.getTime() - at.getTime() > PROCESSING_LIMIT_MS)
        return fail('Instagram took too long to process the video — try again or use a shorter video.', true)
      await tx
        .update(socialPosts)
        .set({ status: 'failed', error: PUBLISHING_NOTE, publishedAt: now })
        .where(eq(socialPosts.id, post.id))
      return { ok: true as const, post, sender, plan: planned.plan, resume }
    },
    appOf(o),
  )
  if (!claim.ok) return claim

  const { post, sender, plan, resume } = claim
  const client = instagramClient(o.fetch, sender.via)
  const polls = o.maxPolls ?? 8
  const waitMs = plan.video ? 3000 : 1500
  /** Polls one container; true = ready to publish / use, false = still processing after the budget. */
  const ready = async (id: string) => {
    for (let i = 0; i < polls; i++) {
      const status = await client.containerStatus(id, sender.token)
      if (status === 'FINISHED' || status === 'PUBLISHED') return true
      if (status === 'ERROR' || status === 'EXPIRED')
        throw new MetaApiError(
          422,
          plan.video
            ? 'Instagram could not process the video (use an MP4/MOV, H.264, under 15 minutes and 300 MB).'
            : 'Instagram could not process the image (use a JPEG under 8 MB).',
        )
      if (i < polls - 1) await sleep(waitMs)
    }
    return false
  }
  const startedAt = resume?.containerAt ?? now.toISOString()
  let result: PublishResult
  let expired = false
  let parked: ContainerMeta | null = null
  try {
    let containerId = resume?.containerId ?? null
    if (!containerId) {
      let params = plan.main
      if (plan.children.length) {
        const childIds =
          resume?.childIds?.split(',').filter(Boolean) ??
          (await Promise.all(
            plan.children.map(
              async (c) =>
                (
                  await client.createContainer({
                    igUserId: sender.igUserId,
                    params: c,
                    accessToken: sender.token,
                  })
                ).id,
            ),
          ))
        if (plan.video)
          for (const id of childIds)
            if (!(await ready(id)))
              throw new StillProcessing({ childIds: childIds.join(','), containerAt: startedAt })
        params = { ...plan.main, children: childIds.join(',') }
      }
      containerId = (
        await client.createContainer({ igUserId: sender.igUserId, params, accessToken: sender.token })
      ).id
    }
    if (!(await ready(containerId))) throw new StillProcessing({ containerId, containerAt: startedAt })
    const published = await client.publishMedia({
      igUserId: sender.igUserId,
      creationId: containerId,
      accessToken: sender.token,
    })
    result = { ok: true, externalId: published.id }
  } catch (e) {
    if (e instanceof StillProcessing) {
      parked = e.state
      result = { ok: false, error: PROCESSING_NOTE, processing: true }
    } else {
      expired = e instanceof MetaApiError && e.code === 190
      result = {
        ok: false,
        error: e instanceof MetaApiError ? `Instagram said: ${e.message}` : 'Publishing failed — try again.',
      }
    }
  }

  await withTenant(
    tenantId,
    async (tx) => {
      if (expired)
        await tx.update(socialAccounts).set({ status: 'expired' }).where(eq(socialAccounts.id, sender.row.id))
      await tx
        .update(socialPosts)
        .set(
          result.ok
            ? {
                status: 'published',
                publishedAt: nowOf(o),
                externalId: result.externalId,
                error: null,
                meta: {},
              }
            : parked
              ? // Back in the job's queue (due now) with the containers kept; nothing new is created on resume.
                {
                  status: 'scheduled',
                  scheduledAt: now,
                  error: PROCESSING_NOTE,
                  publishedAt: null,
                  meta: parked,
                }
              : { status: 'failed', error: result.error, publishedAt: null, meta: {} },
        )
        .where(eq(socialPosts.id, post.id))
    },
    appOf(o),
  )
  return result
}

/** Job (every 5 min): publish approved posts whose scheduled time has come, for spas with Instagram connected. */
export async function publishDueInstagramPosts(o: SocialOpts = {}) {
  const result = {
    attempted: 0,
    published: 0,
    failed: 0,
    processing: 0,
    byTenant: {} as Record<string, { published: number; failed: number }>,
  }
  if (!metaConfig(o.env)) return result
  // Spas with the Instagram automation switched off (B3) keep their scheduled posts until it is back on.
  const switchedOn = platformOf(o)
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(inArray(tenants.status, [...LIVE_STATUSES]), automationOnSql('instagram')))
  // Instagram Login, or a Facebook Page with a linked Instagram account (F19).
  const connected = platformOf(o)
    .select({ tenantId: socialAccounts.tenantId })
    .from(socialAccounts)
    .where(
      and(
        eq(socialAccounts.status, 'connected'),
        sql`(${socialAccounts.platform} = 'instagram'
          or (${socialAccounts.platform} = 'facebook' and ${socialAccounts.meta} ->> 'igUserId' is not null))`,
        inArray(socialAccounts.tenantId, switchedOn),
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
    const per = result.byTenant[p.tenantId] ?? { published: 0, failed: 0 }
    result.byTenant[p.tenantId] = per
    if (r.ok) {
      result.published++
      per.published++
    } else if (r.processing) {
      result.processing++
    } else {
      result.failed++
      per.failed++
    }
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

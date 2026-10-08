// Phase 2/3 — growth: reviews, segments & campaigns, website analytics rollups, saved sections, social & AI agents.
import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, id, updatedAt } from './_columns'
import { tenantPolicies } from './_rls'
import { user } from './auth'
import { storedFiles } from './files'
import { promoCodes } from './finance'
import { bookings, clients } from './operations'
import { tenants } from './platform'

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' })
const ts = (name: string) => timestamp(name, { withTimezone: true })

// ── Reviews ──────────────────────────────────────────────────────────────────
export const replyStatus = pgEnum('reply_status', ['none', 'draft', 'approved', 'posted', 'failed'])

export const reviews = pgTable(
  'reviews',
  {
    id: id(),
    tenantId: tenantId(),
    source: text('source').notNull().default('google'),
    externalId: text('external_id').notNull(),
    author: text('author'),
    rating: integer('rating').notNull(),
    text: text('text'),
    reviewedAt: ts('reviewed_at'),
    replyText: text('reply_text'),
    replyStatus: replyStatus('reply_status').notNull().default('none'),
    repliedAt: ts('replied_at'),
    /** Why posting the reply to Google failed (set with reply_status `failed`). */
    replyError: text('reply_error'),
    createdAt: createdAt(),
  },
  (t) => [unique('reviews_external').on(t.tenantId, t.source, t.externalId), ...tenantPolicies()],
)

// ── Segments & click-to-send campaigns ───────────────────────────────────────
/** One condition of a client segment; a segment matches clients meeting every rule (AND). */
export type SegmentRule =
  /** Last visit more than `days` ago. */
  | { kind: 'lapsed'; days: number }
  /** Last visit within the last `days`. */
  | { kind: 'visited_within'; days: number }
  | { kind: 'visits_at_least'; count: number }
  | { kind: 'visits_at_most'; count: number }
  /** Total paid sales (AED, VAT-inclusive). */
  | { kind: 'spent_at_least'; aed: number }
  | { kind: 'service'; serviceId: string }
  | { kind: 'birthday_month' }
  | { kind: 'birthday_within'; days: number }
  | { kind: 'gender'; gender: 'female' | 'male' | 'other' }
  | { kind: 'language'; language: 'en' | 'ar' }
  | { kind: 'tag'; tag: string }
  | { kind: 'has_package' }
  | { kind: 'package_expiring'; days: number }
  | { kind: 'no_shows_at_least'; count: number }

/** Audience numbers frozen when a campaign is queued. */
export type CampaignStats = {
  matched?: number
  /** Skipped: already messaged by another campaign within 7 days. */
  skippedRecent?: number
  /** Skipped: beyond the per-campaign recipient limit. */
  skippedOverLimit?: number
  en?: number
  ar?: number
}

export const segments = pgTable(
  'segments',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    rules: jsonb('rules').$type<SegmentRule[]>().notNull(),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const campaignStatus = pgEnum('campaign_status', ['draft', 'queued', 'done'])

export const campaigns = pgTable(
  'campaigns',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    segmentId: uuid('segment_id').references(() => segments.id, { onDelete: 'set null' }),
    body: jsonb('body').$type<{ en: string; ar?: string }>().notNull(),
    status: campaignStatus('status').notNull().default('draft'),
    recipients: integer('recipients').notNull().default(0),
    /** Segment rules as they were when the campaign was saved (the segment may change later). */
    rules: jsonb('rules').$type<SegmentRule[]>(),
    promoCodeId: uuid('promo_code_id').references(() => promoCodes.id, { onDelete: 'set null' }),
    /** When the messages become due in the WhatsApp outbox. */
    scheduledAt: ts('scheduled_at'),
    queuedAt: ts('queued_at'),
    archivedAt: ts('archived_at'),
    stats: jsonb('stats').$type<CampaignStats>().notNull().default({}),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => tenantPolicies(),
)

// ── Website analytics (cookieless, block-level) ──────────────────────────────
/** Raw events, kept 90 days. Partitioned by month in SQL (see migration). */
export const webEvents = pgTable(
  'web_events',
  {
    id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity(),
    tenantId: tenantId(),
    ts: ts('ts').notNull().defaultNow(),
    sessionHash: text('session_hash').notNull(),
    type: text('type').notNull(),
    path: text('path').notNull(),
    blockId: text('block_id'),
    blockType: text('block_type'),
    element: text('element'),
    referrer: text('referrer'),
    source: text('source'),
    utm: jsonb('utm').$type<Record<string, string>>(),
    device: text('device'),
    country: text('country'),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.ts] }),
    index('web_events_tenant_ts').on(t.tenantId, t.ts),
    ...tenantPolicies(),
  ],
)

export const webDailyStats = pgTable(
  'web_daily_stats',
  {
    tenantId: tenantId(),
    day: date('day').notNull(),
    /** page | block | source | funnel */
    dimension: text('dimension').notNull(),
    key: text('key').notNull(),
    views: integer('views').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    sessions: integer('sessions').notNull().default(0),
    conversions: integer('conversions').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.day, t.dimension, t.key] }), ...tenantPolicies()],
)

export const savedSections = pgTable(
  'saved_sections',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    isGlobal: boolean('is_global').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => tenantPolicies(),
)

// ── Social accounts, posts, conversations, AI agents (Phase 3) ───────────────
export const socialPlatform = pgEnum('social_platform', ['instagram', 'gbp', 'facebook'])

export const socialAccounts = pgTable(
  'social_accounts',
  {
    id: id(),
    tenantId: tenantId(),
    platform: socialPlatform('platform').notNull(),
    externalId: text('external_id').notNull(),
    username: text('username'),
    /** AES-GCM encrypted access token. */
    tokenEnc: text('token_enc'),
    tokenExpiresAt: ts('token_expires_at'),
    /** AES-GCM encrypted refresh token (Google). */
    refreshTokenEnc: text('refresh_token_enc'),
    /** Provider ids, e.g. { pageId, igUserId } or { accountName, locationName, locationTitle }. */
    meta: jsonb('meta').$type<Record<string, string>>().notNull().default({}),
    scopes: text('scopes').array().notNull().default([]),
    status: text('status').notNull().default('connected'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('social_accounts_unique').on(t.tenantId, t.platform, t.externalId), ...tenantPolicies()],
)

export const postStatus = pgEnum('post_status', [
  'draft',
  'pending_approval',
  'scheduled',
  'published',
  'failed',
])

export const socialPosts = pgTable(
  'social_posts',
  {
    id: id(),
    tenantId: tenantId(),
    platform: socialPlatform('platform').notNull(),
    type: text('type').notNull().default('feed'),
    caption: text('caption').notNull(),
    media: jsonb('media').$type<{ url: string; alt?: string }[]>().notNull().default([]),
    status: postStatus('status').notNull().default('draft'),
    scheduledAt: ts('scheduled_at'),
    publishedAt: ts('published_at'),
    externalId: text('external_id'),
    error: text('error'),
    aiRunId: uuid('ai_run_id'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index('social_posts_schedule').on(t.status, t.scheduledAt), ...tenantPolicies()],
)

export const conversationMode = pgEnum('conversation_mode', ['bot', 'human', 'closed'])

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    tenantId: tenantId(),
    channel: text('channel').notNull(),
    externalThreadId: text('external_thread_id').notNull(),
    participant: text('participant'),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    mode: conversationMode('mode').notNull().default('bot'),
    lastCustomerMsgAt: ts('last_customer_msg_at'),
    flagged: boolean('flagged').notNull().default(false),
    assignedTo: text('assigned_to').references(() => user.id),
    /** Last time staff opened the thread (unread = customer message after this). */
    readAt: ts('read_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('conversations_thread').on(t.tenantId, t.channel, t.externalThreadId), ...tenantPolicies()],
)

export const conversationMessages = pgTable(
  'conversation_messages',
  {
    id: id(),
    tenantId: tenantId(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    direction: text('direction', { enum: ['in', 'out'] }).notNull(),
    /** `ai_draft`: an AI reply waiting for staff approval (never sent until approved). */
    sender: text('sender', { enum: ['customer', 'bot', 'staff', 'ai_draft'] }).notNull(),
    text: text('text').notNull(),
    externalId: text('external_id'),
    /** Why an outbound message was not delivered (null = delivered / inbound). */
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('conversation_messages_conv').on(t.conversationId, t.createdAt),
    uniqueIndex('conversation_messages_external')
      .on(t.tenantId, t.externalId)
      .where(sql`${t.externalId} is not null`),
    ...tenantPolicies(),
  ],
)

/**
 * Inbound Instagram messages waiting for an AI turn (B6 autopilot). The Meta webhook inserts a row in the same
 * transaction that stores the message; the worker's `instagram-reply` job (every minute) claims due rows, answers and
 * deletes them, or backs off (`attempts`, `next_at`) and gives up after a few tries (`failed_at`; the message then just
 * stays unread for staff). One row per message (PK) = idempotent.
 */
export const instagramReplyQueue = pgTable(
  'instagram_reply_queue',
  {
    messageId: uuid('message_id')
      .primaryKey()
      .references(() => conversationMessages.id, { onDelete: 'cascade' }),
    tenantId: tenantId(),
    attempts: integer('attempts').notNull().default(0),
    nextAt: ts('next_at').notNull().defaultNow(),
    lastError: text('last_error'),
    failedAt: ts('failed_at'),
    createdAt: createdAt(),
  },
  (t) => [index('instagram_reply_queue_due').on(t.nextAt).where(sql`${t.failedAt} is null`), ...tenantPolicies()],
)

export const agentMode = pgEnum('agent_mode', ['approve', 'autopilot'])

export const aiAgentSettings = pgTable(
  'ai_agent_settings',
  {
    tenantId: tenantId(),
    agentKey: text('agent_key').notNull(),
    enabled: boolean('enabled').notNull().default(false),
    mode: agentMode('mode').notNull().default('approve'),
    tone: text('tone').notNull().default('warm, calm and professional'),
    rules: text('rules'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.agentKey] }), ...tenantPolicies()],
)

export const aiRunStatus = pgEnum('ai_run_status', [
  'pending_approval',
  'approved',
  'rejected',
  'executed',
  'failed',
])

export const aiRuns = pgTable(
  'ai_runs',
  {
    id: id(),
    tenantId: tenantId(),
    agentKey: text('agent_key').notNull(),
    trigger: text('trigger').notNull(),
    input: jsonb('input'),
    output: jsonb('output'),
    status: aiRunStatus('status').notNull().default('pending_approval'),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    error: text('error'),
    approvedBy: text('approved_by').references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ai_runs_queue').on(t.tenantId, t.status, t.createdAt), ...tenantPolicies()],
)

export const brandProfiles = pgTable(
  'brand_profiles',
  {
    tenantId: tenantId().primaryKey(),
    voice: text('voice').notNull().default('Warm, calm and welcoming. Short sentences. No medical claims.'),
    dos: text('dos').array().notNull().default([]),
    donts: text('donts').array().notNull().default([]),
    samples: jsonb('samples').$type<{ en?: string; ar?: string }[]>().notNull().default([]),
    updatedAt: updatedAt(),
  },
  () => tenantPolicies(),
)

export const mediaAssets = pgTable(
  'media_assets',
  {
    id: id(),
    tenantId: tenantId(),
    url: text('url').notNull(),
    /** Stored file behind this asset (uploads and persisted AI images). */
    fileId: uuid('file_id').references(() => storedFiles.id, { onDelete: 'set null' }),
    bytes: integer('bytes'),
    kind: text('kind').notNull().default('image'),
    width: integer('width'),
    height: integer('height'),
    alt: jsonb('alt').$type<{ en?: string; ar?: string }>(),
    source: text('source').notNull().default('upload'),
    tags: text('tags').array().notNull().default([]),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

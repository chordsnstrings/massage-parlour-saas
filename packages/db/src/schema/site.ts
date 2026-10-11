// Phase 1 — tenant website (Puck page data, versions, theme).
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, id, updatedAt } from './_columns'
import { platformPolicies, tenantPolicies } from './_rls'
import { user } from './auth'
import { tenants } from './platform'

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' })

export type ThemeTokens = Record<string, string | number>

/**
 * What a template switch replaced: previous key + theme, and each touched page's prior draft. It also records
 * what the switch wrote (`appliedTheme`, each draft's `versionId` + `savedAt`), so undo is refused once any of
 * it has been edited or published since — undo never throws away later work.
 */
export type TemplateUndo = {
  templateKey: string
  theme: ThemeTokens
  appliedTheme: ThemeTokens
  at: string
  /** `draft` = the page's previous draft data (null when it had none); `created` = page added by the switch. */
  pages: {
    pageId: string
    created: boolean
    draft: Record<string, unknown> | null
    versionId: string
    savedAt: string
  }[]
}

/**
 * @deprecated R23 (2026-10-10): the review step is gone; never read or written. Kept so a container from before R23
 * can still read it during a zero-downtime deploy; drop in a later migration.
 */
export const siteStudioStatus = pgEnum('site_studio_status', ['building', 'review', 'approved'])

export const sites = pgTable(
  'sites',
  {
    id: id(),
    tenantId: tenantId().unique(),
    templateKey: text('template_key').notNull().default('zen'),
    theme: jsonb('theme').$type<ThemeTokens>().notNull().default({}),
    /**
     * Unpublished theme tokens (AI edits — Studio Ask AI, Claude MCP). Editor + previews show it; the next publish
     * makes it live (`publishPage`) and clears it. null = no pending theme change.
     */
    themeDraft: jsonb('theme_draft').$type<ThemeTokens>(),
    locales: text('locales').array().notNull().default(['en']),
    defaultLocale: text('default_locale').notNull().default('en'),
    seo: jsonb('seo').$type<{ title?: string; description?: string }>().notNull().default({}),
    /** Snapshot taken by the last template switch, for one-click undo (cleared by undo). */
    templateUndo: jsonb('template_undo').$type<TemplateUndo>(),
    /**
     * @deprecated R23 (2026-10-10): the review step is gone; never read or written. Kept so a container from before
     * R23 can still read it during a zero-downtime deploy; drop in a later migration.
     */
    studioStatus: siteStudioStatus('studio_status').notNull().default('building'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => tenantPolicies(),
)

export const sitePages = pgTable(
  'site_pages',
  {
    id: id(),
    tenantId: tenantId(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    /** '' for the home page. */
    slug: text('slug').notNull(),
    title: jsonb('title').$type<{ en: string; ar?: string }>().notNull(),
    visible: boolean('visible').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    /** Rename of a published page waiting for its next publish (title shown in the menu, address). */
    pending: jsonb('pending').$type<{ title?: { en: string; ar?: string }; slug?: string }>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('site_pages_slug').on(t.siteId, t.slug), ...tenantPolicies()],
)

export const pageVersionStatus = pgEnum('page_version_status', ['draft', 'published'])

export const pageVersions = pgTable(
  'page_versions',
  {
    id: id(),
    tenantId: tenantId(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => sitePages.id, { onDelete: 'cascade' }),
    /** Puck data: { root, content } */
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    status: pageVersionStatus('status').notNull().default('draft'),
    label: text('label'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

/**
 * Studio editor soft lock (F29): one editor per page at a time. The editor renews it with a heartbeat; it frees
 * itself at `expires_at` (tab closed, network gone). Others see who holds it and may take over (audited). Draft
 * writers (editor saves, Ask AI, Claude MCP) refuse a page locked by someone else (services `site-locks.ts`).
 */
export const sitePageLocks = pgTable(
  'site_page_locks',
  {
    id: id(),
    tenantId: tenantId(),
    pageId: uuid('page_id')
      .notNull()
      .references(() => sitePages.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Display name at the time the lock was taken (shown to other editors). */
    holderName: text('holder_name').notNull(),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [unique('site_page_locks_page').on(t.pageId), ...tenantPolicies()],
)

/**
 * F15 blog: posts written by the studio (super-admins) in Website Studio, shown by the BlogList block and at
 * `{site}/blog/{slug}` once published (sitemap + BlogPosting JSON-LD). Body = plain text (blank line = paragraph,
 * `## ` = sub-heading); never HTML.
 */
export const sitePostStatus = pgEnum('site_post_status', ['draft', 'published'])

export const sitePosts = pgTable(
  'site_posts',
  {
    id: id(),
    tenantId: tenantId(),
    slug: text('slug').notNull(),
    status: sitePostStatus('status').notNull().default('draft'),
    title: jsonb('title').$type<{ en: string; ar?: string }>().notNull(),
    excerpt: jsonb('excerpt').$type<{ en: string; ar?: string }>().notNull().default({ en: '' }),
    body: jsonb('body').$type<{ en: string; ar?: string }>().notNull().default({ en: '' }),
    /** Cover picture: '/files/{id}' or an https URL (also the og:image). */
    coverImage: text('cover_image'),
    seoTitle: jsonb('seo_title').$type<{ en: string; ar?: string }>().notNull().default({ en: '' }),
    seoDescription: jsonb('seo_description')
      .$type<{ en: string; ar?: string }>()
      .notNull()
      .default({ en: '' }),
    /** First publish (kept on later edits; the post's date). */
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('site_posts_slug').on(t.tenantId, t.slug),
    index('site_posts_published').on(t.tenantId, t.status, t.publishedAt),
    ...tenantPolicies(),
  ],
)

/**
 * F15 enquiry form: leads sent from the spa's website (EnquiryForm block). The spa works them in the dashboard
 * (Inbox → Enquiries) and answers by WhatsApp click-to-send; nothing is ever emailed to the sender.
 */
export const siteEnquiryStatus = pgEnum('site_enquiry_status', ['new', 'replied', 'closed'])

export const siteEnquiries = pgTable(
  'site_enquiries',
  {
    id: id(),
    tenantId: tenantId(),
    status: siteEnquiryStatus('status').notNull().default('new'),
    name: text('name').notNull(),
    /** E.164 with '+'. */
    phone: text('phone').notNull(),
    message: text('message').notNull(),
    /** Site language the visitor wrote in (the WhatsApp reply starts in it). */
    locale: text('locale').notNull().default('en'),
    /** Page slug the form was on ('' = home). */
    page: text('page').notNull().default(''),
    /** Keyed SHA-256 of the sender's IP (abuse checks without storing the address). */
    ipHash: text('ip_hash'),
    handledBy: text('handled_by').references(() => user.id, { onDelete: 'set null' }),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('site_enquiries_status_created').on(t.tenantId, t.status, t.createdAt), ...tenantPolicies()],
)

/** Web Push subscriptions per signed-in user (platform-level; a user can belong to several spas). */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: id(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    keys: jsonb('keys').$type<{ p256dh: string; auth: string }>().notNull(),
    createdAt: createdAt(),
  },
  () => platformPolicies(),
)

/**
 * Template studio (super-admin): full-site templates authored in the editor and stored as JSON, so new
 * templates ship without a deploy. Built-in templates live in code; rows here add to or override them by key.
 */
export const siteTemplates = pgTable(
  'site_templates',
  {
    id: id(),
    key: text('key').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    /** Theme tokens (same shape as sites.theme). */
    theme: jsonb('theme').$type<Record<string, unknown>>().notNull(),
    /** [{ slug, title: {en, ar}, data: PuckData }] */
    pages: jsonb('pages').$type<Record<string, unknown>[]>().notNull(),
    previewImageUrl: text('preview_image_url'),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => platformPolicies(),
)

export const changeRequestStatus = pgEnum('change_request_status', ['open', 'done', 'declined'])

/** Spa → studio change requests (the spa can't edit its site; PLAN §14.4). */
export const siteChangeRequests = pgTable(
  'site_change_requests',
  {
    id: id(),
    tenantId: tenantId(),
    pageId: uuid('page_id').references(() => sitePages.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    status: changeRequestStatus('status').notNull().default('open'),
    response: text('response'),
    createdBy: text('created_by').references(() => user.id),
    resolvedBy: text('resolved_by').references(() => user.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('site_change_requests_status').on(t.status, t.createdAt), ...tenantPolicies()],
)

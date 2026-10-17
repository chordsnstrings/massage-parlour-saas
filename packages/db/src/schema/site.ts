// Phase 1 — tenant website (Puck page data, versions, theme).
import {
  boolean,
  customType,
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
  /**
   * R24 (Claude connector): the switch wrote the template's theme as the DRAFT theme (live `theme` untouched);
   * `themeDraft` = the draft theme before it (null = none). `appliedTheme` is then the editing theme after the switch.
   */
  draftTheme?: true
  themeDraft?: ThemeTokens | null
  /** `draft` = the page's previous draft data (null when it had none); `created` = page added by the switch. */
  pages: {
    pageId: string
    created: boolean
    draft: Record<string, unknown> | null
    versionId: string
    savedAt: string
    /** R28 P5 live upgrade: the published version the upgrade replaced (undo re-publishes its data). */
    publishedBefore?: string
    /** R28 P5 live upgrade: the draft the upgrade carried and moved after the published row (+ its stamp). */
    draftVersionId?: string
    draftSavedAt?: string
  }[]
  /**
   * R28 P5 (owner D4): a live upgrade to a new version of the same template (rollout = sign-off) — published at once;
   * `pages[].versionId` = the published row it inserted. Undo re-publishes `publishedBefore` and sets `template_hold`.
   */
  live?: { version: number; fromSha: string; toSha: string }
}

/** R28 P5: one version of an uploaded HTML template (its design document in site_template_files). */
export type TemplateVersionEntry = {
  version: number
  sha256: string
  file: string
  bytes: number
  at: string
  by: string | null
}
/** R28 P5: an uploaded new version waiting for its sign-off (Roll out); invisible to apply until then. */
export type PendingTemplateVersion = TemplateVersionEntry & {
  pages: Record<string, unknown>[]
  report: Record<string, unknown>
}
/**
 * R28 P5 (owner D5): a queued / finished Write texts run for a spa after a template apply or upgrade (drafts only).
 * The web runs it right away (`after()`); the worker's `site-texts-queue` sweeps queued or stale runs.
 */
export type SiteTextRun = {
  state: 'queued' | 'running' | 'done' | 'failed' | 'skipped'
  via: 'template_apply' | 'template_upgrade' | 'connector_apply'
  actorUserId: string
  pageIds: string[]
  designSha?: string
  /** R30: only the search fields (Draft fixes; site-kit `TextScope`). */
  scope?: 'seo'
  at: string
  startedAt?: string
  finishedAt?: string
  /** Console English. */
  summary?: string
}
/** R28 P5: the spa undid a live upgrade — rollouts of this template up to `version` skip it. */
export type TemplateHold = { key: string; version: number; at: string; by: string | null }

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
    /** R28 P5 (D5): the Write texts run queued by a template apply / upgrade (null = none). */
    textRun: jsonb('text_run').$type<SiteTextRun>(),
    /** R28 P5 (D4): set when the spa undid a live upgrade; later rollouts of that version skip the spa. */
    templateHold: jsonb('template_hold').$type<TemplateHold>(),
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

/** R33: how a redirect was added (console "Add redirect" or "Import list"). */
export const siteRedirectSource = pgEnum('site_redirect_source', ['manual', 'import'])

/**
 * R33 (owner 2026-10-17): the spa's own redirects — an address of its old website (Google still lists it, now a 404)
 * → a page of the site, a 301 on every public address of the spa (web proxy, server/site-redirect.ts). Managed by
 * super-admins in the console (Websites → spa → Redirects). `from_path` is decoded, lower-case, no trailing slash;
 * `from_query` = sorted source params ('' = any query); `to_path` = an on-site path [?query][#hash] (core
 * redirects.ts). A live page or published post at `from_path` wins (path-only rules); chains are flattened on save.
 */
export const siteRedirects = pgTable(
  'site_redirects',
  {
    id: id(),
    tenantId: tenantId(),
    fromPath: text('from_path').notNull(),
    fromQuery: text('from_query').notNull().default(''),
    toPath: text('to_path').notNull(),
    source: siteRedirectSource('source').notNull().default('manual'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('site_redirects_from').on(t.tenantId, t.fromPath, t.fromQuery), ...tenantPolicies()],
)

/**
 * F15 enquiry form: leads sent from the spa's website (EnquiryForm block). The spa works them in the dashboard
 * (Inbox → Enquiries) and answers by WhatsApp click-to-send; nothing is ever emailed to the sender.
 */
export const siteEnquiryStatus = pgEnum('site_enquiry_status', ['new', 'replied', 'closed'])

/** R26: what a design's booking form asked for (names resolved server-side; the spa confirms on WhatsApp). */
export type SiteEnquiryBooking = {
  service: string
  serviceId: string | null
  durationMin: number | null
  date: string
  time: string
  guests: number
  staff: string | null
  staffId: string | null
  /** `date` is the night the visitor chose; a small-hours time is on `calendarDate` (core afterMidnight; 2026-10-13). */
  afterMidnight?: boolean
  calendarDate?: string
  /** "Make booking" (Inbox → Enquiries): the booking made from this request, when and by whom. */
  bookingId?: string
  bookedAt?: string
  bookedBy?: string | null
}

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
    /** R26: a booking request from an HTML design's form (null = a plain message); `message` holds its notes. */
    booking: jsonb('booking').$type<SiteEnquiryBooking>(),
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
    /** R28 P5: HTML templates — the live version's number; older design shas in `history` (newest first). */
    version: integer('version').notNull().default(1),
    history: jsonb('history').$type<TemplateVersionEntry[]>().notNull().default([]),
    /** R28 P5: an uploaded version waiting for its sign-off (the Roll out); null = none. */
    pending: jsonb('pending').$type<PendingTemplateVersion>(),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => platformPolicies(),
)

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' })

/**
 * R24: files of platform templates (templates belong to no spa) — chiefly the design documents of uploaded HTML
 * templates (text/html, stored byte for byte; never served by /files), plus any image / font / video file one uses
 * (public, immutable, /files/{id}/{name}). Content-addressed (one row per sha256). Applying the template copies what it
 * uses into the spa's own files (spa sites never depend on it). Bucket objects live under `templates/{id}`, outside
 * every `{tenantId}/` prefix (the tenant purge never touches them).
 */
export const siteTemplateFiles = pgTable(
  'site_template_files',
  {
    id: id(),
    sha256: text('sha256').notNull().unique(),
    contentType: text('content_type').notNull(),
    size: integer('size').notNull(),
    /** 'db' | 's3' */
    storage: text('storage').notNull().default('db'),
    bytes: bytea('bytes'),
    objectKey: text('object_key'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
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

/** R30: one finding of a search check (@spa/core `seoCheck`; `detail` is console English). */
export type SeoCheckFinding = {
  code: string
  severity: 'high' | 'medium'
  /** '/' or '/{slug}'. */
  path: string
  locale: 'en' | 'ar'
  detail: string
}
export type SeoCheckCounts = { high: number; medium: number }

export const seoCheckTrigger = pgEnum('seo_check_trigger', ['weekly', 'manual'])

/**
 * R30 (owner 2026-10-13): the weekly search check of a spa's live site (worker `seo-check`, or "Check now" in the
 * console). The latest 8 per site are kept (`runSeoCheck` deletes older ones in the same transaction).
 */
export const seoChecks = pgTable(
  'seo_checks',
  {
    id: id(),
    tenantId: tenantId(),
    siteId: uuid('site_id')
      .notNull()
      .references(() => sites.id, { onDelete: 'cascade' }),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    findings: jsonb('findings').$type<SeoCheckFinding[]>().notNull().default([]),
    counts: jsonb('counts').$type<SeoCheckCounts>().notNull().default({ high: 0, medium: 0 }),
    trigger: seoCheckTrigger('trigger').notNull(),
  },
  (t) => [index('seo_checks_site_checked').on(t.siteId, t.checkedAt), ...tenantPolicies()],
)

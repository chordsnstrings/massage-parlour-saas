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

/** Website Studio (PLAN §14.4): the platform builds the site; the spa reviews it. */
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

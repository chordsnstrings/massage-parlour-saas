// Phase 1 — tenant website (Puck page data, versions, theme).
import { boolean, integer, jsonb, pgEnum, pgTable, text, unique, uuid } from 'drizzle-orm/pg-core'
import { createdAt, id, updatedAt } from './_columns'
import { platformPolicies, tenantPolicies } from './_rls'
import { user } from './auth'
import { tenants } from './platform'

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' })

export type ThemeTokens = Record<string, string | number>

export const sites = pgTable(
  'sites',
  {
    id: id(),
    tenantId: tenantId().unique(),
    templateKey: text('template_key').notNull().default('zen'),
    theme: jsonb('theme').$type<ThemeTokens>().notNull().default({}),
    locales: text('locales').array().notNull().default(['en']),
    defaultLocale: text('default_locale').notNull().default('en'),
    seo: jsonb('seo').$type<{ title?: string; description?: string }>().notNull().default({}),
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

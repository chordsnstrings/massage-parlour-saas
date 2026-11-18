// Super-admin console tools (F20, PLAN §17): feature flags and announcements to spas.
import { sql } from 'drizzle-orm'
import { boolean, index, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { createdAt, id, updatedAt } from './_columns'
import { platformPolicies, tenantPolicies } from './_rls'
import { user } from './auth'
import { tenants } from './platform'

/**
 * Boolean feature flags (platform-only). `key` = a `FEATURE_FLAGS` key in @spa/core when code reads it (typed
 * `flag()`), or any key the owner defines ahead of the code. `default_on` = the value for every spa without an override.
 */
export const featureFlags = pgTable(
  'feature_flags',
  {
    key: text('key').primaryKey(),
    description: text('description'),
    defaultOn: boolean('default_on').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
  },
  () => platformPolicies(),
)

/** Per-spa value of a flag (wins over the default). Tenant table: a spa may read its own rows; only the console writes. */
export const featureFlagOverrides = pgTable(
  'feature_flag_overrides',
  {
    flagKey: text('flag_key')
      .notNull()
      .references(() => featureFlags.key, { onDelete: 'cascade', onUpdate: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
    updatedAt: updatedAt(),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
  },
  (t) => [
    primaryKey({ columns: [t.flagKey, t.tenantId] }),
    index('feature_flag_overrides_tenant').on(t.tenantId),
    ...tenantPolicies(),
  ],
)

export const announcementSeverity = pgEnum('announcement_severity', ['info', 'warning', 'critical'])
export const announcementAudience = pgEnum('announcement_audience', ['all', 'plan', 'tenants'])

/**
 * Notices from the platform to spas (platform-only): shown as a dismissible banner in the spa dashboard between
 * `starts_at` and `ends_at` (NULL = no end). Never sent by email/SMS. Text typed by a super-admin in EN (+ TH; an
 * empty TH falls back to EN). Audience: every spa, spas on `plan_codes`, or the spas in `tenant_ids`.
 */
export const announcements = pgTable(
  'announcements',
  {
    id: id(),
    titleEn: text('title_en').notNull(),
    titleTh: text('title_th'),
    bodyEn: text('body_en').notNull(),
    bodyTh: text('body_th'),
    severity: announcementSeverity('severity').notNull().default('info'),
    audience: announcementAudience('audience').notNull().default('all'),
    planCodes: text('plan_codes').array().notNull().default(sql`'{}'::text[]`),
    tenantIds: uuid('tenant_ids').array().notNull().default(sql`'{}'::uuid[]`),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('announcements_window').on(t.startsAt, t.endsAt), ...platformPolicies()],
)

/** One row per member who dismissed an announcement in a spa (tenant table; written through withTenant). */
export const announcementDismissals = pgTable(
  'announcement_dismissals',
  {
    announcementId: uuid('announcement_id')
      .notNull()
      .references(() => announcements.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.announcementId, t.tenantId, t.userId] }),
    index('announcement_dismissals_tenant_user').on(t.tenantId, t.userId),
    ...tenantPolicies(),
  ],
)

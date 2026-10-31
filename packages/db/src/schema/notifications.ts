// In-app notifications (PLAN §14.7 B2, crm-spec §7 bell). One row per event: `user_id` set = for that person only;
// NULL = every active member whose role grants `permission` (kept on the row so listing filters per kind).
// Read state: `read_at` for personal rows, `notification_reads` per user for shared rows.
import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { createdAt, id } from './_columns'
import { tenantPolicies } from './_rls'
import { user } from './auth'
import { tenants } from './platform'

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' })

/** i18n params for `notifications.kind.<kind>.{title,body}` plus the dashboard path opened on click. */
type NotificationParam = string | number | { key: string; params?: Record<string, string | number> }
export type NotificationPayload = { params?: Record<string, NotificationParam>; url?: string }

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: tenantId(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    /** Permission needed to see the row (derived from the kind, `@spa/core` NOTIFICATION_KINDS). */
    permission: text('permission').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<NotificationPayload>().notNull().default({}),
    /** Producers' idempotency key: the same event never notifies twice (jobs re-run, retries). */
    dedupeKey: text('dedupe_key'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_feed').on(t.tenantId, t.createdAt),
    uniqueIndex('notifications_dedupe').on(t.tenantId, t.dedupeKey).where(sql`${t.dedupeKey} is not null`),
    ...tenantPolicies(),
  ],
)

export const notificationReads = pgTable(
  'notification_reads',
  {
    tenantId: tenantId(),
    notificationId: uuid('notification_id')
      .notNull()
      .references(() => notifications.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.notificationId, t.userId] }), ...tenantPolicies()],
)

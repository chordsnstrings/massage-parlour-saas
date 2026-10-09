import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, id, updatedAt } from './_columns'
import { tenantPolicies } from './_rls'
import { user } from './auth'
import { tenants } from './platform'

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' })

export type OpeningHours = Partial<
  Record<'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun', { open: string; close: string }[]>
>

export const branches = pgTable(
  'branches',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    address: text('address'),
    /** Exact Google Maps pin (share link); site address links fall back to an address search when null. */
    mapsUrl: text('maps_url'),
    phone: text('phone'),
    whatsappE164: text('whatsapp_e164'),
    openingHours: jsonb('opening_hours').$type<OpeningHours>().notNull().default({}),
    /** Business day ends at this local time (late-night shops), e.g. 05:00. */
    businessDayCutoff: time('business_day_cutoff').notNull().default('05:00'),
    isDefault: boolean('is_default').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => tenantPolicies(),
)

export const roles = pgTable(
  'roles',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    isSystem: boolean('is_system').notNull().default(false),
    permissions: text('permissions').array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [unique('roles_tenant_key').on(t.tenantId, t.key), ...tenantPolicies()],
)

export const memberStatus = pgEnum('member_status', ['active', 'disabled'])

export const members = pgTable(
  'members',
  {
    id: id(),
    tenantId: tenantId(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    allBranches: boolean('all_branches').notNull().default(true),
    status: memberStatus('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('members_tenant_user').on(t.tenantId, t.userId),
    index('members_user').on(t.userId),
    ...tenantPolicies(),
  ],
)

export const memberBranches = pgTable(
  'member_branches',
  {
    tenantId: tenantId(),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.memberId, t.branchId] }), ...tenantPolicies()],
)

export const invitations = pgTable(
  'invitations',
  {
    id: id(),
    tenantId: tenantId(),
    email: text('email').notNull(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id),
    branchIds: uuid('branch_ids').array(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: text('invited_by').references(() => user.id),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    acceptedBy: text('accepted_by').references(() => user.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const jobRunStatus = pgEnum('job_run_status', ['ok', 'skipped', 'failed'])

/**
 * Per-spa background job log (B3): one row per job run that touched the spa, written by the worker, shown on the
 * Automations page ("last 24 hours"). `summary` holds counts only (rendered through i18n). The writer prunes rows
 * older than 7 days.
 */
export const jobRuns = pgTable(
  'job_runs',
  {
    id: id(),
    tenantId: tenantId(),
    job: text('job').notNull(),
    status: jobRunStatus('status').notNull().default('ok'),
    summary: jsonb('summary').$type<Record<string, number>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('job_runs_tenant_at').on(t.tenantId, t.createdAt), ...tenantPolicies()],
)

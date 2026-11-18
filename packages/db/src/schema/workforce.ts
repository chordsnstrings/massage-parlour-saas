// B5.3 + B5.4 — bookable equipment, staff time clock and leave (PLAN §14.7).
import { sql } from 'drizzle-orm'
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, id } from './_columns'
import { tenantPolicies } from './_rls'
import { user } from './auth'
import { staff } from './operations'
import { tenants } from './platform'
import { branches } from './tenant'

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' })
const ts = (name: string) => timestamp(name, { withTimezone: true })

/**
 * A bookable unit (hot-stone kit, steam cabin, …). Services list the types they need (`services.equipment_types`);
 * bookings reserve one free unit per type through `reservations` (`resource_kind = 'equipment'`).
 */
export const equipment = pgTable(
  'equipment',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Typed by the spa (e.g. "Hot stone kit"); matched against `services.equipment_types`. */
    type: text('type').notNull(),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index('equipment_branch_type').on(t.branchId, t.type), ...tenantPolicies()],
)

export const leaveType = pgEnum('leave_type', ['annual', 'sick', 'unpaid'])
export const leaveStatus = pgEnum('leave_status', ['pending', 'approved', 'rejected'])

/** Leave over whole business dates (inclusive). Approved leave blocks booking slots and feeds payroll. */
export const leaveRequests = pgTable(
  'leave_requests',
  {
    id: id(),
    tenantId: tenantId(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    type: leaveType('type').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: leaveStatus('status').notNull().default('pending'),
    note: text('note'),
    requestedBy: text('requested_by').references(() => user.id, { onDelete: 'set null' }),
    decidedBy: text('decided_by').references(() => user.id, { onDelete: 'set null' }),
    decidedAt: ts('decided_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('leave_staff_dates').on(t.staffId, t.startDate),
    check('leave_dates', sql`${t.endDate} >= ${t.startDate}`),
    ...tenantPolicies(),
  ],
)

/**
 * Clock-in/out entries. One open entry per person (unique partial index); entries of one person never overlap
 * (EXCLUDE, hand-written in migration 0022). `business_date` = the branch business date of the clock-in.
 */
export const timeEntries = pgTable(
  'time_entries',
  {
    id: id(),
    tenantId: tenantId(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    clockIn: ts('clock_in').notNull(),
    clockOut: ts('clock_out'),
    businessDate: date('business_date').notNull(),
    /** kiosk | manual */
    source: text('source').notNull().default('kiosk'),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('time_entries_one_open').on(t.staffId).where(sql`${t.clockOut} IS NULL`),
    index('time_entries_staff_date').on(t.staffId, t.businessDate),
    check('time_entries_order', sql`${t.clockOut} IS NULL OR ${t.clockOut} > ${t.clockIn}`),
    ...tenantPolicies(),
  ],
)

// Phase 1 — point of sale (payments are recorded, never processed), daily close, WhatsApp outbox, counters.
import { sql } from 'drizzle-orm'
import {
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
import { createdAt, id } from './_columns'
import { tenantPolicies } from './_rls'
import { user } from './auth'
import { type BillingDetails, bookings, clients, staff } from './operations'
import { tenants } from './platform'
import { branches, members } from './tenant'

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' })
const aed = (name: string) => numeric(name, { precision: 12, scale: 2 })

/** Per-tenant sequences (e.g. sale numbers) incremented with UPDATE … RETURNING inside a transaction. */
export const counters = pgTable(
  'counters',
  {
    tenantId: tenantId(),
    key: text('key').notNull(),
    value: integer('value').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.key] }), ...tenantPolicies()],
)

export const saleStatus = pgEnum('sale_status', ['open', 'paid', 'void', 'refunded'])
export const saleLineKind = pgEnum('sale_line_kind', [
  'service',
  'product',
  'package',
  'gift_card',
  'other',
  'membership',
])
export const paymentMethodKind = pgEnum('payment_method_kind', [
  'cash',
  'card_terminal',
  'bank_transfer',
  'gift_card',
  'package_credit',
  'other',
])

export const sales = pgTable(
  'sales',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    number: integer('number').notNull(),
    businessDate: date('business_date').notNull(),
    /** All amounts VAT-inclusive; vat is the included portion. */
    subtotalAed: aed('subtotal_aed').notNull(),
    discountAed: aed('discount_aed').notNull().default('0'),
    vatAed: aed('vat_aed').notNull().default('0'),
    totalAed: aed('total_aed').notNull(),
    tipsAed: aed('tips_aed').notNull().default('0'),
    status: saleStatus('status').notNull().default('open'),
    voidReason: text('void_reason'),
    /** Customer billing details printed on the full tax invoice (G16); null = simplified tax invoice only. */
    billing: jsonb('billing').$type<BillingDetails>(),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique('sales_tenant_number').on(t.tenantId, t.number),
    index('sales_branch_day').on(t.branchId, t.businessDate),
    // A booking is checked out at most once (voided sales free it up again).
    uniqueIndex('sales_booking_once')
      .on(t.bookingId)
      .where(sql`${t.bookingId} is not null and ${t.status} <> 'void'`),
    ...tenantPolicies(),
  ],
)

export const saleLines = pgTable(
  'sale_lines',
  {
    id: id(),
    tenantId: tenantId(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    kind: saleLineKind('kind').notNull(),
    refId: uuid('ref_id'),
    description: text('description').notNull(),
    qty: integer('qty').notNull().default(1),
    unitPriceAed: aed('unit_price_aed').notNull(),
    discountAed: aed('discount_aed').notNull().default('0'),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('5'),
    lineTotalAed: aed('line_total_aed').notNull(),
    staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'set null' }),
  },
  () => tenantPolicies(),
)

export const payments = pgTable(
  'payments',
  {
    id: id(),
    tenantId: tenantId(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    method: paymentMethodKind('method').notNull(),
    amountAed: aed('amount_aed').notNull(),
    reference: text('reference'),
    businessDate: date('business_date').notNull(),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index('payments_branch_day').on(t.branchId, t.businessDate), ...tenantPolicies()],
)

export const tips = pgTable(
  'tips',
  {
    id: id(),
    tenantId: tenantId(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    amountAed: aed('amount_aed').notNull(),
    method: paymentMethodKind('method').notNull(),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const refunds = pgTable(
  'refunds',
  {
    id: id(),
    tenantId: tenantId(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sales.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    amountAed: aed('amount_aed').notNull(),
    method: paymentMethodKind('method').notNull(),
    reason: text('reason').notNull(),
    businessDate: date('business_date').notNull(),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

/**
 * What a refund gave back, per sale line (F2). Prepaid lines get one row per gift card / package refunded
 * (`ref_id`, qty 1). Refunds recorded before line-level refunds have no rows here.
 */
export const refundLines = pgTable(
  'refund_lines',
  {
    id: id(),
    tenantId: tenantId(),
    refundId: uuid('refund_id')
      .notNull()
      .references(() => refunds.id, { onDelete: 'cascade' }),
    saleLineId: uuid('sale_line_id')
      .notNull()
      .references(() => saleLines.id, { onDelete: 'cascade' }),
    qty: integer('qty').notNull(),
    /** VAT-inclusive amount given back for this line. */
    amountAed: aed('amount_aed').notNull(),
    vatAed: aed('vat_aed').notNull().default('0'),
    /** Gift card or client package voided by this refund. */
    refId: uuid('ref_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('refund_lines_sale_line').on(t.saleLineId),
    index('refund_lines_refund').on(t.refundId),
    ...tenantPolicies(),
  ],
)

export const dayCloses = pgTable(
  'day_closes',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    businessDate: date('business_date').notNull(),
    openingFloatAed: aed('opening_float_aed').notNull().default('0'),
    expectedCashAed: aed('expected_cash_aed').notNull(),
    countedCashAed: aed('counted_cash_aed').notNull(),
    varianceAed: aed('variance_aed').notNull(),
    totals: jsonb('totals').$type<Record<string, string>>().notNull(),
    notes: text('notes'),
    closedBy: text('closed_by').references(() => user.id),
    closedAt: createdAt(),
  },
  (t) => [unique('day_close_unique').on(t.branchId, t.businessDate), ...tenantPolicies()],
)

export const messageKind = pgEnum('message_kind', [
  'booking_confirmation',
  'reminder',
  'reminder_2h',
  'thank_you',
  'review_request',
  'rebook',
  'birthday',
  'winback',
  'slot_offer',
  'waitlist_slot',
  'custom',
  'membership_renewal',
])
export const outboxStatus = pgEnum('outbox_status', ['queued', 'opened', 'sent', 'skipped'])

export const messageTemplates = pgTable(
  'message_templates',
  {
    id: id(),
    tenantId: tenantId(),
    kind: messageKind('kind').notNull(),
    lang: text('lang').notNull().default('en'),
    body: text('body').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('templates_kind_lang').on(t.tenantId, t.kind, t.lang), ...tenantPolicies()],
)

/** WhatsApp click-to-send queue: the system writes the message, a receptionist presses send. */
export const outbox = pgTable(
  'outbox',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'cascade' }),
    kind: messageKind('kind').notNull(),
    campaignId: uuid('campaign_id'),
    phoneE164: text('phone_e164').notNull(),
    text: text('text').notNull(),
    status: outboxStatus('status').notNull().default('queued'),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentBy: text('sent_by').references(() => user.id),
    /** F28: member responsible for sending it (any active member with marketing.send); null = unassigned. */
    assignedTo: uuid('assigned_to').references(() => members.id, { onDelete: 'set null' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }),
    /** Who assigned it; null while `assigned_to` is set = the auto-assign rule (round-robin). */
    assignedBy: text('assigned_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('outbox_queue').on(t.tenantId, t.status, t.dueAt),
    index('outbox_assignee').on(t.tenantId, t.assignedTo, t.status, t.dueAt),
    index('outbox_auto_assigned')
      .on(t.tenantId, t.assignedAt)
      .where(sql`${t.assignedTo} is not null and ${t.assignedBy} is null`),
    unique('outbox_booking_kind').on(t.bookingId, t.kind),
    index('outbox_campaign').on(t.campaignId),
    ...tenantPolicies(),
  ],
)

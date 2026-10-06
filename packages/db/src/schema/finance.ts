// Phase 2 — money: double-entry ledger, expenses, packages, gift cards, memberships, promo codes, commissions, payroll.
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, id, updatedAt } from './_columns'
import { tenantPolicies } from './_rls'
import { user } from './auth'
import { saleLines, sales } from './commerce'
import { type Bilingual, bookings, clients, services, staff } from './operations'
import { tenants } from './platform'
import { branches } from './tenant'

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' })
const aed = (name: string) => numeric(name, { precision: 12, scale: 2 })
const ts = (name: string) => timestamp(name, { withTimezone: true })

export const accountType = pgEnum('account_type', ['asset', 'liability', 'equity', 'revenue', 'expense'])

/** Chart of accounts per tenant (seeded with a UAE spa default; owners can add accounts). */
export const ledgerAccounts = pgTable(
  'ledger_accounts',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: accountType('type').notNull(),
    system: boolean('system').notNull().default(false),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique('ledger_accounts_code').on(t.tenantId, t.code), ...tenantPolicies()],
)

/**
 * Journal entries are append-only (DB triggers block UPDATE/DELETE) and must balance
 * (deferred constraint trigger checks Σdebit = Σcredit at commit). Corrections are reversals.
 */
export const journalEntries = pgTable(
  'journal_entries',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id').references(() => branches.id),
    entryDate: date('entry_date').notNull(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    memo: text('memo'),
    reversesId: uuid('reverses_id'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [
    index('journal_entries_date').on(t.tenantId, t.entryDate),
    index('journal_entries_source').on(t.sourceType, t.sourceId),
    ...tenantPolicies(),
  ],
)

export const journalLines = pgTable(
  'journal_lines',
  {
    id: id(),
    tenantId: tenantId(),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => journalEntries.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => ledgerAccounts.id),
    debitAed: aed('debit_aed').notNull().default('0'),
    creditAed: aed('credit_aed').notNull().default('0'),
    memo: text('memo'),
  },
  (t) => [
    index('journal_lines_account').on(t.accountId),
    index('journal_lines_entry').on(t.entryId),
    ...tenantPolicies(),
  ],
)

/** Books are locked up to and including this date (no new entries dated on/before it). */
export const periodLocks = pgTable(
  'period_locks',
  {
    tenantId: tenantId().primaryKey(),
    lockedThrough: date('locked_through').notNull(),
    lockedBy: text('locked_by').references(() => user.id),
    updatedAt: updatedAt(),
  },
  () => tenantPolicies(),
)

export const expensePaidVia = pgEnum('expense_paid_via', ['cash', 'bank', 'card', 'owner'])

export const expenses = pgTable(
  'expenses',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id').references(() => branches.id),
    expenseDate: date('expense_date').notNull(),
    /** Ledger account code (e.g. 6100 Rent). */
    accountCode: text('account_code').notNull(),
    vendor: text('vendor'),
    description: text('description'),
    amountAed: aed('amount_aed').notNull(),
    vatAed: aed('vat_aed').notNull().default('0'),
    paidVia: expensePaidVia('paid_via').notNull(),
    receiptUrl: text('receipt_url'),
    ocr: jsonb('ocr'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index('expenses_date').on(t.tenantId, t.expenseDate), ...tenantPolicies()],
)

export const packageDefinitions = pgTable(
  'package_definitions',
  {
    id: id(),
    tenantId: tenantId(),
    name: jsonb('name').$type<Bilingual>().notNull(),
    description: jsonb('description').$type<Bilingual>(),
    priceAed: aed('price_aed').notNull(),
    validityDays: integer('validity_days').notNull().default(180),
    /** [{ serviceId, quantity }] */
    items: jsonb('items').$type<{ serviceId: string; quantity: number }[]>().notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const clientPackageStatus = pgEnum('client_package_status', [
  'active',
  'used_up',
  'expired',
  'refunded',
])

export const clientPackages = pgTable(
  'client_packages',
  {
    id: id(),
    tenantId: tenantId(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    definitionId: uuid('definition_id').references(() => packageDefinitions.id, { onDelete: 'set null' }),
    saleId: uuid('sale_id').references(() => sales.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    pricePaidAed: aed('price_paid_aed').notNull(),
    /** Remaining sessions per service id. */
    balances: jsonb('balances').$type<Record<string, number>>().notNull(),
    /** Liability still owed (decreases on each redemption at the per-session value). */
    remainingValueAed: aed('remaining_value_aed').notNull(),
    purchasedAt: ts('purchased_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    status: clientPackageStatus('status').notNull().default('active'),
  },
  (t) => [index('client_packages_client').on(t.clientId), ...tenantPolicies()],
)

export const packageRedemptions = pgTable(
  'package_redemptions',
  {
    id: id(),
    tenantId: tenantId(),
    clientPackageId: uuid('client_package_id')
      .notNull()
      .references(() => clientPackages.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    saleId: uuid('sale_id').references(() => sales.id, { onDelete: 'set null' }),
    quantity: integer('quantity').notNull().default(1),
    valueAed: aed('value_aed').notNull(),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const giftCardStatus = pgEnum('gift_card_status', ['active', 'redeemed', 'expired', 'void'])

export const giftCards = pgTable(
  'gift_cards',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    initialAed: aed('initial_aed').notNull(),
    balanceAed: aed('balance_aed').notNull(),
    purchaserClientId: uuid('purchaser_client_id').references(() => clients.id, { onDelete: 'set null' }),
    recipientName: text('recipient_name'),
    recipientPhone: text('recipient_phone'),
    message: text('message'),
    saleId: uuid('sale_id').references(() => sales.id, { onDelete: 'set null' }),
    expiresAt: ts('expires_at'),
    status: giftCardStatus('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  (t) => [unique('gift_cards_code').on(t.tenantId, t.code), ...tenantPolicies()],
)

export const giftCardTxnKind = pgEnum('gift_card_txn_kind', ['issue', 'redeem', 'refund', 'expire', 'adjust'])

export const giftCardTxns = pgTable(
  'gift_card_txns',
  {
    id: id(),
    tenantId: tenantId(),
    giftCardId: uuid('gift_card_id')
      .notNull()
      .references(() => giftCards.id, { onDelete: 'cascade' }),
    kind: giftCardTxnKind('kind').notNull(),
    /** Positive adds to the balance, negative spends it. */
    amountAed: aed('amount_aed').notNull(),
    saleId: uuid('sale_id').references(() => sales.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const membershipPlans = pgTable(
  'membership_plans',
  {
    id: id(),
    tenantId: tenantId(),
    name: jsonb('name').$type<Bilingual>().notNull(),
    monthlyAed: aed('monthly_aed').notNull(),
    /** { includedSessions: [{ serviceId, quantity }], discountPct } */
    benefits: jsonb('benefits')
      .$type<{ includedSessions?: { serviceId: string; quantity: number }[]; discountPct?: number }>()
      .notNull()
      .default({}),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const membershipStatus = pgEnum('membership_status', ['active', 'paused', 'cancelled', 'lapsed'])

export const clientMemberships = pgTable(
  'client_memberships',
  {
    id: id(),
    tenantId: tenantId(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    planId: uuid('plan_id')
      .notNull()
      .references(() => membershipPlans.id),
    status: membershipStatus('status').notNull().default('active'),
    currentPeriodStart: date('current_period_start').notNull(),
    currentPeriodEnd: date('current_period_end').notNull(),
    /** Sessions left this period per service id. */
    balances: jsonb('balances').$type<Record<string, number>>().notNull().default({}),
    lastPaidAt: ts('last_paid_at'),
    createdAt: createdAt(),
  },
  (t) => [index('client_memberships_client').on(t.clientId), ...tenantPolicies()],
)

export const promoKind = pgEnum('promo_kind', ['percent', 'amount'])

export const promoCodes = pgTable(
  'promo_codes',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    kind: promoKind('kind').notNull(),
    value: numeric('value', { precision: 10, scale: 2 }).notNull(),
    validFrom: date('valid_from'),
    validTo: date('valid_to'),
    maxUses: integer('max_uses'),
    uses: integer('uses').notNull().default(0),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [unique('promo_codes_code').on(t.tenantId, t.code), ...tenantPolicies()],
)

export const commissionEntries = pgTable(
  'commission_entries',
  {
    id: id(),
    tenantId: tenantId(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    saleLineId: uuid('sale_line_id').references(() => saleLines.id, { onDelete: 'set null' }),
    businessDate: date('business_date').notNull(),
    baseAed: aed('base_aed').notNull(),
    ratePct: numeric('rate_pct', { precision: 5, scale: 2 }).notNull(),
    amountAed: aed('amount_aed').notNull(),
    payrollRunId: uuid('payroll_run_id'),
    createdAt: createdAt(),
  },
  (t) => [index('commission_staff_date').on(t.staffId, t.businessDate), ...tenantPolicies()],
)

export const salaryAdvances = pgTable(
  'salary_advances',
  {
    id: id(),
    tenantId: tenantId(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    advanceDate: date('advance_date').notNull(),
    amountAed: aed('amount_aed').notNull(),
    note: text('note'),
    payrollRunId: uuid('payroll_run_id'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const payrollStatus = pgEnum('payroll_status', ['draft', 'finalised'])

export const payrollRuns = pgTable(
  'payroll_runs',
  {
    id: id(),
    tenantId: tenantId(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    status: payrollStatus('status').notNull().default('draft'),
    createdBy: text('created_by').references(() => user.id),
    finalisedAt: ts('finalised_at'),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const payrollLines = pgTable(
  'payroll_lines',
  {
    id: id(),
    tenantId: tenantId(),
    runId: uuid('run_id')
      .notNull()
      .references(() => payrollRuns.id, { onDelete: 'cascade' }),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id),
    baseAed: aed('base_aed').notNull().default('0'),
    commissionAed: aed('commission_aed').notNull().default('0'),
    tipsAed: aed('tips_aed').notNull().default('0'),
    advancesAed: aed('advances_aed').notNull().default('0'),
    deductionsAed: aed('deductions_aed').notNull().default('0'),
    netAed: aed('net_aed').notNull(),
    note: text('note'),
  },
  (t) => [unique('payroll_line_staff').on(t.runId, t.staffId), ...tenantPolicies()],
)

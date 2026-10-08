import { sql } from 'drizzle-orm'
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgPolicy,
  pgSequence,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, id, updatedAt } from './_columns'
import { appRole, currentTenantId, platformPolicies, tenantPolicies } from './_rls'
import { user } from './auth'
import { storedFiles } from './files'

export const tenantStatus = pgEnum('tenant_status', [
  'trial',
  'active',
  'past_due',
  'read_only',
  'suspended',
  'cancelled',
])
export const billingInterval = pgEnum('billing_interval', ['year', 'month'])
export const subscriptionStatus = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'cancelled',
])
export const invoiceStatus = pgEnum('invoice_status', ['draft', 'issued', 'paid', 'void'])
/** What a platform invoice bills: a plan installment (R3 schedule), the per-spa setup fee, or anything else. */
export const platformInvoiceKind = pgEnum('platform_invoice_kind', ['plan', 'setup', 'other'])
export const paymentMethod = pgEnum('platform_payment_method', ['cash', 'bank_transfer', 'other', 'card'])
export const domainKind = pgEnum('domain_kind', ['subdomain', 'custom'])
export const domainStatus = pgEnum('domain_status', ['pending', 'verifying', 'active', 'failed'])

export const platformAdmins = pgTable(
  'platform_admins',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  () => platformPolicies(),
)

/** Single-row table: the platform operator's company details (editable in super-admin). */
export const platformSettings = pgTable(
  'platform_settings',
  {
    id: smallint('id').primaryKey().default(1),
    companyName: text('company_name').notNull().default('spamanagement.ae'),
    legalName: text('legal_name'),
    trn: text('trn'),
    tradeLicence: text('trade_licence'),
    address: text('address'),
    email: text('email'),
    phone: text('phone'),
    whatsapp: text('whatsapp'),
    website: text('website'),
    bankName: text('bank_name'),
    bankAccountName: text('bank_account_name'),
    iban: text('iban'),
    swift: text('swift'),
    invoicePrefix: text('invoice_prefix').notNull().default('SM'),
    vatRate: numeric('vat_rate', { precision: 5, scale: 2 }).notNull().default('5'),
    pricesIncludeVat: boolean('prices_include_vat').notNull().default(false),
    /** Added once per domain order on top of the registrar price (USD), PLAN §14.8 R14. */
    domainMarkupUsd: numeric('domain_markup_usd', { precision: 10, scale: 2 }).notNull().default('10'),
    updatedAt: updatedAt(),
    updatedBy: text('updated_by'),
  },
  () => [check('platform_settings_single_row', sql`id = 1`), ...platformPolicies()],
)

export const plans = pgTable(
  'plans',
  {
    id: id(),
    code: text('code').notNull().unique(),
    name: text('name').notNull(),
    description: text('description'),
    priceAed: numeric('price_aed', { precision: 12, scale: 2 }).notNull(),
    setupFeeAed: numeric('setup_fee_aed', { precision: 12, scale: 2 }).notNull().default('0'),
    billingInterval: billingInterval('billing_interval').notNull().default('year'),
    trialDays: integer('trial_days').notNull().default(14),
    limits: jsonb('limits').$type<Record<string, number | boolean>>().notNull().default({}),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => platformPolicies(),
)

export type TenantSettings = {
  wps?: { employerId?: string; routingCode?: string; bank?: string }
  /** Spa-wide default: hide service prices on the public website (each service can override — R4). */
  hidePrices?: boolean
  /** AED per completed booking a receptionist created (`booking_fee` pay type; owner's receptionist_booking_fee). */
  receptionistBookingFee?: string
  /** Automation switches (B3): keys = `AUTOMATIONS` in @spa/core; missing = on. Written via setAutomation(). */
  automations?: Record<string, boolean>
}

export const tenants = pgTable(
  'tenants',
  {
    id: id(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    legalName: text('legal_name'),
    trn: text('trn'),
    status: tenantStatus('status').notNull().default('trial'),
    planId: uuid('plan_id').references(() => plans.id),
    defaultLocale: text('default_locale').notNull().default('en'),
    timezone: text('timezone').notNull().default('Asia/Dubai'),
    aiBudgetUsd: numeric('ai_budget_usd', { precision: 10, scale: 2 }).notNull().default('25'),
    /** Tenant-level business settings (e.g. WPS employer identifiers for the salary file). */
    settings: jsonb('settings').$type<TenantSettings>().notNull().default({}),
    /** Spa logo (public `stored_files` row, purpose 'logo'): dashboard sidebar; the studio may reuse it. */
    logoFileId: uuid('logo_file_id').references((): AnyPgColumn => storedFiles.id, { onDelete: 'set null' }),
    /** Soft delete by a super-admin (status is also 'cancelled'): data is kept, members and the site are shut out. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    pgPolicy('tenant_self', {
      for: 'all',
      to: appRole,
      using: sql`id = ${currentTenantId}`,
      withCheck: sql`id = ${currentTenantId}`,
    }),
    ...platformPolicies(),
  ],
)

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' })

export const domains = pgTable(
  'domains',
  {
    id: id(),
    tenantId: tenantId(),
    hostname: text('hostname').notNull().unique(),
    kind: domainKind('kind').notNull(),
    status: domainStatus('status').notNull().default('pending'),
    isPrimary: boolean('is_primary').notNull().default(false),
    cfHostnameId: text('cf_hostname_id'),
    /** TXT record value the owner adds at _spamanagement.<hostname> to prove control. */
    verificationToken: text('verification_token'),
    /** Cloudflare for SaaS SSL / hostname status, mirrored for the UI. */
    sslStatus: text('ssl_status'),
    lastError: text('last_error'),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    tenantId: tenantId().unique(),
    planId: uuid('plan_id')
      .notNull()
      .references(() => plans.id),
    status: subscriptionStatus('status').notNull().default('trialing'),
    priceAed: numeric('price_aed', { precision: 12, scale: 2 }).notNull(),
    setupFeeAed: numeric('setup_fee_aed', { precision: 12, scale: 2 }).notNull().default('0'),
    billingInterval: billingInterval('billing_interval').notNull(),
    currentPeriodStart: date('current_period_start').notNull(),
    currentPeriodEnd: date('current_period_end').notNull(),
    graceDays: integer('grace_days').notNull().default(14),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => tenantPolicies(),
)

/** Global invoice counter: numbers look like SM-2026-0001. */
export const platformInvoiceSeq = pgSequence('platform_invoice_seq', { startWith: 1 })

export const platformInvoices = pgTable(
  'platform_invoices',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull().unique(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    description: text('description').notNull(),
    kind: platformInvoiceKind('kind').notNull().default('other'),
    /** Plan invoices: subscription period start, installment n of `installments` (12 monthly or 1 one-time). */
    periodStart: date('period_start'),
    installment: smallint('installment'),
    installments: smallint('installments'),
    subtotalAed: numeric('subtotal_aed', { precision: 12, scale: 2 }).notNull(),
    vatAed: numeric('vat_aed', { precision: 12, scale: 2 }).notNull(),
    totalAed: numeric('total_aed', { precision: 12, scale: 2 }).notNull(),
    status: invoiceStatus('status').notNull().default('issued'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    /** Latest Stripe Checkout Session started for this invoice (card payments, test mode until live keys). */
    stripeSessionId: text('stripe_session_id'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('platform_invoices_plan_installment')
      .on(t.tenantId, t.periodStart, t.installments, t.installment)
      .where(sql`${t.kind} = 'plan' and ${t.status} <> 'void'`),
    uniqueIndex('platform_invoices_one_setup')
      .on(t.tenantId)
      .where(sql`${t.kind} = 'setup' and ${t.status} <> 'void'`),
    ...tenantPolicies(),
  ],
)

/** Payment reminders a super-admin generates (R12): the spa sees them until resolved; sending is click-to-send. */
export const platformReminders = pgTable(
  'platform_reminders',
  {
    id: id(),
    tenantId: tenantId(),
    message: text('message').notNull(),
    amountAed: numeric('amount_aed', { precision: 12, scale: 2 }).notNull(),
    createdBy: text('created_by').references(() => user.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('platform_reminders_tenant').on(t.tenantId, t.createdAt), ...tenantPolicies()],
)

export const platformPayments = pgTable(
  'platform_payments',
  {
    id: id(),
    tenantId: tenantId(),
    invoiceId: uuid('invoice_id').references(() => platformInvoices.id),
    amountAed: numeric('amount_aed', { precision: 12, scale: 2 }).notNull(),
    method: paymentMethod('method').notNull(),
    reference: text('reference'),
    receivedAt: date('received_at').notNull(),
    recordedBy: text('recorded_by').references(() => user.id),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

/** Append-only audit trail. `tenant_id` NULL = platform-level event (never visible to tenants). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: text('actor_user_id'),
    impersonatorUserId: text('impersonator_user_id'),
    action: text('action').notNull(),
    entity: text('entity'),
    entityId: text('entity_id'),
    data: jsonb('data'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

/** Model per AI agent, chosen by super-admin. Model IDs never live in code. */
export const aiModelConfig = pgTable(
  'ai_model_config',
  {
    agentKey: text('agent_key').primaryKey(),
    label: text('label').notNull(),
    modelId: text('model_id').notNull(),
    kind: text('kind', { enum: ['chat', 'image', 'video'] })
      .notNull()
      .default('chat'),
    supportsStructuredOutput: boolean('supports_structured_output').notNull().default(false),
    supportsTools: boolean('supports_tools').notNull().default(true),
    priceInPerM: numeric('price_in_per_m', { precision: 10, scale: 4 }).notNull().default('0'),
    priceOutPerM: numeric('price_out_per_m', { precision: 10, scale: 4 }).notNull().default('0'),
    priceCachedInPerM: numeric('price_cached_in_per_m', { precision: 10, scale: 4 }).notNull().default('0'),
    pricePerImage: numeric('price_per_image', { precision: 10, scale: 4 }).notNull().default('0'),
    params: jsonb('params').$type<Record<string, unknown>>().notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    updatedAt: updatedAt(),
  },
  () => platformPolicies(),
)

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tenantId: tenantId(),
    agentKey: text('agent_key').notNull(),
    modelId: text('model_id').notNull(),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    tokensCached: integer('tokens_cached').notNull().default(0),
    images: integer('images').notNull().default(0),
    costUsd: numeric('cost_usd', { precision: 12, scale: 6 }).notNull().default('0'),
    status: text('status', { enum: ['ok', 'error'] })
      .notNull()
      .default('ok'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_usage_tenant_created').on(t.tenantId, t.createdAt), ...tenantPolicies()],
)

export const domainOrderStatus = pgEnum('domain_order_status', [
  'requested',
  'purchasing',
  'purchased',
  'failed',
  'rejected',
  'cancelled',
])

/**
 * Domain purchases through the registrar (Namecheap): a spa requests a domain, a super-admin approves, the
 * platform registers it, points DNS at the platform and connects it as the spa's custom domain.
 */
export const domainOrders = pgTable(
  'domain_orders',
  {
    id: id(),
    tenantId: tenantId(),
    domain: text('domain').notNull(),
    years: integer('years').notNull().default(1),
    /** What the spa is billed: registrar price at request time + markup (USD), and the same in AED. */
    priceUsd: numeric('price_usd', { precision: 10, scale: 2 }).notNull(),
    priceAed: numeric('price_aed', { precision: 10, scale: 2 }).notNull(),
    /** Platform markup included in price_usd / price_aed (platform_settings.domain_markup_usd at request time). */
    markupUsd: numeric('markup_usd', { precision: 10, scale: 2 }).notNull().default('0'),
    premium: boolean('premium').notNull().default(false),
    status: domainOrderStatus('status').notNull().default('requested'),
    requestedBy: text('requested_by').references(() => user.id),
    decidedBy: text('decided_by').references(() => user.id),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    chargedUsd: numeric('charged_usd', { precision: 10, scale: 2 }),
    registrarOrderId: text('registrar_order_id'),
    registrarDomainId: text('registrar_domain_id'),
    domainId: uuid('domain_id').references(() => domains.id, { onDelete: 'set null' }),
    note: text('note'),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('domain_orders_tenant').on(t.tenantId, t.createdAt),
    uniqueIndex('domain_orders_open_domain')
      .on(t.domain)
      .where(sql`${t.status} in ('requested', 'purchasing', 'purchased')`),
    ...tenantPolicies(),
  ],
)

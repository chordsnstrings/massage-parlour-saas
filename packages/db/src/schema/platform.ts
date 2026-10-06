import { sql } from 'drizzle-orm'
import {
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
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, id, updatedAt } from './_columns'
import { appRole, currentTenantId, platformPolicies, tenantPolicies } from './_rls'
import { user } from './auth'

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
export const paymentMethod = pgEnum('platform_payment_method', ['cash', 'bank_transfer', 'other'])
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

export const platformInvoices = pgTable(
  'platform_invoices',
  {
    id: id(),
    tenantId: tenantId(),
    number: text('number').notNull().unique(),
    issueDate: date('issue_date').notNull(),
    dueDate: date('due_date').notNull(),
    description: text('description').notNull(),
    subtotalAed: numeric('subtotal_aed', { precision: 12, scale: 2 }).notNull(),
    vatAed: numeric('vat_aed', { precision: 12, scale: 2 }).notNull(),
    totalAed: numeric('total_aed', { precision: 12, scale: 2 }).notNull(),
    status: invoiceStatus('status').notNull().default('issued'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
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

// Phase 2 — inventory (retail + consumables) and staff/business document expiry tracking.
import {
  boolean,
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
  uuid,
} from 'drizzle-orm/pg-core'
import { createdAt, id, updatedAt } from './_columns'
import { tenantPolicies } from './_rls'
import { user } from './auth'
import { type Bilingual, serviceVariants, staff } from './operations'
import { tenants } from './platform'
import { branches } from './tenant'

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' })
const aed = (name: string) => numeric(name, { precision: 12, scale: 2 })
const qty = (name: string) => numeric(name, { precision: 12, scale: 3 })

export const productKind = pgEnum('product_kind', ['retail', 'consumable'])

export const products = pgTable(
  'products',
  {
    id: id(),
    tenantId: tenantId(),
    kind: productKind('kind').notNull(),
    sku: text('sku'),
    name: jsonb('name').$type<Bilingual>().notNull(),
    /** e.g. ml, pcs, g */
    unit: text('unit').notNull().default('pcs'),
    costAed: aed('cost_aed').notNull().default('0'),
    priceAed: aed('price_aed'),
    lowStockAt: qty('low_stock_at'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => tenantPolicies(),
)

/**
 * Stock per location: a branch, or the spa's central warehouse (`branch_id` NULL, one per spa — R9).
 * `low_stock_at` overrides the product's threshold for this location.
 */
export const stockLevels = pgTable(
  'stock_levels',
  {
    tenantId: tenantId(),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    qty: qty('qty').notNull().default('0'),
    lowStockAt: qty('low_stock_at'),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('stock_levels_location').on(t.tenantId, t.branchId, t.productId).nullsNotDistinct(),
    ...tenantPolicies(),
  ],
)

export const stockMovementKind = pgEnum('stock_movement_kind', [
  'purchase',
  'sale',
  'consumption',
  'adjustment',
  'transfer_in',
  'transfer_out',
])

export const stockMovements = pgTable(
  'stock_movements',
  {
    id: id(),
    tenantId: tenantId(),
    /** NULL = the central warehouse. */
    branchId: uuid('branch_id').references(() => branches.id),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    kind: stockMovementKind('kind').notNull(),
    /** Signed quantity: + in, − out. */
    qty: qty('qty').notNull(),
    unitCostAed: aed('unit_cost_aed'),
    refType: text('ref_type'),
    refId: uuid('ref_id'),
    note: text('note'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index('stock_movements_product').on(t.productId, t.createdAt), ...tenantPolicies()],
)

/** Consumables used per service variant (auto-deducted on completion). */
export const serviceConsumables = pgTable(
  'service_consumables',
  {
    tenantId: tenantId(),
    serviceVariantId: uuid('service_variant_id')
      .notNull()
      .references(() => serviceVariants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    qty: qty('qty').notNull(),
  },
  (t) => [primaryKey({ columns: [t.serviceVariantId, t.productId] }), ...tenantPolicies()],
)

/** Visa, Emirates ID, labour card, health card… with expiry reminders (types are free text). */
export const staffDocuments = pgTable(
  'staff_documents',
  {
    id: id(),
    tenantId: tenantId(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    number: text('number'),
    issuedOn: date('issued_on'),
    expiresOn: date('expires_on'),
    fileUrl: text('file_url'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  (t) => [index('staff_documents_expiry').on(t.tenantId, t.expiresOn), ...tenantPolicies()],
)

export const businessDocuments = pgTable(
  'business_documents',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    number: text('number'),
    issuedOn: date('issued_on'),
    expiresOn: date('expires_on'),
    fileUrl: text('file_url'),
    notes: text('notes'),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

/** Simple supplier list for purchase records (R8). */
export const suppliers = pgTable(
  'suppliers',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    phone: text('phone'),
    trn: text('trn'),
    notes: text('notes'),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('suppliers_tenant').on(t.tenantId, t.name), ...tenantPolicies()],
)

export const purchaseCategory = pgEnum('purchase_category', [
  'materials',
  'cleaning',
  'consumables',
  'equipment',
  'other',
])
export const purchaseStatus = pgEnum('purchase_status', ['recorded', 'void'])

/**
 * Purchase record (R8): what was bought, from whom, VAT and how it was paid (recorded, never processed).
 * Stock lines are received into `branch_id` (NULL = central warehouse). Voiding posts reversals; the row stays.
 */
export const purchases = pgTable(
  'purchases',
  {
    id: id(),
    tenantId: tenantId(),
    supplierId: uuid('supplier_id').references(() => suppliers.id),
    branchId: uuid('branch_id').references(() => branches.id),
    purchaseDate: date('purchase_date').notNull(),
    category: purchaseCategory('category').notNull(),
    /** Net of VAT. */
    subtotalAed: aed('subtotal_aed').notNull(),
    vatAed: aed('vat_aed').notNull().default('0'),
    totalAed: aed('total_aed').notNull(),
    paidVia: text('paid_via').notNull(),
    reference: text('reference'),
    notes: text('notes'),
    receiptUrl: text('receipt_url'),
    ocr: jsonb('ocr'),
    status: purchaseStatus('status').notNull().default('recorded'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    voidedBy: text('voided_by').references(() => user.id),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  (t) => [index('purchases_date').on(t.tenantId, t.purchaseDate), ...tenantPolicies()],
)

export const purchaseLines = pgTable(
  'purchase_lines',
  {
    id: id(),
    tenantId: tenantId(),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id, { onDelete: 'cascade' }),
    /** Set for stock products (Dr 1200 + stock movement); otherwise the line is expensed to `account_code`. */
    productId: uuid('product_id').references(() => products.id),
    description: text('description').notNull(),
    qty: qty('qty').notNull(),
    unitCostAed: aed('unit_cost_aed').notNull(),
    /** qty × unit cost, net of VAT. */
    lineTotalAed: aed('line_total_aed').notNull(),
    accountCode: text('account_code').notNull(),
    stockMovementId: uuid('stock_movement_id').references(() => stockMovements.id),
    sort: integer('sort').notNull().default(0),
  },
  (t) => [index('purchase_lines_purchase').on(t.purchaseId), ...tenantPolicies()],
)

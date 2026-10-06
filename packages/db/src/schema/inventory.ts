// Phase 2 — inventory (retail + consumables) and staff/business document expiry tracking.
import {
  boolean,
  date,
  index,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
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

export const stockLevels = pgTable(
  'stock_levels',
  {
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    qty: qty('qty').notNull().default('0'),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.branchId, t.productId] }), ...tenantPolicies()],
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
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
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

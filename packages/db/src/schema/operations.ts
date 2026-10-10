// Phase 1 — spa operations: services, rooms, staff, shifts, clients, intake, bookings, reservations, rotation.
import {
  boolean,
  customType,
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
import { storedFiles } from './files'
import { tenants } from './platform'
import { branches, members } from './tenant'

const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' })
const ts = (name: string) => timestamp(name, { withTimezone: true })
const aed = (name: string) => numeric(name, { precision: 12, scale: 2 })

/** Postgres tstzrange as text, e.g. '[2026-10-06 10:00+04,2026-10-06 11:00+04)'. */
export const tstzrange = customType<{ data: string; driverData: string }>({ dataType: () => 'tstzrange' })

export type Bilingual = { en: string; ar?: string }

export const serviceCategories = pgTable(
  'service_categories',
  {
    id: id(),
    tenantId: tenantId(),
    name: jsonb('name').$type<Bilingual>().notNull(),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const services = pgTable(
  'services',
  {
    id: id(),
    tenantId: tenantId(),
    categoryId: uuid('category_id').references(() => serviceCategories.id, { onDelete: 'set null' }),
    name: jsonb('name').$type<Bilingual>().notNull(),
    description: jsonb('description').$type<Bilingual>(),
    bufferBeforeMin: integer('buffer_before_min').notNull().default(0),
    bufferAfterMin: integer('buffer_after_min').notNull().default(10),
    /** Allowed room types; empty = any room. */
    roomTypes: text('room_types').array().notNull().default([]),
    /** Equipment types each booking needs, one unit per entry (repeat a type for two units); empty = none (B5.3). */
    equipmentTypes: text('equipment_types').array().notNull().default([]),
    therapistsRequired: integer('therapists_required').notNull().default(1),
    onlineBookable: boolean('online_bookable').notNull().default(true),
    /** Show prices on the public website: null = the spa default (`tenants.settings.hidePrices`), else override (R4). */
    showPrice: boolean('show_price'),
    color: text('color'),
    imageUrl: text('image_url'),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => tenantPolicies(),
)

export const serviceVariants = pgTable(
  'service_variants',
  {
    id: id(),
    tenantId: tenantId(),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
    durationMin: integer('duration_min').notNull(),
    /** VAT-inclusive price; null = "price on request", typed at checkout (R4). */
    priceAed: aed('price_aed'),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
  },
  () => tenantPolicies(),
)

export const rooms = pgTable(
  'rooms',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** single | couple | vip | foot | thai | other */
    type: text('type').notNull().default('single'),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const staffGender = pgEnum('staff_gender', ['female', 'male', 'other'])
/**
 * How a person is paid (PLAN §14.8 R2): `booking_commission` = the AED amounts entered per completed booking
 * (therapists; no base, no % accrual); `salary` = fixed monthly base; `sales_commission` = commission_pct of the
 * net POS lines attributed to them (not offered to receptionists); `booking_fee` = the spa's fixed
 * `tenants.settings.receptionistBookingFee` × bookings they created that ended completed in the period (R2 owner
 * decision, receptionists).
 */
export const staffPayType = pgEnum('staff_pay_type', [
  'booking_commission',
  'salary',
  'sales_commission',
  'booking_fee',
])

export const staff = pgTable(
  'staff',
  {
    id: id(),
    tenantId: tenantId(),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
    displayName: text('display_name').notNull(),
    gender: staffGender('gender'),
    phoneE164: text('phone_e164'),
    color: text('color').notNull().default('#5e7d6b'),
    photoUrl: text('photo_url'),
    bio: jsonb('bio').$type<Bilingual>(),
    branchIds: uuid('branch_ids').array().notNull().default([]),
    bookable: boolean('bookable').notNull().default(true),
    payType: staffPayType('pay_type').notNull().default('booking_commission'),
    commissionPct: numeric('commission_pct', { precision: 5, scale: 2 }).notNull().default('0'),
    baseSalaryAed: aed('base_salary_aed').notNull().default('0'),
    /** Time-clock PIN, scrypt-hashed (`v1.<salt>.<hash>`); null = no PIN set (B5.4). */
    pinHash: text('pin_hash'),
    /** Wrong PINs in a row; at 5 the kiosk locks this person until `pin_locked_until`. */
    pinFailures: integer('pin_failures').notNull().default(0),
    pinLockedUntil: ts('pin_locked_until'),
    /** WPS / payroll identifiers: { personId, labourCardNo, iban, routingCode, bank } */
    payroll: jsonb('payroll')
      .$type<{
        personId?: string
        labourCardNo?: string
        iban?: string
        routingCode?: string
        bank?: string
      }>()
      .notNull()
      .default({}),
    active: boolean('active').notNull().default(true),
    sort: integer('sort').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => tenantPolicies(),
)

export const staffServices = pgTable(
  'staff_services',
  {
    tenantId: tenantId(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id')
      .notNull()
      .references(() => services.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.staffId, t.serviceId] }), ...tenantPolicies()],
)

export const shifts = pgTable(
  'shifts',
  {
    id: id(),
    tenantId: tenantId(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    note: text('note'),
    createdAt: createdAt(),
  },
  (t) => [
    index('shifts_staff_time').on(t.staffId, t.startsAt),
    // Branch/period scans (KPIs: on-shift hours, RevPATH).
    index('shifts_branch_time').on(t.branchId, t.startsAt),
    ...tenantPolicies(),
  ],
)

/** Customer billing details for a full UAE tax invoice (G16). `trn` only when the customer is VAT registered. */
export type BillingDetails = { name: string; address?: string | null; trn?: string | null }

export const clients = pgTable(
  'clients',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    phoneE164: text('phone_e164'),
    email: text('email'),
    gender: staffGender('gender'),
    language: text('language').notNull().default('en'),
    birthday: date('birthday'),
    nationality: text('nationality'),
    source: text('source'),
    tags: text('tags').array().notNull().default([]),
    preferences: jsonb('preferences')
      .$type<{
        pressure?: string
        oils?: string
        allergies?: string
        focus?: string
        therapistGender?: string
        preferredStaffId?: string
      }>()
      .notNull()
      .default({}),
    notes: text('notes'),
    /** Saved billing details for tax invoices (G16); copied onto a sale when staff issue one. */
    billing: jsonb('billing').$type<BillingDetails>(),
    blocklisted: boolean('blocklisted').notNull().default(false),
    blocklistReason: text('blocklist_reason'),
    noShowCount: integer('no_show_count').notNull().default(0),
    marketingOptOutAt: ts('marketing_opt_out_at'),
    firstVisitAt: ts('first_visit_at'),
    lastVisitAt: ts('last_visit_at'),
    /** G12: personal data erased on request (name → 'Erased client'); sales/bookings keep the reference. */
    erasedAt: ts('erased_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('clients_tenant_phone').on(t.tenantId, t.phoneE164),
    index('clients_tenant_name').on(t.tenantId, t.name),
    ...tenantPolicies(),
  ],
)

export type IntakeField = {
  key: string
  label: Bilingual
  type: 'text' | 'textarea' | 'yesno' | 'select'
  options?: string[]
  required?: boolean
}

export const intakeTemplates = pgTable(
  'intake_templates',
  {
    id: id(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    fields: jsonb('fields').$type<IntakeField[]>().notNull().default([]),
    waiver: jsonb('waiver').$type<Bilingual>().notNull(),
    version: integer('version').notNull().default(1),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => tenantPolicies(),
)

export const bookingStatus = pgEnum('booking_status', [
  'pending',
  'confirmed',
  'checked_in',
  'in_service',
  'completed',
  'no_show',
  'cancelled',
])
export const bookingSource = pgEnum('booking_source', [
  'walk_in',
  'online',
  'whatsapp',
  'instagram',
  'phone',
  'ai_agent',
  'gbp',
])
/** F13: an online booking's first-touch website source (core BOOKING_ATTRIBUTIONS, public/t.js entry). */
export const bookingAttribution = pgEnum('booking_attribution', [
  'instagram',
  'gbp',
  'google',
  'qr',
  'facebook',
  'tiktok',
  'whatsapp',
  'widget',
  'campaign',
  'referral',
  'direct',
])

export const bookings = pgTable(
  'bookings',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id),
    clientId: uuid('client_id').references(() => clients.id, { onDelete: 'set null' }),
    refCode: text('ref_code').notNull(),
    source: bookingSource('source').notNull(),
    /** Where an online booker came from (?src=ig|gbp|qr, utm, referrer, direct); null for staff-made bookings. */
    attribution: bookingAttribution('attribution'),
    status: bookingStatus('status').notNull().default('pending'),
    businessDate: date('business_date').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    notes: text('notes'),
    cancelReason: text('cancel_reason'),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('bookings_tenant_ref').on(t.tenantId, t.refCode),
    index('bookings_branch_day').on(t.branchId, t.businessDate),
    index('bookings_client').on(t.clientId),
    ...tenantPolicies(),
  ],
)

export const bookingItems = pgTable(
  'booking_items',
  {
    id: id(),
    tenantId: tenantId(),
    bookingId: uuid('booking_id')
      .notNull()
      .references(() => bookings.id, { onDelete: 'cascade' }),
    serviceVariantId: uuid('service_variant_id').references(() => serviceVariants.id, {
      onDelete: 'set null',
    }),
    serviceName: text('service_name').notNull(),
    durationMin: integer('duration_min').notNull(),
    /** Copied from the variant; null = price on request (typed at checkout). */
    priceAed: aed('price_aed'),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at').notNull(),
    roomId: uuid('room_id').references(() => rooms.id, { onDelete: 'set null' }),
    staffIds: uuid('staff_ids').array().notNull().default([]),
    /** Equipment units reserved for this item (B5.3). */
    equipmentIds: uuid('equipment_ids').array().notNull().default([]),
  },
  // Joins from bookings (reports: F31 room utilisation, rebooking by therapist).
  (t) => [index('booking_items_booking').on(t.bookingId), ...tenantPolicies()],
)

export const resourceKind = pgEnum('resource_kind', ['staff', 'room', 'equipment'])

/**
 * Time a staff member, room or equipment unit is held, including buffers. An EXCLUDE constraint
 * (migration 0003) makes overlapping holds on the same resource impossible.
 */
export const reservations = pgTable(
  'reservations',
  {
    id: id(),
    tenantId: tenantId(),
    bookingItemId: uuid('booking_item_id')
      .notNull()
      .references(() => bookingItems.id, { onDelete: 'cascade' }),
    resourceKind: resourceKind('resource_kind').notNull(),
    resourceId: uuid('resource_id').notNull(),
    period: tstzrange('period').notNull(),
  },
  () => tenantPolicies(),
)

export const treatmentNotes = pgTable(
  'treatment_notes',
  {
    id: id(),
    tenantId: tenantId(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    staffId: uuid('staff_id').references(() => staff.id, { onDelete: 'set null' }),
    text: text('text').notNull(),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
  },
  () => tenantPolicies(),
)

export const intakeSubmissions = pgTable(
  'intake_submissions',
  {
    id: id(),
    tenantId: tenantId(),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    templateId: uuid('template_id').references(() => intakeTemplates.id, { onDelete: 'set null' }),
    templateVersion: integer('template_version').notNull(),
    answers: jsonb('answers').$type<Record<string, string>>().notNull(),
    waiverText: text('waiver_text').notNull(),
    /** Signature as an SVG path string drawn on the reception tablet. */
    signature: text('signature').notNull(),
    signedAt: ts('signed_at').notNull().defaultNow(),
    ip: text('ip'),
    /** F27: SHA-256 of the signed record (services intake.ts `intakeContentHash`), printed on the PDF. */
    contentSha256: text('content_sha256'),
    /** F27: the signed PDF (private stored file, purpose `intake_pdf`; served to members with clients.view). */
    pdfFileId: uuid('pdf_file_id').references(() => storedFiles.id, { onDelete: 'set null' }),
    /** SHA-256 of the PDF bytes, so a downloaded copy can be checked against the record. */
    pdfSha256: text('pdf_sha256'),
    pdfGeneratedAt: ts('pdf_generated_at'),
  },
  () => tenantPolicies(),
)

export const rotationStatus = pgEnum('rotation_status', ['available', 'busy', 'break', 'off'])

/** Walk-in "turn" list per branch per business day. */
export const rotationEntries = pgTable(
  'rotation_entries',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    businessDate: date('business_date').notNull(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    turns: integer('turns').notNull().default(0),
    status: rotationStatus('status').notNull().default('available'),
    updatedAt: updatedAt(),
  },
  (t) => [unique('rotation_unique').on(t.branchId, t.businessDate, t.staffId), ...tenantPolicies()],
)

export const waitlistStatus = pgEnum('waitlist_status', ['waiting', 'notified', 'booked', 'cancelled'])

/**
 * Waitlist (B5.1): a client who wants a service on a business date, optionally within a time window
 * (`from_at`/`until_at`, null = any time that day). When a matching slot frees (cancel / no-show / reschedule)
 * the entry is set `notified` and a `waitlist_slot` WhatsApp message is queued (click-to-send).
 */
export const waitlistEntries = pgTable(
  'waitlist_entries',
  {
    id: id(),
    tenantId: tenantId(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branches.id, { onDelete: 'cascade' }),
    clientId: uuid('client_id')
      .notNull()
      .references(() => clients.id, { onDelete: 'cascade' }),
    serviceId: uuid('service_id').references(() => services.id, { onDelete: 'set null' }),
    serviceVariantId: uuid('service_variant_id').references(() => serviceVariants.id, {
      onDelete: 'set null',
    }),
    businessDate: date('business_date').notNull(),
    fromAt: ts('from_at'),
    untilAt: ts('until_at'),
    notes: text('notes'),
    status: waitlistStatus('status').notNull().default('waiting'),
    notifiedAt: ts('notified_at'),
    bookingId: uuid('booking_id').references(() => bookings.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('waitlist_branch_day').on(t.branchId, t.businessDate, t.status),
    index('waitlist_client').on(t.clientId),
    ...tenantPolicies(),
  ],
)

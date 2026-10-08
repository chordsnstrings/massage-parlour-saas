// Data export, database side: per-dataset CSV rows (date-filtered) and the full tenant dump.
// Callers run these inside withTenant(); CSV text and zips are built by the caller (toCsv / fflate).
import { addDays, dubaiInstant, type Permission } from '@spa/core'
import {
  bookingItems,
  bookings,
  branches,
  clients,
  expenses,
  ledgerAccounts,
  payments,
  products,
  rooms,
  saleLines,
  sales,
  schema,
  staff,
  stockLevels,
  type Tx,
} from '@spa/db'
import { and, asc, eq, getTableColumns, gte, is, lt, lte } from 'drizzle-orm'
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core'
import { formatLocalPhone } from './data-io'

export const EXPORT_DATASETS = {
  clients: { label: 'Clients', permission: 'clients.export', dated: 'Added' },
  bookings: { label: 'Bookings', permission: 'reports.view', dated: 'Business date' },
  sales: { label: 'Sales', permission: 'reports.view', dated: 'Business date' },
  sale_lines: { label: 'Sale lines', permission: 'reports.view', dated: 'Business date' },
  payments: { label: 'Payments', permission: 'reports.view', dated: 'Business date' },
  expenses: { label: 'Expenses', permission: 'accounting.view', dated: 'Expense date' },
  products: { label: 'Products & stock', permission: 'inventory.manage', dated: null },
} as const satisfies Record<string, { label: string; permission: Permission; dated: string | null }>
export type ExportDataset = keyof typeof EXPORT_DATASETS
export const isExportDataset = (v: string): v is ExportDataset => Object.hasOwn(EXPORT_DATASETS, v)

export type ExportRange = { from?: string | null; to?: string | null }

/** Instant → "YYYY-MM-DD HH:MM" in Asia/Dubai (UTC+4, no DST). */
export const dubaiStamp = (d: Date | null) =>
  d ? new Date(d.getTime() + 4 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') : ''

const dateBetween = (col: Parameters<typeof gte>[0], r: ExportRange) => [
  ...(r.from ? [gte(col, r.from)] : []),
  ...(r.to ? [lte(col, r.to)] : []),
]

async function lookups(tx: Tx) {
  const [b, s, rm] = await Promise.all([
    tx.select({ id: branches.id, name: branches.name }).from(branches),
    tx.select({ id: staff.id, name: staff.displayName }).from(staff),
    tx.select({ id: rooms.id, name: rooms.name }).from(rooms),
  ])
  const map = (rows: { id: string; name: string }[]) => new Map(rows.map((r) => [r.id, r.name]))
  return { branch: map(b), staff: map(s), room: map(rm) }
}

/** Header + rows for one dataset. Client phone numbers are included only when `phones` is true. */
export async function exportRows(
  tx: Tx,
  dataset: ExportDataset,
  range: ExportRange,
  opts: { phones: boolean },
): Promise<unknown[][]> {
  if (dataset === 'clients') {
    const where = [
      ...(range.from ? [gte(clients.createdAt, dubaiInstant(range.from, 0))] : []),
      ...(range.to ? [lt(clients.createdAt, dubaiInstant(addDays(range.to, 1), 0))] : []),
    ]
    const rows = await tx
      .select()
      .from(clients)
      .where(and(...where))
      .orderBy(asc(clients.name))
    return [
      [
        'Name',
        ...(opts.phones ? ['Mobile'] : []),
        'Gender',
        'Birthday',
        'Language',
        'Tags',
        'Notes',
        'Source',
        'Nationality',
        'First visit',
        'Last visit',
        'No-shows',
        'Marketing opt-out',
        'Blocklisted',
        'Added',
      ],
      ...rows.map((c) => [
        c.name,
        ...(opts.phones ? [c.phoneE164 ? formatLocalPhone(c.phoneE164) : ''] : []),
        c.gender,
        c.birthday,
        c.language,
        c.tags,
        c.notes,
        c.source,
        c.nationality,
        dubaiStamp(c.firstVisitAt),
        dubaiStamp(c.lastVisitAt),
        c.noShowCount,
        c.marketingOptOutAt ? 'yes' : '',
        c.blocklisted ? 'yes' : '',
        dubaiStamp(c.createdAt),
      ]),
    ]
  }

  if (dataset === 'bookings') {
    const l = await lookups(tx)
    const rows = await tx
      .select({ b: bookings, i: bookingItems, client: clients.name, phone: clients.phoneE164 })
      .from(bookings)
      .innerJoin(bookingItems, eq(bookingItems.bookingId, bookings.id))
      .leftJoin(clients, eq(clients.id, bookings.clientId))
      .where(and(...dateBetween(bookings.businessDate, range)))
      .orderBy(asc(bookings.startsAt), asc(bookingItems.startsAt))
    return [
      [
        'Ref',
        'Business date',
        'Start',
        'End',
        'Status',
        'Source',
        'Branch',
        'Client',
        ...(opts.phones ? ['Client mobile'] : []),
        'Service',
        'Duration (min)',
        'Price AED',
        'Therapists',
        'Room',
        'Notes',
        'Booked at',
      ],
      ...rows.map(({ b, i, client, phone }) => [
        b.refCode,
        b.businessDate,
        dubaiStamp(i.startsAt),
        dubaiStamp(i.endsAt),
        b.status,
        b.source,
        l.branch.get(b.branchId) ?? '',
        client ?? '',
        ...(opts.phones ? [phone ? formatLocalPhone(phone) : ''] : []),
        i.serviceName,
        i.durationMin,
        i.priceAed,
        i.staffIds.map((id) => l.staff.get(id) ?? '').filter(Boolean),
        i.roomId ? (l.room.get(i.roomId) ?? '') : '',
        b.notes,
        dubaiStamp(b.createdAt),
      ]),
    ]
  }

  if (dataset === 'sales') {
    const l = await lookups(tx)
    const rows = await tx
      .select({ s: sales, client: clients.name })
      .from(sales)
      .leftJoin(clients, eq(clients.id, sales.clientId))
      .where(and(...dateBetween(sales.businessDate, range)))
      .orderBy(asc(sales.number))
    return [
      [
        'Sale #',
        'Business date',
        'Branch',
        'Client',
        'Status',
        'Subtotal AED',
        'Discount AED',
        'VAT AED',
        'Total AED',
        'Tips AED',
        'Void reason',
        'Created',
      ],
      ...rows.map(({ s, client }) => [
        s.number,
        s.businessDate,
        l.branch.get(s.branchId) ?? '',
        client ?? '',
        s.status,
        s.subtotalAed,
        s.discountAed,
        s.vatAed,
        s.totalAed,
        s.tipsAed,
        s.voidReason,
        dubaiStamp(s.createdAt),
      ]),
    ]
  }

  if (dataset === 'sale_lines') {
    const l = await lookups(tx)
    const rows = await tx
      .select({ line: saleLines, number: sales.number, date: sales.businessDate, status: sales.status })
      .from(saleLines)
      .innerJoin(sales, eq(sales.id, saleLines.saleId))
      .where(and(...dateBetween(sales.businessDate, range)))
      .orderBy(asc(sales.number))
    return [
      [
        'Sale #',
        'Business date',
        'Sale status',
        'Kind',
        'Description',
        'Qty',
        'Unit price AED',
        'Discount AED',
        'VAT rate %',
        'Line total AED',
        'Therapist',
      ],
      ...rows.map(({ line, number, date, status }) => [
        number,
        date,
        status,
        line.kind,
        line.description,
        line.qty,
        line.unitPriceAed,
        line.discountAed,
        line.vatRate,
        line.lineTotalAed,
        line.staffId ? (l.staff.get(line.staffId) ?? '') : '',
      ]),
    ]
  }

  if (dataset === 'payments') {
    const l = await lookups(tx)
    const rows = await tx
      .select({ p: payments, number: sales.number })
      .from(payments)
      .innerJoin(sales, eq(sales.id, payments.saleId))
      .where(and(...dateBetween(payments.businessDate, range)))
      .orderBy(asc(payments.createdAt))
    return [
      ['Sale #', 'Business date', 'Branch', 'Method', 'Amount AED', 'Reference', 'Recorded at'],
      ...rows.map(({ p, number }) => [
        number,
        p.businessDate,
        l.branch.get(p.branchId) ?? '',
        p.method,
        p.amountAed,
        p.reference,
        dubaiStamp(p.createdAt),
      ]),
    ]
  }

  if (dataset === 'expenses') {
    const l = await lookups(tx)
    const accounts = new Map(
      (await tx.select({ code: ledgerAccounts.code, name: ledgerAccounts.name }).from(ledgerAccounts)).map(
        (a) => [a.code, a.name],
      ),
    )
    const rows = await tx
      .select()
      .from(expenses)
      .where(and(...dateBetween(expenses.expenseDate, range)))
      .orderBy(asc(expenses.expenseDate))
    return [
      [
        'Date',
        'Account',
        'Category',
        'Supplier',
        'Description',
        'Amount AED',
        'VAT AED',
        'Paid via',
        'Branch',
        'Recorded at',
      ],
      ...rows.map((e) => [
        e.expenseDate,
        e.accountCode,
        accounts.get(e.accountCode) ?? '',
        e.vendor,
        e.description,
        e.amountAed,
        e.vatAed,
        e.paidVia,
        e.branchId ? (l.branch.get(e.branchId) ?? '') : '',
        dubaiStamp(e.createdAt),
      ]),
    ]
  }

  // products: current snapshot, one row per product and branch holding stock.
  const l = await lookups(tx)
  const rows = await tx
    .select({ p: products, branchId: stockLevels.branchId, qty: stockLevels.qty })
    .from(products)
    .leftJoin(stockLevels, eq(stockLevels.productId, products.id))
    .orderBy(asc(products.createdAt))
  return [
    [
      'SKU',
      'Name',
      'Name (Arabic)',
      'Type',
      'Unit',
      'Cost AED',
      'Price AED',
      'Low stock at',
      'Active',
      'Branch',
      'Stock',
    ],
    ...rows.map(({ p, branchId, qty }) => [
      p.sku,
      p.name.en,
      p.name.ar ?? '',
      p.kind,
      p.unit,
      p.costAed,
      p.priceAed,
      p.lowStockAt,
      p.active ? 'yes' : 'no',
      branchId ? (l.branch.get(branchId) ?? '') : qty != null ? 'Warehouse' : '',
      qty ?? '0',
    ]),
  ]
}

/** Columns never exported: credentials, token hashes and raw file bytes. */
const SECRET_COLUMN = /(token|secret|password|hash|_enc)$|^bytes$/

const PHONE_COLUMN = /phone/

export type ExportTable = { file: string; table: string; rows: unknown[][] }

/** Every tenant-scoped table (RLS tenant policy) as header + rows, secrets removed. */
export async function fullExportTables(tx: Tx, opts: { phones: boolean }): Promise<ExportTable[]> {
  const out: ExportTable[] = []
  const tables = (Object.values(schema) as unknown[])
    .filter((t): t is PgTable => is(t, PgTable))
    .map((t) => ({ t, cfg: getTableConfig(t) }))
    .filter(({ cfg }) => cfg.policies.some((p) => p.name === 'tenant_isolation'))
    .sort((a, b) => a.cfg.name.localeCompare(b.cfg.name))
  for (const { t, cfg } of tables) {
    const cols = Object.entries(getTableColumns(t)).filter(
      ([, c]) => c.name !== 'tenant_id' && !SECRET_COLUMN.test(c.name),
    )
    // Only the exported columns: keeps stored file bytes and secrets out of memory entirely.
    const rows = (await tx.select(Object.fromEntries(cols)).from(t)) as Record<string, unknown>[]
    out.push({
      file: `${cfg.name}.csv`,
      table: cfg.name,
      rows: [
        cols.map(([, c]) => c.name),
        ...rows.map((r) =>
          cols.map(([key, c]) => (PHONE_COLUMN.test(c.name) && !opts.phones ? '' : (r[key] ?? null))),
        ),
      ],
    })
  }
  return out
}

/** README.txt for the full export zip. */
export function fullExportReadme(opts: {
  spa: string
  slug: string
  generatedAt: Date
  tables: { file: string; count: number }[]
  phones: boolean
}) {
  return [
    `Data export for ${opts.spa} (${opts.slug})`,
    `Generated ${dubaiStamp(opts.generatedAt)} Asia/Dubai`,
    '',
    'Each CSV file is one table of your data: UTF-8 with a byte-order mark, comma-separated, first row = column names.',
    '- Timestamps are ISO 8601 in UTC; business dates (YYYY-MM-DD) follow your branch business day.',
    '- Money columns are AED and VAT-inclusive unless the column says otherwise (e.g. vat_aed).',
    '- Bilingual text, preferences and settings are JSON, e.g. {"en":"Swedish massage","ar":"..."}.',
    '- Phone numbers are E.164 digits without "+" (971501234567).',
    '- Cells that start with = + - @ are prefixed with an apostrophe so spreadsheets do not run them.',
    '- Access tokens, invitation/session hashes and uploaded file bytes are not included.',
    ...(opts.phones ? [] : ['- Phone numbers are blank: your role cannot see phone numbers.']),
    '',
    'Files:',
    ...opts.tables.map((t) => `  ${t.file.padEnd(32)} ${t.count} rows`),
    '',
  ].join('\r\n')
}

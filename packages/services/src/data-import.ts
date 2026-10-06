// CSV import, database side: duplicate lookup for the preview and the chunked import itself
// (one transaction per IMPORT_CHUNK rows, so a bad chunk never loses the rest of the file).
import { businessDateOf } from '@spa/core'
import {
  branches,
  clients,
  type Db,
  products,
  serviceCategories,
  services,
  serviceVariants,
  stockLevels,
  stockMovements,
  type Tx,
  withTenant,
} from '@spa/db'
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import {
  type ClientRecord,
  IMPORT_CHUNK,
  type ImportKind,
  type MenuRecord,
  type ProductRecord,
  type ValidatedRow,
} from './data-io'
import { DomainError } from './errors'
import { adjustStock } from './inventory'
import { post } from './ledger'

export type DuplicateMode = 'update' | 'skip'
export type ImportError = { row: number; message: string }
export type ImportSummary = {
  total: number
  created: number
  updated: number
  skipped: number
  errors: ImportError[]
}
type Outcome = { row: number; result: 'created' | 'updated' | 'skipped' }

const chunks = <T>(list: T[], size: number) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size))

/** Row numbers (valid rows only) whose client, menu item or product already exists. */
export async function existingRows(tx: Tx, kind: ImportKind, rows: ValidatedRow[]): Promise<Set<number>> {
  const found = new Set<string>()
  const valid = rows.filter((r) => r.record && r.key)
  if (!valid.length) return new Set()
  if (kind === 'clients') {
    const phones = valid.flatMap((r) => (r.key!.startsWith('name:') ? [] : [r.key!]))
    for (const part of chunks(phones, 2000)) {
      const hits = await tx
        .select({ phone: clients.phoneE164 })
        .from(clients)
        .where(inArray(clients.phoneE164, part))
      for (const h of hits) if (h.phone) found.add(h.phone)
    }
    if (valid.some((r) => r.key!.startsWith('name:'))) {
      const hits = await tx
        .select({ name: sql<string>`lower(${clients.name})` })
        .from(clients)
        .where(isNull(clients.phoneE164))
      for (const h of hits) found.add(`name:${h.name}`)
    }
    return new Set(valid.filter((r) => found.has(r.key!)).map((r) => r.row))
  }
  if (kind === 'menu') {
    const hits = await tx
      .select({ name: services.name, duration: serviceVariants.durationMin })
      .from(serviceVariants)
      .innerJoin(services, eq(services.id, serviceVariants.serviceId))
    for (const h of hits) found.add(`${h.name.en.toLowerCase()}|${h.duration}`)
    return new Set(valid.filter((r) => found.has(r.key!)).map((r) => r.row))
  }
  const index = productIndex(
    await tx.select({ id: products.id, sku: products.sku, name: products.name }).from(products),
  )
  return new Set(valid.filter((r) => findProduct(index, r.record as ProductRecord)).map((r) => r.row))
}

type ProductIndex = { bySku: Map<string, string>; byName: Map<string, string> }
const productIndex = (rows: { id: string; sku: string | null; name: { en: string } }[]): ProductIndex => {
  const index: ProductIndex = { bySku: new Map(), byName: new Map() }
  for (const p of rows) addProduct(index, p.id, p.sku, p.name.en)
  return index
}
const addProduct = (index: ProductIndex, id: string, sku: string | null, name: string) => {
  if (sku && !index.bySku.has(sku.toLowerCase())) index.bySku.set(sku.toLowerCase(), id)
  if (!index.byName.has(name.toLowerCase())) index.byName.set(name.toLowerCase(), id)
}
/** Same SKU, or else the same English name. */
const findProduct = (index: ProductIndex, p: ProductRecord) =>
  (p.sku ? index.bySku.get(p.sku.toLowerCase()) : undefined) ?? index.byName.get(p.name.toLowerCase())

async function importClients(
  tx: Tx,
  tenantId: string,
  rows: ValidatedRow<ClientRecord>[],
  mode: DuplicateMode,
): Promise<Outcome[]> {
  const out: Outcome[] = []
  const phones = rows.flatMap((r) => (r.record!.phone ? [r.record!.phone] : []))
  const byKey = new Map<string, { id: string; tags: string[] }>()
  if (phones.length) {
    const found = await tx
      .select({ id: clients.id, phone: clients.phoneE164, tags: clients.tags })
      .from(clients)
      .where(inArray(clients.phoneE164, phones))
    for (const c of found) byKey.set(c.phone!, c)
  }
  const names = rows.flatMap((r) => (r.record!.phone ? [] : [r.record!.name.toLowerCase()]))
  if (names.length) {
    const found = await tx
      .select({ id: clients.id, name: sql<string>`lower(${clients.name})`, tags: clients.tags })
      .from(clients)
      .where(and(isNull(clients.phoneE164), inArray(sql`lower(${clients.name})`, names)))
    for (const c of found) byKey.set(`name:${c.name}`, c)
  }
  const fresh: ValidatedRow<ClientRecord>[] = []
  for (const r of rows) {
    const rec = r.record!
    const existing = byKey.get(r.key!)
    if (!existing) {
      fresh.push(r)
      continue
    }
    if (mode === 'skip') {
      out.push({ row: r.row, result: 'skipped' })
      continue
    }
    const tags = [...existing.tags]
    for (const t of rec.tags) if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t)
    await tx
      .update(clients)
      .set({
        name: rec.name,
        ...(rec.gender ? { gender: rec.gender } : {}),
        ...(rec.birthday ? { birthday: rec.birthday } : {}),
        ...(rec.language ? { language: rec.language } : {}),
        ...(rec.notes ? { notes: rec.notes } : {}),
        ...(rec.source ? { source: rec.source } : {}),
        tags,
        updatedAt: new Date(),
      })
      .where(eq(clients.id, existing.id))
    out.push({ row: r.row, result: 'updated' })
  }
  if (fresh.length) {
    const inserted = await tx
      .insert(clients)
      .values(
        fresh.map(({ record: c }) => ({
          tenantId,
          name: c!.name,
          phoneE164: c!.phone,
          gender: c!.gender,
          birthday: c!.birthday,
          tags: c!.tags,
          notes: c!.notes,
          language: c!.language ?? 'en',
          source: c!.source ?? 'import',
        })),
      )
      .onConflictDoNothing()
      .returning({ phone: clients.phoneE164, name: clients.name })
    const made = new Set(inserted.map((c) => c.phone ?? `name:${c.name.toLowerCase()}`))
    for (const r of fresh) out.push({ row: r.row, result: made.has(r.key!) ? 'created' : 'skipped' })
  }
  return out
}

async function importMenu(
  tx: Tx,
  tenantId: string,
  rows: ValidatedRow<MenuRecord>[],
  mode: DuplicateMode,
): Promise<Outcome[]> {
  const out: Outcome[] = []
  const cats = new Map(
    (await tx.select({ id: serviceCategories.id, name: serviceCategories.name }).from(serviceCategories)).map(
      (c) => [c.name.en.toLowerCase(), c.id],
    ),
  )
  const svc = new Map<string, { id: string; variants: Map<number, string> }>()
  for (const s of await tx.select({ id: services.id, name: services.name }).from(services))
    svc.set(s.name.en.toLowerCase(), { id: s.id, variants: new Map() })
  const byId = new Map([...svc.values()].map((s) => [s.id, s]))
  for (const v of await tx
    .select({ id: serviceVariants.id, serviceId: serviceVariants.serviceId, d: serviceVariants.durationMin })
    .from(serviceVariants))
    byId.get(v.serviceId)?.variants.set(v.d, v.id)
  let sort = svc.size
  for (const r of rows) {
    const m = r.record!
    let categoryId: string | null = null
    if (m.category) {
      categoryId = cats.get(m.category.toLowerCase()) ?? null
      if (!categoryId) {
        const [c] = await tx
          .insert(serviceCategories)
          .values({ tenantId, name: { en: m.category }, sort: cats.size })
          .returning({ id: serviceCategories.id })
        categoryId = c!.id
        cats.set(m.category.toLowerCase(), categoryId)
      }
    }
    let s = svc.get(m.nameEn.toLowerCase())
    if (!s) {
      const [row] = await tx
        .insert(services)
        .values({
          tenantId,
          categoryId,
          name: m.nameAr ? { en: m.nameEn, ar: m.nameAr } : { en: m.nameEn },
          description: m.description ? { en: m.description } : null,
          sort: sort++,
        })
        .returning({ id: services.id })
      s = { id: row!.id, variants: new Map() }
      svc.set(m.nameEn.toLowerCase(), s)
    }
    const variantId = s.variants.get(m.durationMin)
    if (!variantId) {
      const [v] = await tx
        .insert(serviceVariants)
        .values({
          tenantId,
          serviceId: s.id,
          durationMin: m.durationMin,
          priceAed: m.priceAed.toFixed(2),
          sort: s.variants.size,
        })
        .returning({ id: serviceVariants.id })
      s.variants.set(m.durationMin, v!.id)
      out.push({ row: r.row, result: 'created' })
      continue
    }
    if (mode === 'skip') {
      out.push({ row: r.row, result: 'skipped' })
      continue
    }
    await tx
      .update(serviceVariants)
      .set({ priceAed: m.priceAed.toFixed(2), active: true })
      .where(eq(serviceVariants.id, variantId))
    const [current] = await tx.select({ name: services.name }).from(services).where(eq(services.id, s.id))
    await tx
      .update(services)
      .set({
        ...(m.nameAr ? { name: { ...current!.name, ar: m.nameAr } } : {}),
        ...(categoryId ? { categoryId } : {}),
        ...(m.description ? { description: { en: m.description } } : {}),
        updatedAt: new Date(),
      })
      .where(eq(services.id, s.id))
    out.push({ row: r.row, result: 'updated' })
  }
  return out
}

async function importProducts(
  tx: Tx,
  tenantId: string,
  rows: ValidatedRow<ProductRecord>[],
  mode: DuplicateMode,
  ctx: { userId: string | null; date: string; branchId: string | null },
): Promise<Outcome[]> {
  const out: Outcome[] = []
  const index = productIndex(
    await tx.select({ id: products.id, sku: products.sku, name: products.name }).from(products),
  )
  let openingValue = 0
  for (const r of rows) {
    const p = r.record!
    const id = findProduct(index, p)
    if (!id) {
      const [made] = await tx
        .insert(products)
        .values({
          tenantId,
          kind: p.kind ?? 'retail',
          sku: p.sku,
          name: p.nameAr ? { en: p.name, ar: p.nameAr } : { en: p.name },
          unit: p.unit ?? 'pcs',
          costAed: (p.costAed ?? 0).toFixed(2),
          priceAed: p.priceAed == null ? null : p.priceAed.toFixed(2),
        })
        .returning({ id: products.id })
      addProduct(index, made!.id, p.sku, p.name)
      if (p.stock && ctx.branchId) {
        await tx.insert(stockMovements).values({
          tenantId,
          branchId: ctx.branchId,
          productId: made!.id,
          kind: 'adjustment',
          qty: p.stock.toString(),
          unitCostAed: (p.costAed ?? 0).toFixed(2),
          refType: 'import',
          note: 'Opening stock (CSV import)',
          createdBy: ctx.userId,
        })
        await tx
          .insert(stockLevels)
          .values({ tenantId, branchId: ctx.branchId, productId: made!.id, qty: p.stock.toString() })
          .onConflictDoUpdate({
            target: [stockLevels.branchId, stockLevels.productId],
            set: { qty: sql`${stockLevels.qty} + ${p.stock}` },
          })
        openingValue += p.stock * (p.costAed ?? 0)
      }
      out.push({ row: r.row, result: 'created' })
      continue
    }
    if (mode === 'skip') {
      out.push({ row: r.row, result: 'skipped' })
      continue
    }
    const [current] = await tx.select({ name: products.name }).from(products).where(eq(products.id, id))
    await tx
      .update(products)
      .set({
        name: { ...current!.name, en: p.name, ...(p.nameAr ? { ar: p.nameAr } : {}) },
        ...(p.sku ? { sku: p.sku } : {}),
        ...(p.kind ? { kind: p.kind } : {}),
        ...(p.unit ? { unit: p.unit } : {}),
        ...(p.costAed != null ? { costAed: p.costAed.toFixed(2) } : {}),
        ...(p.priceAed != null ? { priceAed: p.priceAed.toFixed(2) } : {}),
        active: true,
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
    if (p.stock != null && ctx.branchId) {
      const [level] = await tx
        .select({ qty: stockLevels.qty })
        .from(stockLevels)
        .where(and(eq(stockLevels.branchId, ctx.branchId), eq(stockLevels.productId, id)))
      const diff = Math.round((p.stock - Number(level?.qty ?? 0)) * 1000) / 1000
      if (diff !== 0)
        await adjustStock(tx, {
          tenantId,
          branchId: ctx.branchId,
          productId: id,
          qty: diff,
          note: 'Stock count (CSV import)',
          date: ctx.date,
          createdBy: ctx.userId,
        })
    }
    out.push({ row: r.row, result: 'updated' })
  }
  const value = Math.round(openingValue * 100) / 100
  if (value > 0)
    await post(tx, {
      tenantId,
      branchId: ctx.branchId,
      date: ctx.date,
      sourceType: 'stock_adjustment',
      memo: 'Opening stock (CSV import)',
      createdBy: ctx.userId,
      lines: [
        { code: '1200', debit: value },
        { code: '3000', credit: value },
      ],
    })
  return out
}

/** Readable reason for a chunk that failed to save, without leaking SQL. */
function chunkError(e: unknown) {
  const msg = `${e instanceof Error ? e.message : ''} ${(e as { cause?: Error })?.cause?.message ?? ''}`
  if (/closed period|period lock|locked/i.test(msg))
    return 'Not saved: today is inside a closed accounting period'
  if (e instanceof DomainError) return `Not saved: ${e.message}`
  return 'Not saved: the database rejected this batch'
}

/**
 * Imports validated rows: rows with errors are reported, in-file duplicates skipped, and the rest
 * written in transactions of IMPORT_CHUNK rows each.
 */
export async function runImport(opts: {
  tenantId: string
  kind: ImportKind
  rows: ValidatedRow[]
  onDuplicate: DuplicateMode
  userId?: string | null
  chunkSize?: number
  db?: Db
}): Promise<ImportSummary> {
  const summary: ImportSummary = { total: opts.rows.length, created: 0, updated: 0, skipped: 0, errors: [] }
  const ready: ValidatedRow[] = []
  for (const r of opts.rows) {
    if (r.errors.length || !r.record) summary.errors.push({ row: r.row, message: r.errors.join('; ') })
    else if (r.dupOfRow != null) summary.skipped++
    else ready.push(r)
  }
  const run = <T>(fn: (tx: Tx) => Promise<T>) =>
    opts.db ? withTenant(opts.tenantId, fn, opts.db) : withTenant(opts.tenantId, fn)
  const branch =
    opts.kind === 'products'
      ? await run(async (tx) => {
          const [b] = await tx
            .select({ id: branches.id, cutoff: branches.businessDayCutoff })
            .from(branches)
            .where(eq(branches.active, true))
            .orderBy(desc(branches.isDefault), asc(branches.createdAt))
            .limit(1)
          return b ?? null
        })
      : null
  const ctx = {
    userId: opts.userId ?? null,
    branchId: branch?.id ?? null,
    date: businessDateOf(new Date(), branch?.cutoff ?? '05:00'),
  }
  for (const part of chunks(ready, opts.chunkSize ?? IMPORT_CHUNK)) {
    try {
      const outcomes = await run((tx) =>
        opts.kind === 'clients'
          ? importClients(tx, opts.tenantId, part as ValidatedRow<ClientRecord>[], opts.onDuplicate)
          : opts.kind === 'menu'
            ? importMenu(tx, opts.tenantId, part as ValidatedRow<MenuRecord>[], opts.onDuplicate)
            : importProducts(tx, opts.tenantId, part as ValidatedRow<ProductRecord>[], opts.onDuplicate, ctx),
      )
      for (const o of outcomes) summary[o.result]++
    } catch (e) {
      const message = chunkError(e)
      for (const r of part) summary.errors.push({ row: r.row, message })
    }
  }
  summary.errors.sort((a, b) => a.row - b.row)
  return summary
}

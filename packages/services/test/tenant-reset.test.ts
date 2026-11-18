// R40: "Reset spa data" — the spa's operational data goes, its setup stays, a snapshot is kept, other spas untouched.

import { gunzipSync } from 'node:zlib'
import { dubaiInstant } from '@spa/core'
import {
  bookings,
  branches,
  clients,
  closeAllDbs,
  counters,
  expenses,
  journalLines,
  promoCodes,
  rooms,
  sales,
  services,
  serviceVariants,
  staff,
  storedFiles,
  tenantResets,
  tenants,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createBooking,
  createSale,
  putFile,
  RESET_DELETE_TABLES,
  RESET_KEEP_TABLES,
  resetTenantData,
  tenantTables,
} from '../src'

const { platform, app } = testDbs()
const D = '2026-10-06'
const NOON = dubaiInstant(D, 12 * 60)

async function seedSpa(slug: string) {
  const [t] = await platform
    .insert(tenants)
    .values({ slug, name: `${slug} Spa` })
    .returning()
  const tenant = t!.id
  const ids = await withTenant(
    tenant,
    async (db) => {
      const [b] = await db
        .insert(branches)
        .values({ tenantId: tenant, name: 'Marina', isDefault: true })
        .returning()
      const [s] = await db
        .insert(services)
        .values({ tenantId: tenant, name: { en: 'Swedish' } })
        .returning()
      const [v] = await db
        .insert(serviceVariants)
        .values({ tenantId: tenant, serviceId: s!.id, durationMin: 60, priceAed: '350' })
        .returning()
      const [p] = await db
        .insert(staff)
        .values({ tenantId: tenant, displayName: 'Maya', payType: 'sales_commission', commissionPct: '10' })
        .returning()
      const [r] = await db
        .insert(rooms)
        .values({ tenantId: tenant, branchId: b!.id, name: 'Room 1' })
        .returning()
      const [c] = await db
        .insert(clients)
        .values({ tenantId: tenant, name: 'Fatima Al Ali', phoneE164: '971501234567' })
        .returning()
      const booking = await createBooking(db, {
        tenantId: tenant,
        branchId: b!.id,
        clientId: c!.id,
        source: 'phone',
        status: 'confirmed',
        allowOffShift: true,
        items: [{ serviceVariantId: v!.id, start: NOON, staffIds: [p!.id], roomId: r!.id }],
      })
      await createSale(db, {
        tenantId: tenant,
        branchId: b!.id,
        bookingId: booking.id,
        lines: [{ kind: 'service', description: 'Swedish 60', qty: 1, unitPriceAed: 350, staffId: p!.id }],
        payments: [{ method: 'cash', amountAed: 350 }],
        now: NOON,
      })
      const receipt = await putFile(db, {
        tenantId: tenant,
        bytes: Buffer.from('receipt'),
        contentType: 'image/png',
        purpose: 'receipt',
      })
      const logo = await putFile(db, {
        tenantId: tenant,
        bytes: Buffer.from('logo'),
        contentType: 'image/png',
        purpose: 'logo',
      })
      await db.insert(expenses).values({
        tenantId: tenant,
        branchId: b!.id,
        expenseDate: D,
        accountCode: '6100',
        amountAed: '20',
        paidVia: 'cash',
        receiptUrl: `/files/${receipt.id}`,
      })
      await db
        .insert(promoCodes)
        .values({ tenantId: tenant, code: 'WELCOME', kind: 'percent', value: '10', uses: 3 })
      return { service: s!.id, staff: p!.id, receipt: receipt.id, logo: logo.id }
    },
    app,
  )
  return { tenant, ...ids }
}

const count = async (tenant: string) => ({
  clients: (await platform.select().from(clients).where(eq(clients.tenantId, tenant))).length,
  bookings: (await platform.select().from(bookings).where(eq(bookings.tenantId, tenant))).length,
  sales: (await platform.select().from(sales).where(eq(sales.tenantId, tenant))).length,
  ledger: (await platform.select().from(journalLines).where(eq(journalLines.tenantId, tenant))).length,
  counters: (await platform.select().from(counters).where(eq(counters.tenantId, tenant))).length,
})

let a: Awaited<ReturnType<typeof seedSpa>>
let b: Awaited<ReturnType<typeof seedSpa>>

beforeAll(async () => {
  await resetTestDatabase()
  a = await seedSpa('reseta')
  b = await seedSpa('resetb')
})
afterAll(closeAllDbs)

describe('resetTenantData (R40)', () => {
  it('classifies every tenant table as deleted or kept (a new table must be added to one list)', async () => {
    const all = await tenantTables(platform)
    const listed = new Set<string>([...RESET_DELETE_TABLES, ...RESET_KEEP_TABLES])
    expect(all.filter((t) => !listed.has(t))).toEqual([])
    expect(RESET_DELETE_TABLES.filter((t) => (RESET_KEEP_TABLES as readonly string[]).includes(t))).toEqual(
      [],
    )
  })

  it('refuses without the spa name', async () => {
    await expect(resetTenantData(platform, a.tenant, 'reseta')).rejects.toThrow('Type reseta Spa to confirm')
  })

  it('deletes the operational data, keeps the setup, snapshots and records it; the other spa is untouched', async () => {
    const before = await count(a.tenant)
    expect(before).toMatchObject({ clients: 1, bookings: 1, sales: 1, counters: 1 })
    expect(before.ledger).toBeGreaterThan(0)
    const otherBefore = await count(b.tenant)

    const r = await resetTenantData(platform, a.tenant, '  RESETA   spa ', { actorUserId: null })
    expect(r.counts).toMatchObject({ clients: 1, bookings: 1, sales: 1, expenses: 1, counters: 1 })
    expect(r.filesDeleted).toBe(1)
    expect(r.errors).toEqual([])

    expect(await count(a.tenant)).toEqual({ clients: 0, bookings: 0, sales: 0, ledger: 0, counters: 0 })
    expect(await count(b.tenant)).toEqual(otherBefore)
    // Setup kept; the receipt file went, the logo stayed; promo code uses back to 0.
    expect(await platform.select().from(services).where(eq(services.id, a.service))).toHaveLength(1)
    expect(await platform.select().from(staff).where(eq(staff.id, a.staff))).toHaveLength(1)
    expect(await platform.select().from(storedFiles).where(eq(storedFiles.id, a.receipt))).toHaveLength(0)
    expect(await platform.select().from(storedFiles).where(eq(storedFiles.id, a.logo))).toHaveLength(1)
    const [promo] = await platform.select().from(promoCodes).where(eq(promoCodes.tenantId, a.tenant))
    expect(promo!.uses).toBe(0)

    const [rec] = await platform.select().from(tenantResets).where(eq(tenantResets.resetTenantId, a.tenant))
    const snap = JSON.parse(gunzipSync(rec!.snapshot).toString()) as { tables: Record<string, unknown[]> }
    expect(snap.tables.clients).toHaveLength(1)
    expect(snap.tables.journal_lines!.length).toBe(before.ledger)
    expect(snap.tables.stored_files).toHaveLength(1)
    expect(rec!.slug).toBe('reseta')
  })

  it('lets the spa start again: the first new sale is number 1', async () => {
    const n = await withTenant(
      a.tenant,
      async (db) => {
        const [br] = await db.select().from(branches).where(eq(branches.tenantId, a.tenant))
        const { sale } = await createSale(db, {
          tenantId: a.tenant,
          branchId: br!.id,
          lines: [
            { kind: 'service', description: 'Swedish 60', qty: 1, unitPriceAed: 350, staffId: a.staff },
          ],
          payments: [{ method: 'cash', amountAed: 350 }],
          now: NOON,
        })
        return sale.number
      },
      app,
    )
    expect(String(n)).toMatch(/(^|\D)0*1$/)
  })
})

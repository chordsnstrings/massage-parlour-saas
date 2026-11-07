import { dubaiInstant } from '@spa/core'
import {
  auditLog,
  bookings,
  branches,
  clients,
  closeAllDbs,
  conversationMessages,
  conversations,
  domains,
  intakeSubmissions,
  journalLines,
  outbox,
  platformSettings,
  rooms,
  sales,
  services,
  serviceVariants,
  staff,
  tenantPurges,
  tenants,
  treatmentNotes,
  waitlistEntries,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq, sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  autoPurgeDeletedTenants,
  countTenantRows,
  createBooking,
  createSale,
  DomainError,
  deleteTenant,
  deleteTenantObjects,
  ERASED_CLIENT_NAME,
  eraseClient,
  purgeTenant,
  putFile,
  tenantTables,
} from '../src'

const { owner, platform, app } = testDbs()
const D = '2026-10-06'
const NOON = dubaiInstant(D, 12 * 60)

type Spa = { tenant: string; branch: string; client: string; booking: string; sale: string }

/** A spa with rows in the common tables: catalogue, staff, client, booking (+ reservations), sale (+ ledger). */
async function seedSpa(slug: string): Promise<Spa> {
  const [t] = await platform
    .insert(tenants)
    .values({ slug, name: `${slug} Spa` })
    .returning()
  const tenant = t!.id
  const out = await withTenant(
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
        .values({
          tenantId: tenant,
          name: 'Fatima Al Ali',
          phoneE164: '971501234567',
          email: 'fatima@example.com',
          birthday: '1990-02-03',
          nationality: 'AE',
          tags: ['vip'],
          notes: 'Prefers the corner room',
          preferences: { allergies: 'Nut oils' },
        })
        .returning()
      const booking = await createBooking(db, {
        tenantId: tenant,
        branchId: b!.id,
        clientId: c!.id,
        source: 'phone',
        status: 'confirmed',
        allowOffShift: true,
        notes: 'Allergic to nut oils',
        items: [{ serviceVariantId: v!.id, start: NOON, staffIds: [p!.id], roomId: r!.id }],
      })
      const { sale } = await createSale(db, {
        tenantId: tenant,
        branchId: b!.id,
        bookingId: booking.id,
        lines: [{ kind: 'service', description: 'Swedish 60', qty: 1, unitPriceAed: 350, staffId: p!.id }],
        payments: [{ method: 'cash', amountAed: 350 }],
        now: NOON,
      })
      await db.insert(treatmentNotes).values({ tenantId: tenant, clientId: c!.id, text: 'Tight shoulders' })
      await db.insert(intakeSubmissions).values({
        tenantId: tenant,
        clientId: c!.id,
        templateVersion: 1,
        answers: { pregnant: 'no', conditions: 'Back pain' },
        waiverText: 'I agree',
        signature: 'M0 0 L10 10',
      })
      const [conv] = await db
        .insert(conversations)
        .values({ tenantId: tenant, channel: 'instagram', externalThreadId: `t-${slug}`, clientId: c!.id })
        .returning()
      await db.insert(conversationMessages).values({
        tenantId: tenant,
        conversationId: conv!.id,
        direction: 'in',
        sender: 'customer',
        text: 'Hi',
      })
      await db
        .insert(waitlistEntries)
        .values({ tenantId: tenant, branchId: b!.id, clientId: c!.id, businessDate: D })
      await putFile(db, {
        tenantId: tenant,
        bytes: Buffer.from('logo'),
        contentType: 'image/png',
        isPublic: true,
      })
      return { branch: b!.id, client: c!.id, booking: booking.id, sale: sale.id }
    },
    app,
  )
  await platform.insert(domains).values({ tenantId: tenant, hostname: `${slug}.example.com`, kind: 'custom' })
  await platform.insert(auditLog).values({ tenantId: tenant, action: 'test.seeded' })
  return { tenant, ...out }
}

let a: Spa
let b: Spa
beforeAll(async () => {
  await resetTestDatabase()
  a = await seedSpa('purge-a')
  b = await seedSpa('purge-b')
})
afterAll(closeAllDbs)
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** Rows per tenant table, read as the table owner (no RLS). */
const rowsOf = (tenantId: string) => countTenantRows(owner, tenantId)

describe('client erase', () => {
  it('anonymises the client and removes personal records, keeping sales, ledger and bookings', async () => {
    const ledgerBefore = await withTenant(
      b.tenant,
      (db) => db.select({ d: sql<string>`sum(debit_aed)` }).from(journalLines),
      app,
    )
    const { client, removed } = await withTenant(b.tenant, (db) => eraseClient(db, b.client), app)
    expect(client).toMatchObject({
      name: ERASED_CLIENT_NAME,
      phoneE164: null,
      email: null,
      birthday: null,
      nationality: null,
      notes: null,
      tags: [],
      preferences: {},
    })
    expect(client.erasedAt).toBeInstanceOf(Date)
    expect(client.marketingOptOutAt).toBeInstanceOf(Date)
    expect(removed).toMatchObject({
      treatmentNotes: 1,
      intakeSubmissions: 1,
      conversations: 1,
      conversationMessages: 1,
      waitlistEntries: 1,
      bookingNotes: 1,
    })
    expect(removed.outbox).toBeGreaterThanOrEqual(1)
    await withTenant(
      b.tenant,
      async (db) => {
        const [sale] = await db.select().from(sales).where(eq(sales.id, b.sale))
        expect(sale).toMatchObject({ clientId: b.client, totalAed: '350.00', status: 'paid' })
        const [booking] = await db.select().from(bookings).where(eq(bookings.id, b.booking))
        expect(booking).toMatchObject({ clientId: b.client, notes: null })
        for (const table of [treatmentNotes, intakeSubmissions, outbox, conversations, waitlistEntries]) {
          const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table)
          expect(row!.n).toBe(0)
        }
        const [msgs] = await db.select({ n: sql<number>`count(*)::int` }).from(conversationMessages)
        expect(msgs!.n).toBe(0)
        const ledgerAfter = await db.select({ d: sql<string>`sum(debit_aed)` }).from(journalLines)
        expect(ledgerAfter).toEqual(ledgerBefore)
      },
      app,
    )
    // The other spa's client is untouched.
    const [other] = await withTenant(
      a.tenant,
      (db) => db.select().from(clients).where(eq(clients.id, a.client)),
      app,
    )
    expect(other!.name).toBe('Fatima Al Ali')
  })

  it('cannot reach another spa’s client', async () => {
    await expect(withTenant(b.tenant, (db) => eraseClient(db, a.client), app)).rejects.toBeInstanceOf(
      DomainError,
    )
  })
})

describe('tenant purge', () => {
  it('lists every tenant table from the catalog', async () => {
    const tables = await tenantTables(platform)
    expect(tables).toEqual(
      expect.arrayContaining(['clients', 'journal_entries', 'stored_files', 'audit_log']),
    )
    expect(tables).not.toContain('tenant_purges')
  })

  it('refuses a live spa and a wrong confirmation', async () => {
    await expect(purgeTenant(platform, a.tenant, 'purge-a', { cf: null })).rejects.toThrow(
      /Delete the spa first/,
    )
    await deleteTenant(platform, a.tenant, 'purge-a')
    await expect(purgeTenant(platform, a.tenant, 'purge-b', { cf: null })).rejects.toThrow(/Type purge-a/)
  })

  it('removes every row of the deleted spa (ledger included), leaves the other spa alone and keeps a record', async () => {
    const before = await rowsOf(a.tenant)
    expect(before.journal_entries).toBeGreaterThan(0)
    expect(before.stored_files).toBe(1)
    const otherBefore = await rowsOf(b.tenant)
    const rec = await purgeTenant(platform, a.tenant, ' Purge-A ', { actorUserId: 'admin-1', cf: null })
    expect(rec).toMatchObject({ slug: 'purge-a', purgedBy: 'admin-1', mode: 'manual', errors: [] })
    expect(rec.counts).toMatchObject({ tenants: 1, sales: 1, clients: 1, domains: 1 })
    expect(rec.counts.journal_lines).toBe(before.journal_lines)

    // Generic: no tenant table holds a row for the purged spa.
    expect(await rowsOf(a.tenant)).toEqual({})
    const [gone] = await owner.select().from(tenants).where(eq(tenants.id, a.tenant))
    expect(gone).toBeUndefined()
    expect(await rowsOf(b.tenant)).toEqual(otherBefore)
    const [kept] = await platform.select().from(tenantPurges).where(eq(tenantPurges.purgedTenantId, a.tenant))
    expect(kept).toMatchObject({ slug: 'purge-a', name: 'purge-a Spa' })
  })

  it('deletes Cloudflare hostnames and bucket objects under the tenant prefix', async () => {
    const c = await seedSpa('purge-c')
    await platform.update(domains).set({ cfHostnameId: 'cf-123' }).where(eq(domains.tenantId, c.tenant))
    await deleteTenant(platform, c.tenant, 'purge-c')
    vi.stubEnv('S3_ENDPOINT', 'https://s3.example.com')
    vi.stubEnv('S3_BUCKET', 'spa')
    vi.stubEnv('S3_ACCESS_KEY_ID', 'k')
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 's')
    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init)
      calls.push(`${req.method} ${req.url}`)
      if (req.method === 'GET')
        return new Response(
          `<ListBucketResult><Key>${c.tenant}/f1</Key><Key>${c.tenant}/f2</Key><IsTruncated>false</IsTruncated></ListBucketResult>`,
        )
      return new Response(null, { status: 204 })
    })
    const cfCalls: string[] = []
    const cf = {
      token: 't',
      zoneId: 'z',
      fetch: (async (url: string, init?: RequestInit) => {
        cfCalls.push(`${init?.method} ${url}`)
        return Response.json({ success: true, result: { id: 'cf-123' } })
      }) as typeof fetch,
    }
    const rec = await purgeTenant(platform, c.tenant, 'purge-c', { cf })
    expect(cfCalls.some((x) => x.startsWith('DELETE') && x.includes('cf-123'))).toBe(true)
    expect(rec.objectsDeleted).toBe(2)
    expect(calls.filter((x) => x.startsWith('DELETE'))).toHaveLength(2)
    expect(calls[0]).toContain(`prefix=${c.tenant}%2F`)
    expect(await rowsOf(c.tenant)).toEqual({})
  })

  it('bucket clean-up is a no-op without S3 settings', async () => {
    expect(await deleteTenantObjects(b.tenant)).toEqual({ deleted: 0, errors: [] })
  })

  it('auto purge is off by default and only takes spas deleted longer ago than the setting', async () => {
    const old = await seedSpa('purge-old')
    const recent = await seedSpa('purge-new')
    const now = new Date()
    await platform
      .update(tenants)
      .set({ status: 'cancelled', deletedAt: new Date(now.getTime() - 50 * 86_400_000) })
      .where(eq(tenants.id, old.tenant))
    await platform
      .update(tenants)
      .set({ status: 'cancelled', deletedAt: new Date(now.getTime() - 10 * 86_400_000) })
      .where(eq(tenants.id, recent.tenant))
    expect(await autoPurgeDeletedTenants(platform, { cf: null })).toMatchObject({
      enabled: false,
      purged: [],
    })
    // 5 days is raised to the 30-day minimum, so the 10-day-old deletion stays.
    await platform
      .insert(platformSettings)
      .values({ id: 1, autoPurgeDays: 5 })
      .onConflictDoUpdate({
        target: platformSettings.id,
        set: { autoPurgeDays: 5 },
      })
    const res = await autoPurgeDeletedTenants(platform, { cf: null })
    expect(res).toMatchObject({ enabled: true, days: 30, purged: ['purge-old'], failed: [] })
    expect(await rowsOf(old.tenant)).toEqual({})
    expect((await rowsOf(recent.tenant)).clients).toBe(1)
    const [rec] = await platform
      .select()
      .from(tenantPurges)
      .where(eq(tenantPurges.purgedTenantId, old.tenant))
    expect(rec).toMatchObject({ mode: 'auto', purgedBy: null })
  })
})

// X5 (PLAN §14.7 B4): global search (tenant-scoped, ranked, paginated, permission-scoped) + audit log viewer.
import { dubaiInstant } from '@spa/core'
import {
  auditLog,
  bookingItems,
  bookings,
  branches,
  clients,
  closeAllDbs,
  sales,
  services,
  staff,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { auditFilterOptions, globalSearch, listAuditLog, type SearchScope } from '../src'

const { platform, app } = testDbs()
const as = <T>(tenant: string, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(tenant, fn, app)
const D = '2026-10-06'

async function seedSpa(slug: string, clientName: string) {
  const [t] = await platform.insert(tenants).values({ slug, name: slug }).returning()
  const tenantId = t!.id
  return as(tenantId, async (db) => {
    const [b] = await db.insert(branches).values({ tenantId, name: 'Main', isDefault: true }).returning()
    const [b2] = await db.insert(branches).values({ tenantId, name: 'Marina' }).returning()
    const [c] = await db
      .insert(clients)
      .values([
        { tenantId, name: clientName, phoneE164: '971501234567' },
        { tenantId, name: `${clientName} Junior`, phoneE164: '971559998877' },
        { tenantId, name: 'Zed Other' },
      ])
      .returning()
    const [maya, lina] = await db
      .insert(staff)
      .values([
        { tenantId, displayName: 'Maya Therapist' },
        { tenantId, displayName: 'Lina' },
      ])
      .returning()
    await db.insert(services).values({ tenantId, name: { en: 'Thai Massage', ar: 'مساج تايلندي' } })
    const start = dubaiInstant(D, 15 * 60)
    const end = new Date(start.getTime() + 3600_000)
    const bk = await db
      .insert(bookings)
      .values([
        {
          tenantId,
          branchId: b!.id,
          clientId: c!.id,
          refCode: 'ABCDE',
          source: 'walk_in',
          businessDate: D,
          startsAt: start,
          endsAt: end,
        },
        {
          tenantId,
          branchId: b2!.id,
          clientId: c!.id,
          refCode: 'XYZQW',
          source: 'online',
          businessDate: D,
          startsAt: start,
          endsAt: end,
        },
      ])
      .returning()
    await db.insert(bookingItems).values([
      {
        tenantId,
        bookingId: bk[0]!.id,
        serviceName: 'Thai',
        durationMin: 60,
        startsAt: start,
        endsAt: end,
        staffIds: [maya!.id],
      },
      {
        tenantId,
        bookingId: bk[1]!.id,
        serviceName: 'Thai',
        durationMin: 60,
        startsAt: start,
        endsAt: end,
        staffIds: [lina!.id],
      },
    ])
    await db.insert(sales).values({
      tenantId,
      branchId: b!.id,
      clientId: c!.id,
      number: 1042,
      businessDate: D,
      subtotalAed: '300',
      totalAed: '300',
      status: 'paid',
    })
    return { tenantId, branch: b!.id, branch2: b2!.id, client: c!.id, maya: maya!.id, lina: lina!.id }
  })
}

const full = (s: Awaited<ReturnType<typeof seedSpa>>): SearchScope => ({
  clients: { phone: true },
  bookings: { branchIds: [s.branch, s.branch2] },
  sales: { branchIds: [s.branch, s.branch2] },
  staff: true,
  services: true,
})

let a: Awaited<ReturnType<typeof seedSpa>>
let b: Awaited<ReturnType<typeof seedSpa>>
beforeAll(async () => {
  await resetTestDatabase()
  a = await seedSpa('search-a', 'Fatima Al Nuaimi')
  b = await seedSpa('search-b', 'Fatima Other Spa')
  await platform.insert(user).values([
    { id: 'u-owner', name: 'Aisha Owner', email: 'aisha@x5.test' },
    { id: 'u-admin', name: 'Platform Admin', email: 'admin@x5.test' },
    { id: 'u-b', name: 'Other Spa Owner', email: 'b@x5.test' },
  ])
  const at = (h: number) => new Date(Date.UTC(2026, 9, 5, h))
  await platform.insert(auditLog).values([
    {
      tenantId: a.tenantId,
      actorUserId: 'u-owner',
      action: 'settings.updated',
      entity: 'tenant',
      createdAt: at(6),
    },
    {
      tenantId: a.tenantId,
      actorUserId: 'u-owner',
      action: 'client.created',
      entity: 'client',
      entityId: a.client,
      createdAt: dubaiInstant('2026-10-07', 600),
    },
    {
      tenantId: a.tenantId,
      actorUserId: 'u-admin',
      impersonatorUserId: 'u-admin',
      action: 'site.published',
      createdAt: at(8),
    },
    { tenantId: a.tenantId, action: 'booking.reminder', createdAt: at(9) },
    { tenantId: b.tenantId, actorUserId: 'u-b', action: 'settings.updated', createdAt: at(7) },
    { tenantId: null, actorUserId: 'u-admin', action: 'platform.plan.updated', createdAt: at(7) },
  ])
})
afterAll(closeAllDbs)

describe('global search', () => {
  it('finds clients by name and ranks the exact name first, only in this tenant', async () => {
    const groups = await as(a.tenantId, (tx) => globalSearch(tx, 'fatima al nuaimi', full(a)))
    const c = groups.find((g) => g.kind === 'clients')!
    expect(c.hits.map((h) => h.title)).toEqual(['Fatima Al Nuaimi', 'Fatima Al Nuaimi Junior'])
    expect(c.hits[0]!.phone).toBe('971501234567')
    const all = groups.flatMap((g) => g.hits.map((h) => h.clientName ?? h.title))
    expect(all.some((n) => n.includes('Other Spa'))).toBe(false)
  })

  it('matches phones (local 05x form too) only with clients.phone, and never returns them without it', async () => {
    const withPhone = await as(a.tenantId, (tx) => globalSearch(tx, '050 123 4567', full(a)))
    expect(withPhone.find((g) => g.kind === 'clients')?.hits.map((h) => h.title)).toEqual([
      'Fatima Al Nuaimi',
    ])
    const scope = { ...full(a), clients: { phone: false } }
    expect(await as(a.tenantId, (tx) => globalSearch(tx, '0501234567', scope))).toEqual([])
    const byName = await as(a.tenantId, (tx) => globalSearch(tx, 'fatima', scope))
    expect(byName.find((g) => g.kind === 'clients')!.hits.every((h) => h.phone === null)).toBe(true)
  })

  it('finds bookings by reference and client, within allowed branches and own-therapist scope', async () => {
    const byRef = await as(a.tenantId, (tx) => globalSearch(tx, 'abcde', full(a)))
    expect(byRef.find((g) => g.kind === 'bookings')?.hits[0]).toMatchObject({
      refCode: 'ABCDE',
      clientName: 'Fatima Al Nuaimi',
    })
    const oneBranch = await as(a.tenantId, (tx) =>
      globalSearch(tx, 'fatima', { bookings: { branchIds: [a.branch] } }),
    )
    expect(oneBranch.map((g) => g.kind)).toEqual(['bookings'])
    expect(oneBranch[0]!.hits.map((h) => h.refCode)).toEqual(['ABCDE'])
    const lina = await as(a.tenantId, (tx) =>
      globalSearch(tx, 'fatima', { bookings: { branchIds: [a.branch, a.branch2], staffId: a.lina } }),
    )
    expect(lina[0]!.hits.map((h) => h.refCode)).toEqual(['XYZQW'])
  })

  it('finds receipts by number, staff and services (EN or AR name), skipping groups outside the scope', async () => {
    const r = await as(a.tenantId, (tx) => globalSearch(tx, '#1042', full(a)))
    expect(r.find((g) => g.kind === 'sales')?.hits[0]).toMatchObject({ number: 1042, totalAed: '300.00' })
    expect((await as(a.tenantId, (tx) => globalSearch(tx, 'maya', full(a))))[0]).toMatchObject({
      kind: 'staff',
      hits: [{ title: 'Maya Therapist' }],
    })
    expect((await as(a.tenantId, (tx) => globalSearch(tx, 'تايلندي', full(a))))[0]?.hits[0]?.title).toBe(
      'Thai Massage',
    )
    expect(await as(a.tenantId, (tx) => globalSearch(tx, 'maya', { clients: { phone: true } }))).toEqual([])
  })

  it('tolerates a typo, escapes wildcards, ignores 1-char queries and pages one group', async () => {
    const typo = await as(a.tenantId, (tx) => globalSearch(tx, 'fatma', full(a)))
    expect(typo.find((g) => g.kind === 'clients')?.hits.length).toBeGreaterThan(0)
    expect(await as(a.tenantId, (tx) => globalSearch(tx, '%%', full(a)))).toEqual([])
    expect(await as(a.tenantId, (tx) => globalSearch(tx, 'f', full(a)))).toEqual([])
    const p1 = await as(a.tenantId, (tx) =>
      globalSearch(tx, 'fatima', full(a), { kind: 'clients', limit: 1 }),
    )
    expect(p1).toHaveLength(1)
    expect(p1[0]).toMatchObject({ hasMore: true })
    const p2 = await as(a.tenantId, (tx) =>
      globalSearch(tx, 'fatima', full(a), { kind: 'clients', limit: 1, page: 2 }),
    )
    expect(p2[0]!.hits[0]!.title).not.toBe(p1[0]!.hits[0]!.title)
    expect(p2[0]!.hasMore).toBe(false)
  })
})

describe('audit log viewer', () => {
  it('lists only this tenant, newest first, with actor names and support flag', async () => {
    const r = await as(a.tenantId, (tx) => listAuditLog(tx, {}, platform))
    expect(r.total).toBe(4)
    expect(r.entries.map((e) => e.action)).toEqual([
      'client.created',
      'booking.reminder',
      'site.published',
      'settings.updated',
    ])
    expect(r.entries[0]).toMatchObject({ actorName: 'Aisha Owner', support: false, entity: 'client' })
    expect(r.entries[1]).toMatchObject({ actorName: null, actorUserId: null })
    expect(r.entries[2]).toMatchObject({ actorName: 'Platform Admin', support: true })
  })

  it('filters by actor, action and Dubai date range, and paginates', async () => {
    const mine = await as(a.tenantId, (tx) => listAuditLog(tx, { actorUserId: 'u-owner' }, platform))
    expect(mine.total).toBe(2)
    const act = await as(a.tenantId, (tx) => listAuditLog(tx, { action: 'site.published' }, platform))
    expect(act.entries.map((e) => e.action)).toEqual(['site.published'])
    const day = await as(a.tenantId, (tx) =>
      listAuditLog(tx, { from: '2026-10-07', to: '2026-10-07' }, platform),
    )
    expect(day.entries.map((e) => e.action)).toEqual(['client.created'])
    const p2 = await as(a.tenantId, (tx) => listAuditLog(tx, { page: 2, pageSize: 3 }, platform))
    expect(p2.entries.map((e) => e.action)).toEqual(['settings.updated'])
  })

  it('offers filter choices from this tenant only', async () => {
    const o = await as(a.tenantId, (tx) => auditFilterOptions(tx, platform))
    expect(o.actors).toEqual([
      { id: 'u-owner', name: 'Aisha Owner' },
      { id: 'u-admin', name: 'Platform Admin' },
    ])
    expect(o.actions).toEqual(['booking.reminder', 'client.created', 'settings.updated', 'site.published'])
  })
})

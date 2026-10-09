import {
  branches,
  clients,
  closeAllDbs,
  memberBranches,
  members,
  roles,
  sales,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  branchesForMember,
  branchLimit,
  createBranch,
  DomainError,
  listBranches,
  memberBranchIds,
  saveSaleBilling,
  setBranchActive,
  setMemberBranches,
  taxInvoiceLines,
  updateBranch,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const as = <T>(tenant: string, fn: Parameters<typeof withTenant<T>>[1]) => withTenant(tenant, fn, app)
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => as(ids.a!, fn)

beforeAll(async () => {
  await resetTestDatabase()
  const [a] = await platform.insert(tenants).values({ slug: 'multi', name: 'Multi Spa' }).returning()
  const [b] = await platform.insert(tenants).values({ slug: 'other', name: 'Other Spa' }).returning()
  ids.a = a!.id
  ids.b = b!.id
  const now = new Date()
  await platform
    .insert(user)
    .values({ id: 'u-rec', name: 'Rec', email: 'rec@example.com', createdAt: now, updatedAt: now })
  const [role] = await platform
    .insert(roles)
    .values({ tenantId: ids.a, key: 'receptionist', name: 'Receptionist' })
    .returning()
  const [m] = await platform
    .insert(members)
    .values({ tenantId: ids.a, userId: 'u-rec', roleId: role!.id })
    .returning()
  ids.member = m!.id
  const [main] = await platform
    .insert(branches)
    .values({
      tenantId: ids.a,
      name: 'Marina',
      isDefault: true,
      openingHours: { mon: [{ open: '10:00', close: '22:00' }] },
    })
    .returning()
  ids.main = main!.id
  const [bMain] = await platform
    .insert(branches)
    .values({ tenantId: ids.b, name: 'Elsewhere', isDefault: true })
    .returning()
  ids.bMain = bMain!.id
})
afterAll(() => closeAllDbs())

describe('branches (G22)', () => {
  it('creates a branch with the main branch hours, edits it, and respects the plan limit', async () => {
    const jlt = await tx((db) =>
      createBranch(
        db,
        ids.a!,
        { name: ' JLT ', address: 'Cluster D', businessDayCutoff: '04:00' },
        { limit: 2 },
      ),
    )
    ids.jlt = jlt.id
    expect(jlt).toMatchObject({ name: 'JLT', address: 'Cluster D', isDefault: false, active: true })
    expect(jlt.openingHours).toEqual({ mon: [{ open: '10:00', close: '22:00' }] })
    expect(jlt.businessDayCutoff.slice(0, 5)).toBe('04:00')

    await expect(
      tx((db) => createBranch(db, ids.a!, { name: 'Third', businessDayCutoff: '05:00' }, { limit: 2 })),
    ).rejects.toThrow(DomainError)

    const edited = await tx((db) =>
      updateBranch(db, ids.jlt!, { name: 'JLT Cluster D', phone: '04 123 4567', businessDayCutoff: '05:00' }),
    )
    expect(edited).toMatchObject({ name: 'JLT Cluster D', phone: '04 123 4567', address: null })
    expect(branchLimit({ branches: 3 })).toBe(3)
    expect(branchLimit({})).toBeNull()
  })

  it('archives and restores branches, never the main one', async () => {
    await expect(tx((db) => setBranchActive(db, ids.main!, false))).rejects.toThrow(/main branch/)
    await tx((db) => setBranchActive(db, ids.jlt!, false))
    expect((await tx((db) => listBranches(db))).map((b) => b.id)).toEqual([ids.main])
    expect(await tx((db) => listBranches(db, { includeArchived: true }))).toHaveLength(2)
    await tx((db) => setBranchActive(db, ids.jlt!, true, { limit: 2 }))
    expect(await tx((db) => listBranches(db))).toHaveLength(2)
  })

  it('keeps branches tenant-scoped (RLS)', async () => {
    expect((await as(ids.b!, (db) => listBranches(db))).map((b) => b.id)).toEqual([ids.bMain])
    await expect(
      as(ids.b!, (db) => updateBranch(db, ids.jlt!, { name: 'Hijack', businessDayCutoff: '05:00' })),
    ).rejects.toThrow(/not found/)
  })

  it('scopes a member to chosen branches and back to all', async () => {
    expect(await tx((db) => memberBranchIds(db, ids.member!))).toBeNull()
    await tx((db) => setMemberBranches(db, ids.a!, ids.member!, [ids.jlt!]))
    expect(await tx((db) => memberBranchIds(db, ids.member!))).toEqual([ids.jlt])
    expect((await tx((db) => branchesForMember(db, ids.member!))).map((b) => b.name)).toEqual([
      'JLT Cluster D',
    ])
    // Another spa's branch, or an empty list, is refused and leaves the assignment as it was.
    await expect(tx((db) => setMemberBranches(db, ids.a!, ids.member!, [ids.bMain!]))).rejects.toThrow(
      DomainError,
    )
    await expect(tx((db) => setMemberBranches(db, ids.a!, ids.member!, []))).rejects.toThrow(DomainError)
    expect(await tx((db) => memberBranchIds(db, ids.member!))).toEqual([ids.jlt])
    // Archived branches drop out of the member's working set.
    await tx((db) => setBranchActive(db, ids.jlt!, false))
    expect(await tx((db) => branchesForMember(db, ids.member!))).toEqual([])
    await tx((db) => setBranchActive(db, ids.jlt!, true))

    await tx((db) => setMemberBranches(db, ids.a!, ids.member!, 'all'))
    expect(await tx((db) => memberBranchIds(db, ids.member!))).toBeNull()
    expect(await tx((db) => db.select().from(memberBranches))).toEqual([])
    const [m] = await tx((db) => db.select().from(members).where(eq(members.id, ids.member!)))
    expect(m!.allBranches).toBe(true)
  })
})

describe('tax invoice (G16)', () => {
  it('breaks lines into taxable amount + VAT that add up to the paid total', () => {
    const { lines, totals } = taxInvoiceLines([
      // 2 × 210 with 20 line discount and 20 of a sale discount → 380 paid.
      { kind: 'service', qty: 2, unitPriceAed: '210.00', lineTotalAed: '380.00' },
      { kind: 'product', qty: 1, unitPriceAed: '52.50', lineTotalAed: '52.50' },
      { kind: 'gift_card', qty: 1, unitPriceAed: '100.00', lineTotalAed: '100.00' },
    ])
    expect(lines[0]).toEqual({
      qty: 2,
      unitPriceAed: 210,
      discountAed: 40,
      taxableAed: 361.9,
      vatRatePct: 5,
      vatAed: 18.1,
      totalAed: 380,
    })
    expect(lines[1]).toMatchObject({ taxableAed: 50, vatAed: 2.5 })
    expect(lines[2]).toMatchObject({ vatRatePct: 0, vatAed: 0, taxableAed: 100 })
    expect(totals).toEqual({ discountAed: 40, taxableAed: 511.9, vatAed: 20.6, totalAed: 532.5 })
  })

  it('saves billing details on the sale and, when asked, on the client', async () => {
    const [c] = await tx((db) =>
      db.insert(clients).values({ tenantId: ids.a!, name: 'Acme LLC contact' }).returning(),
    )
    const [s] = await tx((db) =>
      db
        .insert(sales)
        .values({
          tenantId: ids.a!,
          branchId: ids.main!,
          clientId: c!.id,
          number: 1,
          businessDate: '2026-10-09',
          subtotalAed: '105.00',
          vatAed: '5.00',
          totalAed: '105.00',
          status: 'paid',
        })
        .returning(),
    )
    await expect(tx((db) => saveSaleBilling(db, s!.id, { name: 'Acme', trn: '1234' }))).rejects.toThrow(
      /15 digits/,
    )
    const billing = await tx((db) =>
      saveSaleBilling(
        db,
        s!.id,
        { name: ' Acme Trading LLC ', address: 'Office 12, Bay Square', trn: '100 1234 5678 9003' },
        { saveToClient: true },
      ),
    )
    expect(billing).toEqual({
      name: 'Acme Trading LLC',
      address: 'Office 12, Bay Square',
      trn: '100123456789003',
    })
    const [sale] = await tx((db) => db.select().from(sales).where(eq(sales.id, s!.id)))
    const [client] = await tx((db) => db.select().from(clients).where(eq(clients.id, c!.id)))
    expect(sale!.billing).toEqual(billing)
    expect(client!.billing).toEqual(billing)
    // Another spa can't touch it.
    await expect(as(ids.b!, (db) => saveSaleBilling(db, s!.id, { name: 'X Co' }))).rejects.toThrow(
      /not found/,
    )
  })
})

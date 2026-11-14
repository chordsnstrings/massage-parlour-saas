import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeAllDbs, withTenant } from '../src/client'
import { branches, tenants } from '../src/schema'
import { resetTestDatabase, testDbs } from '../src/testing'

const { owner, platform, app } = testDbs()
let tenantA: string
let tenantB: string

beforeAll(async () => {
  await resetTestDatabase()
  const [a, b] = await platform
    .insert(tenants)
    .values([
      { slug: 'alpha', name: 'Alpha Spa' },
      { slug: 'beta', name: 'Beta Spa' },
    ])
    .returning({ id: tenants.id })
  tenantA = a!.id
  tenantB = b!.id
  await platform.insert(branches).values([
    { tenantId: tenantA, name: 'Alpha Marina', isDefault: true },
    { tenantId: tenantB, name: 'Beta JLT', isDefault: true },
  ])
})
afterAll(closeAllDbs)

describe('row-level security structure', () => {
  it('enables RLS on every public table', async () => {
    const { rows } = await owner.execute<{ relname: string }>(sql`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`)
    expect(rows.map((r) => r.relname)).toEqual([])
  })

  it('gives spa_app a tenant-scoped policy on every tenant table and nothing else', async () => {
    const { rows: tenantTables } = await owner.execute<{ table_name: string }>(sql`
      select table_name from information_schema.columns
      where table_schema = 'public' and column_name = 'tenant_id'`)
    const { rows: policies } = await owner.execute<{
      tablename: string
      qual: string
      with_check: string
    }>(sql`
      select tablename, qual, with_check from pg_policies
      where schemaname = 'public' and 'spa_app' = any(roles)`)
    const byTable = new Map(policies.map((p) => [p.tablename, p]))
    for (const { table_name } of tenantTables) {
      const p = byTable.get(table_name)
      expect(p, `${table_name} needs a spa_app policy`).toBeDefined()
      expect(p!.qual).toContain("current_setting('app.tenant_id'")
      expect(p!.with_check).toContain("current_setting('app.tenant_id'")
    }
    const allowed = new Set([...tenantTables.map((t) => t.table_name), 'tenants'])
    expect(policies.filter((p) => !allowed.has(p.tablename)).map((p) => p.tablename)).toEqual([])
  })
})

describe('tenant isolation (spa_app)', () => {
  it('returns nothing without a tenant context', async () => {
    expect(await app.select().from(branches)).toEqual([])
    expect(await app.select().from(tenants)).toEqual([])
  })

  it('only sees the current tenant', async () => {
    const rows = await withTenant(tenantA, (tx) => tx.select().from(branches), app)
    expect(rows.map((r) => r.name)).toEqual(['Alpha Marina'])
    const own = await withTenant(tenantA, (tx) => tx.select().from(tenants), app)
    expect(own.map((t) => t.slug)).toEqual(['alpha'])
  })

  it("cannot write another tenant's rows", async () => {
    await expect(
      withTenant(tenantA, (tx) => tx.insert(branches).values({ tenantId: tenantB, name: 'Sneaky' }), app),
    ).rejects.toMatchObject({ cause: { message: expect.stringMatching(/row-level security/) } })
    const updated = await withTenant(
      tenantA,
      (tx) => tx.update(branches).set({ name: 'Hijacked' }).where(eq(branches.tenantId, tenantB)).returning(),
      app,
    )
    expect(updated).toEqual([])
  })

  it('cannot read platform tables', async () => {
    const { rows } = await app.execute(sql`select count(*)::int as n from "user"`)
    expect(rows[0]).toEqual({ n: 0 })
  })

  it('does not leak tenant context outside the transaction', async () => {
    await withTenant(tenantA, async () => undefined, app)
    expect(await app.select().from(branches)).toEqual([])
  })

  it('rejects malformed tenant ids', async () => {
    await expect(withTenant("x' or 1=1", async () => undefined, app)).rejects.toThrow(/invalid tenant id/)
  })
})

describe('platform role', () => {
  it('sees all tenants', async () => {
    expect(await platform.select().from(branches)).toHaveLength(2)
  })
})

// R42: a super-admin removes a team member (console); what happens to the login depends on where else it is used.
import {
  branches,
  closeAllDbs,
  expenses,
  members,
  platformAdmins,
  roles,
  session,
  tenants,
  user,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { removeTenantMember } from '../src'

const { platform } = testDbs()
const ids: Record<string, string> = {}

async function login(id: string) {
  const now = new Date()
  await platform
    .insert(user)
    .values({ id, name: id, email: `${id}@example.com`, createdAt: now, updatedAt: now })
  await platform.insert(session).values({
    id: `s-${id}`,
    userId: id,
    token: `t-${id}`,
    expiresAt: new Date(now.getTime() + 86_400_000),
    createdAt: now,
    updatedAt: now,
  })
}
async function join(tenant: string, userId: string) {
  const [m] = await platform
    .insert(members)
    .values({ tenantId: tenant, userId, roleId: ids[`role-${tenant}`]! })
    .returning()
  return m!.id
}

beforeAll(async () => {
  await resetTestDatabase()
  for (const slug of ['team-a', 'team-b']) {
    const [t] = await platform.insert(tenants).values({ slug, name: slug }).returning()
    ids[slug] = t!.id
    const [r] = await platform
      .insert(roles)
      .values({ tenantId: t!.id, key: 'owner', name: 'Owner' })
      .returning()
    ids[`role-${t!.id}`] = r!.id
  }
  for (const u of ['solo', 'shared', 'boss', 'writer']) await login(u)
  await platform.insert(platformAdmins).values({ userId: 'boss' })
  const [b] = await platform
    .insert(branches)
    .values({ tenantId: ids['team-a']!, name: 'Main', isDefault: true })
    .returning()
  ids.branch = b!.id
})
afterAll(closeAllDbs)

const userGone = async (id: string) =>
  (await platform.select().from(user).where(eq(user.id, id))).length === 0

describe('removeTenantMember (R42)', () => {
  it('deletes the membership and a login used nowhere else', async () => {
    const m = await join(ids['team-a']!, 'solo')
    const r = await removeTenantMember(platform, ids['team-a']!, m)
    expect(r).toMatchObject({ email: 'solo@example.com', login: 'deleted' })
    expect(await platform.select().from(members).where(eq(members.id, m))).toHaveLength(0)
    expect(await userGone('solo')).toBe(true)
  })

  it("keeps a login that belongs to another spa or is a super-admin's", async () => {
    const m = await join(ids['team-a']!, 'shared')
    await join(ids['team-b']!, 'shared')
    expect((await removeTenantMember(platform, ids['team-a']!, m)).login).toBe('kept_other_spa')
    expect(await userGone('shared')).toBe(false)
    const a = await join(ids['team-a']!, 'boss')
    expect((await removeTenantMember(platform, ids['team-a']!, a)).login).toBe('kept_admin')
    expect(await userGone('boss')).toBe(false)
  })

  it('keeps (and signs out) a login that already wrote records', async () => {
    const m = await join(ids['team-a']!, 'writer')
    await platform.insert(expenses).values({
      tenantId: ids['team-a']!,
      branchId: ids.branch!,
      expenseDate: '2026-11-02',
      accountCode: '6100',
      amountAed: '10',
      paidVia: 'cash',
      createdBy: 'writer',
    })
    expect((await removeTenantMember(platform, ids['team-a']!, m)).login).toBe('kept_has_records')
    expect(await userGone('writer')).toBe(false)
    expect(await platform.select().from(session).where(eq(session.userId, 'writer'))).toHaveLength(0)
    expect(await platform.select().from(members).where(eq(members.userId, 'writer'))).toHaveLength(0)
  })

  it('refuses a member of another spa (wrong tenant id)', async () => {
    const m = await join(ids['team-b']!, 'boss')
    await expect(removeTenantMember(platform, ids['team-a']!, m)).rejects.toThrow('Team member not found')
    expect(await platform.select().from(members).where(eq(members.id, m))).toHaveLength(1)
  })
})

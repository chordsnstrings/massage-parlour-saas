import { SYSTEM_ROLES } from '@spa/core'
import {
  branches,
  closeAllDbs,
  memberBranches,
  members,
  outbox,
  roles,
  shifts,
  staff,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assignableMembers,
  assignOutbox,
  autoAssignDueOutbox,
  DomainError,
  getAutomations,
  navCounts,
  outboxAssigneeCounts,
  outboxAssigneeWhere,
  outboxPending,
  setAutomation,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)
const now = new Date('2026-10-09T08:00:00Z') // 12:00 Dubai
const hour = 3_600_000

async function queue(n: number, opts: { branchId?: string | null; dueAt?: Date } = {}) {
  return tx(async (db) => {
    const rows = await db
      .insert(outbox)
      .values(
        Array.from({ length: n }, (_, i) => ({
          tenantId: ids.tenant!,
          branchId: opts.branchId === undefined ? ids.marina! : opts.branchId,
          kind: 'custom' as const,
          phoneE164: `97150000${String(i).padStart(4, '0')}`,
          text: `Hello ${i}`,
          dueAt: opts.dueAt ?? new Date(now.getTime() - (n - i) * 60_000),
        })),
      )
      .returning({ id: outbox.id })
    return rows.map((r) => r.id)
  })
}

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'assign', name: 'Assign Spa' }).returning()
  const [o] = await platform.insert(tenants).values({ slug: 'assign-other', name: 'Other' }).returning()
  ids.tenant = t!.id
  ids.other = o!.id
  await platform.insert(user).values(
    ['owner', 'desk1', 'desk2', 'desk3', 'ther', 'gone'].map((k) => ({
      id: `a-${k}`,
      name: k,
      email: `${k}@assign.test`,
    })),
  )
  await tx(async (db) => {
    const role = async (key: keyof typeof SYSTEM_ROLES) => {
      const [r] = await db
        .insert(roles)
        .values({ tenantId: ids.tenant!, key, name: key, permissions: [...SYSTEM_ROLES[key].permissions] })
        .returning()
      return r!.id
    }
    const ownerRole = await role('owner')
    const deskRole = await role('receptionist')
    const therRole = await role('therapist')
    const [b1] = await db
      .insert(branches)
      .values({ tenantId: ids.tenant!, name: 'Marina', isDefault: true })
      .returning()
    const [b2] = await db.insert(branches).values({ tenantId: ids.tenant!, name: 'JLT' }).returning()
    ids.marina = b1!.id
    ids.jlt = b2!.id
    const m = await db
      .insert(members)
      .values([
        { tenantId: ids.tenant!, userId: 'a-owner', roleId: ownerRole },
        { tenantId: ids.tenant!, userId: 'a-desk1', roleId: deskRole },
        { tenantId: ids.tenant!, userId: 'a-desk2', roleId: deskRole },
        { tenantId: ids.tenant!, userId: 'a-desk3', roleId: deskRole, allBranches: false },
        { tenantId: ids.tenant!, userId: 'a-ther', roleId: therRole },
        { tenantId: ids.tenant!, userId: 'a-gone', roleId: deskRole, status: 'disabled' },
      ])
      .returning()
    for (const row of m) ids[row.userId.slice(2)] = row.id
    await db
      .insert(memberBranches)
      .values({ tenantId: ids.tenant!, memberId: ids.desk3!, branchId: ids.jlt! })
    // desk1 + desk2 on shift at Marina now, desk3 on shift at JLT; desk2's next shift is tomorrow.
    for (const [key, branchId, from, to] of [
      ['desk1', ids.marina!, -2, 6],
      ['desk2', ids.marina!, -1, 3],
      ['desk3', ids.jlt!, -1, 3],
      ['ther', ids.marina!, -1, 3],
    ] as const) {
      const [s] = await db
        .insert(staff)
        .values({ tenantId: ids.tenant!, displayName: key, memberId: ids[key] })
        .returning()
      await db.insert(shifts).values({
        tenantId: ids.tenant!,
        staffId: s!.id,
        branchId,
        startsAt: new Date(now.getTime() + from * hour),
        endsAt: new Date(now.getTime() + to * hour),
      })
    }
  })
})
afterAll(closeAllDbs)

describe('assignable members', () => {
  it('lists active members with marketing.send only (therapists and disabled members out)', async () => {
    const list = await tx((db) => assignableMembers(db))
    expect(list.map((m) => m.userId).sort()).toEqual(['a-desk1', 'a-desk2', 'a-desk3', 'a-owner'])
    expect(list.find((m) => m.userId === 'a-desk3')!.branchIds).toEqual([ids.jlt])
  })
})

describe('assignOutbox', () => {
  it('assigns, skips rows of a branch the member can’t see, clears, and refuses non-senders', async () => {
    const [a, b] = await queue(2)
    const [j] = await queue(1, { branchId: ids.jlt })
    const r1 = await tx((db) =>
      assignOutbox(db, { ids: [a!, b!], memberId: ids.desk1!, byUserId: 'a-owner' }),
    )
    expect(r1.changed.map((c) => c.from)).toEqual([null, null])
    const r2 = await tx((db) =>
      assignOutbox(db, { ids: [a!, j!], memberId: ids.desk3!, byUserId: 'a-owner' }),
    )
    expect(r2.changed).toEqual([{ id: j, from: null }])
    expect(r2.skipped).toBe(1) // Marina message: desk3 only sees JLT
    const r3 = await tx((db) => assignOutbox(db, { ids: [b!], memberId: null, byUserId: 'a-owner' }))
    expect(r3.changed).toEqual([{ id: b, from: ids.desk1 }])
    const [row] = await tx((db) => db.select().from(outbox).where(eq(outbox.id, a!)))
    expect(row).toMatchObject({ assignedTo: ids.desk1, assignedBy: 'a-owner' })
    await expect(
      tx((db) => assignOutbox(db, { ids: [a!], memberId: ids.ther!, byUserId: 'a-owner' })),
    ).rejects.toBeInstanceOf(DomainError)
    await expect(
      tx((db) => assignOutbox(db, { ids: [a!], memberId: ids.gone!, byUserId: 'a-owner' })),
    ).rejects.toBeInstanceOf(DomainError)
    await tx((db) => db.update(outbox).set({ status: 'sent' }).where(eq(outbox.id, a!)))
    const r4 = await tx((db) => assignOutbox(db, { ids: [a!], memberId: ids.desk2!, byUserId: 'a-owner' }))
    expect(r4).toEqual({ changed: [], skipped: 1 }) // handled messages keep their assignee
  })

  it('cannot touch another spa’s messages (RLS)', async () => {
    const [a] = await queue(1)
    const r = await withTenant(
      ids.other!,
      (db) => assignOutbox(db, { ids: [a!], memberId: null, byUserId: 'a-owner' }),
      app,
    )
    expect(r).toEqual({ changed: [], skipped: 1 })
    const otherView = await withTenant(ids.other!, (db) => db.select().from(outbox), app)
    expect(otherView).toEqual([])
  })
})

describe('filters and the sidebar badge', () => {
  it('counts Mine / Unassigned / All and the assignee’s nav badge', async () => {
    await tx((db) => db.delete(outbox))
    const due = await queue(4)
    await queue(2, { dueAt: new Date(now.getTime() + 3 * hour) }) // scheduled: not in due counts
    await tx((db) =>
      assignOutbox(db, { ids: due.slice(0, 3), memberId: ids.desk2!, byUserId: 'a-owner', now }),
    )
    const counts = await tx((db) =>
      outboxAssigneeCounts(db, { memberId: ids.desk2!, where: outboxPending() }),
    )
    expect(counts).toEqual({ all: 6, mine: 3, unassigned: 3 })
    const mine = await tx((db) =>
      db.select({ id: outbox.id }).from(outbox).where(outboxAssigneeWhere('mine', ids.desk2!)),
    )
    expect(mine).toHaveLength(3)
    const badge = (memberId: string | null) =>
      tx((db) =>
        navCounts(db, {
          branchIds: null,
          calendar: false,
          outbox: true,
          instagram: false,
          assigneeMemberId: memberId,
          now,
        }),
      )
    expect(await badge(ids.desk2!)).toMatchObject({ outboxDue: 4, outboxMine: 3 })
    expect(await badge(ids.desk1!)).toMatchObject({ outboxDue: 4, outboxMine: 0 })
    expect(await badge(null)).toMatchObject({ outboxMine: 0 })
  })
})

describe('auto-assign (round-robin among receptionists on shift)', () => {
  it('is off by default and shares due messages in turn, per branch, continuing where it stopped', async () => {
    await tx((db) => db.delete(outbox))
    expect((await tx((db) => getAutomations(db, ids.tenant!))).outboxAutoAssign).toBe(false)
    await queue(3)
    expect(await tx((db) => autoAssignDueOutbox(db, ids.tenant!, now))).toBe(0)

    await tx((db) => setAutomation(db, ids.tenant!, 'outboxAutoAssign', true))
    const later = await queue(1, { dueAt: new Date(now.getTime() + hour) })
    await queue(1, { branchId: ids.jlt })
    await queue(1, { branchId: null })
    expect(await tx((db) => autoAssignDueOutbox(db, ids.tenant!, now))).toBe(5)
    const rows = await tx((db) => db.select().from(outbox).orderBy(outbox.dueAt, outbox.id))
    const byId = new Map(rows.map((r) => [r.id, r]))
    expect(byId.get(later[0]!)!.assignedTo).toBeNull() // not due yet
    const marina = rows.filter((r) => r.branchId === ids.marina && r.assignedTo)
    // Marina: desk1 and desk2 alternate (therapist on shift is not a receptionist).
    const counts = new Map<string, number>()
    for (const r of marina) counts.set(r.assignedTo!, (counts.get(r.assignedTo!) ?? 0) + 1)
    expect([...counts.keys()].sort()).toEqual([ids.desk1, ids.desk2].sort())
    expect(Math.abs((counts.get(ids.desk1!) ?? 0) - (counts.get(ids.desk2!) ?? 0))).toBeLessThanOrEqual(1)
    expect(rows.find((r) => r.branchId === ids.jlt)!.assignedTo).toBe(ids.desk3)
    expect(rows.find((r) => r.branchId === null)!.assignedTo).not.toBeNull()
    expect(rows.every((r) => !r.assignedTo || r.assignedBy === null)).toBe(true)

    // Next run continues the turn after the last pick; already assigned rows are left alone.
    const last = rows
      .filter((r) => r.assignedTo)
      .sort((a, b) => +a.assignedAt! - +b.assignedAt!)
      .at(-1)!
    const [next] = await queue(1)
    expect(await tx((db) => autoAssignDueOutbox(db, ids.tenant!, new Date(now.getTime() + 1000)))).toBe(1)
    const [n] = await tx((db) => db.select().from(outbox).where(eq(outbox.id, next!)))
    if (last.branchId === ids.marina) expect(n!.assignedTo).not.toBe(last.assignedTo)
    else expect([ids.desk1, ids.desk2]).toContain(n!.assignedTo)

    // Nobody on shift (tomorrow night) → stays unassigned.
    const [night] = await queue(1, { dueAt: new Date(now.getTime() + 20 * hour) })
    expect(await tx((db) => autoAssignDueOutbox(db, ids.tenant!, new Date(now.getTime() + 21 * hour)))).toBe(
      0,
    )
    const [nr] = await tx((db) => db.select().from(outbox).where(eq(outbox.id, night!)))
    expect(nr!.assignedTo).toBeNull()
  })
})

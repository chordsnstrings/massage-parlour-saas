import { dubaiParts } from '@spa/core'
import { members, platformDb, services, user, withTenant } from '@spa/db'
import { asc, eq, inArray } from 'drizzle-orm'

/** "HH:MM" Dubai wall-clock time of an instant. */
export const dubaiTime = (d: Date) => {
  const m = dubaiParts(d).minutes
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** Members of the tenant with their names (names live in the platform-scoped auth table). */
export async function memberOptions(tenantId: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: members.id, userId: members.userId })
      .from(members)
      .where(eq(members.status, 'active'))
      .orderBy(asc(members.createdAt)),
  )
  if (rows.length === 0) return []
  const people = await platformDb()
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(
      inArray(
        user.id,
        rows.map((r) => r.userId),
      ),
    )
  const byId = new Map(people.map((p) => [p.id, p]))
  return rows.map((r) => ({
    id: r.id,
    name: byId.get(r.userId)?.name ?? '—',
    email: byId.get(r.userId)?.email ?? '',
  }))
}

export async function serviceOptions(tenantId: string) {
  const rows = await withTenant(tenantId, (tx) =>
    tx
      .select({ id: services.id, name: services.name, active: services.active })
      .from(services)
      .orderBy(asc(services.sort), asc(services.createdAt)),
  )
  return rows.map((s) => ({ id: s.id, name: s.name.en, active: s.active }))
}

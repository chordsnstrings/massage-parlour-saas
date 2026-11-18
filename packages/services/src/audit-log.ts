// Owner-facing audit log viewer (PLAN §14.7 B4). Rows are written by the web app through platformDb
// (apps/web/src/server/audit.ts); `audit_log` carries the tenant policy, so reading through the caller's
// `withTenant` tx sees only this spa's rows. Actor names come from the platform `user` table, looked up only for
// the user ids found in those rows (platform code path: cross-tenant member names).
import { dubaiInstant } from '@spa/core'
import { auditLog, type Db, platformDb, type Tx, user } from '@spa/db'
import { and, desc, eq, gte, inArray, lt, type SQL, sql } from 'drizzle-orm'

export type AuditFilter = {
  actorUserId?: string
  action?: string
  /** Calendar dates (Asia/Dubai), inclusive. */
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

export type AuditEntry = {
  id: number
  at: Date
  action: string
  entity: string | null
  entityId: string | null
  actorUserId: string | null
  actorName: string | null
  /** A super-admin acted on the spa (impersonation). */
  support: boolean
  ip: string | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

function where(f: AuditFilter): SQL | undefined {
  const next = (d: string) => {
    const x = new Date(`${d}T00:00:00Z`)
    x.setUTCDate(x.getUTCDate() + 1)
    return x.toISOString().slice(0, 10)
  }
  return and(
    f.actorUserId ? eq(auditLog.actorUserId, f.actorUserId) : undefined,
    f.action ? eq(auditLog.action, f.action) : undefined,
    f.from && DATE.test(f.from) ? gte(auditLog.createdAt, dubaiInstant(f.from, 0)) : undefined,
    f.to && DATE.test(f.to) ? lt(auditLog.createdAt, dubaiInstant(next(f.to), 0)) : undefined,
  )
}

/** User names by id (platform `user` table). Pass only ids read from this tenant's own rows. */
export async function userNames(ids: string[], db: Db = platformDb()) {
  const unique = [...new Set(ids)]
  if (!unique.length) return new Map<string, string>()
  const rows = await db.select({ id: user.id, name: user.name }).from(user).where(inArray(user.id, unique))
  return new Map(rows.map((r) => [r.id, r.name]))
}

/** One page of this tenant's audit log, newest first, with actor names. */
export async function listAuditLog(tx: Tx, f: AuditFilter = {}, names: Db = platformDb()) {
  const pageSize = Math.min(Math.max(f.pageSize ?? 25, 1), 100)
  const page = Math.max(f.page ?? 1, 1)
  const w = where(f)
  const [count] = await tx.select({ total: sql<number>`count(*)::int` }).from(auditLog).where(w)
  const rows = await tx
    .select({
      id: auditLog.id,
      at: auditLog.createdAt,
      action: auditLog.action,
      entity: auditLog.entity,
      entityId: auditLog.entityId,
      actorUserId: auditLog.actorUserId,
      impersonatorUserId: auditLog.impersonatorUserId,
      ip: auditLog.ip,
    })
    .from(auditLog)
    .where(w)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize)
  const byId = await userNames(
    rows.flatMap((r) => (r.actorUserId ? [r.actorUserId] : [])),
    names,
  )
  const entries: AuditEntry[] = rows.map(({ impersonatorUserId, ...r }) => ({
    ...r,
    actorName: r.actorUserId ? (byId.get(r.actorUserId) ?? null) : null,
    support: Boolean(impersonatorUserId),
  }))
  return { entries, total: count?.total ?? 0, page, pageSize }
}

/** Filter choices: people and action codes that occur in this tenant's log. */
export async function auditFilterOptions(tx: Tx, names: Db = platformDb()) {
  const actors = await tx
    .selectDistinct({ id: auditLog.actorUserId })
    .from(auditLog)
    .where(sql`${auditLog.actorUserId} is not null`)
  const actions = await tx
    .selectDistinct({ action: auditLog.action })
    .from(auditLog)
    .orderBy(auditLog.action)
    .limit(500)
  const byId = await userNames(
    actors.flatMap((a) => (a.id ? [a.id] : [])),
    names,
  )
  return {
    actors: [...byId.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    actions: actions.map((a) => a.action),
  }
}

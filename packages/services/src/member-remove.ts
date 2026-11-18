// R42 (owner 2026-11-02): a super-admin removes someone from a spa's team (console only; no last-owner limit, by the
// owner's choice). The membership goes at once (branch links cascade). When the login belongs to no other spa and is
// not a super-admin, the login is deleted too, so the email can be invited fresh; a login that already wrote records
// (bookings, sales, …: user FKs without ON DELETE) cannot be deleted, so its sessions are ended instead and it stays
// without any spa.
import { type Db, members, platformAdmins, session, tenants, user } from '@spa/db'
import { and, eq } from 'drizzle-orm'
import { DomainError, pgCode } from './errors'

export type RemovedMember = {
  name: string
  email: string
  /** 'deleted' = the login is gone; 'kept_other_spa' / 'kept_admin' / 'kept_has_records' = it stays (signed out in the last case). */
  login: 'deleted' | 'kept_other_spa' | 'kept_admin' | 'kept_has_records'
}

export async function removeTenantMember(db: Db, tenantId: string, memberId: string): Promise<RemovedMember> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ userId: members.userId, name: user.name, email: user.email })
      .from(members)
      .innerJoin(user, eq(user.id, members.userId))
      .innerJoin(tenants, eq(tenants.id, members.tenantId))
      .where(and(eq(members.id, memberId), eq(members.tenantId, tenantId)))
      .for('update', { of: members })
    if (!row) throw new DomainError('Team member not found', 'not_found')
    await tx.delete(members).where(eq(members.id, memberId))

    const out = { name: row.name, email: row.email }
    const [other] = await tx
      .select({ id: members.id })
      .from(members)
      .where(eq(members.userId, row.userId))
      .limit(1)
    if (other) return { ...out, login: 'kept_other_spa' }
    const [admin] = await tx
      .select({ id: platformAdmins.userId })
      .from(platformAdmins)
      .where(eq(platformAdmins.userId, row.userId))
    if (admin) return { ...out, login: 'kept_admin' }
    try {
      await tx.transaction((sp) => sp.delete(user).where(eq(user.id, row.userId)))
      return { ...out, login: 'deleted' }
    } catch (e) {
      if (pgCode(e) !== '23503') throw e
      await tx.delete(session).where(eq(session.userId, row.userId))
      return { ...out, login: 'kept_has_records' }
    }
  })
}

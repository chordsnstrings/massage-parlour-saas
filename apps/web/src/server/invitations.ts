import { invitations, members, platformDb, roles, tenants } from '@spa/db'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { hashToken } from './token'

/** Looks up a pending invitation by its raw token (platform role: the invitee isn't a member yet). */
export async function findInvitation(token: string) {
  const [row] = await platformDb()
    .select({
      id: invitations.id,
      email: invitations.email,
      tenantId: invitations.tenantId,
      roleId: invitations.roleId,
      branchIds: invitations.branchIds,
      tenantName: tenants.name,
      tenantSlug: tenants.slug,
      roleName: roles.name,
    })
    .from(invitations)
    .innerJoin(tenants, eq(invitations.tenantId, tenants.id))
    .innerJoin(roles, eq(invitations.roleId, roles.id))
    .where(
      and(
        eq(invitations.tokenHash, hashToken(token)),
        isNull(invitations.acceptedAt),
        isNull(invitations.revokedAt),
        gt(invitations.expiresAt, new Date()),
      ),
    )
    .limit(1)
  return row ?? null
}

export type Invitation = NonNullable<Awaited<ReturnType<typeof findInvitation>>>

export async function acceptInvitation(invite: Invitation, userId: string) {
  await platformDb().transaction(async (tx) => {
    const all = !invite.branchIds?.length
    await tx
      .insert(members)
      .values({ tenantId: invite.tenantId, userId, roleId: invite.roleId, allBranches: all })
      .onConflictDoNothing()
    await tx
      .update(invitations)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(eq(invitations.id, invite.id))
  })
}

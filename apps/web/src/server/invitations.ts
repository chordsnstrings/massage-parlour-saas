import { branches, invitations, memberBranches, members, platformDb, roles, tenants } from '@spa/db'
import { and, eq, gt, inArray, isNull } from 'drizzle-orm'
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
    // Branch scope (G22): only branches of this spa that are still open; none left → every branch.
    const scoped = invite.branchIds?.length
      ? await tx
          .select({ id: branches.id })
          .from(branches)
          .where(
            and(
              eq(branches.tenantId, invite.tenantId),
              inArray(branches.id, invite.branchIds),
              eq(branches.active, true),
            ),
          )
      : []
    const [member] = await tx
      .insert(members)
      .values({ tenantId: invite.tenantId, userId, roleId: invite.roleId, allBranches: !scoped.length })
      .onConflictDoNothing()
      .returning({ id: members.id })
    if (member && scoped.length)
      await tx
        .insert(memberBranches)
        .values(scoped.map((b) => ({ tenantId: invite.tenantId, memberId: member.id, branchId: b.id })))
    await tx
      .update(invitations)
      .set({ acceptedAt: new Date(), acceptedBy: userId })
      .where(eq(invitations.id, invite.id))
  })
}

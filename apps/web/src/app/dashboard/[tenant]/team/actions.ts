'use server'
import { sendStaffEmail } from '@spa/core'
import { branches, invitations, members, platformDb, roles, user, withTenant } from '@spa/db'
import { DomainError, setMemberBranches } from '@spa/services'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
import { canonicalUrls } from '@/server/origin'
import { hashToken, newToken } from '@/server/token'

/** Branch scope from the form (G22): undefined = field not shown (single-branch spa), else 'all' or ids. */
function branchScopeOf(formData: FormData): 'all' | string[] | undefined {
  if (!formData.get('branchField')) return undefined
  if (formData.get('branchScope') === 'all') return 'all'
  return formData
    .getAll('branchIds')
    .map(String)
    .filter((id) => z.uuid().safeParse(id).success)
}

const inviteSchema = z.object({
  email: z.email('validation.email').transform((e) => e.toLowerCase()),
  roleId: z.uuid('team.validation.role'),
})

export async function inviteAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'team.manage')
  if (error) return fail(error)
  const parsed = inviteSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const { email, roleId } = parsed.data
  const scope = branchScopeOf(formData)
  if (Array.isArray(scope) && !scope.length) return fail('team.edit.branchesRequired')
  const existingUser = await platformDb().query.user.findFirst({
    where: eq(user.email, email),
    columns: { id: true },
  })
  const token = newToken()
  const result = await withTenant(
    ctx.tenant.id,
    async (tx): Promise<{ error: string } | { error: null; roleName: string }> => {
      const [role] = await tx.select().from(roles).where(eq(roles.id, roleId))
      if (!role) return { error: 'team.result.chooseRole' }
      if (role.key === 'owner' && ctx.member?.roleKey !== 'owner' && !ctx.impersonating)
        return { error: 'team.result.ownersInviteOwners' }
      if (existingUser) {
        const [m] = await tx
          .select({ id: members.id })
          .from(members)
          .where(eq(members.userId, existingUser.id))
        if (m) return { error: 'team.result.alreadyOnTeam' }
      }
      await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)),
        )
      const branchIds = Array.isArray(scope)
        ? (
            await tx
              .select({ id: branches.id })
              .from(branches)
              .where(and(inArray(branches.id, scope), eq(branches.active, true)))
          ).map((b) => b.id)
        : null
      if (branchIds && !branchIds.length) return { error: 'team.edit.branchesRequired' }
      await tx.insert(invitations).values({
        tenantId: ctx.tenant.id,
        email,
        roleId,
        branchIds,
        tokenHash: hashToken(token),
        invitedBy: ctx.user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      })
      return { error: null, roleName: role.name }
    },
  )
  if (result.error !== null) return fail(result.error, { email: result.error })
  // Staff email stays English: the invitee's language isn't known until they join.
  const link = canonicalUrls().app(`/invite/${token}`)
  await sendStaffEmail({
    to: email,
    subject: `You're invited to ${ctx.tenant.name}`,
    text: `${ctx.user.name} invited you to join ${ctx.tenant.name} on spamanagement.co as ${result.roleName}.\n\nAccept: ${link}\n\nThis link expires in 7 days.`,
  }).catch((e) => console.error('invite email failed', e))
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'invitation.created',
    data: { email, role: result.roleName },
  })
  revalidatePath(`/dashboard/${slug}/team`)
  return ok('team.result.invited', { link, email, tenantName: ctx.tenant.name })
}

export async function revokeInviteAction(slug: string, inviteId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'team.manage')
  if (error) return fail(error)
  await withTenant(ctx.tenant.id, (tx) =>
    tx.update(invitations).set({ revokedAt: new Date() }).where(eq(invitations.id, inviteId)),
  )
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'invitation.revoked',
    entityId: inviteId,
  })
  revalidatePath(`/dashboard/${slug}/team`)
  return ok('team.result.revoked')
}

const memberSchema = z.object({
  memberId: z.uuid(),
  roleId: z.uuid(),
  status: z.enum(['active', 'disabled']),
})

export async function updateMemberAction(
  slug: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'team.manage')
  if (error) return fail(error)
  const parsed = memberSchema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const { memberId, roleId, status } = parsed.data
  const scope = branchScopeOf(formData)
  let problem: string | null
  try {
    problem = await withTenant(ctx.tenant.id, async (tx) => {
      const [target] = await tx
        .select({ id: members.id, userId: members.userId, roleKey: roles.key })
        .from(members)
        .innerJoin(roles, eq(members.roleId, roles.id))
        .where(eq(members.id, memberId))
      const [role] = await tx.select().from(roles).where(eq(roles.id, roleId))
      if (!target || !role) return 'team.result.notFound'
      const callerIsOwner = ctx.member?.roleKey === 'owner' || ctx.impersonating
      if ((target.roleKey === 'owner' || role.key === 'owner') && !callerIsOwner)
        return 'team.result.ownersChangeOwners'
      if (target.userId === ctx.user.id && status === 'disabled') return 'team.result.cantDisableSelf'
      if (target.roleKey === 'owner' && (role.key !== 'owner' || status === 'disabled')) {
        const owners = await tx
          .select({ id: members.id })
          .from(members)
          .innerJoin(roles, eq(members.roleId, roles.id))
          .where(and(eq(roles.key, 'owner'), eq(members.status, 'active')))
        if (owners.length <= 1) return 'team.result.needOwner'
      }
      await tx.update(members).set({ roleId, status }).where(eq(members.id, memberId))
      if (scope) await setMemberBranches(tx, ctx.tenant.id, memberId, scope)
      return null
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  if (problem) return fail(problem)
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'member.updated',
    entityId: memberId,
    data: { roleId, status, branches: scope },
  })
  revalidatePath(`/dashboard/${slug}/team`)
  return ok('team.result.memberUpdated')
}

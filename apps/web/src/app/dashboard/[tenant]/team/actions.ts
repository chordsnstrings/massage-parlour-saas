'use server'
import { sendStaffEmail } from '@spa/core'
import { invitations, members, platformDb, roles, user, withTenant } from '@spa/db'
import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { appUrl } from '@/lib/paths'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
import { hashToken, newToken } from '@/server/token'

const inviteSchema = z.object({
  email: z.email('Enter a valid email').transform((e) => e.toLowerCase()),
  roleId: z.uuid('Choose a role'),
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
  const existingUser = await platformDb().query.user.findFirst({
    where: eq(user.email, email),
    columns: { id: true },
  })
  const token = newToken()
  const result = await withTenant(
    ctx.tenant.id,
    async (tx): Promise<{ error: string } | { error: null; roleName: string }> => {
      const [role] = await tx.select().from(roles).where(eq(roles.id, roleId))
      if (!role) return { error: 'Choose a role.' }
      if (role.key === 'owner' && ctx.member?.roleKey !== 'owner' && !ctx.impersonating)
        return { error: 'Only owners can invite owners.' }
      if (existingUser) {
        const [m] = await tx
          .select({ id: members.id })
          .from(members)
          .where(eq(members.userId, existingUser.id))
        if (m) return { error: 'This person is already on your team.' }
      }
      await tx
        .update(invitations)
        .set({ revokedAt: new Date() })
        .where(
          and(eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)),
        )
      await tx.insert(invitations).values({
        tenantId: ctx.tenant.id,
        email,
        roleId,
        tokenHash: hashToken(token),
        invitedBy: ctx.user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      })
      return { error: null, roleName: role.name }
    },
  )
  if (result.error !== null) return fail(result.error, { email: result.error })
  const link = appUrl(`/invite/${token}`)
  await sendStaffEmail({
    to: email,
    subject: `You're invited to ${ctx.tenant.name}`,
    text: `${ctx.user.name} invited you to join ${ctx.tenant.name} on spamanagement.ae as ${result.roleName}.\n\nAccept: ${link}\n\nThis link expires in 7 days.`,
  }).catch((e) => console.error('invite email failed', e))
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'invitation.created',
    data: { email, role: result.roleName },
  })
  revalidatePath(`/dashboard/${slug}/team`)
  return ok('Invitation created', { link, email, tenantName: ctx.tenant.name })
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
  return ok('Invitation revoked')
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
  const problem = await withTenant(ctx.tenant.id, async (tx) => {
    const [target] = await tx
      .select({ id: members.id, userId: members.userId, roleKey: roles.key })
      .from(members)
      .innerJoin(roles, eq(members.roleId, roles.id))
      .where(eq(members.id, memberId))
    const [role] = await tx.select().from(roles).where(eq(roles.id, roleId))
    if (!target || !role) return 'Member or role not found.'
    const callerIsOwner = ctx.member?.roleKey === 'owner' || ctx.impersonating
    if ((target.roleKey === 'owner' || role.key === 'owner') && !callerIsOwner)
      return 'Only owners can change owners.'
    if (target.userId === ctx.user.id && status === 'disabled') return "You can't disable yourself."
    if (target.roleKey === 'owner' && (role.key !== 'owner' || status === 'disabled')) {
      const owners = await tx
        .select({ id: members.id })
        .from(members)
        .innerJoin(roles, eq(members.roleId, roles.id))
        .where(and(eq(roles.key, 'owner'), eq(members.status, 'active')))
      if (owners.length <= 1) return 'Your spa needs at least one active owner.'
    }
    await tx.update(members).set({ roleId, status }).where(eq(members.id, memberId))
    return null
  })
  if (problem) return fail(problem)
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'member.updated',
    entityId: memberId,
    data: { roleId, status },
  })
  revalidatePath(`/dashboard/${slug}/team`)
  return ok('Member updated')
}

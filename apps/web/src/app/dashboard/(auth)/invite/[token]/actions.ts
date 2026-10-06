'use server'
import { getAuth } from '@spa/auth'
import { APIError } from 'better-auth/api'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod } from '@/lib/action'
import { audit } from '@/server/audit'
import { acceptInvitation, findInvitation } from '@/server/invitations'
import { getSession } from '@/server/session'

export async function acceptInviteAction(token: string): Promise<ActionResult> {
  const session = await getSession()
  const invite = await findInvitation(token)
  if (!session || !invite) return fail('This invitation is no longer valid.')
  if (session.user.email.toLowerCase() !== invite.email.toLowerCase())
    return fail(`This invitation is for ${invite.email}.`)
  await acceptInvitation(invite, session.user.id)
  await audit({
    tenantId: invite.tenantId,
    actorUserId: session.user.id,
    action: 'member.joined',
    entity: 'invitation',
    entityId: invite.id,
  })
  redirect(`/${invite.tenantSlug}`)
}

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  password: z.string().min(10, 'Use at least 10 characters').max(128),
})

export async function signupAndAcceptAction(
  token: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const invite = await findInvitation(token)
  if (!invite) return fail('This invitation is no longer valid.')
  const parsed = schema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  try {
    const res = await getAuth().api.signUpEmail({
      body: { name: parsed.data.name, email: invite.email, password: parsed.data.password },
      headers: await headers(),
    })
    await acceptInvitation(invite, res.user.id)
    await audit({
      tenantId: invite.tenantId,
      actorUserId: res.user.id,
      action: 'member.joined',
      entity: 'invitation',
      entityId: invite.id,
    })
  } catch (e) {
    if (e instanceof APIError)
      return fail(/exist/i.test(e.message) ? 'You already have an account — sign in to accept.' : e.message)
    throw e
  }
  redirect(`/${invite.tenantSlug}`)
}

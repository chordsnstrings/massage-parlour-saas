'use server'
import { getAuth } from '@spa/auth'
import { APIError } from 'better-auth/api'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getT } from '@/i18n/server'
import { type ActionResult, fail, formObject, fromZod } from '@/lib/action'
import { appPath } from '@/lib/paths'
import { audit } from '@/server/audit'
import { acceptInvitation, findInvitation } from '@/server/invitations'
import { getSession } from '@/server/session'

export async function acceptInviteAction(token: string): Promise<ActionResult> {
  const session = await getSession()
  const invite = await findInvitation(token)
  if (!session || !invite) return fail('auth.invite.invalid')
  if (session.user.email.toLowerCase() !== invite.email.toLowerCase())
    return fail({ key: 'auth.invite.forEmail', params: { email: invite.email } })
  await acceptInvitation(invite, session.user.id)
  await audit({
    tenantId: invite.tenantId,
    actorUserId: session.user.id,
    action: 'member.joined',
    entity: 'invitation',
    entityId: invite.id,
  })
  redirect(appPath(`/${invite.tenantSlug}`))
}

const schema = z.object({
  name: z.string().trim().min(2, 'auth.signup.errors.name').max(80),
  password: z.string().min(10, 'auth.signup.errors.password').max(128),
})

export async function signupAndAcceptAction(
  token: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const invite = await findInvitation(token)
  if (!invite) return fail('auth.invite.invalid')
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
    if (e instanceof APIError) {
      if (/exist/i.test(e.message)) return fail('auth.invite.exists')
      const code = (e.body as { code?: string } | undefined)?.code
      const t = await getT()
      return fail((code && t.maybe(`auth.errors.${code}`)) || e.message)
    }
    throw e
  }
  redirect(appPath(`/${invite.tenantSlug}`))
}

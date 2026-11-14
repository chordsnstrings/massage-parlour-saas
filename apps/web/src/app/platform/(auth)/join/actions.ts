'use server'
// Super-admin join (owner, 2026-10-09): a PLATFORM_ADMIN_EMAILS address creates its login here — no spa, no
// application. Promotion stays G2 (verified email, then requirePlatformAdmin) + G3 (2FA before the console opens).
import { getAuth } from '@spa/auth'
import { isListedAdminEmail } from '@spa/db'
import { assertAdminJoinAllowed, DomainError } from '@spa/services'
import { APIError } from 'better-auth/api'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { adminPath } from '@/lib/paths'
import { audit } from '@/server/audit'
import { withinIpLimit } from '@/server/rate-limit'
import { getSession } from '@/server/session'

const schema = z.object({
  name: z.string().trim().min(2, 'Enter your name').max(80),
  email: z.email('Enter a valid email address').transform((e) => e.trim().toLowerCase()),
  password: z.string().min(10, 'Use at least 10 characters').max(128),
})

/** Join attempts per IP (also caps probing the list): 5 an hour, 20 a day. */
const JOIN_LIMITS: [number, number][] = [
  [5, 3600],
  [20, 86_400],
]

/** The verification link lands on the console (relative: the link is built on this admin host). */
const CALLBACK = adminPath('/')

export async function joinAdminAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = schema.safeParse(formObject(formData))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  // Counted before the list check, so the page can't be used to test many addresses.
  if (!(await withinIpLimit('admin-join', JOIN_LIMITS)))
    return fail('Too many attempts from your network. Please try again later.')
  try {
    assertAdminJoinAllowed(d.email)
  } catch (e) {
    // Neutral: says nothing about which addresses are listed.
    if (e instanceof DomainError) return fail(e.message, { email: e.message })
    throw e
  }
  let created: { id: string; email: string }
  try {
    const res = await getAuth().api.signUpEmail({
      body: { name: d.name, email: d.email, password: d.password, callbackURL: CALLBACK },
      headers: await headers(),
    })
    created = { id: res.user.id, email: res.user.email }
  } catch (e) {
    if (e instanceof APIError) {
      if (/exist/i.test(e.message))
        return fail('This email already has a login. Sign in instead.', { email: 'Already registered' })
      return fail(e.message)
    }
    throw e
  }
  await audit({
    actorUserId: created.id,
    action: 'platform.admin.joined',
    entity: 'user',
    entityId: created.id,
    data: { email: created.email },
  })
  // Signed in now (unverified): the join page shows "verify your email, then open the console".
  redirect(adminPath('/join'))
}

/** "Send the link again" for the signed-in, still unverified listed login (e.g. once email is set up). */
export async function resendAdminVerificationAction(_prev: ActionResult): Promise<ActionResult> {
  const session = await getSession()
  if (!session || !isListedAdminEmail(session.user.email)) return fail('Sign in first.')
  if (!(await withinIpLimit('admin-join-resend', JOIN_LIMITS)))
    return fail('Too many attempts from your network. Please try again later.')
  try {
    await getAuth().api.sendVerificationEmail({
      body: { email: session.user.email, callbackURL: CALLBACK },
      headers: await headers(),
    })
  } catch (e) {
    // e.g. already verified meanwhile: say so instead of failing the request.
    if (e instanceof APIError) return fail(e.message)
    throw e
  }
  await audit({
    actorUserId: session.user.id,
    action: 'platform.admin.verification_resent',
    entity: 'user',
    entityId: session.user.id,
  })
  return ok(`A new link is on its way to ${session.user.email} (if email sending is set up).`)
}

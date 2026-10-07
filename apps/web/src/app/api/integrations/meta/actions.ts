'use server'
import { withTenant } from '@spa/db'
import { authorizeUrl, disconnectInstagram, metaConfig, metaUrls, newNonce, signState } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { type ActionResult, fail, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
import { requestUrls } from '@/server/origin'
import { NONCE_COOKIE, NONCE_PATH } from './oauth'

/** Starts Instagram Login: a signed, 10-minute state bound to this tenant + user and a nonce cookie. */
export async function connectInstagramAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage')
  if (error) return fail(error)
  const cfg = metaConfig()
  const secret = process.env.BETTER_AUTH_SECRET
  if (!cfg || !secret) return fail("Instagram isn't configured on this server yet.")
  const nonce = newNonce()
  const state = signState({ tenantId: ctx.tenant.id, userId: ctx.user.id, nonce }, secret)
  // The whole flow stays on the platform domain it starts on (session + nonce cookies are per host); each platform
  // domain's callback must be registered in the Meta app (the Instagram card lists this one).
  const redirectUri = metaUrls((await requestUrls()).api('')).callback
  ;(await cookies()).set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: redirectUri.startsWith('https://'),
    path: NONCE_PATH,
    maxAge: 600,
  })
  return ok(undefined, { url: authorizeUrl({ appId: cfg.appId, redirectUri, state }) })
}

export async function disconnectInstagramAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage')
  if (error) return fail(error)
  const n = await withTenant(ctx.tenant.id, (tx) => disconnectInstagram(tx))
  if (!n) return fail('Instagram is not connected.')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'integrations.instagram.disconnect',
    entity: 'social_account',
  })
  revalidatePath(`/dashboard/${slug}/settings/integrations`)
  return ok('Instagram disconnected')
}

import { platformDb, tenants } from '@spa/db'
import {
  connectInstagramAccount,
  constantTimeEqual,
  INSTAGRAM_SCOPES,
  instagramAccountTenants,
  instagramClient,
  integrationEnv,
  MetaApiError,
  metaConfig,
  metaUrls,
  signedState,
  verifyState,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { can, isWritable, requireMember } from '@/server/access'
import { audit } from '@/server/audit'
import { canonicalUrls, requestUrls } from '@/server/origin'
import { NONCE_PATH, nonceCookie } from '../oauth'

export const dynamic = 'force-dynamic'

/**
 * Instagram Login redirect: verify the signed state + nonce cookie, re-check the signed-in user can still manage AI for
 * that spa, then code → short-lived token → long-lived token → /me → encrypted social_accounts row.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const secret = process.env.BETTER_AUTH_SECRET ?? ''
  const state = verifyState(q.get('state'), secret)
  // R29: an expired but genuine state still names its spa (back there with the 'state' notice); only a bad signature
  // goes to the dashboard root.
  const signed = state ?? signedState(q.get('state'), secret)
  const tenant = signed
    ? await platformDb().query.tenants.findFirst({
        where: eq(tenants.id, signed.t),
        columns: { id: true, slug: true },
      })
    : undefined
  const urls = await requestUrls()
  if (!signed || !tenant) return NextResponse.redirect(urls.app('/'))
  const back = (status: string) =>
    NextResponse.redirect(urls.app(`/${tenant.slug}/settings/integrations?ig=${status}`))
  // R29: this spa's nonce cookie (one per spa: two spas connecting in one browser don't collide).
  const jar = await cookies()
  const nonce = jar.get(nonceCookie('ig', tenant.id))?.value
  jar.set(nonceCookie('ig', tenant.id), '', { path: NONCE_PATH, maxAge: 0 })
  if (!state || !constantTimeEqual(nonce, state.n)) return back('state')

  const ctx = await requireMember(tenant.slug) // signs in / 404s as needed
  if (ctx.user.id !== state.u || !can(ctx, 'ai.manage') || !isWritable(ctx.tenant)) return back('forbidden')
  const cfg = metaConfig(await integrationEnv())
  if (!cfg) return back('not_configured')
  const code = q.get('code')
  if (q.get('error') || !code) return back('denied')

  let status = 'connected'
  try {
    const ig = instagramClient()
    const short = await ig.exchangeCode({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      redirectUri: metaUrls(canonicalUrls().api('')).callback, // the same URI the dialog got
      code,
    })
    const long = await ig.longLivedToken({ appSecret: cfg.appSecret, accessToken: short.accessToken })
    const me = await ig.me(long.accessToken)
    const others = (await instagramAccountTenants(me.userId)).filter((id) => id !== tenant.id)
    if (others.length) {
      status = 'in_use'
    } else {
      let webhooks: 'subscribed' | 'failed' = 'subscribed'
      try {
        await ig.subscribeWebhooks(long.accessToken)
      } catch {
        webhooks = 'failed'
      }
      // R29: lock + re-check + save in one transaction; 'in_use' if another spa won a race for this account.
      status = await connectInstagramAccount(tenant.id, {
        igUserId: me.userId,
        appUserId: short.userId,
        username: me.username,
        profilePictureUrl: me.profilePictureUrl,
        accessToken: long.accessToken,
        expiresIn: long.expiresIn,
        scopes: short.permissions.length ? short.permissions : [...INSTAGRAM_SCOPES],
        webhooks,
      })
      if (status === 'connected')
        await audit({
          tenantId: tenant.id,
          actorUserId: ctx.user.id,
          action: 'integrations.instagram.connect',
          entity: 'social_account',
          data: { username: me.username ?? null, webhooks },
        })
    }
  } catch (e) {
    console.error('instagram connect failed', e instanceof MetaApiError ? e.message : 'unexpected error')
    status = 'error'
  }
  revalidatePath(`/dashboard/${tenant.slug}/settings/integrations`)
  return back(status)
}

import { platformDb, tenants, withTenant } from '@spa/db'
import {
  constantTimeEqual,
  facebookAppConfig,
  facebookLoginClient,
  integrationEnv,
  MetaApiError,
  metaConfig,
  metaUrls,
  saveFacebookLogin,
  signedState,
  verifyState,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { can, isWritable, requireMember } from '@/server/access'
import { audit } from '@/server/audit'
import { hasFeature } from '@/server/entitlements'
import { canonicalUrls, requestUrls } from '@/server/origin'
import { NONCE_PATH, nonceCookie } from '../../oauth'

export const dynamic = 'force-dynamic'

/**
 * Facebook Login for Business redirect (F19): verify the signed state + nonce cookie, re-check the signed-in user may
 * still manage AI for that spa on a Premium plan, then code → user token → long-lived user token (encrypted, pending
 * row) → the integrations card lists the Pages to choose from.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const secret = process.env.BETTER_AUTH_SECRET ?? ''
  const state = verifyState(q.get('state'), secret)
  // R29: an expired but genuine state still names its spa; only a bad signature goes to the dashboard root.
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
    NextResponse.redirect(urls.app(`/${tenant.slug}/settings/integrations?fb=${status}`))
  const jar = await cookies()
  const nonce = jar.get(nonceCookie('fb', tenant.id))?.value
  jar.set(nonceCookie('fb', tenant.id), '', { path: NONCE_PATH, maxAge: 0 })
  if (!state || !constantTimeEqual(nonce, state.n)) return back('state')

  const ctx = await requireMember(tenant.slug)
  if (ctx.user.id !== state.u || !can(ctx, 'ai.manage') || !isWritable(ctx.tenant)) return back('forbidden')
  if (!(await hasFeature(ctx.tenant.id, 'marketing'))) return back('forbidden')
  const env = await integrationEnv()
  const cfg = facebookAppConfig(env)
  if (!cfg || !metaConfig(env)) return back('not_configured')
  const code = q.get('code')
  if (q.get('error') || !code) return back('denied')

  let status = 'choose'
  try {
    const fb = facebookLoginClient()
    const short = await fb.exchangeCode({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      redirectUri: metaUrls(canonicalUrls().api('')).facebookCallback, // the same URI the dialog got
      code,
    })
    const long = await fb.longLivedUserToken({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      accessToken: short.accessToken,
    })
    const me = await fb.me(long.accessToken)
    const pages = await fb.pages(long.accessToken)
    if (!pages.length) status = 'no_pages'
    else {
      await withTenant(tenant.id, (tx) =>
        saveFacebookLogin(tx, tenant.id, {
          fbUserId: me.id,
          userToken: long.accessToken,
          expiresIn: long.expiresIn,
        }),
      )
      await audit({
        tenantId: tenant.id,
        actorUserId: ctx.user.id,
        action: 'integrations.facebook.login',
        entity: 'social_account',
        data: { pages: pages.length },
      })
    }
  } catch (e) {
    console.error('facebook connect failed', e instanceof MetaApiError ? e.message : 'unexpected error')
    status = 'error'
  }
  revalidatePath(`/dashboard/${tenant.slug}/settings/integrations`)
  return back(status)
}

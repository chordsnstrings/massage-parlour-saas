import { platformDb, tenants, withTenant } from '@spa/db'
import {
  exchangeGoogleCode,
  GOOGLE_SCOPE,
  GoogleApiError,
  googleConfig,
  googleRedirectUri,
  integrationEnv,
  sameSecret,
  saveGbpTokens,
  signedGoogleState,
  verifyGoogleState,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { can, isWritable, requireMember } from '@/server/access'
import { audit } from '@/server/audit'
import { canonicalUrls, requestUrls } from '@/server/origin'
import { getSession } from '@/server/session'
import { GBP_COOKIE_PATH, gbpCookie } from '../oauth'

export const dynamic = 'force-dynamic'

/**
 * Google OAuth redirect: verify the signed state + the nonce/PKCE cookie, re-check that the signed-in user may still
 * manage AI for that spa, then code (+ verifier) → tokens → encrypted social_accounts row → location picker.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const secret = process.env.BETTER_AUTH_SECRET ?? ''
  const state = verifyGoogleState(q.get('state'), secret)
  // R29: an expired but genuine state still names its spa; only a bad signature goes to the dashboard root.
  const signed = state ?? signedGoogleState(q.get('state'), secret)
  const tenant = signed
    ? await platformDb().query.tenants.findFirst({
        where: eq(tenants.id, signed.tenantId),
        columns: { id: true, slug: true },
      })
    : undefined
  const urls = await requestUrls()
  if (!signed || !tenant) return NextResponse.redirect(urls.app('/'))
  const back = (status: string) =>
    NextResponse.redirect(urls.app(`/${tenant.slug}/settings/integrations?gbp=${status}`))
  // R29: this spa's cookie (one per spa: two spas connecting in one browser don't collide).
  const jar = await cookies()
  const [nonce, verifier] = (jar.get(gbpCookie(tenant.id))?.value ?? '').split('.')
  jar.set(gbpCookie(tenant.id), '', { path: GBP_COOKIE_PATH, maxAge: 0 })
  if (!state || !sameSecret(nonce, state.nonce) || !verifier) return back('state')

  const session = await getSession()
  if (!session || session.user.id !== state.userId) return back('forbidden')
  const ctx = await requireMember(tenant.slug)
  if (!can(ctx, 'ai.manage') || !isWritable(ctx.tenant)) return back('forbidden')
  const cfg = googleConfig(await integrationEnv())
  if (!cfg) return back('not_configured')
  const code = q.get('code')
  if (q.get('error') || !code) return back('denied')

  let status = 'choose'
  try {
    const tokens = await exchangeGoogleCode({
      cfg,
      code,
      verifier,
      redirectUri: googleRedirectUri(canonicalUrls().api('')), // the same URI the sign-in got
    })
    if (!tokens.scopes.includes(GOOGLE_SCOPE)) {
      status = 'scope'
    } else {
      const saved = await withTenant(tenant.id, (tx) => saveGbpTokens(tx, tenant.id, tokens))
      status = saved.needsLocation ? 'choose' : 'connected'
      await audit({
        tenantId: tenant.id,
        actorUserId: ctx.user.id,
        action: 'integrations.gbp.connect',
        entity: 'social_account',
        entityId: saved.id,
        data: { offline: Boolean(tokens.refreshToken) },
      })
    }
  } catch (e) {
    console.error(
      'google connect failed',
      e instanceof GoogleApiError ? `${e.status} ${e.reason ?? ''}`.trim() : 'unexpected error',
    )
    status = 'error'
  }
  revalidatePath(`/dashboard/${tenant.slug}/settings/integrations`)
  return back(status)
}

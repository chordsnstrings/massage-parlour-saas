import { platformDb, tenants, withTenant } from '@spa/db'
import {
  exchangeGoogleCode,
  GOOGLE_SCOPE,
  GoogleApiError,
  googleConfig,
  googleRedirectUri,
  sameSecret,
  saveGbpTokens,
  verifyGoogleState,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { appUrl } from '@/lib/paths'
import { can, isWritable, requireMember } from '@/server/access'
import { audit } from '@/server/audit'
import { getSession } from '@/server/session'
import { GBP_COOKIE, GBP_COOKIE_PATH } from '../oauth'

export const dynamic = 'force-dynamic'

/**
 * Google OAuth redirect: verify the signed state + the nonce/PKCE cookie, re-check that the signed-in user may still
 * manage AI for that spa, then code (+ verifier) → tokens → encrypted social_accounts row → location picker.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const jar = await cookies()
  const [nonce, verifier] = (jar.get(GBP_COOKIE)?.value ?? '').split('.')
  jar.set(GBP_COOKIE, '', { path: GBP_COOKIE_PATH, maxAge: 0 })

  const state = verifyGoogleState(q.get('state'), process.env.BETTER_AUTH_SECRET ?? '')
  const tenant = state
    ? await platformDb().query.tenants.findFirst({
        where: eq(tenants.id, state.tenantId),
        columns: { id: true, slug: true },
      })
    : undefined
  if (!state || !tenant) return NextResponse.redirect(appUrl('/'))
  const back = (status: string) =>
    NextResponse.redirect(appUrl(`/${tenant.slug}/settings/integrations?gbp=${status}`))
  if (!sameSecret(nonce, state.nonce) || !verifier) return back('state')

  const session = await getSession()
  if (!session || session.user.id !== state.userId) return back('forbidden')
  const ctx = await requireMember(tenant.slug)
  if (!can(ctx, 'ai.manage') || !isWritable(ctx.tenant)) return back('forbidden')
  const cfg = googleConfig()
  if (!cfg) return back('not_configured')
  const code = q.get('code')
  if (q.get('error') || !code) return back('denied')

  let status = 'choose'
  try {
    const tokens = await exchangeGoogleCode({ cfg, code, verifier, redirectUri: googleRedirectUri() })
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

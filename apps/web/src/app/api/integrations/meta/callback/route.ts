import { platformDb, tenants, withTenant } from '@spa/db'
import {
  constantTimeEqual,
  INSTAGRAM_SCOPES,
  instagramAccountTenants,
  instagramClient,
  MetaApiError,
  metaConfig,
  metaUrls,
  saveInstagramConnection,
  verifyState,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { type NextRequest, NextResponse } from 'next/server'
import { appUrl } from '@/lib/paths'
import { can, isWritable, requireMember } from '@/server/access'
import { audit } from '@/server/audit'
import { NONCE_COOKIE, NONCE_PATH } from '../oauth'

export const dynamic = 'force-dynamic'

/**
 * Instagram Login redirect: verify the signed state + nonce cookie, re-check the signed-in user can still manage AI for
 * that spa, then code → short-lived token → long-lived token → /me → encrypted social_accounts row.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const jar = await cookies()
  const nonce = jar.get(NONCE_COOKIE)?.value
  jar.set(NONCE_COOKIE, '', { path: NONCE_PATH, maxAge: 0 })

  const state = verifyState(q.get('state'), process.env.BETTER_AUTH_SECRET ?? '')
  const tenant = state
    ? await platformDb().query.tenants.findFirst({
        where: eq(tenants.id, state.t),
        columns: { id: true, slug: true },
      })
    : undefined
  if (!state || !tenant) return NextResponse.redirect(appUrl('/'))
  const back = (status: string) =>
    NextResponse.redirect(appUrl(`/${tenant.slug}/settings/integrations?ig=${status}`))
  if (!constantTimeEqual(nonce, state.n)) return back('state')

  const ctx = await requireMember(tenant.slug) // signs in / 404s as needed
  if (ctx.user.id !== state.u || !can(ctx, 'ai.manage') || !isWritable(ctx.tenant)) return back('forbidden')
  const cfg = metaConfig()
  if (!cfg) return back('not_configured')
  const code = q.get('code')
  if (q.get('error') || !code) return back('denied')

  let status = 'connected'
  try {
    const ig = instagramClient()
    const short = await ig.exchangeCode({
      appId: cfg.appId,
      appSecret: cfg.appSecret,
      redirectUri: metaUrls().callback,
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
      await withTenant(tenant.id, (tx) =>
        saveInstagramConnection(tx, tenant.id, {
          igUserId: me.userId,
          appUserId: short.userId,
          username: me.username,
          profilePictureUrl: me.profilePictureUrl,
          accessToken: long.accessToken,
          expiresIn: long.expiresIn,
          scopes: short.permissions.length ? short.permissions : [...INSTAGRAM_SCOPES],
          webhooks,
        }),
      )
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

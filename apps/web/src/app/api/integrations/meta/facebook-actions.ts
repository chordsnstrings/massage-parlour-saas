'use server'
import { withTenant } from '@spa/db'
import {
  DomainError,
  disconnectFacebook,
  facebookAppConfig,
  facebookAuthorizeUrl,
  facebookConfigId,
  facebookLoginClient,
  facebookPageTenants,
  instagramAccountTenants,
  integrationEnv,
  MetaApiError,
  metaConfig,
  metaUrls,
  newNonce,
  pendingFacebookPages,
  saveFacebookPage,
  signState,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
import { canonicalUrls } from '@/server/origin'
import { NONCE_PATH, nonceCookie } from './oauth'

const revalidate = (slug: string) => revalidatePath(`/dashboard/${slug}/settings/integrations`)

/**
 * F19: starts Facebook Login for Business (a Login for Business configuration when META_FB_CONFIG_ID is set, else
 * the Page + Instagram permissions) with a signed 10-minute state bound to this tenant + user and a nonce cookie.
 */
export async function connectFacebookAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage', 'marketing')
  if (error) return fail(error)
  const env = await integrationEnv()
  const cfg = facebookAppConfig(env)
  const secret = process.env.BETTER_AUTH_SECRET
  if (!cfg || !metaConfig(env) || !secret) return fail('settings.integrations.fb.notices.not_configured')
  const nonce = newNonce()
  const state = signState({ tenantId: ctx.tenant.id, userId: ctx.user.id, nonce }, secret)
  // R29: the canonical callback only (old platform domains redirect there); the callback reuses it for the exchange.
  const redirectUri = metaUrls(canonicalUrls().api('')).facebookCallback
  ;(await cookies()).set(nonceCookie('fb', ctx.tenant.id), nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: redirectUri.startsWith('https://'),
    path: NONCE_PATH,
    maxAge: 600,
  })
  return ok(undefined, {
    url: facebookAuthorizeUrl({ appId: cfg.appId, redirectUri, state, configId: facebookConfigId(env) }),
  })
}

const ChoosePage = z.object({ page: z.string().regex(/^\d{1,40}$/, 'settings.integrations.fb.choosePage') })

/**
 * Saves the chosen Page: re-reads the Page list with the pending login (so only Pages this person manages can be
 * saved), refuses a Page or Instagram account another spa already uses, checks the Page token, installs the app on
 * the Page (best effort) and stores the Page token encrypted.
 */
export async function chooseFacebookPageAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage', 'marketing')
  if (error) return fail(error)
  const parsed = ChoosePage.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const cfg = facebookAppConfig(await integrationEnv())
  if (!cfg) return fail('settings.integrations.fb.notices.not_configured')
  const tenantId = ctx.tenant.id
  try {
    const page = (await pendingFacebookPages(tenantId)).find((p) => p.id === parsed.data.page)
    if (!page) return fail('settings.integrations.fb.pageGone')
    const others = [
      ...(await facebookPageTenants(page.id)),
      ...(page.instagram ? await instagramAccountTenants(page.instagram.id) : []),
    ].filter((id) => id !== tenantId)
    if (others.length) return fail('settings.integrations.fb.notices.in_use')
    const client = facebookLoginClient()
    const info = await client
      .debugToken({ appId: cfg.appId, appSecret: cfg.appSecret, token: page.accessToken })
      .catch(() => null)
    let webhooks: 'subscribed' | 'failed' = 'subscribed'
    try {
      await client.subscribePage({ pageId: page.id, pageToken: page.accessToken })
    } catch {
      webhooks = 'failed'
    }
    // R29: the lock + re-check + save in one transaction (a connect of the same account elsewhere can't slip past).
    if ((await saveFacebookPage(tenantId, { page, info, webhooks })) === 'in_use')
      return fail('settings.integrations.fb.notices.in_use')
    await audit({
      tenantId,
      actorUserId: ctx.user.id,
      action: 'integrations.facebook.page',
      entity: 'social_account',
      data: { pageId: page.id, pageName: page.name, instagram: page.instagram?.username ?? null, webhooks },
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    if (e instanceof MetaApiError) {
      console.error('facebook page choice failed', e.message)
      return fail('settings.integrations.fb.notices.error')
    }
    throw e
  }
  revalidate(slug)
  return ok('settings.integrations.fb.saved')
}

/** Disconnects the Page (tokens wiped here; the app is uninstalled from the Page best effort). Any plan may do this. */
export async function disconnectFacebookAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage')
  if (error) return fail(error)
  const pages = await withTenant(ctx.tenant.id, (tx) => disconnectFacebook(tx))
  if (!pages.length) return fail('settings.integrations.fb.notConnected')
  const client = facebookLoginClient()
  for (const p of pages)
    if (p.token) await client.unsubscribePage({ pageId: p.pageId, pageToken: p.token }).catch(() => undefined)
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'integrations.facebook.disconnect',
    entity: 'social_account',
  })
  revalidate(slug)
  return ok('settings.integrations.fb.disconnected')
}

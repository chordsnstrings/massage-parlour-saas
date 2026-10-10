'use server'
import { draftReviewReply } from '@spa/ai'
import { withTenant } from '@spa/db'
import {
  chooseGbpLocation,
  createPkce,
  DomainError,
  disconnectGbp,
  type GoogleErrorCode,
  gbpErrorMessage,
  getGbpAccount,
  googleAuthorizeUrl,
  googleBookingUrl,
  googleConfig,
  googleRedirectUri,
  listGbpLocations,
  newGoogleNonce,
  publicSiteBase,
  publishGbpLocalPost,
  removeGbpBookAction,
  resetGbpLocation,
  setGbpBookAction,
  signGoogleState,
  submitGbpSitemap,
  syncGbpReviews,
  withGbpToken,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { type ActionResult, fail, failDomain, formObject, fromZod, ok } from '@/lib/action'
import { guard, type MemberContext } from '@/server/access'
import { audit } from '@/server/audit'
import { requestUrls } from '@/server/origin'
import { publicSiteUrl } from '@/server/sites'
import { GBP_COOKIE, GBP_COOKIE_PATH } from './oauth'

const revalidate = (slug: string) => {
  revalidatePath(`/dashboard/${slug}/settings/integrations`)
  revalidatePath(`/dashboard/${slug}/ai/reviews`)
}

/** Starts Google sign-in: PKCE verifier + nonce in an httpOnly cookie, signed 10-minute state for this tenant + user. */
export async function connectGoogleAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage')
  if (error) return fail(error)
  const cfg = googleConfig()
  const secret = process.env.BETTER_AUTH_SECRET
  if (!cfg || !secret) return fail("Google sign-in isn't configured on this server yet.")
  const nonce = newGoogleNonce()
  const { verifier, challenge } = createPkce()
  const state = signGoogleState({ tenantId: ctx.tenant.id, userId: ctx.user.id, nonce }, secret)
  // Stays on the platform domain the flow starts on (cookies are per host); register each domain's callback with Google.
  const redirectUri = googleRedirectUri((await requestUrls()).api(''))
  ;(await cookies()).set(GBP_COOKIE, `${nonce}.${verifier}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: redirectUri.startsWith('https://'),
    path: GBP_COOKIE_PATH,
    maxAge: 600,
  })
  return ok(undefined, {
    url: googleAuthorizeUrl({ clientId: cfg.clientId, redirectUri, state, codeChallenge: challenge }),
  })
}

const locationSchema = z.object({
  location: z
    .string()
    .regex(/^accounts\/[\w-]+\|locations\/[\w-]+$/, 'Choose a location.')
    .transform((v) => {
      const [accountName, locationName] = v.split('|') as [string, string]
      return { accountName, locationName }
    }),
})

/** Saves the chosen location after checking Google really lists it for this sign-in, then imports its reviews. */
export async function chooseLocationAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage')
  if (error) return fail(error)
  const parsed = locationSchema.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const { accountName, locationName } = parsed.data.location
  let match: { title: string; address: string } | undefined
  try {
    const locations = await withGbpToken({ tenantId: ctx.tenant.id }, (token) =>
      listGbpLocations(token, accountName),
    )
    match = locations.find((l) => l.name === locationName)
  } catch (e) {
    return fail(gbpErrorMessage(e))
  }
  if (!match) return fail('That location is not available for this Google account.')
  await withTenant(ctx.tenant.id, (tx) =>
    chooseGbpLocation(tx, ctx.tenant.id, { accountName, locationName, ...match }),
  )
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'integrations.gbp.location',
    entity: 'social_account',
    data: { locationName, title: match.title },
  })
  // First import without AI drafts. Reviews written before this choice (meta.importedAt) are history and never get
  // drafts or autopilot replies, even if this import fails and the next sync is the first to see them.
  const res = await syncGbpReviews({ tenantId: ctx.tenant.id })
  revalidate(slug)
  return ok(
    res.ok
      ? `Connected to ${match.title}. ${res.fetched} review${res.fetched === 1 ? '' : 's'} imported.`
      : `Connected to ${match.title}. Reviews will sync shortly.`,
  )
}

/** Best effort before the location or connection goes: take our Book button off the old location. */
async function dropBookButton(ctx: MemberContext) {
  const row = await withTenant(ctx.tenant.id, (tx) => getGbpAccount(tx, ctx.tenant.id))
  if (row?.meta?.bookAction !== 'on') return
  try {
    await removeGbpBookAction({
      tenantId: ctx.tenant.id,
      bookingUrl: googleBookingUrl(await publicSiteUrl(ctx.tenant)),
    })
  } catch {
    // the change goes ahead; the link can still be removed in Google's own Business Profile editor
  }
}

export async function changeLocationAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage')
  if (error) return fail(error)
  await dropBookButton(ctx)
  const done = await withTenant(ctx.tenant.id, (tx) => resetGbpLocation(tx, ctx.tenant.id))
  if (!done) return fail('Google Business Profile is not connected.')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'integrations.gbp.location_reset',
    entity: 'social_account',
  })
  revalidate(slug)
  return ok('Choose a location')
}

export async function disconnectGoogleAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage')
  if (error) return fail(error)
  await dropBookButton(ctx)
  const done = await disconnectGbp({ tenantId: ctx.tenant.id })
  if (!done) return fail('Google Business Profile is not connected.')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'integrations.gbp.disconnect',
    entity: 'social_account',
  })
  revalidate(slug)
  return ok('Google Business Profile disconnected')
}

/** "Sync now": unanswered new reviews get AI drafts (at most 5 here; the 2-hourly job drafts the rest). */
export async function syncGoogleReviewsAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.approve', 'marketing')
  if (error) return fail(error)
  const tenantId = ctx.tenant.id
  const res = await syncGbpReviews({
    tenantId,
    maxDrafts: 5,
    draft: (reviewId) => draftReviewReply({ tenantId, reviewId }),
  })
  revalidate(slug)
  if (!res.ok) return fail(res.error)
  await audit({
    tenantId,
    actorUserId: ctx.user.id,
    action: 'integrations.gbp.sync',
    entity: 'review',
    data: { created: res.created, drafted: res.drafted, posted: res.posted },
  })
  return ok(
    res.created
      ? `${res.created} new review${res.created === 1 ? '' : 's'} from Google`
      : 'Up to date with Google',
  )
}

/** Publishes an approved AI-studio post as a Google local post with a "Book" button. */
export async function postToGoogleAction(slug: string, postId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.approve', 'marketing')
  if (error) return fail(error)
  if (!z.uuid().safeParse(postId).success) return fail('Post not found.')
  const res = await publishGbpLocalPost({
    tenantId: ctx.tenant.id,
    postId,
    bookingUrl: `${await publicSiteUrl(ctx.tenant)}/book?src=gbp`,
    createdBy: ctx.impersonating ? null : ctx.user.id,
  })
  if (!res.ok) return fail(res.error)
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'integrations.gbp.local_post',
    entity: 'social_post',
    entityId: postId,
  })
  revalidatePath(`/dashboard/${slug}/ai/content`)
  return ok('Posted to Google')
}

/** A Google failure code as the viewer's text ("Google: {reason}"); the card shows the stored state after revalidation. */
const googleFail = (code: GoogleErrorCode) =>
  fail({
    key: 'settings.integrations.google.error',
    params: { reason: { key: `settings.integrations.google.errors.${code}` } },
  })

/**
 * F17a: puts the Business Profile "Book" button (Place Actions APPOINTMENT link) on the chosen location, pointing at
 * the online booking page with `?src=google`; running it again re-points it (the worker also follows domain changes).
 */
export async function setBookButtonAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage', 'marketing')
  if (error) return fail(error)
  const bookingUrl = googleBookingUrl(await publicSiteUrl(ctx.tenant))
  let res: Awaited<ReturnType<typeof setGbpBookAction>>
  try {
    res = await setGbpBookAction({ tenantId: ctx.tenant.id, bookingUrl })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'integrations.gbp.book_button',
    entity: 'social_account',
    data: res.ok ? { uri: res.uri, changed: res.changed } : { error: res.code },
  })
  revalidate(slug)
  return res.ok ? ok('settings.integrations.google.book.saved') : googleFail(res.code)
}

export async function removeBookButtonAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage', 'marketing')
  if (error) return fail(error)
  let res: Awaited<ReturnType<typeof removeGbpBookAction>>
  try {
    res = await removeGbpBookAction({
      tenantId: ctx.tenant.id,
      bookingUrl: googleBookingUrl(await publicSiteUrl(ctx.tenant)),
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'integrations.gbp.book_button_removed',
    entity: 'social_account',
    data: res.ok ? { removed: res.removed } : { error: res.code },
  })
  revalidate(slug)
  return res.ok ? ok('settings.integrations.google.book.removed') : googleFail(res.code)
}

/** F17b: submits the spa site's sitemap to Search Console with the connected Google account. */
export async function submitSitemapAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage', 'marketing')
  if (error) return fail(error)
  const base = await withTenant(ctx.tenant.id, (tx) => publicSiteBase(tx, ctx.tenant.slug))
  let res: Awaited<ReturnType<typeof submitGbpSitemap>>
  try {
    res = await submitGbpSitemap({
      tenantId: ctx.tenant.id,
      siteBase: base.custom ? base.url : await publicSiteUrl(ctx.tenant),
      custom: base.custom,
    })
  } catch (e) {
    if (e instanceof DomainError) return failDomain(e)
    throw e
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'integrations.gsc.sitemap_submit',
    entity: 'site',
    data: res.ok ? { siteUrl: res.siteUrl } : { state: res.state, error: res.code ?? null },
  })
  revalidate(slug)
  if (res.ok) return ok('settings.integrations.google.sc.submitted')
  if (res.state === 'error') return googleFail(res.code ?? 'other')
  return fail(`settings.integrations.google.sc.state.${res.state}`)
}

'use server'
import { draftReviewReply } from '@spa/ai'
import { withTenant } from '@spa/db'
import {
  chooseGbpLocation,
  createPkce,
  disconnectGbp,
  gbpErrorMessage,
  googleAuthorizeUrl,
  googleConfig,
  googleRedirectUri,
  listGbpLocations,
  newGoogleNonce,
  publishGbpLocalPost,
  resetGbpLocation,
  signGoogleState,
  syncGbpReviews,
  withGbpToken,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { tenantSiteUrl } from '@/lib/paths'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
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
  const redirectUri = googleRedirectUri()
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

export async function changeLocationAction(slug: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage')
  if (error) return fail(error)
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
  const { ctx, error } = await guard(slug, 'ai.approve')
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
  const { ctx, error } = await guard(slug, 'ai.approve')
  if (error) return fail(error)
  if (!z.uuid().safeParse(postId).success) return fail('Post not found.')
  const res = await publishGbpLocalPost({
    tenantId: ctx.tenant.id,
    postId,
    bookingUrl: `${tenantSiteUrl(slug)}/book?src=gbp`,
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

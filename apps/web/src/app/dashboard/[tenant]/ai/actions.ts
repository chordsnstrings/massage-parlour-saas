'use server'
import { draftInstagramPost, draftReviewReply, runDmTurn } from '@spa/ai'
import { aiAgentSettings, brandProfiles, reviews, socialPosts, withTenant } from '@spa/db'
import { fileIdFromUrl, persistRemoteAsset, postImageUrl, saveRemoteImage } from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'
import { canonicalUrls } from '@/server/origin'

const AGENTS = ['dm_agent', 'content_agent', 'review_agent', 'seo_agent', 'slot_filler'] as const
const aiError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e)
  if (/budget/i.test(msg)) return 'Your monthly AI budget is used up. Ask your account manager to raise it.'
  if (/disabled/i.test(msg)) return 'This AI feature is switched off by the platform.'
  return 'The AI service is busy — please try again in a moment.'
}

const settingsSchema = z.object({
  agentKey: z.enum(AGENTS),
  enabled: z.preprocess((v) => v === 'on', z.boolean()),
  mode: z.enum(['approve', 'autopilot']),
  tone: z.string().trim().min(3).max(120),
  rules: z.string().trim().max(1000).optional(),
})

export async function saveAgentAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage')
  if (error) return fail(error)
  const parsed = settingsSchema.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const d = parsed.data
  await withTenant(ctx.tenant.id, (tx) =>
    tx
      .insert(aiAgentSettings)
      .values({ tenantId: ctx.tenant.id, ...d, rules: d.rules ?? null })
      .onConflictDoUpdate({
        target: [aiAgentSettings.tenantId, aiAgentSettings.agentKey],
        set: { enabled: d.enabled, mode: d.mode, tone: d.tone, rules: d.rules ?? null },
      }),
  )
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'ai.agent.updated',
    entityId: d.agentKey,
    data: d,
  })
  revalidatePath(`/dashboard/${slug}/ai`)
  return ok('Saved')
}

export async function saveBrandAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.manage')
  if (error) return fail(error)
  const parsed = z
    .object({
      voice: z.string().trim().min(10).max(600),
      dos: z.string().max(800).optional(),
      donts: z.string().max(800).optional(),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const lines = (s?: string) =>
    (s ?? '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean)
  const v = { voice: parsed.data.voice, dos: lines(parsed.data.dos), donts: lines(parsed.data.donts) }
  await withTenant(ctx.tenant.id, (tx) =>
    tx
      .insert(brandProfiles)
      .values({ tenantId: ctx.tenant.id, ...v })
      .onConflictDoUpdate({ target: brandProfiles.tenantId, set: v }),
  )
  revalidatePath(`/dashboard/${slug}/ai`)
  return ok('Brand voice saved')
}

export type ChatTurn = { from: 'customer' | 'spa'; text: string }

/** Lets the owner try the DM receptionist with the spa's live menu and availability. */
export async function tryDmAction(slug: string, history: ChatTurn[], text: string) {
  const { ctx, error } = await guard(slug, 'ai.approve')
  if (error) return { ok: false as const, error }
  const incoming = text.trim().slice(0, 1000)
  if (!incoming) return { ok: false as const, error: 'Type a message' }
  try {
    const r = await runDmTurn({
      tenantId: ctx.tenant.id,
      history: history.slice(-12),
      incoming,
      source: 'instagram',
    })
    return {
      ok: true as const,
      reply: r.reply,
      bookingRef: r.bookingRef,
      flagged: r.flagged,
      handoff: r.handoff,
    }
  } catch (e) {
    console.error('dm try failed', e)
    return { ok: false as const, error: aiError(e) }
  }
}

export async function draftPostAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.approve')
  if (error) return fail(error)
  const brief = String(fd.get('brief') ?? '')
    .trim()
    .slice(0, 500)
  let post: Awaited<ReturnType<typeof draftInstagramPost>>
  try {
    post = await draftInstagramPost({
      tenantId: ctx.tenant.id,
      brief: brief || undefined,
      withImage: fd.get('image') === 'on',
      createdBy: ctx.user.id,
    })
  } catch (e) {
    console.error('draft post failed', e)
    return fail(aiError(e))
  }
  await persistPostImages(ctx.tenant.id, slug, post, ctx.user.id)
  revalidatePath(`/dashboard/${slug}/ai/content`)
  revalidatePath(`/dashboard/${slug}/media`)
  return ok('Draft ready for review')
}

/**
 * Seedream links expire after 7 days: copy the generated image into the media library and point the post at the
 * permanent file (absolute on the spa's site origin as a ?f=jpg rendition — Instagram needs a public JPEG URL).
 * On failure the draft keeps the temporary link and the library shows a "Save to library" retry.
 */
async function persistPostImages(
  tenantId: string,
  slug: string,
  post: { id: string; media: { url: string; alt?: string }[] },
  userId: string,
) {
  const remote = post.media.filter((m) => /^https:\/\//i.test(m.url) && !fileIdFromUrl(m.url))
  if (remote.length === 0) return
  const origin = new URL(canonicalUrls().site(slug)).origin
  const moved = new Map<string, string>()
  for (const m of remote) {
    try {
      const image = await saveRemoteImage(m.url)
      const asset = await withTenant(tenantId, (tx) =>
        persistRemoteAsset(tx, { tenantId, remoteUrl: m.url, image, alt: { en: m.alt }, createdBy: userId }),
      )
      moved.set(m.url, postImageUrl(asset.url, origin))
    } catch (e) {
      console.error('persist AI image failed', e instanceof Error ? e.message : e)
    }
  }
  if (moved.size === 0) return
  await withTenant(tenantId, (tx) =>
    tx
      .update(socialPosts)
      .set({ media: post.media.map((m) => ({ ...m, url: moved.get(m.url) ?? m.url })) })
      .where(eq(socialPosts.id, post.id)),
  )
  await audit({
    tenantId,
    actorUserId: userId,
    action: 'media.persisted',
    entity: 'social_post',
    entityId: post.id,
    data: { images: moved.size },
  })
}

export async function setPostStatusAction(
  slug: string,
  postId: string,
  status: 'scheduled' | 'draft' | 'published',
  scheduledAt?: string,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.approve')
  if (error) return fail(error)
  await withTenant(ctx.tenant.id, (tx) =>
    tx
      .update(socialPosts)
      .set({
        status,
        scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        publishedAt: status === 'published' ? new Date() : null,
      })
      .where(eq(socialPosts.id, postId)),
  )
  if (status !== 'draft') {
    // Second chance for images whose copy into the library failed when the draft was made.
    const [post] = await withTenant(ctx.tenant.id, (tx) =>
      tx
        .select({ id: socialPosts.id, media: socialPosts.media })
        .from(socialPosts)
        .where(eq(socialPosts.id, postId)),
    )
    if (post) await persistPostImages(ctx.tenant.id, slug, post, ctx.user.id)
  }
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: `ai.post.${status}`,
    entityId: postId,
  })
  revalidatePath(`/dashboard/${slug}/ai/content`)
  return ok(
    status === 'scheduled'
      ? 'Approved and scheduled'
      : status === 'published'
        ? 'Marked as posted'
        : 'Moved back to drafts',
  )
}

export async function addReviewAction(slug: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.approve')
  if (error) return fail(error)
  const parsed = z
    .object({
      author: z.string().trim().max(80).optional(),
      rating: z.coerce.number().int().min(1).max(5),
      text: z.string().trim().max(4000).optional(),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  await withTenant(ctx.tenant.id, (tx) =>
    tx.insert(reviews).values({
      tenantId: ctx.tenant.id,
      source: 'google',
      externalId: `manual-${Date.now()}`,
      author: parsed.data.author || null,
      rating: parsed.data.rating,
      text: parsed.data.text || null,
      reviewedAt: new Date(),
    }),
  )
  revalidatePath(`/dashboard/${slug}/ai/reviews`)
  return ok('Review added')
}

export async function draftReplyAction(slug: string, reviewId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.approve')
  if (error) return fail(error)
  try {
    await draftReviewReply({ tenantId: ctx.tenant.id, reviewId })
  } catch (e) {
    console.error('review reply failed', e)
    return fail(aiError(e))
  }
  revalidatePath(`/dashboard/${slug}/ai/reviews`)
  return ok('Reply drafted')
}

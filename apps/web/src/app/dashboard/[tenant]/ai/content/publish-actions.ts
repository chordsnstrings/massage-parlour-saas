'use server'
import { socialPosts, withTenant } from '@spa/db'
import {
  IG_POST_TYPES,
  instagramPublishPlan,
  isProcessing,
  isPublishing,
  type PostMedia,
  publishInstagramPost,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

/** Publishes an approved post to the connected Instagram account now (image container → media_publish). */
export async function publishToInstagramAction(slug: string, postId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.approve', 'marketing')
  if (error) return fail(error)
  const parsed = z.uuid().safeParse(postId)
  if (!parsed.success) return fail('ai.unknownPost')
  // Videos may need longer than one request: then the post is parked and the 5-minute job publishes it.
  const r = await publishInstagramPost(ctx.tenant.id, parsed.data)
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'ai.post.publish_instagram',
    entity: 'social_post',
    entityId: parsed.data,
    data: r.ok ? { externalId: r.externalId } : { error: r.error },
  })
  revalidatePath(`/dashboard/${slug}/ai/content`)
  if (!r.ok && r.processing) return ok('marketing.processingStarted')
  return r.ok ? ok('ai.publishedIg') : fail(r.error)
}

const list = (v: unknown) => (Array.isArray(v) ? v : v === undefined ? [] : [v])
const FormatSchema = z.object({
  type: z.enum(IG_POST_TYPES, 'marketing.format.errType'),
  url: z
    .array(
      z
        .string()
        .trim()
        .max(2000)
        .refine((u) => {
          try {
            return new URL(u).protocol === 'https:'
          } catch {
            return false
          }
        }, 'marketing.format.errUrl'),
    )
    .min(1, 'marketing.format.errUrl')
    .max(10),
  kind: z.array(z.enum(['image', 'video'])).max(10),
})

/**
 * F18: sets the post's Instagram format (feed / reel / story / carousel) and media links. Checked with the same plan
 * the publisher uses, so a saved format can be published; any parked container is dropped (the media changed).
 */
export async function setPostFormatAction(
  slug: string,
  postId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.approve', 'marketing')
  if (error) return fail(error)
  if (!z.uuid().safeParse(postId).success) return fail('ai.unknownPost')
  const raw = formObject(fd)
  const urls = list(raw.url).map(String)
  const kinds = list(raw.kind).map(String)
  const keep = urls.map((u, i) => [u.trim(), kinds[i] ?? 'image'] as const).filter(([u]) => u)
  const parsed = FormatSchema.safeParse({
    type: raw.type,
    url: keep.map(([u]) => u),
    kind: keep.map(([, k]) => k),
  })
  if (!parsed.success) return fromZod(parsed.error)
  const media: PostMedia[] = parsed.data.url.map((url, i) => ({ url, type: parsed.data.kind[i] ?? 'image' }))
  const plan = instagramPublishPlan({ type: parsed.data.type, caption: '', media })
  if (!plan.ok) return fail(`marketing.problem.${plan.problem}`)
  const res = await withTenant(ctx.tenant.id, async (tx) => {
    const [post] = await tx.select().from(socialPosts).where(eq(socialPosts.id, postId)).for('update')
    if (!post) return 'ai.unknownPost'
    if (post.platform !== 'instagram') return 'marketing.blockNotIg'
    if (post.status === 'published' || isPublishing(post) || isProcessing(post))
      return 'marketing.format.errLocked'
    const alts = new Map(post.media.map((m) => [m.url, m.alt]))
    await tx
      .update(socialPosts)
      .set({
        type: parsed.data.type,
        media: media.map((m) => ({ ...m, ...(alts.get(m.url) ? { alt: alts.get(m.url) } : {}) })),
        meta: {},
      })
      .where(eq(socialPosts.id, post.id))
    return null
  })
  if (res) return fail(res)
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'ai.post.format',
    entity: 'social_post',
    entityId: postId,
    data: { type: parsed.data.type, items: media.length },
  })
  revalidatePath(`/dashboard/${slug}/ai/content`)
  return ok('marketing.format.saved')
}

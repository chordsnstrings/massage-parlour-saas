'use server'
import { publishInstagramPost } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

/** Publishes an approved post to the connected Instagram account now (image container → media_publish). */
export async function publishToInstagramAction(slug: string, postId: string): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.approve')
  if (error) return fail(error)
  const parsed = z.uuid().safeParse(postId)
  if (!parsed.success) return fail('ai.unknownPost')
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
  return r.ok ? ok('ai.publishedIg') : fail(r.error)
}

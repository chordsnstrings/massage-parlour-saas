'use server'
import { reviews, withTenant } from '@spa/db'
import { postGbpReply } from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const schema = z.object({
  reviewId: z.uuid(),
  reply: z.string().trim().min(2, 'reviews.writeFirst').max(2000, 'reviews.tooLong'),
  /** draft = keep editing · approve = ready to post · post = approve + post to Google · manual = fallback flow */
  intent: z.enum(['draft', 'approve', 'post', 'manual']),
  posted: z.preprocess((v) => v === 'on', z.boolean()),
})

const MESSAGES = {
  draft: 'reviews.draftSaved',
  approve: 'reviews.replyApproved',
  post: 'reviews.replyPosted',
} as const

/** Saves a review reply; `post` also publishes it to Google (the review ends `posted` or `failed` with the reason). */
export async function saveReviewReplyAction(
  slug: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'ai.approve')
  if (error) return fail(error)
  const parsed = schema.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const { reviewId, reply, intent, posted } = parsed.data
  const status =
    intent === 'draft' ? 'draft' : intent === 'manual' ? (posted ? 'posted' : 'approved') : 'approved'
  const [row] = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .update(reviews)
      .set({
        replyText: reply,
        replyStatus: status,
        replyError: null,
        repliedAt: status === 'posted' ? new Date() : null,
      })
      .where(and(eq(reviews.tenantId, ctx.tenant.id), eq(reviews.id, reviewId)))
      .returning({ id: reviews.id, rating: reviews.rating }),
  )
  if (!row) return fail('reviews.notFound')
  const result = intent === 'post' ? await postGbpReply({ tenantId: ctx.tenant.id, reviewId }) : null
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: `reviews.reply.${intent === 'manual' ? status : intent}`,
    entity: 'review',
    entityId: reviewId,
    data: { rating: row.rating, ...(result && !result.ok ? { error: result.error } : {}) },
  })
  revalidatePath(`/dashboard/${slug}/ai/reviews`)
  if (result && !result.ok) return fail(result.error)
  if (intent === 'manual') return ok(posted ? 'reviews.markedReplied' : 'reviews.replySaved')
  return ok(MESSAGES[intent])
}

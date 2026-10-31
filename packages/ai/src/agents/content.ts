import { aiRuns, mediaAssets, reviews, socialPosts, withTenant } from '@spa/db'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { runChat, runImage } from '../gateway'
import type { ModelArkClient } from '../modelark'
import { loadSpaContext, nowLine, SAFETY } from './context'

const PostSchema = z.object({
  caption_en: z.string().min(10).max(1500),
  caption_ar: z.string().min(5).max(1500),
  hashtags: z.array(z.string()).max(15),
  image_prompt: z.string().min(10).max(600),
})

/**
 * Drafts an Instagram post (EN + AR caption, hashtags) and, optionally, a Seedream image.
 * Stored as a social post awaiting approval; nothing is published automatically.
 */
export async function draftInstagramPost(opts: {
  tenantId: string
  brief?: string
  withImage?: boolean
  createdBy?: string | null
  client?: ModelArkClient
}) {
  const ctx = await withTenant(opts.tenantId, (tx) => loadSpaContext(tx, opts.tenantId, 'content_agent'))
  const menu = ctx.menu
    .map(
      (m) => `${m.name} ${m.durationMin}min ${m.priceAed == null ? 'price on request' : `AED ${m.priceAed}`}`,
    )
    .join('; ')
  const res = await runChat({
    tenantId: opts.tenantId,
    agentKey: 'content_agent',
    client: opts.client,
    schema: PostSchema,
    temperature: 0.8,
    messages: [
      {
        role: 'system',
        content: `You write Instagram posts for ${ctx.name}, a massage & wellness spa in the UAE. Voice: ${ctx.voice}. ${nowLine()}
Menu: ${menu || 'massage treatments'}. Write an inviting caption in English and in Arabic (natural Gulf-friendly Modern Standard Arabic), end with a gentle call to book via the link in bio or WhatsApp.
Also write an image prompt for a photorealistic, tasteful, non-suggestive spa image (interiors, products, hands with oils, towels, plants — no faces, no bodies in revealing poses, no text in the image).
${SAFETY}`,
      },
      {
        role: 'user',
        content: opts.brief
          ? `Post idea: ${opts.brief}`
          : 'Suggest a fresh post idea for this week and write it.',
      },
    ],
  })
  const out = res.output
  let image: { url: string } | null = null
  if (opts.withImage !== false)
    image = await runImage({
      tenantId: opts.tenantId,
      agentKey: 'image_default',
      prompt: out.image_prompt,
      client: opts.client,
    })
  const caption = `${out.caption_en}\n\n${out.caption_ar}\n\n${out.hashtags.map((h) => (h.startsWith('#') ? h : `#${h}`)).join(' ')}`
  return withTenant(opts.tenantId, async (tx) => {
    const [run] = await tx
      .insert(aiRuns)
      .values({
        tenantId: opts.tenantId,
        agentKey: 'content_agent',
        trigger: 'manual',
        input: { brief: opts.brief ?? null },
        output: out,
        status: 'pending_approval',
        costUsd: res.costUsd.toFixed(6),
      })
      .returning()
    if (image)
      await tx.insert(mediaAssets).values({
        tenantId: opts.tenantId,
        url: image.url,
        kind: 'image',
        source: 'ai',
        alt: { en: out.image_prompt.slice(0, 200) },
      })
    const [post] = await tx
      .insert(socialPosts)
      .values({
        tenantId: opts.tenantId,
        platform: 'instagram',
        caption,
        media: image ? [{ url: image.url, alt: out.image_prompt.slice(0, 200) }] : [],
        status: 'pending_approval',
        aiRunId: run!.id,
        createdBy: opts.createdBy ?? null,
      })
      .returning()
    return post!
  })
}

const ReplySchema = z.object({ reply: z.string().min(5).max(900) })

/** Drafts a reply to a Google review (stored as a draft for approval). */
export async function draftReviewReply(opts: {
  tenantId: string
  reviewId: string
  client?: ModelArkClient
}) {
  const ctx = await withTenant(opts.tenantId, (tx) => loadSpaContext(tx, opts.tenantId, 'review_agent'))
  const [review] = await withTenant(opts.tenantId, (tx) =>
    tx.select().from(reviews).where(eq(reviews.id, opts.reviewId)),
  )
  if (!review) throw new Error('review not found')
  const res = await runChat({
    tenantId: opts.tenantId,
    agentKey: 'review_agent',
    client: opts.client,
    schema: ReplySchema,
    messages: [
      {
        role: 'system',
        content: `You reply to Google reviews for ${ctx.name}. Voice: ${ctx.voice}. Thank the reviewer by first name if given, reflect one specific detail,
for 1–3 stars apologise sincerely and invite them to message the spa (no excuses, no arguing, never reveal private details). 2–4 sentences, same language as the review.
${SAFETY}`,
      },
      {
        role: 'user',
        content: `${review.rating}★ review by ${review.author ?? 'a guest'}: ${review.text ?? '(no text)'}`,
      },
    ],
  })
  await withTenant(opts.tenantId, (tx) =>
    tx
      .update(reviews)
      .set({ replyText: res.output.reply, replyStatus: 'draft' })
      .where(eq(reviews.id, review.id)),
  )
  return res.output.reply
}

const SeoSchema = z.object({
  title: z.string().min(10).max(70),
  description: z.string().min(50).max(170),
  keywords: z.array(z.string()).max(12),
})

/** SEO title/description/keywords for a page of the spa's website (EN). */
export async function generateSeo(opts: {
  tenantId: string
  pageTitle: string
  pageText: string
  client?: ModelArkClient
}) {
  const ctx = await withTenant(opts.tenantId, (tx) => loadSpaContext(tx, opts.tenantId, 'seo_agent'))
  const res = await runChat({
    tenantId: opts.tenantId,
    agentKey: 'seo_agent',
    client: opts.client,
    schema: SeoSchema,
    messages: [
      {
        role: 'system',
        content: `You write SEO metadata for ${ctx.name}, a massage spa in ${ctx.branch?.address ?? 'the UAE'}. Title ≤ 60 characters including the spa name and area; description 140–160 characters,
specific and inviting; keywords people in the UAE search for (e.g. "massage Dubai Marina"). No medical claims, no keyword stuffing.`,
      },
      { role: 'user', content: `Page: ${opts.pageTitle}\n\n${opts.pageText.slice(0, 4000)}` },
    ],
  })
  return res.output
}

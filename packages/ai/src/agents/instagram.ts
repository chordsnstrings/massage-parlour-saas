import { aiAgentSettings, withTenant } from '@spa/db'
import {
  applyAgentOutcome,
  clipBytes,
  fillParticipant,
  type InboundItem,
  loadAgentTurn,
  type SocialOpts,
} from '@spa/services'
import { and, eq } from 'drizzle-orm'
import { z } from 'zod'
import { runChat } from '../gateway'
import type { ModelArkClient } from '../modelark'
import { hoursText, loadSpaContext, nowLine, SAFETY, type SpaContext } from './context'
import { runDmTurn } from './dm'

const MAX_COMMENT_CHARS = 300

export function commentSystemPrompt(ctx: SpaContext, now = new Date()) {
  const menu = ctx.menu
    .map(
      (m) =>
        `- ${m.name}: ${m.durationMin} min, ${m.priceAed == null ? 'price on request' : `AED ${m.priceAed}`}`,
    )
    .join('\n')
  return `You write short public replies to Instagram comments for ${ctx.name}, a massage & wellness spa in the UAE.
Voice: ${ctx.voice} Tone: ${ctx.tone}.
${nowLine(now)}
Address: ${ctx.branch?.address ?? 'ask the team'}. Opening hours: ${hoursText(ctx.branch?.openingHours)}.
Menu (prices in AED, VAT included):
${menu || '- (no online menu yet)'}

The reply is public: one or two short sentences, at most ${MAX_COMMENT_CHARS} characters. Thank people for kind words.
Answer simple questions briefly from the facts above and invite them to send a DM or book online for anything else.
Never discuss complaints, health details or personal data in public — invite them to DM instead.
If the comment is inappropriate, sexual or suggestive: set "inappropriate" to true and reply with one brief, neutral sentence
that you can only help with spa services — no prices, no questions, and do not repeat or engage with the content.
${ctx.rules}
${SAFETY}
(For comments there are no tools: set "inappropriate" instead of calling flag_conversation.)`
}

const CommentReply = z.object({ reply: z.string(), inappropriate: z.boolean() })

/** Drafts a short public reply to one Instagram comment. */
export async function draftCommentReply(opts: {
  tenantId: string
  comment: string
  client?: ModelArkClient
  now?: Date
}) {
  const ctx = await withTenant(opts.tenantId, (tx) => loadSpaContext(tx, opts.tenantId, 'dm_agent'))
  const res = await runChat({
    tenantId: opts.tenantId,
    agentKey: 'comment_agent',
    messages: [
      { role: 'system', content: commentSystemPrompt(ctx, opts.now) },
      { role: 'user', content: `Comment: """${opts.comment.slice(0, 1000)}"""` },
    ],
    schema: CommentReply,
    temperature: 0.4,
    client: opts.client,
  })
  const reply = res.output.reply.trim()
  return {
    reply: reply.length > MAX_COMMENT_CHARS ? `${reply.slice(0, MAX_COMMENT_CHARS - 1)}…` : reply,
    flagged: res.output.inappropriate ? 'inappropriate comment' : undefined,
    costUsd: res.costUsd,
  }
}

/** Instagram DM text limit in UTF-8 bytes (Arabic letters take 2). */
const MAX_PRIVATE_BYTES = 1000

export function privateReplySystemPrompt(ctx: SpaContext, bookingUrl: string | null, now = new Date()) {
  const menu = ctx.menu
    .map(
      (m) =>
        `- ${m.name}: ${m.durationMin} min, ${m.priceAed == null ? 'price on request' : `AED ${m.priceAed}`}`,
    )
    .join('\n')
  return `You write ONE private Instagram message (a DM) answering a comment someone left on ${ctx.name}'s post.
${ctx.name} is a massage & wellness spa in the UAE. Voice: ${ctx.voice} Tone: ${ctx.tone}.
${nowLine(now)}
Address: ${ctx.branch?.address ?? 'ask the team'}. Opening hours: ${hoursText(ctx.branch?.openingHours)}.
Menu (prices in AED, VAT included):
${menu || '- (no online menu yet)'}
${bookingUrl ? `Online booking: ${bookingUrl}` : ''}

Instagram allows only this one private message unless the person writes back, so make it complete: greet them,
answer the comment helpfully from the facts above (prices are fine here), and invite them to reply or book online.
Two to four short sentences, under ${MAX_PRIVATE_BYTES} bytes. Reply in the comment's language (English or Arabic).
If the comment is inappropriate, sexual or suggestive: set "inappropriate" to true and write one brief, neutral
sentence that you can only help with spa services. A staff member reviews and sends your text.
${ctx.rules}
${SAFETY}`
}

const PrivateReply = z.object({ reply: z.string(), inappropriate: z.boolean() })

/**
 * Drafts the private DM reply to one comment (F18) through the gateway (budget + kill switch, `comment_agent`
 * model). Never sends anything: the inbox puts the text in the private-reply box for staff to edit and send.
 */
export async function draftPrivateReply(opts: {
  tenantId: string
  comment: string
  bookingUrl?: string | null
  client?: ModelArkClient
  now?: Date
}) {
  const ctx = await withTenant(opts.tenantId, (tx) => loadSpaContext(tx, opts.tenantId, 'dm_agent'))
  const res = await runChat({
    tenantId: opts.tenantId,
    agentKey: 'comment_agent',
    messages: [
      { role: 'system', content: privateReplySystemPrompt(ctx, opts.bookingUrl ?? null, opts.now) },
      { role: 'user', content: `Comment: """${opts.comment.slice(0, 1000)}"""` },
    ],
    schema: PrivateReply,
    temperature: 0.4,
    client: opts.client,
  })
  return {
    reply: clipBytes(res.output.reply.trim(), MAX_PRIVATE_BYTES),
    inappropriate: res.output.inappropriate,
    costUsd: res.costUsd,
  }
}

export type InstagramTurn = 'missing' | 'human' | 'flagged' | 'off' | 'sent' | 'drafted' | 'none'

/**
 * Handles one new inbound Instagram DM or comment per the spa's "Instagram receptionist" settings:
 * autopilot sends DM replies (inside the 24-hour window), approve-first stores an AI draft,
 * and human / closed / flagged threads are left for staff (they show as unread in the inbox).
 * Comment replies are public, so they are always drafts for staff to approve, whatever the DM mode.
 */
export async function respondToInstagram(
  item: InboundItem,
  opts: SocialOpts & { client?: ModelArkClient } = {},
): Promise<InstagramTurn> {
  if (item.channel === 'instagram_dm') await fillParticipant(item.tenantId, item.conversationId, opts)
  const turn = await loadAgentTurn(item, opts)
  if (!turn) return 'missing'
  if (turn.conversation.mode !== 'bot') return 'human'
  if (turn.conversation.flagged) return 'flagged'
  const [settings] = await withTenant(
    item.tenantId,
    (tx) =>
      tx
        .select()
        .from(aiAgentSettings)
        .where(and(eq(aiAgentSettings.tenantId, item.tenantId), eq(aiAgentSettings.agentKey, 'dm_agent'))),
    opts.app,
  )
  if (!settings?.enabled) return 'off'
  const now = opts.now ?? new Date()
  if (item.channel === 'instagram_dm') {
    const r = await runDmTurn({
      tenantId: item.tenantId,
      history: turn.history,
      incoming: item.text,
      source: 'instagram',
      client: opts.client,
      now,
    })
    return applyAgentOutcome(item.tenantId, item.conversationId, r, settings.mode, opts)
  }
  const r = await draftCommentReply({ tenantId: item.tenantId, comment: item.text, client: opts.client, now })
  return applyAgentOutcome(item.tenantId, item.conversationId, r, 'approve', opts)
}

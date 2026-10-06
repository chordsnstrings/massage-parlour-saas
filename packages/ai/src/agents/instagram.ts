import { aiAgentSettings, withTenant } from '@spa/db'
import {
  applyAgentOutcome,
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
  const menu = ctx.menu.map((m) => `- ${m.name}: ${m.durationMin} min, AED ${m.priceAed}`).join('\n')
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

export type InstagramTurn = 'missing' | 'human' | 'flagged' | 'off' | 'sent' | 'drafted' | 'none'

/**
 * Handles one new inbound Instagram DM or comment per the spa's "Instagram receptionist" settings:
 * autopilot sends the reply (inside the 24-hour window), approve-first stores an AI draft,
 * and human / closed / flagged threads are left for staff (they show as unread in the inbox).
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
  return applyAgentOutcome(item.tenantId, item.conversationId, r, settings.mode, opts)
}

import { addDays, businessDateOf, dubaiInstant, dubaiParts } from '@spa/core'
import { conversationMessages, conversations, type Tx, withTenant } from '@spa/db'
import {
  availableSlots,
  createBooking,
  DomainError,
  findOrCreateClient,
  selfBookingStatus,
} from '@spa/services'
import { eq } from 'drizzle-orm'
import { metaMcpSources } from '../mcp/client'
import type { ChatMessage, ModelArkClient, ToolDef } from '../modelark'
import { type LocalTool, runToolLoop } from '../tool-loop'
import { hoursText, loadSpaContext, nowLine, SAFETY, type SpaContext } from './context'

const MAX_DM_BYTES = 1000

const tools: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'check_availability',
      description: 'Free start times for a service on a date (Dubai time).',
      parameters: {
        type: 'object',
        properties: {
          variant_id: { type: 'string', description: 'Service variant id from the menu' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          after: { type: 'string', description: 'Optional HH:MM — only times at or after this' },
        },
        required: ['variant_id', 'date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'book',
      description:
        'Create a booking request (the spa confirms it). Only after the customer chose a time and gave name + UAE mobile.',
      parameters: {
        type: 'object',
        properties: {
          variant_id: { type: 'string' },
          date: { type: 'string', description: 'YYYY-MM-DD' },
          time: { type: 'string', description: 'HH:MM (Dubai)' },
          name: { type: 'string' },
          phone: { type: 'string', description: 'UAE mobile, e.g. 050 123 4567' },
        },
        required: ['variant_id', 'date', 'time', 'name', 'phone'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'handoff_to_human',
      description:
        'Hand the conversation to staff (complaints, special requests, anything you cannot answer).',
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'flag_conversation',
      description: 'Flag an inappropriate conversation for staff review.',
      parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] },
    },
  },
]

export function dmSystemPrompt(ctx: SpaContext, now = new Date()) {
  const menu = ctx.menu
    .map(
      (m) =>
        `- ${m.name}${m.nameAr ? ` / ${m.nameAr}` : ''}: ${m.durationMin} min, ${m.priceAed == null ? 'price on request' : `AED ${m.priceAed}`} (variant_id ${m.variantId})`,
    )
    .join('\n')
  return `You reply to Instagram direct messages for ${ctx.name}, a massage & wellness spa in the UAE.
Voice: ${ctx.voice} Tone: ${ctx.tone}.
${nowLine(now)}
Address: ${ctx.branch?.address ?? 'ask the team'}. Opening hours: ${hoursText(ctx.branch?.openingHours)}.
Menu (prices in AED, VAT included):
${menu || '- (no online menu yet — hand off to staff for bookings)'}

How to help: answer questions about services, prices, hours and location from the facts above. To book, find out the service and preferred day/time,
call check_availability, offer up to 3 times, then collect the customer's name and UAE mobile and call book. After booking, tell them the reference and what the book tool's status says (pending: the spa will confirm on WhatsApp; confirmed: they are booked).
Keep replies under 600 characters, friendly and clear. ${ctx.rules}
${SAFETY}`
}

export type DmResult = {
  reply: string
  bookingRef?: string
  handoff?: string
  flagged?: string
  costUsd: number
}

/**
 * One DM turn: the model may call tools (availability, booking, hand-off, flag) before answering.
 * Writes the inbound and outbound messages to the conversation when `conversationId` is given.
 */
export async function runDmTurn(opts: {
  tenantId: string
  history: { from: 'customer' | 'spa'; text: string }[]
  incoming: string
  conversationId?: string
  source?: 'instagram' | 'whatsapp'
  client?: ModelArkClient
  now?: Date
  /** Also offer the Meta MCP tools allowed for dm_agent (R7). */
  mcp?: boolean
}): Promise<DmResult> {
  const now = opts.now ?? new Date()
  const ctx = await withTenant(opts.tenantId, (tx) => loadSpaContext(tx, opts.tenantId, 'dm_agent'))
  const messages: ChatMessage[] = [
    { role: 'system', content: dmSystemPrompt(ctx, now) },
    ...opts.history.map(
      (h): ChatMessage =>
        h.from === 'customer' ? { role: 'user', content: h.text } : { role: 'assistant', content: h.text },
    ),
    { role: 'user', content: opts.incoming },
  ]
  const result: DmResult = { reply: '', costUsd: 0 }
  const source = opts.source ?? 'instagram'
  const localTools: LocalTool[] = tools.map((def) => ({
    def,
    run: (args) => runTool(opts.tenantId, def.function.name, args, ctx, source, now, result),
  }))
  // R7: Meta MCP tools on the dm_agent allow-list, only when the caller asks for them.
  const sources = opts.mcp ? await metaMcpSources({ tenantId: opts.tenantId, agentKey: 'dm_agent' }) : []
  try {
    const loop = await runToolLoop({
      tenantId: opts.tenantId,
      agentKey: 'dm_agent',
      messages,
      localTools,
      sources,
      temperature: 0.4,
      client: opts.client,
    })
    result.costUsd += loop.costUsd
    result.reply = truncateBytes(loop.content, MAX_DM_BYTES)
  } finally {
    await Promise.all(sources.map((s) => s.close().catch(() => undefined)))
  }
  if (opts.conversationId) {
    await withTenant(opts.tenantId, async (tx) => {
      await tx.insert(conversationMessages).values([
        {
          tenantId: opts.tenantId,
          conversationId: opts.conversationId!,
          direction: 'in',
          sender: 'customer',
          text: opts.incoming,
        },
        ...(result.reply
          ? [
              {
                tenantId: opts.tenantId,
                conversationId: opts.conversationId!,
                direction: 'out' as const,
                sender: 'bot' as const,
                text: result.reply,
              },
            ]
          : []),
      ])
      await tx
        .update(conversations)
        .set({
          lastCustomerMsgAt: now,
          ...(result.handoff ? { mode: 'human' as const } : {}),
          ...(result.flagged ? { flagged: true } : {}),
        })
        .where(eq(conversations.id, opts.conversationId!))
    })
  }
  return result
}

async function runTool(
  tenantId: string,
  name: string,
  args: Record<string, string>,
  ctx: SpaContext,
  source: 'instagram' | 'whatsapp',
  now: Date,
  result: DmResult,
) {
  const branchId = ctx.branch?.id
  try {
    if (name === 'check_availability') {
      if (!branchId) return { error: 'no branch' }
      const date = args.date ?? businessDateOf(now)
      const slots = await withTenant(tenantId, (tx: Tx) =>
        availableSlots(tx, {
          branchId,
          date,
          serviceVariantId: args.variant_id ?? '',
          notBefore: new Date(now.getTime() + 60 * 60_000),
          stepMin: 30,
        }),
      )
      const after = args.after ? Number(args.after.slice(0, 2)) * 60 + Number(args.after.slice(3, 5)) : 0
      const times = slots
        .map((s) => dubaiParts(s.start))
        .filter((p) => p.date !== date || p.minutes >= after)
        .map(
          (p) =>
            `${String(Math.floor(p.minutes / 60)).padStart(2, '0')}:${String(p.minutes % 60).padStart(2, '0')}`,
        )
      return {
        date,
        times: times.slice(0, 8),
        more: Math.max(0, times.length - 8),
        next_day: times.length ? undefined : addDays(date, 1),
      }
    }
    if (name === 'book') {
      if (!branchId) return { error: 'no branch' }
      const [h, m] = (args.time ?? '').split(':').map(Number)
      const start = dubaiInstant(args.date ?? '', (h ?? 0) * 60 + (m ?? 0))
      const booking = await withTenant(tenantId, async (tx: Tx) => {
        const client = await findOrCreateClient(tx, tenantId, {
          name: args.name ?? 'Guest',
          phone: args.phone ?? '',
          source,
        })
        if (client.blocklisted)
          throw new DomainError('We are unable to take this booking online — please call the spa.')
        // Pending for the spa to confirm, unless it auto-confirms returning clients (G21).
        const status = await selfBookingStatus(tx, tenantId, client.id)
        return createBooking(tx, {
          tenantId,
          branchId,
          clientId: client.id,
          source,
          status,
          items: [{ serviceVariantId: args.variant_id ?? '', start }],
        })
      })
      result.bookingRef = booking.refCode
      return {
        ok: true,
        ref: booking.refCode,
        status:
          booking.status === 'confirmed'
            ? 'confirmed — the confirmation follows on WhatsApp'
            : 'pending — the spa will confirm on WhatsApp',
      }
    }
    if (name === 'handoff_to_human') {
      result.handoff = args.reason ?? 'requested'
      return { ok: true }
    }
    if (name === 'flag_conversation') {
      result.flagged = args.reason ?? 'flagged'
      return { ok: true }
    }
    return { error: `unknown tool ${name}` }
  } catch (e) {
    return { error: e instanceof DomainError ? e.message : 'Something went wrong' }
  }
}

export function truncateBytes(text: string, max: number) {
  const enc = new TextEncoder()
  if (enc.encode(text).length <= max) return text
  let out = text
  while (enc.encode(`${out}…`).length > max) out = out.slice(0, -1)
  return `${out}…`
}

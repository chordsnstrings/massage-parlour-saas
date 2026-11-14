'use server'
// Dashboard "Ask AI" (F30, PLAN §17): one question → answer + deep links. Premium `ai` feature, any member with
// dashboard.view; every tool re-checks its own permission and branch scope (packages/ai agents/assistant.ts).
import {
  AiBudgetExceededError,
  AiDisabledError,
  AiNotInPlanError,
  AiPausedError,
  ASSISTANT_LIMITS,
  type AssistantAction,
  type AssistantLink,
  aiConfigured,
  runAssistant,
} from '@spa/ai'
import { platformDb, withTenant } from '@spa/db'
import { liveSale, withinRateLimits } from '@spa/services'
import { z } from 'zod'
import { markBookingAction } from '@/app/dashboard/[tenant]/bookings/actions'
import { rescheduleAction } from '@/app/dashboard/[tenant]/calendar/actions'
import { getI18n } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { guard } from '@/server/access'
import { aiFixturesOn, fixtureClient } from '@/server/ai-fixture'
import { readAssistantAction, signAssistantAction } from '@/server/assistant-token'
import { audit } from '@/server/audit'

export type AskTurn = { role: 'user' | 'assistant'; text: string }
export type AskLink = { kind: 'screen' | 'whatsapp'; href: string; label: string }
/** R46: a prepared change shown as a card with Confirm (the token is signed server-side, see assistant-token.ts). */
export type AskAction = { token: string; kind: AssistantAction['kind']; text: string }
export type AskResult =
  | { ok: true; answer: string; links: AskLink[]; actions: AskAction[]; incomplete: boolean }
  | { ok: false; error: string }

/** Per member: questions per hour and per day (each question is up to maxSteps metered model calls). */
const RATE: [number, number][] = [
  [30, 3600],
  [150, 86_400],
]

const input = z.object({
  question: z.string().trim().min(1).max(ASSISTANT_LIMITS.questionChars),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
    .max(40)
    .default([]),
})

const noon = (date: string) => new Date(`${date}T12:00:00+04:00`)

export async function askAssistantAction(
  slug: string,
  question: string,
  history: AskTurn[],
): Promise<AskResult> {
  const { ctx, error } = await guard(slug, 'dashboard.view', 'ai')
  if (error) return { ok: false, error }
  const { t, fmt, locale } = await getI18n()
  // Members only: a super-admin acting on a spa sees no spa data (PLAN §18), so impersonation can't ask.
  if (!ctx.member) return { ok: false, error: t('errors.forbidden') }
  const parsed = input.safeParse({ question, history })
  if (!parsed.success) return { ok: false, error: t('assistant.errors.question') }
  if (!aiConfigured() && !aiFixturesOn()) return { ok: false, error: t('assistant.errors.off') }
  const subject = `${ctx.tenant.id}:${ctx.user.id}`
  if (!(await withinRateLimits(platformDb(), 'assistant', subject, RATE)))
    return { ok: false, error: t('assistant.errors.rate') }

  const base = appPath(`/${ctx.tenant.slug}`)
  const record = (data: Record<string, unknown>) =>
    audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: 'ai.assistant.asked',
      entity: 'ai_assistant',
      // The question as typed (clipped) and which tools ran — never the answer (it can list clients).
      data: { question: parsed.data.question.slice(0, 200), locale, ...data },
    })

  let res: Awaited<ReturnType<typeof runAssistant>>
  try {
    res = await runAssistant({
      tenantId: ctx.tenant.id,
      scope: { permissions: ctx.permissions, memberId: ctx.member?.id ?? null, role: ctx.member.roleKey },
      question: parsed.data.question,
      history: parsed.data.history,
      locale,
      client: fixtureClient(ctx.tenant.slug),
    })
  } catch (e) {
    const code =
      e instanceof AiBudgetExceededError
        ? 'budget'
        : e instanceof AiPausedError
          ? 'paused'
          : e instanceof AiNotInPlanError
            ? 'plan'
            : e instanceof AiDisabledError
              ? 'disabled'
              : 'busy'
    if (code === 'busy') console.error('ask ai failed', e)
    await record({ outcome: code })
    return { ok: false, error: t(`assistant.errors.${code}`) }
  }
  await record({
    outcome: res.incomplete ? 'incomplete' : 'answered',
    tools: res.calls.map((c) => c.name),
    prepared: res.actions.map((a) => `${a.kind}:${a.ref}`),
    denied: res.denied,
    costUsd: Number(res.costUsd.toFixed(6)),
  })

  const label = (l: AssistantLink) =>
    l.kind === 'whatsapp'
      ? t('assistant.link.whatsapp', { name: l.name })
      : l.screen === 'calendar'
        ? t('assistant.link.calendar', { date: l.date ? fmt.date(noon(l.date)) : '' })
        : l.screen === 'client'
          ? t('assistant.link.client', { name: l.name ?? '' })
          : t(`assistant.link.${l.screen}`)
  const href = (l: AssistantLink) =>
    l.kind === 'whatsapp' ? l.href : `${base}${l.path.startsWith('/?') ? l.path.slice(1) : l.path}`
  const links = res.links
    .filter((l) => (l.kind === 'whatsapp' ? l.href.startsWith('https://wa.me/') : /^\/(?!\/)/.test(l.path)))
    .map((l) => ({ kind: l.kind, href: href(l), label: label(l) }))
  const part = (key: 'client' | 'therapist', name: string | null | undefined) =>
    name ? t(`assistant.action.${key}`, { name }) : ''
  const actions: AskAction[] = res.actions.map((a) => ({
    token: signAssistantAction(ctx.tenant.id, ctx.user.id, a),
    kind: a.kind,
    text:
      a.kind === 'move'
        ? t('assistant.action.move', {
            ref: a.ref,
            service: a.service,
            client: part('client', a.client),
            date: fmt.date(noon(a.date)),
            time: a.time,
            therapist: part('therapist', a.therapist),
          })
        : t('assistant.action.cancel', {
            ref: a.ref,
            service: a.service,
            client: part('client', a.client),
            date: fmt.date(noon(a.date)),
            time: a.time,
            reason: a.reason,
          }),
  }))
  return {
    ok: true,
    answer: res.incomplete ? t('assistant.incomplete') : res.answer,
    links,
    actions,
    incomplete: res.incomplete,
  }
}

/**
 * R46: the person pressed Confirm on a prepared change. The signed token proves it was prepared for this member of
 * this spa in the last 10 minutes; the change itself runs through the normal booking actions (calendar.manage,
 * branch scope, clash checks, audit). Cancelling: owner role only, and never a booking with a payment.
 */
export async function confirmAssistantAction(
  slug: string,
  token: string,
): Promise<{ ok: boolean; text: string }> {
  const { ctx, error } = await guard(slug, 'calendar.manage', 'ai')
  if (error) return { ok: false, text: error }
  const { t } = await getI18n()
  if (!ctx.member) return { ok: false, text: t('errors.forbidden') }
  const a = typeof token === 'string' ? readAssistantAction(token, ctx.tenant.id, ctx.user.id) : null
  if (!a) return { ok: false, text: t('assistant.action.expired') }
  if (a.kind === 'cancel' && ctx.member.roleKey !== 'owner')
    return { ok: false, text: t('assistant.action.ownerOnly') }
  if (a.kind === 'cancel' && (await withTenant(ctx.tenant.id, (tx) => liveSale(tx, a.bookingId))))
    return { ok: false, text: t('bookings.pay.paidAlready') }
  const r =
    a.kind === 'move'
      ? await rescheduleAction(slug, { itemId: a.itemId, date: a.date, time: a.time, staffIds: a.staffIds })
      : await markBookingAction(slug, { bookingId: a.bookingId, mark: 'cancelled', reason: a.reason })
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    action: 'ai.assistant.confirmed',
    entity: 'booking',
    entityId: a.bookingId,
    data: { kind: a.kind, ref: a.ref, ok: Boolean(r?.ok) },
  })
  if (!r?.ok) return { ok: false, text: (r && (t.maybe(r.key, r.params) ?? r.error)) || t('errors.generic') }
  return {
    ok: true,
    text: t(a.kind === 'move' ? 'assistant.action.moved' : 'assistant.action.cancelled', { ref: a.ref }),
  }
}

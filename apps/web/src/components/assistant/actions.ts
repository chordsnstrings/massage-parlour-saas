'use server'
// Dashboard "Ask AI" (F30, PLAN §17): one question → answer + deep links. Premium `ai` feature, any member with
// dashboard.view; every tool re-checks its own permission and branch scope (packages/ai agents/assistant.ts).
import {
  AiBudgetExceededError,
  AiDisabledError,
  AiNotInPlanError,
  AiPausedError,
  ASSISTANT_LIMITS,
  type AssistantLink,
  aiConfigured,
  runAssistant,
} from '@spa/ai'
import { platformDb } from '@spa/db'
import { withinRateLimits } from '@spa/services'
import { z } from 'zod'
import { getI18n } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { guard } from '@/server/access'
import { aiFixturesOn, fixtureClient } from '@/server/ai-fixture'
import { audit } from '@/server/audit'

export type AskTurn = { role: 'user' | 'assistant'; text: string }
export type AskLink = { kind: 'screen' | 'whatsapp'; href: string; label: string }
export type AskResult =
  | { ok: true; answer: string; links: AskLink[]; incomplete: boolean }
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
      scope: { permissions: ctx.permissions, memberId: ctx.member?.id ?? null },
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
  return {
    ok: true,
    answer: res.incomplete ? t('assistant.incomplete') : res.answer,
    links,
    incomplete: res.incomplete,
  }
}

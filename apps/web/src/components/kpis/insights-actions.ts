'use server'
import {
  AiBudgetExceededError,
  AiDisabledError,
  aiConfigured,
  generateInsights,
  latestInsights,
  NotEnoughDataError,
} from '@spa/ai'
import { withTenant } from '@spa/db'
import { revalidatePath } from 'next/cache'
import { type ActionResult, fail, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const COOLDOWN_MS = 10 * 60_000

/** "Refresh" on the dashboard's weekly insights card. */
export async function refreshInsightsAction(
  slug: string,
  _p: ActionResult,
  _fd: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'reports.view')
  if (error) return fail(error)
  if (!aiConfigured()) return fail('AI insights aren’t switched on yet.')
  const last = await withTenant(ctx.tenant.id, (tx) => latestInsights(tx))
  if (last && Date.now() - last.createdAt.getTime() < COOLDOWN_MS)
    return fail('Insights were just refreshed — try again in a few minutes.')
  try {
    const run = await generateInsights({ tenantId: ctx.tenant.id, trigger: 'manual' })
    await audit({
      tenantId: ctx.tenant.id,
      actorUserId: ctx.user.id,
      impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
      action: 'insights.generated',
      entity: 'ai_run',
      entityId: run.id,
    })
  } catch (e) {
    if (e instanceof NotEnoughDataError)
      return fail('Not enough activity in the last two weeks yet — insights start once bookings come in.')
    if (e instanceof AiBudgetExceededError)
      return fail('Your monthly AI budget is used up. Ask your account manager to raise it.')
    if (e instanceof AiDisabledError) return fail('Weekly insights are switched off by the platform.')
    console.error('insights refresh failed', e)
    return fail('The AI service is busy — please try again in a moment.')
  }
  revalidatePath(`/dashboard/${slug}`)
  return ok('Insights updated')
}

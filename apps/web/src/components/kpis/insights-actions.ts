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
  if (!aiConfigured()) return fail('overview.insights.errors.off')
  const last = await withTenant(ctx.tenant.id, (tx) => latestInsights(tx))
  if (last && Date.now() - last.createdAt.getTime() < COOLDOWN_MS)
    return fail('overview.insights.errors.cooldown')
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
      return fail('overview.insights.errors.notEnoughData')
    if (e instanceof AiBudgetExceededError)
      return fail('overview.insights.errors.budget')
    if (e instanceof AiDisabledError) return fail('overview.insights.errors.disabled')
    console.error('insights refresh failed', e)
    return fail('overview.insights.errors.busy')
  }
  revalidatePath(`/dashboard/${slug}`)
  return ok('overview.insights.updated')
}

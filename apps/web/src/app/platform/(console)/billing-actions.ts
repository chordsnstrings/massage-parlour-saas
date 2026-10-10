'use server'
// F22 automatic billing transitions (console): rules, per-spa pause (flag override) and "Check now". Audited.
import { BILLING_RULE_LIMITS } from '@spa/core'
import { platformDb } from '@spa/db'
import {
  applyBillingTransition,
  billingRules,
  billingTransitionEffects,
  flagOn,
  saveBillingRules,
  setFlagOverride,
} from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, formObject, fromZod, ok } from '@/lib/action'
import { todayDubai } from '@/lib/utils'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'

const days = (l: { min: number; max: number }) =>
  z.coerce
    .number({ error: 'Enter a number of days' })
    .int()
    .min(l.min, `At least ${l.min}`)
    .max(l.max, `At most ${l.max}`)

export async function saveBillingRulesAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = z
    .object({
      overdueAfterDays: days(BILLING_RULE_LIMITS.overdueAfterDays),
      graceDays: days(BILLING_RULE_LIMITS.graceDays),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const change = await saveBillingRules(platformDb(), parsed.data, user.id)
  await audit({ actorUserId: user.id, action: 'platform.billing.rules', data: change })
  revalidatePath('/platform/settings')
  return ok('Billing rules saved')
}

/** Pause / resume the automatic transitions for one spa (= `billing.autoTransitions` override off / cleared). */
export async function setBillingPauseAction(
  tenantId: string,
  pause: boolean,
  _p: ActionResult,
): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const db = platformDb()
  const change = await setFlagOverride(db, {
    key: 'billing.autoTransitions',
    tenantId,
    // Resuming clears the override, so the spa follows the global default again.
    enabled: pause ? false : null,
    userId: user.id,
  })
  await audit({
    tenantId,
    actorUserId: user.id,
    action: pause ? 'platform.billing.paused' : 'platform.billing.resumed',
    entity: 'feature_flag',
    entityId: 'billing.autoTransitions',
    data: { ...change, effective: await flagOn(db, 'billing.autoTransitions', tenantId) },
  })
  revalidatePath(`/platform/tenants/${tenantId}`)
  return ok(pause ? 'Automatic billing transitions paused for this spa' : 'Automatic transitions resumed')
}

/** Applies today's rules to this spa now (what the 09:05 job does), e.g. after voiding or re-dating invoices. */
export async function checkBillingNowAction(tenantId: string, _p: ActionResult): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const db = platformDb()
  const [rules, auto] = await Promise.all([billingRules(db), flagOn(db, 'billing.autoTransitions', tenantId)])
  const t = await db.transaction((tx) =>
    applyBillingTransition(tx, tenantId, todayDubai(), { rules, paused: !auto }),
  )
  if (t) await billingTransitionEffects(db, t, { actorUserId: user.id })
  revalidatePath(`/platform/tenants/${tenantId}`)
  revalidatePath('/platform/tenants')
  if (!t) return ok('No change')
  return ok(`Billing stage: ${t.from.stage ?? 'none'} → ${t.to.stage ?? 'none'}`)
}

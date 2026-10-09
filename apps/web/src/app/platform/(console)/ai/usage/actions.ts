'use server'
import { platformDb, platformSettings, tenants } from '@spa/db'
import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'

// G18: monthly AI budget + kill switches. Super-admin only; every change is audited.

const refresh = (tenantId?: string) => {
  revalidatePath('/platform/ai/usage')
  if (tenantId) revalidatePath(`/platform/ai/usage/${tenantId}`)
  revalidatePath('/platform/performance')
}

const budgetSchema = z.object({
  budget: z.coerce
    .number({ error: 'Enter an amount' })
    .min(0, 'Must be 0 or more')
    .max(10_000, 'At most USD 10,000')
    .transform((n) => n.toFixed(2)),
})

export async function setAiBudgetAction(
  tenantId: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = budgetSchema.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const db = platformDb()
  const [before] = await db
    .select({ budget: tenants.aiBudgetUsd, name: tenants.name })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
  if (!before) return fail('Spa not found')
  await db.update(tenants).set({ aiBudgetUsd: parsed.data.budget }).where(eq(tenants.id, tenantId))
  await audit({
    tenantId,
    actorUserId: user.id,
    action: 'platform.ai.budget_updated',
    data: { from: Number(before.budget), to: Number(parsed.data.budget) },
  })
  refresh(tenantId)
  return ok(`${before.name}: AI budget USD ${parsed.data.budget} / month`)
}

export async function setTenantAiEnabledAction(
  tenantId: string,
  enabled: boolean,
  _p: ActionResult,
): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const [row] = await platformDb()
    .update(tenants)
    .set({ aiEnabled: enabled })
    .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
    .returning({ name: tenants.name })
  if (!row) return fail('Spa not found')
  await audit({
    tenantId,
    actorUserId: user.id,
    action: enabled ? 'platform.ai.tenant_enabled' : 'platform.ai.tenant_disabled',
  })
  refresh(tenantId)
  return ok(enabled ? `AI on for ${row.name}` : `AI off for ${row.name}`)
}

export async function setGlobalAiEnabledAction(enabled: boolean, _p: ActionResult): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  await platformDb()
    .insert(platformSettings)
    .values({ id: 1, aiEnabled: enabled, updatedBy: user.id })
    .onConflictDoUpdate({ target: platformSettings.id, set: { aiEnabled: enabled, updatedBy: user.id } })
  await audit({ actorUserId: user.id, action: enabled ? 'platform.ai.enabled' : 'platform.ai.disabled' })
  refresh()
  return ok(enabled ? 'AI is on for every spa' : 'AI is off for every spa')
}

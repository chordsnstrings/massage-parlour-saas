'use server'
// F20 feature flags (console). Super-admin only; every change audited (from → to).
import { platformDb } from '@spa/db'
import { DomainError, deleteFlag, saveFlag, setFlagOverride } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'

const PAGE = '/platform/flags'
const key = z.string().trim().min(2).max(80)

const domainFail = (e: unknown) => {
  if (e instanceof DomainError) return fail(e.message)
  throw e
}

export async function saveFlagAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = z
    .object({
      key,
      description: z
        .string()
        .trim()
        .max(300)
        .optional()
        .transform((v) => v || null),
      defaultOn: z.preprocess((v) => v === 'on' || v === 'true', z.boolean()),
    })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  try {
    const { before, after } = await saveFlag(platformDb(), { ...parsed.data, userId: user.id })
    await audit({
      actorUserId: user.id,
      action: before ? 'platform.flag.updated' : 'platform.flag.created',
      entity: 'feature_flag',
      entityId: after.key,
      data: { key: after.key, from: before?.defaultOn ?? null, to: after.defaultOn },
    })
  } catch (e) {
    return domainFail(e)
  }
  revalidatePath(PAGE)
  return ok('Flag saved')
}

export async function deleteFlagAction(flagKey: string, _p: ActionResult): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  try {
    const row = await deleteFlag(platformDb(), flagKey)
    await audit({
      actorUserId: user.id,
      action: 'platform.flag.deleted',
      entity: 'feature_flag',
      entityId: row.key,
      data: { key: row.key, defaultOn: row.defaultOn },
    })
  } catch (e) {
    return domainFail(e)
  }
  revalidatePath(PAGE)
  return ok('Flag deleted')
}

/** One spa's override: on / off / default (= clear the override). */
export async function setFlagOverrideAction(
  flagKey: string,
  _p: ActionResult,
  fd: FormData,
): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = z
    .object({ tenantId: z.uuid('Pick a spa'), value: z.enum(['on', 'off', 'default']) })
    .safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const { tenantId, value } = parsed.data
  try {
    const change = await setFlagOverride(platformDb(), {
      key: flagKey,
      tenantId,
      enabled: value === 'default' ? null : value === 'on',
      userId: user.id,
    })
    await audit({
      tenantId,
      actorUserId: user.id,
      action: 'platform.flag.override',
      entity: 'feature_flag',
      entityId: flagKey,
      data: { key: flagKey, ...change },
    })
  } catch (e) {
    return domainFail(e)
  }
  revalidatePath(PAGE)
  revalidatePath(`/platform/tenants/${tenantId}`)
  return ok(value === 'default' ? 'Override removed' : 'Override saved')
}

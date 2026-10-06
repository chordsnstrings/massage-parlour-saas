'use server'
import { branches, withTenant } from '@spa/db'
import { eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, fromZod, ok } from '@/lib/action'
import { guard } from '@/server/access'
import { audit } from '@/server/audit'

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Use HH:MM')
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

const interval = z
  .object({ open: time, close: time })
  .refine((i) => i.open !== i.close && i.open !== '24:00', {
    message: 'Opening and closing times are the same',
  })

const hoursSchema = z
  .object(
    Object.fromEntries(WEEKDAYS.map((d) => [d, z.array(interval).max(4)])) as Record<
      (typeof WEEKDAYS)[number],
      z.ZodArray<typeof interval>
    >,
  )
  .superRefine((hours, zctx) => {
    // Intervals of one day must not overlap (a close before open runs past midnight).
    for (const d of WEEKDAYS) {
      const spans = hours[d]
        .map((i) => {
          const o = toMin(i.open)
          const c = toMin(i.close)
          return [o, c <= o ? c + 1440 : c] as const
        })
        .sort((a, b) => a[0] - b[0])
      for (let i = 1; i < spans.length; i++)
        if (spans[i]![0] < spans[i - 1]![1])
          zctx.addIssue({ code: 'custom', path: [d], message: 'Times overlap' })
    }
  })

export async function saveHoursAction(
  slug: string,
  branchId: string,
  _prev: ActionResult,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, error } = await guard(slug, 'settings.manage')
  if (error) return fail(error)
  if (!z.string().uuid().safeParse(branchId).success) return fail('Branch not found.')
  let raw: unknown
  try {
    raw = JSON.parse(String(formData.get('hours') ?? '{}'))
  } catch {
    return fail('Could not read the opening hours.')
  }
  const parsed = hoursSchema.safeParse(raw)
  if (!parsed.success) return fromZod(parsed.error)
  const [row] = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .update(branches)
      .set({ openingHours: parsed.data })
      .where(eq(branches.id, branchId))
      .returning({ id: branches.id }),
  )
  if (!row) return fail('Branch not found.')
  await audit({
    tenantId: ctx.tenant.id,
    actorUserId: ctx.user.id,
    impersonatorUserId: ctx.impersonating ? ctx.user.id : undefined,
    action: 'branch.hours_updated',
    entity: 'branch',
    entityId: branchId,
    data: parsed.data,
  })
  revalidatePath(`/dashboard/${slug}/settings/hours`)
  return ok('Opening hours saved')
}

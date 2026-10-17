'use server'
// F20 announcements to spas (console). Super-admin only; audited. Shown in the spa dashboard only (no email/SMS).
import { ANNOUNCEMENT_AUDIENCES, ANNOUNCEMENT_SEVERITIES, PLAN_CODES } from '@spa/core'
import { platformDb } from '@spa/db'
import { DomainError, deleteAnnouncement, endAnnouncement, saveAnnouncement } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'

const PAGE = '/platform/announcements'
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || null)
const list = <T extends z.ZodType>(item: T) =>
  z.preprocess((v) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v]), z.array(item))
/** `<input type="datetime-local">` in Dubai time (UTC+4, no DST) → instant. */
const dubaiLocal = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, 'Pick a date and time')
  .transform((v) => new Date(`${v}:00+04:00`))

const schema = z.object({
  id: z
    .uuid()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  titleEn: z.string().trim().min(2, 'Enter a title').max(120),
  titleTh: optText(120),
  bodyEn: z.string().trim().min(2, 'Enter the message').max(1000),
  bodyTh: optText(1000),
  severity: z.enum(ANNOUNCEMENT_SEVERITIES),
  audience: z.enum(ANNOUNCEMENT_AUDIENCES),
  planCodes: list(z.enum(Object.values(PLAN_CODES) as [string, ...string[]])),
  tenantIds: list(z.uuid()),
  startsAt: dubaiLocal,
  endsAt: z
    .union([z.literal('').transform(() => null), dubaiLocal])
    .optional()
    .transform((v) => v ?? null),
})

const domainFail = (e: unknown) => {
  if (e instanceof DomainError) return fail(e.message)
  throw e
}

export async function saveAnnouncementAction(_p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  const parsed = schema.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const { id, ...input } = parsed.data
  try {
    const row = await saveAnnouncement(platformDb(), id ?? null, input, user.id)
    await audit({
      actorUserId: user.id,
      action: id ? 'platform.announcement.updated' : 'platform.announcement.created',
      entity: 'announcement',
      entityId: row.id,
      data: {
        title: row.titleEn,
        severity: row.severity,
        audience: row.audience,
        planCodes: row.planCodes,
        spas: row.tenantIds.length,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
      },
    })
  } catch (e) {
    return domainFail(e)
  }
  revalidatePath(PAGE)
  return ok(id ? 'Announcement saved' : 'Announcement published')
}

export async function endAnnouncementAction(id: string, _p: ActionResult): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  try {
    const row = await endAnnouncement(platformDb(), id)
    await audit({
      actorUserId: user.id,
      action: 'platform.announcement.ended',
      entity: 'announcement',
      entityId: row.id,
      data: { title: row.titleEn },
    })
  } catch (e) {
    return domainFail(e)
  }
  revalidatePath(PAGE)
  return ok('Announcement ended')
}

export async function deleteAnnouncementAction(id: string, _p: ActionResult): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  try {
    const row = await deleteAnnouncement(platformDb(), id)
    await audit({
      actorUserId: user.id,
      action: 'platform.announcement.deleted',
      entity: 'announcement',
      entityId: row.id,
      data: { title: row.titleEn },
    })
  } catch (e) {
    return domainFail(e)
  }
  revalidatePath(PAGE)
  return ok('Announcement deleted')
}

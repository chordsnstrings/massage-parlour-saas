'use server'
// Console: status + internal note on a contact enquiry (PLAN §18.4). Super-admin only — re-checked here, not just
// in the page; every change is audited.
import { platformDb } from '@spa/db'
import { ENQUIRY_STATUSES, updateEnquiry } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { requirePlatformAdmin } from '@/server/access'
import { audit } from '@/server/audit'
import { ENQUIRY_STATUS } from './status'

const schema = z.object({
  status: z.enum(ENQUIRY_STATUSES, 'Choose a status'),
  note: z.string().trim().max(2000, 'Keep the note under 2000 characters').optional(),
})

export async function updateEnquiryAction(id: string, _p: ActionResult, fd: FormData): Promise<ActionResult> {
  const { user } = await requirePlatformAdmin()
  if (!z.uuid().safeParse(id).success) return fail('Enquiry not found')
  const parsed = schema.safeParse(formObject(fd))
  if (!parsed.success) return fromZod(parsed.error)
  const res = await updateEnquiry(platformDb(), {
    id,
    status: parsed.data.status,
    note: parsed.data.note ?? null,
    actorId: user.id,
  })
  if (!res) return fail('Enquiry not found')
  if (!res.changed.length) return ok('No changes')
  await audit({
    actorUserId: user.id,
    action: 'platform.enquiry.updated',
    entity: 'contact_enquiry',
    entityId: id,
    data: {
      changed: res.changed,
      status: { from: res.before.status, to: res.after.status },
      ...(res.changed.includes('note') ? { note: res.after.adminNote } : {}),
    },
  })
  // The whole console: list, detail and the nav badge (layout).
  revalidatePath('/platform', 'layout')
  return ok(
    res.changed.includes('status')
      ? `Marked ${ENQUIRY_STATUS[res.after.status].label.toLowerCase()}`
      : 'Note saved',
  )
}

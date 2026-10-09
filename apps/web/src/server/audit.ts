import { auditLog, platformDb } from '@spa/db'
import { headers } from 'next/headers'

export async function audit(entry: {
  tenantId?: string | null
  actorUserId?: string
  impersonatorUserId?: string
  action: string
  entity?: string
  entityId?: string
  data?: unknown
  /** Overrides the request IP; `null` stores none (public, unauthenticated events such as a contact enquiry). */
  ip?: string | null
}) {
  const h = await headers()
  const ip =
    entry.ip !== undefined
      ? entry.ip
      : (h.get('cf-connecting-ip') ?? h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null)
  await platformDb()
    .insert(auditLog)
    .values({ ...entry, data: entry.data ?? null, ip })
}

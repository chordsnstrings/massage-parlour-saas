// Announcements to spas (F20, PLAN §17): written in the super-admin console, shown as a dismissible banner in the
// spa dashboard (never email/SMS). `announcements` is platform data (read on the platform role);
// `announcement_dismissals` is a tenant table, written through the caller's `withTenant` transaction.
import type { AnnouncementAudience, AnnouncementSeverity } from '@spa/core'
import { announcementDismissals, announcements, type DbOrTx, type Tx } from '@spa/db'
import { and, desc, eq, sql } from 'drizzle-orm'
import { DomainError } from './errors'

export type AnnouncementRow = typeof announcements.$inferSelect

export type AnnouncementInput = {
  titleEn: string
  titleTh: string | null
  bodyEn: string
  bodyTh: string | null
  severity: AnnouncementSeverity
  audience: AnnouncementAudience
  planCodes: string[]
  tenantIds: string[]
  startsAt: Date
  endsAt: Date | null
}

function check(a: AnnouncementInput) {
  if (a.endsAt && a.endsAt <= a.startsAt) throw new DomainError('The end must be after the start')
  if (a.audience === 'plan' && a.planCodes.length === 0) throw new DomainError('Pick at least one plan')
  if (a.audience === 'tenants' && a.tenantIds.length === 0) throw new DomainError('Pick at least one spa')
}

/** Creates (id null) or updates an announcement; the audience lists not used by `audience` are cleared. */
export async function saveAnnouncement(db: DbOrTx, id: string | null, a: AnnouncementInput, userId: string) {
  check(a)
  const values = {
    ...a,
    planCodes: a.audience === 'plan' ? a.planCodes : [],
    tenantIds: a.audience === 'tenants' ? a.tenantIds : [],
  }
  if (!id) {
    const [row] = await db
      .insert(announcements)
      .values({ ...values, createdBy: userId })
      .returning()
    return row!
  }
  const [row] = await db.update(announcements).set(values).where(eq(announcements.id, id)).returning()
  if (!row) throw new DomainError('Announcement not found', 'not_found')
  return row
}

/** Ends an announcement now (kept for the record; dismissals stay). */
export async function endAnnouncement(db: DbOrTx, id: string, now = new Date()) {
  const [row] = await db
    .update(announcements)
    .set({ endsAt: now })
    .where(eq(announcements.id, id))
    .returning()
  if (!row) throw new DomainError('Announcement not found', 'not_found')
  return row
}

export async function deleteAnnouncement(db: DbOrTx, id: string) {
  const [row] = await db.delete(announcements).where(eq(announcements.id, id)).returning()
  if (!row) throw new DomainError('Announcement not found', 'not_found')
  return row
}

/** Console list, newest first, with how many members dismissed each. */
export function listAnnouncements(db: DbOrTx) {
  return db
    .select({
      a: announcements,
      dismissed: sql<number>`(select count(*)::int from ${announcementDismissals}
        where ${announcementDismissals.announcementId} = ${announcements.id})`,
    })
    .from(announcements)
    .orderBy(desc(announcements.startsAt), desc(announcements.createdAt))
}

const SEVERITY_ORDER = sql`case ${announcements.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`

/**
 * Live announcements for one member of one spa (platform role): inside the time window, addressed to the spa
 * (everyone, its plan code, or the spa itself) and not dismissed by this member here. Most severe first, max `limit`.
 */
export function activeAnnouncements(
  db: DbOrTx,
  v: { tenantId: string; userId: string; planCode: string | null; now?: Date; limit?: number },
) {
  const now = v.now ?? new Date()
  return db
    .select()
    .from(announcements)
    .where(
      and(
        sql`${announcements.startsAt} <= ${now} and (${announcements.endsAt} is null or ${announcements.endsAt} > ${now})`,
        sql`(${announcements.audience} = 'all'
          or (${announcements.audience} = 'tenants' and ${v.tenantId}::uuid = any(${announcements.tenantIds}))
          or (${announcements.audience} = 'plan' and ${v.planCode ?? ''} = any(${announcements.planCodes})))`,
        sql`not exists (select 1 from ${announcementDismissals}
          where ${announcementDismissals.announcementId} = ${announcements.id}
            and ${announcementDismissals.tenantId} = ${v.tenantId}
            and ${announcementDismissals.userId} = ${v.userId})`,
      ),
    )
    .orderBy(SEVERITY_ORDER, desc(announcements.startsAt))
    .limit(v.limit ?? 3)
}

/** Records that this member dismissed the announcement in this spa (idempotent). Tenant transaction. */
export async function dismissAnnouncement(
  tx: Tx,
  d: { tenantId: string; userId: string; announcementId: string },
) {
  await tx
    .insert(announcementDismissals)
    .values({ announcementId: d.announcementId, tenantId: d.tenantId, userId: d.userId })
    .onConflictDoNothing()
}

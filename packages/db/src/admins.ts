import { and, eq, inArray } from 'drizzle-orm'
import type { DbOrTx } from './client'
import { platformAdmins, user } from './schema'

/** Lower-cased PLATFORM_ADMIN_EMAILS (comma separated). */
export const listedAdminEmails = (raw = process.env.PLATFORM_ADMIN_EMAILS ?? '') =>
  raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

/**
 * G2: users whose email is in `emails` become super-admins only once that email is verified (verification link, or
 * a Google sign-in). Never removes anyone: existing super-admins stay. Returns how many rows were added.
 */
export async function grantListedPlatformAdmins(db: DbOrTx, emails: string[], onlyUserId?: string) {
  const list = emails.map((e) => e.trim().toLowerCase()).filter(Boolean)
  if (!list.length) return 0
  const rows = await db
    .select({ id: user.id })
    .from(user)
    .where(
      and(
        inArray(user.email, list),
        eq(user.emailVerified, true),
        onlyUserId ? eq(user.id, onlyUserId) : undefined,
      ),
    )
  if (!rows.length) return 0
  const added = await db
    .insert(platformAdmins)
    .values(rows.map((r) => ({ userId: r.id })))
    .onConflictDoNothing()
    .returning({ id: platformAdmins.userId })
  return added.length
}

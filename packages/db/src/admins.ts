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

/**
 * SITE_AI_EDITOR_EMAILS (comma separated, lower-cased): the only accounts that may edit spa sites with prompts —
 * the Studio "Ask AI" panel and the Claude MCP connector (/api/mcp). Empty = nobody. Never hard-coded.
 */
export const siteAiEditorEmails = (raw = process.env.SITE_AI_EDITOR_EMAILS ?? '') => listedAdminEmails(raw)

export type SiteAiEditorStatus = 'ok' | 'not_listed' | 'not_admin' | 'needs2fa'

/**
 * Read fresh on every use (no cache) so removing an email, the super-admin row or 2FA cuts access at once:
 * allowed only for a listed, VERIFIED email that is also a super-admin with TOTP 2FA on (isPlatformAdmin).
 */
export async function siteAiEditorStatus(
  db: DbOrTx,
  userId: string,
  emails: string[] = siteAiEditorEmails(),
): Promise<SiteAiEditorStatus> {
  const [row] = await db
    .select({
      email: user.email,
      verified: user.emailVerified,
      twoFactor: user.twoFactorEnabled,
      admin: platformAdmins.userId,
    })
    .from(user)
    .leftJoin(platformAdmins, eq(platformAdmins.userId, user.id))
    .where(eq(user.id, userId))
  if (!row?.verified || !emails.includes(row.email.toLowerCase())) return 'not_listed'
  if (!row.admin) return 'not_admin'
  return row.twoFactor ? 'ok' : 'needs2fa'
}

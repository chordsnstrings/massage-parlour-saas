// Super-admin bootstrap (owner, 2026-10-09; PLAN §18.3): PLATFORM_ADMIN_EMAILS addresses create their login on the
// admin host's join page (no spa, no application) and become super-admins once the email is verified — by the emailed
// link, or by an existing super-admin with 2FA in the console ("Super-admins" card) when no email is delivered yet.
// Platform role only (`platformDb()`); the web layer re-checks requirePlatformAdmin and audits.
import {
  type Db,
  grantListedPlatformAdmins,
  isListedAdminEmail,
  listedAdminEmails,
  platformAdmins,
  user,
} from '@spa/db'
import { asc, eq, inArray } from 'drizzle-orm'
import { DomainError } from './errors'

/** Join page gate: only a PLATFORM_ADMIN_EMAILS address may create a super-admin login (neutral refusal otherwise). */
export function assertAdminJoinAllowed(email: string, listed = listedAdminEmails()) {
  if (!isListedAdminEmail(email, listed))
    throw new DomainError('This email address cannot create a super-admin account.')
}

export type SuperAdminRow = {
  userId: string
  email: string
  name: string
  verified: boolean
  twoFactor: boolean
  /** Still in PLATFORM_ADMIN_EMAILS (super-admins added otherwise, or later removed from the list, stay). */
  listed: boolean
}

export type ListedAdminRow = {
  email: string
  /** null = no login with this email yet (it joins on the admin host). */
  userId: string | null
  name: string | null
  verified: boolean
  /** Login closed (rejected applicant): can't be confirmed. */
  disabled: boolean
}

/** The console card: current super-admins, and listed emails that are not super-admins yet (with or without a login). */
export async function superAdminRoster(db: Db, listed = listedAdminEmails()) {
  const admins: SuperAdminRow[] = (
    await db
      .select({
        userId: user.id,
        email: user.email,
        name: user.name,
        verified: user.emailVerified,
        twoFactor: user.twoFactorEnabled,
      })
      .from(platformAdmins)
      .innerJoin(user, eq(user.id, platformAdmins.userId))
      .orderBy(asc(user.email))
  ).map((r) => ({ ...r, twoFactor: Boolean(r.twoFactor), listed: isListedAdminEmail(r.email, listed) }))
  const adminEmails = new Set(admins.map((a) => a.email.toLowerCase()))
  const logins = listed.length
    ? await db
        .select({
          userId: user.id,
          email: user.email,
          name: user.name,
          verified: user.emailVerified,
          disabledAt: user.disabledAt,
        })
        .from(user)
        .where(inArray(user.email, listed))
    : []
  const pending: ListedAdminRow[] = listed
    .filter((email) => !adminEmails.has(email))
    .map((email) => {
      const login = logins.find((l) => l.email.toLowerCase() === email)
      return login
        ? {
            email,
            userId: login.userId,
            name: login.name,
            verified: login.verified,
            disabled: Boolean(login.disabledAt),
          }
        : { email, userId: null, name: null, verified: false, disabled: false }
    })
  return { admins, pending }
}

/**
 * "Mark email verified" (console): an existing super-admin WITH 2FA vouches for a registered login whose email is in
 * PLATFORM_ADMIN_EMAILS — the email is marked verified and the login promoted at once (it still enrols 2FA before the
 * console opens). Refused for any other login, a disabled one, or an actor without super-admin + 2FA. One transaction.
 */
export async function markListedAdminVerified(
  db: Db,
  input: { actorUserId: string; userId: string },
  listed = listedAdminEmails(),
) {
  if (input.actorUserId === input.userId) throw new DomainError('You are already a super-admin.')
  return db.transaction(async (tx) => {
    const [actor] = await tx
      .select({ twoFactor: user.twoFactorEnabled })
      .from(platformAdmins)
      .innerJoin(user, eq(user.id, platformAdmins.userId))
      .where(eq(platformAdmins.userId, input.actorUserId))
    if (!actor?.twoFactor)
      throw new DomainError('Only a super-admin with two-step verification can confirm super-admins.')
    const [target] = await tx
      .select({ id: user.id, email: user.email, verified: user.emailVerified, disabledAt: user.disabledAt })
      .from(user)
      .where(eq(user.id, input.userId))
    if (!target || target.disabledAt || !isListedAdminEmail(target.email, listed))
      throw new DomainError('Only a login whose email is in PLATFORM_ADMIN_EMAILS can be confirmed here.')
    if (!target.verified)
      await tx.update(user).set({ emailVerified: true, updatedAt: new Date() }).where(eq(user.id, target.id))
    const promoted = (await grantListedPlatformAdmins(tx, listed, target.id)) > 0
    return { email: target.email, markedVerified: !target.verified, promoted }
  })
}

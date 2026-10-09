// Spa applications (PLAN §18.3): who may open what before approval, slug availability and the emails around it.
import { EMIRATE_NAMES, isEmirate, sendStaffEmail } from '@spa/core'
import {
  listedAdminEmails,
  members,
  platformAdmins,
  platformDb,
  type spaApplications,
  tenants,
} from '@spa/db'
import { latestApplication, slugStatus } from '@spa/services'
import { and, eq, isNull } from 'drizzle-orm'
import { cache } from 'react'
import { registerEmailSettings } from './email-settings'
import { canonicalUrls } from './origin'

type Application = typeof spaApplications.$inferSelect

/** A web address is free when no spa uses it and no pending application holds it. */
export const isSlugAvailable = async (slug: string) => (await slugStatus(platformDb(), slug)) === 'free'

/**
 * What a signed-in login is: member of a (live) spa, super-admin row, latest application. `locked` = applied, not
 * approved yet, nothing else to open → the waiting page is all it sees (no 2FA needed for it).
 */
export const applicantState = cache(async (userId: string) => {
  const db = platformDb()
  const [member] = await db
    .select({ id: members.id })
    .from(members)
    .innerJoin(tenants, eq(tenants.id, members.tenantId))
    .where(and(eq(members.userId, userId), eq(members.status, 'active'), isNull(tenants.deletedAt)))
    .limit(1)
  const [admin] = await db
    .select({ id: platformAdmins.userId })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
  const application = await latestApplication(db, userId)
  const hasSpa = Boolean(member)
  const isAdmin = Boolean(admin)
  return {
    hasSpa,
    isAdmin,
    application,
    locked: !hasSpa && !isAdmin && application?.status === 'pending',
  }
})

export const emirateName = (key: string) => (isEmirate(key) ? EMIRATE_NAMES[key] : key)

/** Email never blocks the flow (G2/G9: sendStaffEmail throws in production without a Resend key). */
async function send(to: string, subject: string, text: string) {
  try {
    registerEmailSettings()
    await sendStaffEmail({ to, subject, text })
  } catch (error) {
    console.error('[applications] email failed', { to, subject, error: String(error) })
  }
}

/** New application → every PLATFORM_ADMIN_EMAILS address (console link on the canonical domain). */
export async function emailNewApplication(app: Application) {
  const link = canonicalUrls().admin(`/applications/${app.id}`)
  const text = [
    `New spa application: ${app.spaName} (${app.slug})`,
    '',
    `Applicant: ${app.applicantName} <${app.email}>, ${app.phone}`,
    `Address: ${app.streetAddress}, ${emirateName(app.emirate)}`,
    `Preferred start: ${app.preferredStart}`,
    app.notes ? `Notes: ${app.notes}` : null,
    '',
    `Review it in the console: ${link}`,
  ]
    .filter((l) => l !== null)
    .join('\n')
  await Promise.all(listedAdminEmails().map((to) => send(to, `New spa application: ${app.spaName}`, text)))
}

export async function emailApplicationAccepted(app: Application) {
  const link = canonicalUrls().app('/login')
  await send(
    app.email,
    `${app.spaName} is approved on spamanagement.co`,
    `Hi ${app.applicantName},\n\nGood news: your application for ${app.spaName} was approved.\n\nSign in to your dashboard here: ${link}\nOn your first visit you'll set up two-step verification (an authenticator app) to protect your spa.\n\nWelcome aboard!`,
  )
}

export async function emailApplicationRejected(app: Application) {
  const reason = app.shareReason && app.rejectionReason ? `\n\nReason: ${app.rejectionReason}` : ''
  await send(
    app.email,
    `Your spamanagement.co application for ${app.spaName}`,
    `Hi ${app.applicantName},\n\nThank you for applying. We're sorry, but we could not approve your application for ${app.spaName}, so the account you created has been closed.${reason}\n\nIf you have questions, just reply to this email.`,
  )
}

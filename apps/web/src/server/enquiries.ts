// Contact enquiries (PLAN §18.4): the sender's IP hash and the owner's notification email.
import { createHmac } from 'node:crypto'
import { sendStaffEmail } from '@spa/core'
import { listedAdminEmails } from '@spa/db'
import type { ContactEnquiry } from '@spa/services'
import { registerEmailSettings } from './email-settings'
import { canonicalUrls } from './origin'

/** Keyed hash of the IP (BETTER_AUTH_SECRET): repeat senders can be matched without storing the address. */
export const hashIp = (ip: string) =>
  createHmac('sha256', process.env.BETTER_AUTH_SECRET ?? 'spa-enquiry')
    .update(ip)
    .digest('hex')
    .slice(0, 32)

/**
 * New enquiry → every PLATFORM_ADMIN_EMAILS address, reply-to = the sender (answer straight from the inbox).
 * Never throws: a failed email must not fail the submission (G2/G9: sendStaffEmail throws without a Resend key).
 */
export async function emailNewEnquiry(e: ContactEnquiry) {
  const subject = `New enquiry: ${e.spaName} (${e.name})`
  const text = [
    `New contact enquiry from ${e.name}, ${e.spaName}`,
    '',
    `Email: ${e.email}`,
    `Phone: ${e.phone}`,
    '',
    e.message,
    '',
    `Reply to this email to answer ${e.name}, or open it in the console: ${canonicalUrls().admin(`/enquiries/${e.id}`)}`,
  ].join('\n')
  try {
    registerEmailSettings()
  } catch (error) {
    console.error('[enquiries] email settings unavailable', String(error))
  }
  await Promise.all(
    listedAdminEmails().map(async (to) => {
      try {
        await sendStaffEmail({ to, subject, text, replyTo: e.email })
      } catch (error) {
        console.error('[enquiries] email failed', { to, enquiry: e.id, error: String(error) })
      }
    }),
  )
}

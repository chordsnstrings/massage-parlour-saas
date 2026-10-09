'use server'
// Marketing Contact form (PLAN §18.4). Public: honeypot → zod (server-side, never trust the client) → per-IP limit
// (5/hour, 20/day) → stored as a `new` enquiry → super-admins emailed after the reply (never fails the submission).
import { PLATFORM_CONTACT_EMAIL } from '@spa/core'
import { platformDb } from '@spa/db'
import { ENQUIRY_LIMITS, enquirySchema, submitEnquiry } from '@spa/services'
import { headers } from 'next/headers'
import { after } from 'next/server'
import { ENQUIRY_HONEYPOT } from '@/components/marketing/enquiry-fields'
import { companyContact } from '@/components/marketing/plans'
import { type ActionResult, fail, formObject, fromZod, ok } from '@/lib/action'
import { audit } from '@/server/audit'
import { emailNewEnquiry, hashIp } from '@/server/enquiries'
import { clientIp, withinIpLimit } from '@/server/rate-limit'

const SENT = 'Thanks — we’ll reply within one working day.'

export async function sendEnquiryAction(_prev: ActionResult, fd: FormData): Promise<ActionResult> {
  const form = formObject(fd)
  // Bots fill the hidden field: same answer as a real success, nothing stored, counted or sent.
  const trap = form[ENQUIRY_HONEYPOT]
  if (typeof trap === 'string' ? trap.trim() : trap?.length) return ok(SENT)
  const parsed = enquirySchema.safeParse(form)
  if (!parsed.success) return fromZod(parsed.error)
  if (!(await withinIpLimit('enquiry', ENQUIRY_LIMITS))) {
    const email = (await companyContact())?.email || PLATFORM_CONTACT_EMAIL
    return fail(`Too many messages from your network. Please email us at ${email} instead.`)
  }
  const h = await headers()
  const enquiry = await submitEnquiry(platformDb(), parsed.data, {
    ipHash: hashIp(await clientIp()),
    userAgent: h.get('user-agent'),
  })
  await audit({
    action: 'platform.enquiry.received',
    entity: 'contact_enquiry',
    entityId: enquiry.id,
    data: { spaName: enquiry.spaName },
  })
  after(() => emailNewEnquiry(enquiry))
  return ok(SENT)
}

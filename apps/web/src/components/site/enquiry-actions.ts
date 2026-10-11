'use server'
import { withTenant } from '@spa/db'
// F15 website enquiry form (EnquiryForm block). Public: honeypot → zod (server-side) → per-IP limit across all spa
// sites (5/hour, 20/day, ipRateLimitKey) → Turnstile (F9, like /book) → the spa (resolved server-side, must take
// bookings) → stored per tenant (RLS) → audit + bell/push to the front desk. Nothing is emailed to the visitor;
// the spa replies by WhatsApp click-to-send from Inbox → Enquiries.
import { notify, SITE_ENQUIRY_LIMITS, siteEnquirySchema, submitSiteEnquiry } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { z } from 'zod'
import { acceptsBookings } from '@/components/booking/data'
import { type ActionResult, fail, ok } from '@/lib/action'
import { audit } from '@/server/audit'
import { hashIp } from '@/server/enquiries'
import { clientIp, withinIpLimit } from '@/server/rate-limit'
import { resolveSiteTenant } from '@/server/sites'
import { passesBotCheck } from '@/server/turnstile'
import { type SiteUiKey, ui } from './i18n'
import type { Locale } from './types'

const site = z.union([
  z.object({ slug: z.string().trim().min(1).max(63) }),
  z.object({ hostname: z.string().trim().min(1).max(253) }),
])

export type SiteEnquiryForm = {
  site: { slug: string } | { hostname: string }
  locale: Locale
  page: string
  name: string
  phone: string
  message: string
  /** Honeypot (hidden from people). */
  company?: string
  token?: string
  /** The block's own thank-you text (already in the page language). */
  success?: string
}

/** zod error codes (services siteEnquirySchema) → the visitor's language. */
const FIELD_ERRORS: Record<string, SiteUiKey> = {
  'required:name': 'errRequiredName',
  'long:name': 'errLongName',
  'required:phone': 'errRequiredPhone',
  phone: 'errPhone',
  'required:message': 'errRequiredMessage',
  'long:message': 'errLongMessage',
}

export async function sendSiteEnquiryAction(input: SiteEnquiryForm): Promise<ActionResult> {
  const lang: Locale = input?.locale === 'ar' ? 'ar' : 'en'
  const thanks = (typeof input?.success === 'string' && input.success.trim().slice(0, 300)) || ''
  const done = thanks || (lang === 'ar' ? 'شكرًا، وصلتنا رسالتك.' : 'Thank you — we got your message.')
  // Bots fill the hidden field: same answer as a real success, nothing stored or counted.
  if (typeof input?.company === 'string' && input.company.trim()) return ok(done)
  const where = site.safeParse(input?.site)
  if (!where.success) return fail(ui('errUnavailable', lang))
  const parsed = siteEnquirySchema.safeParse({
    name: input.name,
    phone: input.phone,
    message: input.message,
    locale: lang,
    page: input.page,
  })
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? '')
      const msg = FIELD_ERRORS[issue.message]
      if (key && msg && !fieldErrors[key]) fieldErrors[key] = ui(msg, lang)
    }
    return fail(ui('errCheckFields', lang), fieldErrors)
  }
  if (!(await withinIpLimit('site-enquiry', SITE_ENQUIRY_LIMITS))) return fail(ui('errTooMany', lang))
  if (!(await passesBotCheck(input.token, 'enquiry', { customDomain: 'hostname' in where.data })))
    return fail(ui('errBotCheck', lang))
  const tenant = await resolveSiteTenant(where.data)
  if (!tenant || !acceptsBookings(tenant.status)) return fail(ui('errUnavailable', lang))
  const ip = await clientIp()
  const enquiry = await withTenant(tenant.id, (tx) =>
    submitSiteEnquiry(tx, tenant.id, parsed.data, { ipHash: ip ? hashIp(ip) : null }),
  )
  await audit({
    tenantId: tenant.id,
    action: 'site.enquiry.received',
    entity: 'site_enquiry',
    entityId: enquiry.id,
    data: { page: enquiry.page, locale: enquiry.locale },
    ip: null, // public event: only the enquiry's keyed ip_hash is kept
  })
  revalidatePath(`/dashboard/${tenant.slug}/enquiries`)
  after(() =>
    notify({
      tenantId: tenant.id,
      kind: 'enquiry.site',
      params: { name: enquiry.name, message: enquiry.message.replace(/\s+/g, ' ').slice(0, 120) },
      url: `/${tenant.slug}/enquiries`,
      dedupeKey: `enquiry.site:${enquiry.id}`,
    }).catch((e) => console.error('enquiry notification failed', e)),
  )
  return ok(done)
}

// Website enquiries (F15 EnquiryForm, R26 HTML design booking form) → the spa's inbox: stored per tenant (RLS, keyed
// ip_hash), audited (ip null: public event), the dashboard list refreshed, bell/push to the front desk. Nothing is
// emailed or texted to the visitor; the spa replies by WhatsApp click-to-send.
import type { SiteEnquiryBooking } from '@spa/db'
import { withTenant } from '@spa/db'
import { notify, type SiteEnquiryInput, submitSiteEnquiry } from '@spa/services'
import { revalidatePath } from 'next/cache'
import { after } from 'next/server'
import { audit } from '@/server/audit'
import { hashIp } from '@/server/enquiries'

export async function recordSiteEnquiry(
  tenant: { id: string; slug: string },
  input: SiteEnquiryInput & { booking?: SiteEnquiryBooking | null },
  ip: string | null,
) {
  const enquiry = await withTenant(tenant.id, (tx) =>
    submitSiteEnquiry(tx, tenant.id, input, { ipHash: ip ? hashIp(ip) : null }),
  )
  const b = enquiry.booking
  await audit({
    tenantId: tenant.id,
    action: 'site.enquiry.received',
    entity: 'site_enquiry',
    entityId: enquiry.id,
    data: { page: enquiry.page, locale: enquiry.locale, ...(b ? { kind: 'booking' } : {}) },
    ip: null, // public event: only the enquiry's keyed ip_hash is kept
  })
  revalidatePath(`/dashboard/${tenant.slug}/enquiries`)
  after(() =>
    notify({
      tenantId: tenant.id,
      kind: 'enquiry.site',
      // A booking request reads the same in any language: "{service} · {date} {time}" (small hours: the next day).
      params: {
        name: enquiry.name,
        message: (b ? `${b.service} · ${b.calendarDate ?? b.date} ${b.time}` : enquiry.message)
          .replace(/\s+/g, ' ')
          .slice(0, 120),
      },
      url: `/${tenant.slug}/enquiries`,
      dedupeKey: `enquiry.site:${enquiry.id}`,
    }).catch((e) => console.error('enquiry notification failed', e)),
  )
  return enquiry
}

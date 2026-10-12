// R26: the CRM side of the HTML design data contract for one spa + locale (server only; docs/design/html-crm-contract.md).
import { buildCrmContract, CRM_ENQUIRY_PATH, type CrmContract } from '@spa/core'
import { withTenant } from '@spa/db'
import { crmFeedFacts, fileUrl, websiteServices } from '@spa/services'
import { acceptsBookings } from '@/components/booking/data'
import { siteRequestOrigin } from '@/server/origin'
import { publicSiteUrl } from '@/server/sites'
import { pageUsesCrmContract } from './html-crm'
import type { Locale, SiteService } from './types'

type Tenant = { id: string; slug: string }

/** The booking-request endpoint of a live page, on the host it was served on (`?page=` names the page). */
export const crmEnquiryEndpoint = (siteOrigin: string, slug: string, locale: Locale) =>
  `${siteOrigin}/${CRM_ENQUIRY_PATH}?page=${encodeURIComponent(slug)}${locale === 'ar' ? '&lang=ar' : ''}`

/**
 * One tenant transaction of public facts (branches, website staff, logo, status; the website services unless the
 * page already loaded them) → the contract. Booking url = the spa's online booking page (its public address, R20)
 * while it takes bookings and has a website service.
 */
export async function crmContractFor(
  tenant: Tenant,
  opts: { locale: Locale; formEndpoint: string | null; services?: SiteService[] },
): Promise<CrmContract> {
  const { facts, services } = await withTenant(tenant.id, async (tx) => ({
    facts: await crmFeedFacts(tx, tenant.id),
    services: opts.services ?? (await websiteServices(tx, tenant.id)),
  }))
  const site = (await publicSiteUrl(tenant)).replace(/\/+$/, '')
  const origin = new URL(site).origin
  return buildCrmContract(
    {
      spa: { name: facts.name, logoUrl: facts.logoFileId ? `${origin}${fileUrl(facts.logoFileId)}` : null },
      branches: facts.branches,
      services: services.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        category: s.category,
        imageUrl: s.imageUrl ?? null,
        variants: s.variants,
      })),
      staff: facts.staff,
      bookingUrl:
        acceptsBookings(facts.status) && services.length
          ? `${site}/book${opts.locale === 'ar' ? '?lang=ar' : ''}`
          : null,
      formEndpoint: opts.formEndpoint,
      filesOrigin: origin,
    },
    { locale: opts.locale },
  )
}

/**
 * `SiteMeta.crm` for a page: `{}` unless it has an HtmlDesign whose design uses the contract (block-built sites pay
 * nothing). `live`: the published page on the spa's site — its form posts to `{this host}{base}/crm-enquiry`;
 * previews, the editor and share links get no endpoint (the design falls back to WhatsApp, nothing is stored).
 */
export async function crmFeedMeta(
  tenant: Tenant,
  data: unknown,
  ctx: {
    locale: Locale
    live: boolean
    base: string
    slug: string
    services?: SiteService[]
    htmlDocs?: Record<string, string>
  },
): Promise<{ crm?: CrmContract }> {
  if (!pageUsesCrmContract(data, ctx.htmlDocs)) return {}
  const origin = ctx.live ? await siteRequestOrigin(ctx.base) : null
  const formEndpoint = origin ? crmEnquiryEndpoint(origin, ctx.slug, ctx.locale) : null
  return { crm: await crmContractFor(tenant, { locale: ctx.locale, formEndpoint, services: ctx.services }) }
}

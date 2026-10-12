// R26: the CRM side of the HTML design data contract for one spa + locale (server only; docs/design/html-crm-contract.md).
import { buildCrmContract, CRM_ENQUIRY_PATH, type CrmContract } from '@spa/core'
import { withTenant } from '@spa/db'
import {
  crmFeedFacts,
  fileUrl,
  liveHtmlDesignVersionIds,
  pageVersionsData,
  websiteServices,
} from '@spa/services'
import { LRUCache } from 'lru-cache'
import { spaDesignData } from '@/server/html-design-files'
import { siteRequestOrigin } from '@/server/origin'
import { publicSiteUrl } from '@/server/sites'
import { pageUsesCrmContract } from './html-crm'
import type { Locale, SiteService } from './types'

type Tenant = { id: string; slug: string }

/** The booking-request endpoint of a live page, on the host it was served on (`?page=` names the page). */
export const crmEnquiryEndpoint = (siteOrigin: string, slug: string, locale: Locale) =>
  `${siteOrigin}/${CRM_ENQUIRY_PATH}?page=${encodeURIComponent(slug)}${locale === 'ar' ? '&lang=ar' : ''}`

/**
 * One tenant transaction of public facts (branches, website staff, logo; the website services unless the page
 * already loaded them) → the contract. No booking url: the design's own Book links stay (its booking form → a
 * website enquiry, owner R26 (1)), never the automatic online booking page.
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

// Site → whether its live HTML designs use the contract, by the live version ids (immutable: no invalidation).
const g = globalThis as unknown as { __spaCrmSites?: LRUCache<string, { uses: boolean }> }
g.__spaCrmSites ??= new LRUCache<string, { uses: boolean }>({ max: 5000 })
const crmSites = g.__spaCrmSites

/**
 * Whether the spa's live site has a page whose HTML design uses the contract. Only those sites take design booking
 * requests (`{site}/crm-enquiry`, no Turnstile): every other site's enquiries stay behind the EnquiryForm's check.
 */
export async function siteUsesCrmContract(tenant: Tenant): Promise<boolean> {
  return withTenant(tenant.id, async (tx) => {
    const ids = await liveHtmlDesignVersionIds(tx, tenant.id)
    if (!ids.length) return false
    const key = `${tenant.id}:${ids.join(',')}`
    const hit = crmSites.get(key)
    if (hit) return hit.uses
    let uses = false
    for (const v of await pageVersionsData(tx, ids)) {
      if (pageUsesCrmContract(await spaDesignData(tenant.id, v.data, tx))) {
        uses = true
        break
      }
    }
    crmSites.set(key, { uses })
    return uses
  })
}

// Published spa pages, shared by the public site (public.tsx) and the direct HTML design page (R24, app/site-html).
import { jsonLdString, normalizeGoogleMapsUrl, spaJsonLd } from '@spa/core'
import { withTenant } from '@spa/db'
import { getPublishedPage, globalSectionsFor } from '@spa/services'
import { cache } from 'react'
import { spaDesignData } from '@/server/html-design-files'
import { heroImageOf, sitePageUrl, siteSeo } from '@/server/seo'
import { loadSite } from './data'
import { tr } from './i18n'
import type { Bi, Locale } from './types'

export type Tenant = { id: string; slug: string; name: string; status: string }

/** Published page (+ the global sections it shows) and live data, shared by generateMetadata and the page. */
export const loadPublished = cache(async (tenant: Tenant, slug: string) => {
  const published = await withTenant(tenant.id, async (tx) => {
    const page = await getPublishedPage(tx, tenant.id, slug)
    // R24: an HTML design's html comes from the spa's own file (the page JSON keeps only the reference).
    return page
      ? {
          ...page,
          data: await spaDesignData(tenant.id, page.data, tx),
          globals: await globalSectionsFor(tx, tenant.id, page.data),
        }
      : null
  })
  if (!published) return null
  const { data } = await loadSite(tenant, { published: true })
  return { published, data }
})

/** schema.org JSON-LD for a published page: the spa (branch, hours, profiles, services + public prices). */
export async function siteJsonLd(
  tenant: Tenant,
  slug: string,
  loaded: NonNullable<Awaited<ReturnType<typeof loadPublished>>>,
  locale: Locale,
) {
  const seo = await siteSeo(tenant)
  const ctx = { locale, data: loaded.data }
  const root = (loaded.published.data as { root?: { props?: { description?: Bi } } }).root?.props
  const branch = loaded.data.branch
  return jsonLdString(
    spaJsonLd({
      name: tenant.name,
      url: seo.home,
      pageUrl: sitePageUrl(seo.base, slug),
      pageName: slug ? tr(loaded.published.page.title, ctx) : null,
      description: slug ? null : tr(root?.description, ctx),
      logo: seo.logo,
      image: heroImageOf(loaded.published.data, seo.origin),
      branch,
      services: loaded.data.services.map((s) => ({
        name: tr(s.name, ctx),
        description: tr(s.description, ctx) || null,
        category: tr(s.category, ctx) || null,
        variants: s.variants,
      })),
      sameAs: [seo.instagram, normalizeGoogleMapsUrl(branch?.mapsUrl)],
      catalogName: locale === 'ar' ? 'العلاجات' : 'Treatments',
    }),
  )
}

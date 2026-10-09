import './site.css'
import { type ComponentConfig, type Config, type Data, Render } from '@puckeditor/core'
import { jsonLdString, normalizeGoogleMapsUrl, spaJsonLd } from '@spa/core'
import { withTenant } from '@spa/db'
import { getPublishedPage, globalSectionsFor, isScheduleVisible, PAGE_SLUG } from '@spa/services'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { ScrollScenes } from '@/components/scroll-scenes'
import { PlaceholderSite } from '@/components/site/placeholder-site'
import { heroImageOf, hreflang, sitePageUrl, siteSeo } from '@/server/seo'
import { siteData } from '@/server/sites'
import { siteConfig } from './config'
import { buildMeta, loadSite, localeOf } from './data'
import { tr } from './i18n'
import type { AdvancedProps } from './style'
import type { Bi, Locale } from './types'

type Tenant = { id: string; slug: string; name: string; status: string }

/** '' for home, 'services' for /services; null for anything that can't be a page slug. */
export function slugOf(path: string[] | undefined): string | null {
  if (!path?.length) return ''
  if (path.length > 1) return null
  const slug = decodeURIComponent(path[0]!).toLowerCase()
  return PAGE_SLUG.test(slug) ? slug : null
}

/**
 * Public-only config: each top-level section is wrapped in a box carrying `data-block-id/-type`, which the
 * cookieless tracker (public/t.js) uses for block views and per-section click attribution.
 */
function trackedConfig(data: Partial<Data>): Config {
  const top = new Set((data.content ?? []).map((c) => String(c.props?.id)))
  const components = Object.fromEntries(
    Object.entries(siteConfig.components).map(([name, c]) => {
      const Inner = c.render as (props: Record<string, unknown>) => React.ReactNode
      const render = (props: Record<string, unknown>) => {
        // Outside its schedule a band renders nothing — not even the tracking box.
        if (!isScheduleVisible((props.advanced as AdvancedProps | undefined)?.schedule)) return null
        return top.has(String(props.id)) ? (
          <div data-block-id={String(props.id)} data-block-type={name}>
            <Inner {...props} />
          </div>
        ) : (
          <Inner {...props} />
        )
      }
      return [name, { ...c, render } as ComponentConfig]
    }),
  )
  return { ...siteConfig, components }
}

/** Published page (+ the global sections it shows) and live data, shared by generateMetadata and the page. */
const loadPublished = cache(async (tenant: Tenant, slug: string) => {
  const published = await withTenant(tenant.id, async (tx) => {
    const page = await getPublishedPage(tx, tenant.id, slug)
    return page ? { ...page, globals: await globalSectionsFor(tx, tenant.id, page.data) } : null
  })
  if (!published) return null
  const { data } = await loadSite(tenant, { published: true })
  return { published, data }
})

export async function publicSiteMetadata(
  tenant: Tenant | null,
  path: string[] | undefined,
  lang: string | string[] | undefined,
): Promise<Metadata> {
  if (!tenant) return {}
  const slug = slugOf(path)
  const loaded = slug === null ? null : await loadPublished(tenant, slug)
  // Placeholder (nothing published) or a 404: never indexed.
  if (!loaded || slug === null) return { title: { absolute: tenant.name }, robots: { index: false } }
  const seo = await siteSeo(tenant)
  const locale = localeOf(lang)
  const ctx = { locale, data: loaded.data }
  const root = (loaded.published.data as { root?: { props?: { title?: Bi; description?: Bi } } }).root?.props
  const title = tr(root?.title, ctx) || tenant.name
  const description = tr(root?.description, ctx) || undefined
  const url = sitePageUrl(seo.base, slug, locale === 'ar' && seo.arabic ? 'ar' : undefined)
  // Social card: the page's hero picture, else the spa logo.
  const hero = heroImageOf(loaded.published.data, seo.origin)
  const image = hero ?? seo.logo
  const images = image ? [{ url: image, alt: title }] : undefined
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url, languages: hreflang(seo.base, slug, seo.arabic) },
    openGraph: {
      title,
      description,
      siteName: tenant.name,
      locale: locale === 'ar' ? 'ar_AE' : 'en_AE',
      type: 'website',
      url,
      images,
    },
    twitter: { card: hero ? 'summary_large_image' : 'summary', title, description, images },
    ...(seo.indexable ? {} : { robots: { index: false, follow: false } }),
  }
}

/** schema.org JSON-LD for a published page: the spa (branch, hours, profiles, services + public prices). */
async function siteJsonLd(
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
    }),
  )
}

/**
 * Public tenant page: renders the published Puck JSON on the server (only interactive bits ship JS).
 * Home falls back to the placeholder until something is published; unknown slugs 404.
 */
export async function PublicSite({
  tenant,
  path,
  lang,
  base,
}: {
  tenant: Tenant
  path: string[] | undefined
  lang: string | string[] | undefined
  base: string
}) {
  const slug = slugOf(path)
  if (slug === null) notFound()
  const loaded = await loadPublished(tenant, slug)
  if (!loaded) {
    if (slug === '') return <PlaceholderSite data={await siteData(tenant)} />
    notFound()
  }
  const meta = {
    ...buildMeta({
      data: loaded.data,
      theme: loaded.published.site.theme,
      locale: localeOf(lang),
      base,
      slug,
    }),
    globals: loaded.published.globals,
  }
  const data = loaded.published.data as Partial<Data>
  const ld = await siteJsonLd(tenant, slug, loaded, meta.locale)
  // ScrollScenes mounts last so it commits with the sections it drives (per-section scroll effects).
  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD escaped by jsonLdString (no tag breakout)
        dangerouslySetInnerHTML={{ __html: ld }}
      />
      <Render config={trackedConfig(data)} data={data} metadata={meta} />
      <ScrollScenes key={slug} />
    </>
  )
}

import './site.css'
import { type ComponentConfig, type Config, type Data, Render } from '@puckeditor/core'
import { withTenant } from '@spa/db'
import { getPublishedPage, PAGE_SLUG } from '@spa/services'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { PlaceholderSite } from '@/components/site/placeholder-site'
import { siteData } from '@/server/sites'
import { siteConfig } from './config'
import { buildMeta, loadSite, localeOf } from './data'
import { tr } from './i18n'
import type { Bi } from './types'

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
      const render = (props: Record<string, unknown>) =>
        top.has(String(props.id)) ? (
          <div data-block-id={String(props.id)} data-block-type={name}>
            <Inner {...props} />
          </div>
        ) : (
          <Inner {...props} />
        )
      return [name, { ...c, render } as ComponentConfig]
    }),
  )
  return { ...siteConfig, components }
}

/** Published page + live data, shared by generateMetadata and the page within one request. */
const loadPublished = cache(async (tenant: Tenant, slug: string) => {
  const published = await withTenant(tenant.id, (tx) => getPublishedPage(tx, tenant.id, slug))
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
  if (!loaded) return { title: { absolute: tenant.name } }
  const locale = localeOf(lang)
  const ctx = { locale, data: loaded.data }
  const root = (loaded.published.data as { root?: { props?: { title?: Bi; description?: Bi } } }).root?.props
  const title = tr(root?.title, ctx) || tenant.name
  const description = tr(root?.description, ctx) || undefined
  return {
    title: { absolute: title },
    description,
    openGraph: {
      title,
      description,
      siteName: tenant.name,
      locale: locale === 'ar' ? 'ar_AE' : 'en_AE',
      type: 'website',
    },
    alternates: { languages: { en: '?lang=en', ar: '?lang=ar' } },
  }
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
  const meta = buildMeta({
    data: loaded.data,
    theme: loaded.published.site.theme,
    locale: localeOf(lang),
    base,
    slug,
  })
  const data = loaded.published.data as Partial<Data>
  return <Render config={trackedConfig(data)} data={data} metadata={meta} />
}

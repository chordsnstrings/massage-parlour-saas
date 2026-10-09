import { CalendarX2 } from 'lucide-react'
import type { Metadata } from 'next'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/page'
import { hreflang, sitePageUrl, siteSeo } from '@/server/seo'
import { turnstileSiteKey } from '@/server/turnstile'
import { BookingFlow } from './booking-flow'
import { acceptsBookings, loadBookingCatalog } from './data'
import { localeOf, t } from './i18n'
import type { SiteKey } from './types'

type Tenant = { id: string; slug: string; name: string; status: string }
type Search = { lang?: string | string[]; service?: string | string[]; branch?: string | string[] }

export async function bookingMetadata(
  tenant: Tenant | null,
  lang: Search['lang'],
  embed = false,
): Promise<Metadata> {
  if (!tenant) return { title: 'Not found' }
  const locale = localeOf(lang)
  const title = `${t('title', locale)} · ${tenant.name}`
  if (embed) return { title: { absolute: title }, robots: { index: false } }
  // Canonical address + hreflang on the spa's canonical host; kept out of search like the rest of the site.
  const seo = await siteSeo(tenant)
  const url = sitePageUrl(seo.base, 'book', locale === 'ar' && seo.arabic ? 'ar' : undefined)
  const description = t('intro', locale)
  const images = seo.logo ? [{ url: seo.logo, alt: tenant.name }] : undefined
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url, languages: hreflang(seo.base, 'book', seo.arabic) },
    openGraph: { title, description, siteName: tenant.name, type: 'website', url, images },
    twitter: { card: 'summary', title, description, images },
    ...(seo.indexable ? {} : { robots: { index: false, follow: false } }),
  }
}

/** Public /book page (shared by the subdomain/path site route and the custom-domain route). */
export async function BookingPage({
  tenant,
  site,
  base,
  search,
  embed = false,
}: {
  tenant: Tenant
  site: SiteKey
  /** Site path prefix: '/s/{slug}' on a single host, '' on {slug}.domain or a custom domain. */
  base: string
  search: Search
  /** Chrome-less /book/embed route loaded by the widget iframe. */
  embed?: boolean
}) {
  const locale = localeOf(search.lang)
  const suffix = locale === 'ar' ? '?lang=ar' : ''
  const homeHref = `${base || ''}/${suffix}`
  const langHref = embed
    ? `${base}/book/embed?src=widget&lang=${locale === 'ar' ? 'en' : 'ar'}`
    : `${base}/book${locale === 'ar' ? '' : '?lang=ar'}`
  const branch = Array.isArray(search.branch) ? search.branch[0] : search.branch
  const catalog = acceptsBookings(tenant.status) ? await loadBookingCatalog(tenant, branch) : null
  const service = Array.isArray(search.service) ? search.service[0] : search.service

  if (!catalog || catalog.groups.length === 0) {
    return (
      <div
        dir={locale === 'ar' ? 'rtl' : 'ltr'}
        lang={locale}
        className={
          embed
            ? 'grid place-items-center bg-bg px-4 py-10'
            : 'grid min-h-dvh place-items-center bg-bg px-4 py-16'
        }
      >
        <Card className="anim-fade-in w-full max-w-md">
          <EmptyState
            icon={<CalendarX2 className="size-5" />}
            title={tenant.name}
            description={t(catalog ? 'noServices' : 'unavailable', locale)}
            action={
              embed ? undefined : (
                <a
                  href={homeHref}
                  className="text-sm font-medium text-accent underline-offset-4 hover:underline"
                >
                  {t('backToSite', locale)}
                </a>
              )
            }
          />
        </Card>
      </div>
    )
  }

  return (
    <BookingFlow
      site={site}
      catalog={catalog}
      locale={locale}
      homeHref={homeHref}
      langHref={langHref}
      initialServiceId={service}
      embed={embed}
      turnstileSiteKey={turnstileSiteKey({ customDomain: 'hostname' in site })}
    />
  )
}

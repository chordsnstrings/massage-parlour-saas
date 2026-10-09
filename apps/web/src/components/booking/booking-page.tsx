import { CalendarX2 } from 'lucide-react'
import type { Metadata } from 'next'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/page'
import { BookingFlow } from './booking-flow'
import { acceptsBookings, loadBookingCatalog } from './data'
import { localeOf, t } from './i18n'
import type { SiteKey } from './types'

type Tenant = { id: string; slug: string; name: string; status: string }
type Search = { lang?: string | string[]; service?: string | string[]; branch?: string | string[] }

export function bookingMetadata(tenant: Tenant | null, lang: Search['lang'], embed = false): Metadata {
  if (!tenant) return { title: 'Not found' }
  const locale = localeOf(lang)
  if (embed)
    return { title: { absolute: `${t('title', locale)} · ${tenant.name}` }, robots: { index: false } }
  return {
    title: { absolute: `${t('title', locale)} · ${tenant.name}` },
    description: t('intro', locale),
    alternates: { languages: { en: '?lang=en', ar: '?lang=ar' } },
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
    />
  )
}

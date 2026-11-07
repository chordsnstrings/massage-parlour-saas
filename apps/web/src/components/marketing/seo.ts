import { PLATFORM_NAME } from '@spa/core'
import type { Metadata } from 'next'

/**
 * Marketing pages for search + social (PLAN §17 F12): sitemap.xml lists them, each gets a canonical link and a
 * generated og:image (/og/{key}.png, app/og/[page]/route.tsx) carrying its headline. Add new pages here.
 */
export const MARKETING_PAGES = {
  home: { path: '/', headline: 'More bookings, less work for UAE spas' },
  features: { path: '/features', headline: 'Every automation your spa needs' },
  crm: { path: '/crm', headline: 'The spa CRM your whole team uses' },
  'website-builder': { path: '/website-builder', headline: 'Your spa website, built for you' },
  pricing: { path: '/pricing', headline: 'One simple yearly price in AED' },
  contact: { path: '/contact', headline: 'Talk to our team in Dubai' },
  privacy: { path: '/privacy', headline: 'Privacy policy' },
  terms: { path: '/terms', headline: 'Terms of service' },
  'data-deletion': { path: '/data-deletion', headline: 'Delete your data' },
} as const

export type MarketingPageKey = keyof typeof MARKETING_PAGES

export const isMarketingPage = (key: string): key is MarketingPageKey => Object.hasOwn(MARKETING_PAGES, key)

/**
 * A marketing page's title, description, canonical link, Open Graph and Twitter card. URLs are relative: the
 * marketing layout's metadataBase makes them absolute on the canonical domain.
 */
export function marketingMetadata(
  key: MarketingPageKey,
  page: { title: string; description: string; absoluteTitle?: boolean },
): Metadata {
  const { path, headline } = MARKETING_PAGES[key]
  const full = page.absoluteTitle ? page.title : `${page.title} · ${PLATFORM_NAME}`
  const image = { url: `/og/${key}.png`, width: 1200, height: 630, alt: headline }
  return {
    title: page.absoluteTitle ? { absolute: page.title } : page.title,
    description: page.description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: PLATFORM_NAME,
      locale: 'en_AE',
      url: path,
      title: full,
      description: page.description,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: full, description: page.description, images: [image] },
  }
}

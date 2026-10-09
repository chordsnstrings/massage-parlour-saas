import '@fontsource-variable/dm-sans'
import '@fontsource-variable/noto-sans-thai'
import '@fontsource-variable/space-grotesk'
import './marketing.css'
import { jsonLdString, PLATFORM_NAME, platformJsonLd } from '@spa/core'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { LEGAL } from '@/components/marketing/legal-config'
import { activePlans, companyContact, DEFAULT_CONTACT_EMAIL } from '@/components/marketing/plans'
import { canonicalUrls } from '@/server/origin'

/** Canonical domain for every page's canonical link, og:image and Twitter card (relative URLs in page metadata). */
export async function generateMetadata(): Promise<Metadata> {
  await headers() // request-time only: the canonical domain comes from runtime env
  return { metadataBase: new URL(canonicalUrls().marketing()) }
}

// Pages render per request: the shell's links come from the visitor's domain (server/origin.ts reads headers()).
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  await headers()
  const url = canonicalUrls().marketing()
  const [contact, plans] = await Promise.all([companyContact(), activePlans()])
  const ld = platformJsonLd({
    url,
    name: PLATFORM_NAME,
    legalName: LEGAL.companyName,
    email: contact?.email || DEFAULT_CONTACT_EMAIL,
    telephone: contact?.phone,
    logo: `${url}/brand/spamanagement-logo.svg`,
    description: 'Bookings, payments, accounting, websites and AI marketing for spas in the UAE.',
    plans: plans.map((p) => ({ name: p.name, priceAed: p.priceAed })),
  })
  return (
    <>
      <script
        type="application/ld+json"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD, escaped by jsonLdString (no tag breakout)
        dangerouslySetInnerHTML={{ __html: jsonLdString(ld) }}
      />
      {children}
    </>
  )
}

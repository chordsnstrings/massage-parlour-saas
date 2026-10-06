import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PlaceholderSite } from '@/components/site/placeholder-site'
import { resolveSiteTenant, siteData } from '@/server/sites'

type Props = { params: Promise<{ hostname: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tenant = await resolveSiteTenant({ hostname: decodeURIComponent((await params).hostname) })
  return tenant ? { title: { absolute: tenant.name } } : {}
}

export default async function CustomDomainSite({ params }: Props) {
  const tenant = await resolveSiteTenant({ hostname: decodeURIComponent((await params).hostname) })
  if (!tenant) notFound()
  return <PlaceholderSite data={await siteData(tenant)} />
}

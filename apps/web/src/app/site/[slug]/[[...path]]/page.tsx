import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PlaceholderSite } from '@/components/site/placeholder-site'
import { resolveSiteTenant, siteData } from '@/server/sites'

type Props = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tenant = await resolveSiteTenant({ slug: (await params).slug })
  return tenant ? { title: { absolute: tenant.name } } : {}
}

export default async function SubdomainSite({ params }: Props) {
  const tenant = await resolveSiteTenant({ slug: (await params).slug })
  if (!tenant) notFound()
  return <PlaceholderSite data={await siteData(tenant)} />
}

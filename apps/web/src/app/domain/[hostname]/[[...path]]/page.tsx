import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicSite, publicSiteMetadata } from '@/components/site/public'
import { resolveSiteTenant } from '@/server/sites'

type Props = {
  params: Promise<{ hostname: string; path?: string[] }>
  searchParams: Promise<{ lang?: string | string[] }>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { hostname, path } = await params
  const tenant = await resolveSiteTenant({ hostname: decodeURIComponent(hostname) })
  return publicSiteMetadata(tenant, path, (await searchParams).lang)
}

export default async function CustomDomainSite({ params, searchParams }: Props) {
  const { hostname, path } = await params
  const tenant = await resolveSiteTenant({ hostname: decodeURIComponent(hostname) })
  if (!tenant) notFound()
  return <PublicSite tenant={tenant} path={path} lang={(await searchParams).lang} base="" />
}

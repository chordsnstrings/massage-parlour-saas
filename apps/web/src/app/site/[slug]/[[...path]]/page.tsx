import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PublicSite, publicSiteMetadata } from '@/components/site/public'
import { PATH_ROUTING } from '@/lib/paths'
import { resolveSiteTenant } from '@/server/sites'

type Props = {
  params: Promise<{ slug: string; path?: string[] }>
  searchParams: Promise<{ lang?: string | string[] }>
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { slug, path } = await params
  return publicSiteMetadata(await resolveSiteTenant({ slug }), path, (await searchParams).lang)
}

export default async function SubdomainSite({ params, searchParams }: Props) {
  const { slug, path } = await params
  const tenant = await resolveSiteTenant({ slug })
  if (!tenant) notFound()
  // Links stay inside the tenant site: /s/{slug}/… on a single host, root-relative on {slug}.domain.
  const base = PATH_ROUTING ? `/s/${tenant.slug}` : ''
  return (
    <PublicSite
      tenant={tenant}
      path={path}
      lang={(await searchParams).lang}
      base={base}
      site={{ slug: tenant.slug }}
    />
  )
}

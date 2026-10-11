import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { getT } from '@/i18n/server'
import { can, isStudio, requireMember } from '@/server/access'
import { studioUrl } from '@/server/studio'
import { ServicesPrices } from './services-prices'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('website.title') }
}

export default async function WebsitePage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  // R23: the Website Studio lives in the platform console; super-admins (acting on the spa or members) go there.
  if (await isStudio(ctx)) redirect(await studioUrl(ctx.tenant.slug))
  // Spa members keep their site's services and prices current.
  if (!can(ctx, 'site.content') && !can(ctx, 'services.manage')) notFound()
  return <ServicesPrices ctx={ctx} />
}

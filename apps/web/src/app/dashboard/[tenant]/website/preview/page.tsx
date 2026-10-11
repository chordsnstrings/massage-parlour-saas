import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DraftPreview, type DraftPreviewQuery } from '@/components/site/draft-preview'
import { getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('website.previewMeta'), robots: { index: false } }
}

type Props = {
  params: Promise<{ tenant: string }>
  searchParams: Promise<DraftPreviewQuery>
}

/** Draft preview on the spa dashboard (body: components/site/draft-preview.tsx). */
export default async function SitePreviewPage({ params, searchParams }: Props) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'site.content') && !can(ctx, 'site.design') && !can(ctx, 'site.publish')) notFound()
  return <DraftPreview tenant={ctx.tenant} query={await searchParams} />
}

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

/**
 * Site preview on the spa dashboard (body: components/site/draft-preview.tsx): the spa's Website page frames it
 * (`live=1` once published) for everyone who opens that page.
 */
export default async function SitePreviewPage({ params, searchParams }: Props) {
  const ctx = await requireMember((await params).tenant)
  const allowed = ['site.content', 'site.design', 'site.publish', 'services.manage'] as const
  if (!allowed.some((p) => can(ctx, p))) notFound()
  return <DraftPreview tenant={ctx.tenant} query={await searchParams} />
}

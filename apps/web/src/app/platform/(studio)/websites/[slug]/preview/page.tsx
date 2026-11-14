import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { DraftPreview, type DraftPreviewQuery } from '@/components/site/draft-preview'
import { can, isStudio, requireMember } from '@/server/access'

export const metadata: Metadata = { title: 'Preview', robots: { index: false } }

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<DraftPreviewQuery>
}

/** R23 console draft preview + template try-on (full screen, thumbnails and new tabs of the spa website page). */
export default async function StudioPreviewPage({ params, searchParams }: Props) {
  const ctx = await requireMember((await params).slug)
  if (!(await isStudio(ctx))) notFound()
  if (!can(ctx, 'site.content') && !can(ctx, 'site.design') && !can(ctx, 'site.publish')) notFound()
  return <DraftPreview tenant={ctx.tenant} query={await searchParams} />
}

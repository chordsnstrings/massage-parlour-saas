import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { can, requireMember } from '@/server/access'
import { ComposerPage } from '../composer-page'
import { DEFAULT_MESSAGE, dubaiLocalValue } from '../data'

export const metadata: Metadata = { title: 'New campaign' }

export default async function NewCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ segment?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'marketing.campaigns')) notFound()
  const tomorrow = new Date(Date.now() + 86_400_000)
  return (
    <ComposerPage
      ctx={ctx}
      campaignId={null}
      title="New campaign"
      initial={{
        name: '',
        segmentId: (await searchParams).segment ?? '',
        bodyEn: DEFAULT_MESSAGE.en,
        bodyAr: DEFAULT_MESSAGE.ar,
        promoCodeId: '',
        when: 'now',
        sendAt: `${dubaiLocalValue(tomorrow).slice(0, 10)}T10:00`,
      }}
    />
  )
}

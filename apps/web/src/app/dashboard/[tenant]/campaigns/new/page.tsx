import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'
import { ComposerPage } from '../composer-page'
import { DEFAULT_MESSAGE, dubaiLocalValue } from '../data'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('campaigns.composer.newTitle') }
}

export default async function NewCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ segment?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'marketing.campaigns')) notFound()
  const t = await getT()
  const tomorrow = new Date(Date.now() + 86_400_000)
  return (
    <ComposerPage
      ctx={ctx}
      campaignId={null}
      title={t('campaigns.composer.newTitle')}
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

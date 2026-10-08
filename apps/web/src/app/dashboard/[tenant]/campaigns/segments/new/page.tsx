import { withTenant } from '@spa/db'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { presetName, SEGMENT_PRESETS } from '@/components/campaigns/rules'
import { SegmentBuilder } from '@/components/campaigns/segment-builder'
import { Button } from '@/components/ui/button'
import { PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'
import { clientTags, serviceOptions } from '../../data'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('campaigns.segments.newTitle') }
}

export default async function NewSegmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ preset?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'marketing.campaigns')) notFound()
  const presetKey = (await searchParams).preset
  const preset = SEGMENT_PRESETS.find((p) => p.slug === presetKey)
  const slug = ctx.tenant.slug
  const t = await getT()
  const data = await withTenant(ctx.tenant.id, async (tx) => ({
    services: await serviceOptions(tx),
    tags: await clientTags(tx),
  }))
  return (
    <>
      <PageHeader
        eyebrow={t('campaigns.composer.eyebrow')}
        title={t('campaigns.segments.newTitle')}
        description={t('campaigns.segments.newDescription')}
        actions={
          <Button variant="ghost" asChild>
            <Link href={appPath(`/${slug}/campaigns?tab=segments`)}>
              <ArrowLeft className="rtl:rotate-180" /> {t('campaigns.segments.back')}
            </Link>
          </Button>
        }
      />
      <PageBody>
        <SegmentBuilder
          slug={slug}
          segmentId={null}
          initialName={preset ? presetName(t, preset) : ''}
          initialRules={preset?.rules ?? [{ kind: 'lapsed', days: 60 }]}
          services={data.services}
          tags={data.tags}
        />
      </PageBody>
    </>
  )
}

import { segments, withTenant } from '@spa/db'
import { eq } from 'drizzle-orm'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { z } from 'zod'
import { DeleteSegmentButton } from '@/components/campaigns/campaign-buttons'
import { SegmentBuilder } from '@/components/campaigns/segment-builder'
import { Button } from '@/components/ui/button'
import { PageBody, PageHeader } from '@/components/ui/page'
import { appPath } from '@/lib/paths'
import { getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'
import { clientTags, serviceOptions } from '../../data'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('campaigns.segments.editTitle') }
}

export default async function SegmentPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'marketing.campaigns')) notFound()
  if (!z.uuid().safeParse(id).success) notFound()
  const slug = ctx.tenant.slug
  const t = await getT()
  const data = await withTenant(ctx.tenant.id, async (tx) => ({
    segment: (await tx.select().from(segments).where(eq(segments.id, id)))[0],
    services: await serviceOptions(tx),
    tags: await clientTags(tx),
  }))
  if (!data.segment) notFound()
  return (
    <>
      <PageHeader
        eyebrow={t('campaigns.segments.eyebrow')}
        title={data.segment.name}
        description={t('campaigns.segments.editDescription')}
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link href={appPath(`/${slug}/campaigns?tab=segments`)}>
                <ArrowLeft className="rtl:rotate-180" /> {t('campaigns.segments.back')}
              </Link>
            </Button>
            <DeleteSegmentButton slug={slug} id={id} />
          </>
        }
      />
      <PageBody>
        <SegmentBuilder
          slug={slug}
          segmentId={id}
          initialName={data.segment.name}
          initialRules={data.segment.rules}
          services={data.services}
          tags={data.tags}
        />
      </PageBody>
    </>
  )
}

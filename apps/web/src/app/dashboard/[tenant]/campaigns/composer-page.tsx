import { promoCodes, withTenant } from '@spa/db'
import { and, asc, eq, gte, isNull, or } from 'drizzle-orm'
import { ArrowLeft, Users } from 'lucide-react'
import Link from 'next/link'
import { CampaignComposer, type ComposerInitial } from '@/components/campaigns/campaign-composer'
import { Card, Note } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { todayDubai } from '@/lib/utils'
import type { MemberContext } from '@/server/access'
import { publicSiteUrl } from '@/server/sites'
import { dubaiLocalValue, segmentOptions } from './data'

/** Shared by "new campaign" and "edit draft". */
export async function ComposerPage({
  ctx,
  campaignId,
  title,
  initial,
}: {
  ctx: MemberContext
  campaignId: string | null
  title: string
  initial: ComposerInitial
}) {
  const slug = ctx.tenant.slug
  const { t, fmt } = await getI18n()
  const base = appPath(`/${slug}/campaigns`)
  const data = await withTenant(ctx.tenant.id, async (tx) => ({
    segments: await segmentOptions(tx, t, fmt),
    promos: await tx
      .select()
      .from(promoCodes)
      .where(
        and(
          eq(promoCodes.active, true),
          or(isNull(promoCodes.validTo), gte(promoCodes.validTo, todayDubai())),
        ),
      )
      .orderBy(asc(promoCodes.code)),
  }))
  const segmentKnown = Boolean(initial.segmentId) && data.segments.some((s) => s.id === initial.segmentId)
  // A saved draft whose segment was deleted must not silently switch to another audience: make staff choose.
  const segmentLost = campaignId !== null && !segmentKnown
  const segmentId = segmentKnown ? initial.segmentId : segmentLost ? '' : (data.segments[0]?.id ?? '')

  return (
    <>
      <PageHeader
        eyebrow={t('campaigns.composer.eyebrow')}
        title={title}
        description={t('campaigns.composer.description')}
        actions={
          <Button variant="ghost" asChild>
            <Link href={campaignId ? `${base}/${campaignId}` : base}>
              <ArrowLeft className="rtl:rotate-180" /> {campaignId ? t('campaigns.composer.backCampaign') : t('campaigns.composer.backCampaigns')}
            </Link>
          </Button>
        }
      />
      <PageBody>
        {data.segments.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Users className="size-5" strokeWidth={1.5} />}
              title={t('campaigns.composer.noSegmentTitle')}
              description={t('campaigns.composer.noSegmentBody')}
              action={
                <Button asChild>
                  <Link href={`${base}/segments/new?preset=winback`}>{t('campaigns.newSegment')}</Link>
                </Button>
              }
            />
          </Card>
        ) : (
          <>
            {segmentLost && (
              <div role="status">
                <Note tone="warn">{t('campaigns.composer.segmentLost')}</Note>
              </div>
            )}
            <CampaignComposer
              slug={slug}
              campaignId={campaignId}
              segments={data.segments.map((s) => ({ id: s.id, name: s.name, summary: s.summary }))}
              promos={data.promos.map((p) => ({
                id: p.id,
                code: p.code,
                label:
                  p.kind === 'percent'
                    ? t('campaigns.composer.percentOff', { value: fmt.number(Number(p.value)) })
                    : t('campaigns.composer.amountOff', { amount: fmt.aed(p.value) }),
              }))}
              spaName={ctx.tenant.name}
              bookingLink={`${await publicSiteUrl(ctx.tenant)}/book?src=campaign`}
              newSegmentHref={`${base}/segments/new`}
              minSendAt={dubaiLocalValue(new Date())}
              initial={{ ...initial, segmentId }}
            />
          </>
        )}
      </PageBody>
    </>
  )
}

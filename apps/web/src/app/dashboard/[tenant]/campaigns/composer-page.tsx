import { promoCodes, withTenant } from '@spa/db'
import { and, asc, eq, gte, isNull, or } from 'drizzle-orm'
import { ArrowLeft, Users } from 'lucide-react'
import Link from 'next/link'
import { CampaignComposer, type ComposerInitial } from '@/components/campaigns/campaign-composer'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { appPath, tenantSiteUrl } from '@/lib/paths'
import { formatAed, todayDubai } from '@/lib/utils'
import type { MemberContext } from '@/server/access'
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
  const base = appPath(`/${slug}/campaigns`)
  const data = await withTenant(ctx.tenant.id, async (tx) => ({
    segments: await segmentOptions(tx),
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
  const segmentId =
    initial.segmentId && data.segments.some((s) => s.id === initial.segmentId)
      ? initial.segmentId
      : (data.segments[0]?.id ?? '')

  return (
    <>
      <PageHeader
        eyebrow="Campaigns"
        title={title}
        description="Messages are written for each client and wait in the WhatsApp queue — your team presses send for every one."
        actions={
          <Button variant="ghost" asChild>
            <Link href={campaignId ? `${base}/${campaignId}` : base}>
              <ArrowLeft className="rtl:rotate-180" /> {campaignId ? 'Campaign' : 'Campaigns'}
            </Link>
          </Button>
        }
      />
      <PageBody>
        {data.segments.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Users className="size-5" strokeWidth={1.5} />}
              title="Create a segment first"
              description="A segment decides who receives the campaign — for example clients who haven't visited in 60 days."
              action={
                <Button asChild>
                  <Link href={`${base}/segments/new?preset=winback`}>New segment</Link>
                </Button>
              }
            />
          </Card>
        ) : (
          <CampaignComposer
            slug={slug}
            campaignId={campaignId}
            segments={data.segments.map((s) => ({ id: s.id, name: s.name, summary: s.summary }))}
            promos={data.promos.map((p) => ({
              id: p.id,
              code: p.code,
              label: p.kind === 'percent' ? `${Number(p.value)}% off` : `${formatAed(p.value)} off`,
            }))}
            spaName={ctx.tenant.name}
            bookingLink={`${tenantSiteUrl(slug)}/book?src=campaign`}
            newSegmentHref={`${base}/segments/new`}
            minSendAt={dubaiLocalValue(new Date())}
            initial={{ ...initial, segmentId }}
          />
        )}
      </PageBody>
    </>
  )
}

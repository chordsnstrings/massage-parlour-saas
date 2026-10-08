import { campaigns, withTenant } from '@spa/db'
import { eq } from 'drizzle-orm'
import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { z } from 'zod'
import { appPath } from '@/lib/paths'
import { getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'
import { ComposerPage } from '../../composer-page'
import { dubaiLocalValue } from '../../data'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('campaigns.composer.editMetaTitle') }
}

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ tenant: string; id: string }>
}) {
  const { tenant, id } = await params
  const ctx = await requireMember(tenant)
  if (!can(ctx, 'marketing.campaigns')) notFound()
  if (!z.uuid().safeParse(id).success) notFound()
  const [c] = await withTenant(ctx.tenant.id, (tx) => tx.select().from(campaigns).where(eq(campaigns.id, id)))
  if (!c) notFound()
  if (c.status !== 'draft' || c.archivedAt) redirect(appPath(`/${ctx.tenant.slug}/campaigns/${id}`))
  const t = await getT()
  const tomorrow = new Date(Date.now() + 86_400_000)
  return (
    <ComposerPage
      ctx={ctx}
      campaignId={id}
      title={t('campaigns.composer.editTitle', { name: c.name })}
      initial={{
        name: c.name,
        segmentId: c.segmentId ?? '',
        bodyEn: c.body.en,
        bodyAr: c.body.ar ?? '',
        promoCodeId: c.promoCodeId ?? '',
        when: c.scheduledAt && c.scheduledAt > new Date() ? 'later' : 'now',
        sendAt: dubaiLocalValue(
          c.scheduledAt && c.scheduledAt > new Date()
            ? c.scheduledAt
            : new Date(`${dubaiLocalValue(tomorrow).slice(0, 10)}T06:00:00Z`),
        ),
      }}
    />
  )
}

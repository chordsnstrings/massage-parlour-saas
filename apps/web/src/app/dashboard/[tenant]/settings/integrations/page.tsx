import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Grid } from '@/components/crm'
import { GbpCard } from '@/components/integrations/gbp-card'
import { InstagramCard } from '@/components/integrations/instagram-card'
import { PageHeader } from '@/components/ui/page'
import { getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'
import { SettingsTabs } from '../settings-tabs'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('settings.integrations.title') }
}

/** Integration hub: each provider card is owned by its own module (components/integrations/*). */
export default async function IntegrationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'ai.manage') && !can(ctx, 'settings.manage')) notFound()
  const sp = await searchParams
  const t = await getT()
  return (
    <>
      <PageHeader
        title={t('settings.integrations.title')}
        description={t('settings.integrations.description')}
      />
      <SettingsTabs ctx={ctx} value="integrations" />
      <Grid cols="col-2">
        <InstagramCard ctx={ctx} searchParams={sp} />
        <GbpCard ctx={ctx} searchParams={sp} />
      </Grid>
    </>
  )
}

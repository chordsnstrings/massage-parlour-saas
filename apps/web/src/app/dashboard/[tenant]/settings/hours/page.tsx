import { DEFAULT_HOURS } from '@spa/core'
import { branches, withTenant } from '@spa/db'
import { asc, desc } from 'drizzle-orm'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Stack } from '@/components/crm'
import { PageHeader } from '@/components/ui/page'
import { getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'
import { SettingsTabs } from '../settings-tabs'
import { HoursForm } from './hours-client'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('settings.hours.title') }
}

export default async function HoursPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'settings.manage')) notFound()
  const slug = ctx.tenant.slug
  const t = await getT()
  const rows = await withTenant(ctx.tenant.id, (tx) =>
    tx
      .select({
        id: branches.id,
        name: branches.name,
        openingHours: branches.openingHours,
        cutoff: branches.businessDayCutoff,
      })
      .from(branches)
      .orderBy(desc(branches.isDefault), asc(branches.createdAt)),
  )
  return (
    <>
      <PageHeader title={t('settings.hours.title')} description={t('settings.hours.description')} />
      <SettingsTabs ctx={ctx} value="hours" />
      <Stack>
        {rows.map((b) => {
          const configured = Object.keys(b.openingHours ?? {}).length > 0
          return (
            <Card
              key={b.id}
              title={b.name}
              sub={
                configured
                  ? t('settings.hours.cutoffNote', { time: b.cutoff.slice(0, 5) })
                  : t('settings.hours.notSet')
              }
            >
              <HoursForm slug={slug} branchId={b.id} initial={configured ? b.openingHours : DEFAULT_HOURS} />
            </Card>
          )
        })}
      </Stack>
    </>
  )
}

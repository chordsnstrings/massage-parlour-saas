import { withTenant } from '@spa/db'
import { listBranches } from '@spa/services'
import { MapPin } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, ListRow, Note, Pill } from '@/components/crm'
import { PlanUpsell } from '@/components/plan/upsell'
import { PageHeader } from '@/components/ui/page'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { hasFeature } from '@/server/entitlements'
import { SettingsTabs, showBranches } from '../settings-tabs'
import { ArchiveBranchButton, BranchSheet } from './branches-client'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('settings.branches.title') }
}

/** Settings → Branches (G22): add, edit, archive and restore branches. */
export default async function BranchesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'settings.manage')) notFound()
  const slug = ctx.tenant.slug
  const t = await getT()
  // PLAN §18.8: without `multiBranch` (Standard) a single-branch spa gets the Premium upsell; a downgraded spa keeps
  // its other branches working (edit / archive) but can't add or restore one (services refuse it too).
  const multi = await hasFeature(ctx.tenant.id, 'multiBranch')
  if (!multi && !(await showBranches(ctx))) return <PlanUpsell ctx={ctx} feature="multiBranch" />
  const rows = await withTenant(ctx.tenant.id, (tx) => listBranches(tx, { includeArchived: true }))
  const open = rows.filter((b) => b.active).length
  return (
    <>
      <PageHeader
        title={t('settings.branches.title')}
        description={t('settings.branches.description')}
        actions={multi ? <BranchSheet slug={slug} /> : undefined}
      />
      <SettingsTabs ctx={ctx} value="branches" />
      {!multi && (
        <Note tone="acc">
          <span data-testid="branches-upsell">
            {t('plan.branches.limit')} {t('plan.branches.extra')}
          </span>
        </Note>
      )}
      <Card title={t('settings.branches.title')} sub={t('settings.branches.count', { count: open })}>
        {rows.map((b) => (
          <ListRow
            key={b.id}
            icon={<MapPin aria-hidden />}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <span data-testid="branch-name">{b.name}</span>
                {b.isDefault && <Pill tone="acc">{t('settings.branches.main')}</Pill>}
                {!b.active && <Pill>{t('settings.branches.archived')}</Pill>}
              </span>
            }
            body={[b.address, b.phone, `${t('settings.branches.cutoff')} ${b.businessDayCutoff.slice(0, 5)}`]
              .filter(Boolean)
              .join(' · ')}
            end={
              <span className="flex items-center gap-1">
                {b.active && (
                  <Link
                    href={appPath(`/${slug}/settings/hours`)}
                    className="crm-muted px-2 text-sm hover:underline"
                  >
                    {t('settings.branches.hours')}
                  </Link>
                )}
                <BranchSheet
                  slug={slug}
                  branch={{
                    id: b.id,
                    name: b.name,
                    address: b.address,
                    mapsUrl: b.mapsUrl,
                    phone: b.phone,
                    whatsapp: b.whatsappE164 ? `+${b.whatsappE164}` : null,
                    cutoff: b.businessDayCutoff.slice(0, 5),
                  }}
                />
                {!b.isDefault && (multi || b.active) && (
                  <ArchiveBranchButton slug={slug} branchId={b.id} name={b.name} active={b.active} />
                )}
              </span>
            }
          />
        ))}
      </Card>
      <Note>{t('settings.branches.archiveHint')}</Note>
    </>
  )
}

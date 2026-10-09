import { AUTOMATION_JOBS, AUTOMATIONS, type AutomationKey, LOCKED_AUTOMATIONS } from '@spa/core'
import { withTenant } from '@spa/db'
import { getAutomations, recentJobRuns } from '@spa/services'
import {
  BellRing,
  CalendarCheck,
  Camera,
  DatabaseBackup,
  FileWarning,
  Globe,
  HeartHandshake,
  LineChart,
  PackageX,
  Sparkles,
  Star,
  Sunrise,
} from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Card, Grid, ListRow, Note, Pill, type Tone } from '@/components/crm'
import { PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { can, requireMember } from '@/server/access'
import { AutomationToggle } from './automation-toggle'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('automations.title') }
}

const ICONS = {
  bookingMessages: CalendarCheck,
  thankYou: HeartHandshake,
  slotFiller: Sparkles,
  packageExpiry: PackageX,
  instagram: Camera,
  googleReviews: Star,
  weeklyInsights: LineChart,
  dailyDigest: Sunrise,
  documentAlerts: FileWarning,
  backups: DatabaseBackup,
  domains: Globe,
} as const

const AUTOMATION_OF_JOB = new Map(
  Object.entries(AUTOMATION_JOBS).flatMap(([k, jobs]) => jobs.map((j) => [j, k as AutomationKey])),
)
const STATUS_TONE: Record<string, Tone> = { ok: 'ok', skipped: 'neutral', failed: 'bad' }

export default async function AutomationsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'settings.manage')) notFound()
  const { t, fmt } = await getI18n()
  const { switches, runs } = await withTenant(ctx.tenant.id, async (tx) => ({
    switches: await getAutomations(tx, ctx.tenant.id),
    runs: await recentJobRuns(tx),
  }))
  const active = AUTOMATIONS.filter((k) => switches[k]).length + LOCKED_AUTOMATIONS.length
  const icon = (k: keyof typeof ICONS) => {
    const Icon = ICONS[k]
    return <Icon size={16} />
  }
  return (
    <>
      <PageHeader title={t('automations.title')} description={t('automations.description')} />
      <Grid cols="col-2">
        <Card
          title={t('automations.listTitle')}
          actions={
            <Pill tone="ok" dot>
              {t('automations.active', { count: active })}
            </Pill>
          }
        >
          {AUTOMATIONS.map((k) => (
            <ListRow
              key={k}
              icon={icon(k)}
              title={t(`automations.items.${k}.name`)}
              body={`${t(`automations.items.${k}.desc`)} · ${t(`automations.items.${k}.schedule`)}`}
              end={
                <AutomationToggle
                  slug={ctx.tenant.slug}
                  id={k}
                  on={switches[k]}
                  label={t('automations.toggle', { name: { key: `automations.items.${k}.name` } })}
                />
              }
            />
          ))}
          {LOCKED_AUTOMATIONS.map((k) => (
            <ListRow
              key={k}
              icon={icon(k)}
              title={t(`automations.items.${k}.name`)}
              body={`${t(`automations.items.${k}.desc`)} · ${t(`automations.items.${k}.schedule`)}`}
              end={
                <span title={t('automations.lockedHint')}>
                  <Pill tone="neutral">{t('automations.alwaysOn')}</Pill>
                </span>
              }
            />
          ))}
        </Card>
        <Card
          title={t('automations.log.title')}
          footer={<Note icon={<BellRing size={14} />}>{t('automations.log.note')}</Note>}
        >
          {runs.length === 0 ? (
            <p className="crm-muted">{t('automations.log.empty')}</p>
          ) : (
            <div className="crm-tbl-wrap">
              <table className="crm-tbl" data-stack="true">
                <thead>
                  <tr>
                    <th>{t('automations.log.time')}</th>
                    <th>{t('automations.log.event')}</th>
                    <th>{t('automations.log.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => {
                    const k = AUTOMATION_OF_JOB.get(r.job)
                    const count = r.summary.count
                    return (
                      <tr key={r.id}>
                        <td data-label={t('automations.log.time')} className="crm-num">
                          {fmt.time(r.createdAt)}
                        </td>
                        <td data-label={t('automations.log.event')}>
                          {k ? t(`automations.items.${k}.name`) : r.job}
                          {typeof count === 'number' && count > 0 && (
                            <span className="crm-muted"> · {t('automations.log.count', { count })}</span>
                          )}
                        </td>
                        <td data-label={t('automations.log.status')}>
                          <Pill tone={STATUS_TONE[r.status] ?? 'neutral'}>
                            {t(`automations.log.statuses.${r.status}`)}
                          </Pill>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Grid>
    </>
  )
}

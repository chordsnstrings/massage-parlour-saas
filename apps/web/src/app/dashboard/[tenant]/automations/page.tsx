import {
  AUTOMATION_FEATURE,
  AUTOMATION_JOBS,
  AUTOMATIONS,
  type AutomationKey,
  clientDraftSettings,
  LOCKED_AUTOMATIONS,
} from '@spa/core'
import { withTenant } from '@spa/db'
import { getAutomations, recentJobRuns } from '@spa/services'
import {
  BellRing,
  Cake,
  CalendarCheck,
  Camera,
  DatabaseBackup,
  FileWarning,
  Globe,
  HeartHandshake,
  LineChart,
  MessageSquareHeart,
  PackageX,
  Pencil,
  Repeat,
  RotateCcw,
  Sparkles,
  Star,
  Sunrise,
  UserCheck,
} from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Grid, ListRow, Note, Pill, type Tone } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { getEntitlements } from '@/server/entitlements'
import { saveClientDraftsAction } from './actions'
import { AutomationToggle } from './automation-toggle'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('automations.title') }
}

const ICONS = {
  bookingMessages: CalendarCheck,
  thankYou: HeartHandshake,
  reviewRequests: MessageSquareHeart,
  birthdayMessages: Cake,
  winbackMessages: RotateCcw,
  slotFiller: Sparkles,
  packageExpiry: PackageX,
  membershipRenewals: Repeat,
  instagram: Camera,
  googleReviews: Star,
  weeklyInsights: LineChart,
  dailyDigest: Sunrise,
  documentAlerts: FileWarning,
  outboxAutoAssign: UserCheck,
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
  // PLAN §18.8: automations of a plan feature the spa doesn't have never run (the worker skips them) — shown as such.
  const { features } = await getEntitlements(ctx.tenant.id)
  const inPlan = (k: AutomationKey) => {
    const f = AUTOMATION_FEATURE[k]
    return !f || features.includes(f)
  }
  const active = AUTOMATIONS.filter((k) => switches[k] && inPlan(k)).length + LOCKED_AUTOMATIONS.length
  const drafts = clientDraftSettings(ctx.tenant.settings)
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
                inPlan(k) ? (
                  <AutomationToggle
                    slug={ctx.tenant.slug}
                    id={k}
                    on={switches[k]}
                    label={t('automations.toggle', { name: { key: `automations.items.${k}.name` } })}
                  />
                ) : (
                  <Pill tone="acc">{t('plan.premiumBadge')}</Pill>
                )
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
          title={t('growth.drafts.title')}
          sub={t('growth.drafts.sub')}
          data-testid="client-drafts"
          actions={
            inPlan('reviewRequests') ? (
              <FormSheet
                title={t('growth.drafts.title')}
                description={t('growth.drafts.sub')}
                action={saveClientDraftsAction.bind(null, ctx.tenant.slug)}
                submitLabel={t('growth.drafts.save')}
                trigger={
                  <Button size="sm" variant="secondary">
                    <Pencil /> {t('growth.drafts.save')}
                  </Button>
                }
              >
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('growth.drafts.quietStart')} name="quietStart">
                    <Input id="quietStart" name="quietStart" type="time" defaultValue={drafts.quietStart} />
                  </Field>
                  <Field label={t('growth.drafts.quietEnd')} name="quietEnd">
                    <Input id="quietEnd" name="quietEnd" type="time" defaultValue={drafts.quietEnd} />
                  </Field>
                </div>
                <p className="crm-muted text-xs">{t('growth.drafts.quietHint')}</p>
                <Field
                  label={t('growth.drafts.reviewLink')}
                  name="reviewLink"
                  hint={t('growth.drafts.reviewLinkHint')}
                >
                  <Input
                    id="reviewLink"
                    name="reviewLink"
                    type="url"
                    inputMode="url"
                    placeholder="https://g.page/r/…/review"
                    defaultValue={drafts.reviewLink}
                  />
                </Field>
                <Field label={t('growth.drafts.reviewDelay')} name="reviewDelayHours">
                  <Input
                    id="reviewDelayHours"
                    name="reviewDelayHours"
                    type="number"
                    min={1}
                    max={72}
                    defaultValue={drafts.reviewDelayHours}
                  />
                </Field>
                <Field label={t('growth.drafts.winbackDays')} name="winbackDays">
                  <Input
                    id="winbackDays"
                    name="winbackDays"
                    type="number"
                    min={21}
                    max={365}
                    defaultValue={drafts.winbackDays}
                  />
                </Field>
              </FormSheet>
            ) : (
              <Pill tone="acc">{t('plan.premiumBadge')}</Pill>
            )
          }
          footer={<Note icon={<BellRing size={14} />}>{t('growth.drafts.caps')}</Note>}
        >
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="crm-muted">{t('growth.drafts.quietStart')}</dt>
            <dd className="crm-num">
              {drafts.quietStart}–{drafts.quietEnd}
            </dd>
            <dt className="crm-muted">{t('growth.drafts.reviewLink')}</dt>
            <dd className="truncate">{drafts.reviewLink || '—'}</dd>
            <dt className="crm-muted">{t('growth.drafts.reviewDelay')}</dt>
            <dd className="crm-num">{drafts.reviewDelayHours}</dd>
            <dt className="crm-muted">{t('growth.drafts.winbackDays')}</dt>
            <dd className="crm-num">{drafts.winbackDays}</dd>
          </dl>
          <Button size="sm" variant="ghost" className="mt-3" asChild>
            <Link href={appPath(`/${ctx.tenant.slug}/messages/templates`)}>
              {t('growth.drafts.templates')}
            </Link>
          </Button>
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

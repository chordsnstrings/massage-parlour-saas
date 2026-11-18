import type { RebookWindow, RoomUse, TherapistRebooking, TherapistRevPath } from '@spa/services'
import { REBOOK_WINDOWS } from '@spa/services'
import { Download } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Avatar, Card, Grid, Meter, Note, Seg, Stack, Stat } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { PageBody, PageHeader } from '@/components/ui/page'
import { type Column, DataTable } from '@/components/ui/table'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { loadReports, RANGE_KEYS, type ReportQuery, reportQuery } from './data'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('reports.title') }
}

const num = 'text-right tabular-nums'
const hours = (minutes: number) => Math.round((minutes / 60) * 10) / 10
const noon = (date: string) => `${date}T12:00:00+04:00`

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<ReportQuery>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'reports.view')) notFound()
  const { t, fmt } = await getI18n()
  const d = await loadReports(ctx, await searchParams)
  const base = appPath(`/${ctx.tenant.slug}/reports`)
  const href = (patch: ReportQuery) => `${base}${reportQuery(d, patch)}`
  const pct = (v: number | null) => (v === null ? t('reports.none') : fmt.percent(v))
  const aed = (v: number | null) => (v === null ? t('reports.none') : fmt.aed(v))
  const { rebooking: rb, rev, rooms, liability: li, cohorts } = d

  const person = (r: { name: string; color: string }) => (
    <span className="crm-tname">
      <Avatar name={r.name} color={r.color} size="sm" />
      <b className="truncate">{r.name}</b>
    </span>
  )
  const rebookCols: Column<TherapistRebooking>[] = [
    { key: 'name', header: t('reports.therapist'), primary: true, cell: person },
    { key: 'visits', header: t('reports.rebook.visits'), className: num, cell: (r) => fmt.number(r.visits) },
    {
      key: 'rebooked',
      header: t('reports.rebook.rebooked'),
      className: num,
      cell: (r) => fmt.number(r.rebooked),
    },
    { key: 'rate', header: t('reports.rebook.rate'), className: num, cell: (r) => pct(r.rate) },
  ]
  const revCols: Column<TherapistRevPath>[] = [
    { key: 'name', header: t('reports.therapist'), primary: true, cell: person },
    { key: 'revenue', header: t('reports.revPath.revenue'), className: num, cell: (r) => fmt.aed(r.revenue) },
    { key: 'hours', header: t('reports.revPath.hours'), className: num, cell: (r) => fmt.number(r.hours) },
    { key: 'value', header: t('reports.revPath.value'), className: num, cell: (r) => aed(r.revPath) },
    {
      key: 'source',
      header: t('reports.revPath.source'),
      cell: (r) =>
        r.source === 'shifts'
          ? t('reports.revPath.sourceShifts')
          : r.source === 'timeclock'
            ? t('reports.revPath.sourceTimeclock')
            : t('reports.none'),
    },
  ]
  const roomCols: Column<RoomUse>[] = [
    { key: 'name', header: t('reports.rooms.room'), primary: true, cell: (r) => <b>{r.name}</b> },
    {
      key: 'booked',
      header: t('reports.rooms.booked'),
      className: num,
      cell: (r) => fmt.number(hours(r.bookedMinutes)),
    },
    {
      key: 'open',
      header: t('reports.rooms.open'),
      className: num,
      cell: (r) => fmt.number(hours(r.openMinutes)),
    },
    {
      key: 'use',
      header: t('reports.rooms.utilisation'),
      cell: (r) => (
        <span className="flex items-center justify-end gap-2">
          <Meter
            className="w-20 sm:w-28"
            label={`${t('reports.rooms.utilisation')} · ${r.name}`}
            value={Math.min(1, r.utilisation ?? 0)}
            valueText={pct(r.utilisation)}
          />
          <span className="tabular-nums">{pct(r.utilisation)}</span>
        </span>
      ),
    },
  ]
  type LiabilityRow = {
    key: string
    label: string
    sub?: string
    count?: number
    value: number
    ledger: number
    diff: number
  }
  const liabilityRows: LiabilityRow[] = li
    ? [
        {
          key: 'gift',
          label: t('reports.liability.giftCards'),
          count: li.giftCards.count,
          value: li.giftCards.value,
          ledger: li.ledger.giftCards,
          diff: li.difference.giftCards,
        },
        {
          key: 'pm',
          label: t('reports.liability.packagesMemberships'),
          sub: t('reports.liability.split', {
            packages: `${fmt.aed(li.packages.value)} (${fmt.number(li.packages.count)})`,
            memberships: `${fmt.aed(li.memberships.value)} (${fmt.number(li.memberships.count)})`,
          }),
          count: li.packages.count + li.memberships.count,
          value: li.packages.value + li.memberships.value,
          ledger: li.ledger.packagesMemberships,
          diff: li.difference.packagesMemberships,
        },
        {
          key: 'total',
          label: t('reports.liability.total'),
          value: li.total,
          ledger: li.ledger.total,
          diff: li.difference.total,
        },
      ]
    : []
  const liabilityCols: Column<LiabilityRow>[] = [
    {
      key: 'item',
      header: t('reports.liability.item'),
      primary: true,
      cell: (r) => (
        <span className="flex flex-col">
          <b>{r.label}</b>
          {r.sub && <span className="crm-muted text-xs">{r.sub}</span>}
        </span>
      ),
    },
    {
      key: 'count',
      header: t('reports.liability.count'),
      className: num,
      cell: (r) => (r.count === undefined ? '' : fmt.number(r.count)),
    },
    {
      key: 'value',
      header: t('reports.liability.outstanding'),
      className: num,
      cell: (r) => fmt.aed(r.value),
    },
    { key: 'ledger', header: t('reports.liability.ledger'), className: num, cell: (r) => fmt.aed(r.ledger) },
    {
      key: 'diff',
      header: t('reports.liability.difference'),
      className: num,
      cell: (r) => <span className={r.diff ? 'text-danger' : 'crm-muted'}>{fmt.aed(r.diff)}</span>,
    },
  ]
  const multiBranch = rooms.branches.length > 1
  const maxCohort = Math.max(1, ...cohorts.map((c) => c.size))

  return (
    <>
      <PageHeader
        title={t('reports.title')}
        description={t('reports.description', {
          from: fmt.date(noon(d.range.from)),
          to: fmt.date(noon(d.range.to)),
          cutoff: d.cutoff,
        })}
        actions={
          <>
            {d.branchOptions.length > 1 && (
              <Seg
                label={t('reports.branchLabel')}
                value={d.branchId ?? 'all'}
                items={[
                  ...(d.scoped
                    ? []
                    : [{ value: 'all', label: t('reports.allBranches'), href: href({ branch: '' }) }]),
                  ...d.branchOptions.map((b) => ({
                    value: b.id,
                    label: b.name,
                    href: href({ branch: b.id }),
                  })),
                ]}
              />
            )}
            <Seg
              label={t('reports.periodLabel')}
              value={d.range.key}
              items={RANGE_KEYS.map((key) => ({
                value: key,
                label: t(`reports.period.${key}`),
                href: href({ range: key }),
              }))}
            />
            <Button variant="secondary" asChild>
              <a href={`${base}/export${reportQuery(d)}`} download>
                <Download /> {t('reports.export')}
              </a>
            </Button>
          </>
        }
      />
      <PageBody>
        <Stack>
          <Grid cols="g4">
            <Stat
              label={t('reports.stat.rebooking')}
              value={pct(rb.rate)}
              change={{ text: t('reports.stat.rebookingSub', { days: rb.windowDays }) }}
            />
            {rev && (
              <Stat
                label={t('reports.stat.revPath')}
                value={aed(rev.revPath)}
                change={{ text: t('reports.stat.revPathSub') }}
              />
            )}
            <Stat
              label={t('reports.stat.rooms')}
              value={pct(rooms.utilisation)}
              change={{
                text: t('reports.stat.roomsSub', {
                  booked: fmt.number(hours(rooms.bookedMinutes)),
                  open: fmt.number(hours(rooms.openMinutes)),
                }),
              }}
            />
            {li && (
              <Stat
                label={t('reports.stat.liability')}
                value={fmt.aed(li.total)}
                change={{ text: t('reports.stat.liabilitySub', { date: fmt.date(noon(li.asOf)) }) }}
              />
            )}
          </Grid>

          <Card
            title={t('reports.rebook.title')}
            sub={t('reports.rebook.sub')}
            flush
            data-testid="report-rebooking"
            actions={
              <Seg
                label={t('reports.rebook.windowLabel')}
                value={String(rb.windowDays)}
                items={REBOOK_WINDOWS.map((w: RebookWindow) => ({
                  value: String(w),
                  label: t('reports.rebook.window', { days: w }),
                  href: href({ rebook: String(w) }),
                }))}
              />
            }
          >
            {rb.visits === 0 ? (
              <p className="crm-muted px-6 pb-6 text-sm">{t('reports.rebook.empty')}</p>
            ) : (
              <>
                <p className="px-6 pb-3 text-sm">
                  <b>
                    {t('reports.rebook.summary', {
                      rebooked: fmt.number(rb.rebooked),
                      visits: fmt.number(rb.visits),
                    })}
                  </b>
                  {rb.pending > 0 && (
                    <span className="crm-muted"> · {t('reports.rebook.pending', { count: rb.pending })}</span>
                  )}
                </p>
                <DataTable columns={rebookCols} rows={rb.byTherapist} rowKey={(r) => r.staffId} />
              </>
            )}
          </Card>

          {rev && (
            <Card
              title={t('reports.revPath.title')}
              sub={t('reports.revPath.sub')}
              flush
              data-testid="report-revpath"
            >
              {rev.byTherapist.length === 0 && rev.revenue === 0 ? (
                <p className="crm-muted px-6 pb-6 text-sm">{t('reports.revPath.empty')}</p>
              ) : (
                <>
                  <p className="px-6 pb-3 text-sm">
                    <b>{aed(rev.revPath)}</b>{' '}
                    <span className="crm-muted">
                      {t('reports.revPath.summary', {
                        revenue: fmt.aed(rev.revenue),
                        hours: fmt.number(rev.hours),
                      })}
                    </span>
                  </p>
                  {rev.hours === 0 && (
                    <div className="px-6 pb-3">
                      <Note tone="warn">{t('reports.revPath.noHours')}</Note>
                    </div>
                  )}
                  <DataTable columns={revCols} rows={rev.byTherapist} rowKey={(r) => r.staffId} />
                  {rev.unassigned !== 0 && (
                    <p className="crm-muted px-6 py-3 text-xs">
                      {t('reports.revPath.unassigned', { amount: fmt.aed(rev.unassigned) })}
                    </p>
                  )}
                </>
              )}
            </Card>
          )}

          <Card
            title={t('reports.rooms.title')}
            sub={t('reports.rooms.sub')}
            flush
            data-testid="report-rooms"
          >
            {rooms.branches.length === 0 ? (
              <p className="crm-muted px-6 pb-6 text-sm">{t('reports.rooms.empty')}</p>
            ) : (
              rooms.branches.map((b) => (
                <div key={b.branchId}>
                  {multiBranch && (
                    <p className="crm-ey px-6 pt-2">
                      {t('reports.rooms.branchTotal', { branch: b.name, pct: pct(b.utilisation) })}
                    </p>
                  )}
                  <DataTable columns={roomCols} rows={b.rooms} rowKey={(r) => r.roomId} />
                </div>
              ))
            )}
          </Card>

          <Card
            title={t('reports.cohorts.title')}
            sub={t('reports.cohorts.sub')}
            data-testid="report-cohorts"
          >
            <div className="crm-tbl-wrap">
              <table className="crm-tbl">
                <thead>
                  <tr>
                    <th scope="col">{t('reports.cohorts.cohort')}</th>
                    <th scope="col" className="crm-num-c">
                      {t('reports.cohorts.clients')}
                    </th>
                    {[1, 2, 3, 4, 5, 6].map((k) => (
                      <th key={k} scope="col" className="crm-num-c">
                        {t('reports.cohorts.month', { n: k })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...cohorts].reverse().map((c) => {
                    const month = fmt.monthYear(`${c.month}-15T12:00:00+04:00`)
                    return (
                      <tr key={c.month}>
                        <th scope="row" className="whitespace-nowrap text-start font-medium">
                          {month}
                        </th>
                        <td className="crm-num-c">
                          <span style={{ opacity: c.size ? 0.55 + (0.45 * c.size) / maxCohort : 0.5 }}>
                            {c.size ? fmt.number(c.size) : t('reports.none')}
                          </span>
                        </td>
                        {c.returning.map((n, i) => {
                          const k = i + 1
                          if (n === null || !c.size)
                            return (
                              <td
                                key={k}
                                className="crm-num-c crm-muted"
                                title={n === null ? t('reports.cohorts.notYet') : undefined}
                              >
                                {n === null ? '·' : t('reports.none')}
                              </td>
                            )
                          const share = n / c.size
                          return (
                            <td
                              key={k}
                              className="crm-num-c"
                              title={t('reports.cohorts.cell', { pct: fmt.percent(share), month, n: k })}
                              style={{
                                background: `color-mix(in srgb, var(--crm-accent) ${Math.round(6 + share * 44)}%, transparent)`,
                              }}
                            >
                              {fmt.percent(share)}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {li && (
            <Card
              title={t('reports.liability.title')}
              sub={t('reports.liability.sub')}
              flush
              data-testid="report-liability"
              actions={
                <form method="get" action={base} className="flex items-end gap-2">
                  {d.range.key !== '30' && <input type="hidden" name="range" value={d.range.key} />}
                  {d.branchId && <input type="hidden" name="branch" value={d.branchId} />}
                  {rb.windowDays !== 30 && <input type="hidden" name="rebook" value={rb.windowDays} />}
                  <label className="crm-fieldrow mb-0">
                    <span className="crm-muted text-xs font-semibold">{t('reports.liability.asOf')}</span>
                    <input
                      type="date"
                      name="asOf"
                      className="crm-inp"
                      defaultValue={li.asOf}
                      max={d.today}
                      required
                    />
                  </label>
                  <Button type="submit" variant="secondary" size="sm">
                    {t('reports.liability.show')}
                  </Button>
                </form>
              }
            >
              <DataTable columns={liabilityCols} rows={liabilityRows} rowKey={(r) => r.key} />
              <div className="crm-stack px-6 pb-6 pt-3">
                {li.difference.total === 0 &&
                li.difference.giftCards === 0 &&
                li.difference.packagesMemberships === 0 ? (
                  <Note tone="acc">{t('reports.liability.matches')}</Note>
                ) : (
                  <Note tone="warn">
                    {t('reports.liability.differs', {
                      amount: fmt.aed(
                        Math.abs(li.difference.giftCards) + Math.abs(li.difference.packagesMemberships),
                      ),
                    })}
                  </Note>
                )}
                {li.giftCards.pastExpiry > 0 && (
                  <Note>
                    {t('reports.liability.pastExpiry', { amount: fmt.aed(li.giftCards.pastExpiry) })}
                  </Note>
                )}
              </div>
            </Card>
          )}
        </Stack>
      </PageBody>
    </>
  )
}

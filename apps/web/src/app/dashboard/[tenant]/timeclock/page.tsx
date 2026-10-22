// B5.4 — Time clock: PIN kiosk, timesheet (actual vs planned) and leave requests (PLAN §14.7).
import { addDays, businessDateOf, dubaiParts } from '@spa/core'
import { enumLabel } from '@spa/core/i18n'
import { staff, withTenant } from '@spa/db'
import { clockedIn, listLeave, overlapDays, timesheet } from '@spa/services'
import { asc, eq } from 'drizzle-orm'
import { ChevronLeft, ChevronRight, KeyRound, Plus } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Grid, ListRow, Pill, SectionTabs, Seg, Stack, type Tone } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input, Select, Textarea } from '@/components/ui/input'
import { EmptyState, PageBody, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { allowedBranches, ownStaffId } from '../calendar/data'
import { fixEntryAction, requestLeaveAction, setPinAction } from './actions'
import { KioskTile, LeaveButtons } from './timeclock-client'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('timeclock.title') }
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const LEAVE_TONE: Record<string, Tone> = { pending: 'warn', approved: 'ok', rejected: 'neutral' }
type Tab = 'kiosk' | 'sheet' | 'leave'

/** Dubai wall clock for a datetime-local input. */
const localValue = (d: Date) => {
  const p = dubaiParts(d)
  const hh = String(Math.floor(p.minutes / 60)).padStart(2, '0')
  const mm = String(p.minutes % 60).padStart(2, '0')
  return `${p.date}T${hh}:${mm}`
}

export default async function TimeclockPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ tab?: string; branch?: string; from?: string }>
}) {
  const ctx = await requireMember((await params).tenant)
  const sp = await searchParams
  const approver = can(ctx, 'timeclock.approve')
  const tabs: Tab[] = [
    ...(can(ctx, 'timeclock.kiosk') || approver ? (['kiosk'] as const) : []),
    ...(approver ? (['sheet'] as const) : []),
    ...(can(ctx, 'timeclock.leave') || approver ? (['leave'] as const) : []),
  ]
  if (!tabs.length) notFound()
  const tab = tabs.includes(sp.tab as Tab) ? (sp.tab as Tab) : tabs[0]!
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const base = appPath(`/${slug}/timeclock`)
  const hm = (min: number) => t('timeclock.hm', { h: Math.floor(Math.abs(min) / 60), m: Math.abs(min) % 60 })
  const day = (d: string) => fmt.dateShort(`${d}T12:00:00Z`)

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const branchRows = await allowedBranches(tx, ctx)
    const branch = branchRows.find((b) => b.id === sp.branch) ?? branchRows[0]
    if (!branch) return null
    const cutoff = branch.businessDayCutoff.slice(0, 5)
    const today = businessDateOf(new Date(), cutoff)
    const people = (
      await tx
        .select()
        .from(staff)
        .where(eq(staff.active, true))
        .orderBy(asc(staff.sort), asc(staff.displayName))
    ).filter((s) => s.branchIds.length === 0 || s.branchIds.includes(branch.id))
    const from = sp.from && DATE.test(sp.from) ? sp.from : addDays(today, -6)
    const to = addDays(from, 6)
    const own = await ownStaffId(tx, ctx)
    return {
      branch,
      branches: branchRows.map((b) => ({ id: b.id, name: b.name })),
      today,
      people,
      own,
      from,
      to,
      open: tab === 'kiosk' ? await clockedIn(tx) : [],
      sheet: tab === 'sheet' ? await timesheet(tx, { branchId: branch.id, from, to }) : [],
      leave:
        tab === 'leave'
          ? approver
            ? await listLeave(tx, { from: addDays(today, -60) })
            : own
              ? await listLeave(tx, { staffId: own })
              : []
          : [],
    }
  })
  if (!data) notFound()
  const name = (id: string) => data.people.find((p) => p.id === id)?.displayName ?? t('timeclock.formerStaff')
  const link = (q: Record<string, string>) =>
    `${base}?${new URLSearchParams({ tab, ...(data.branches.length > 1 ? { branch: data.branch.id } : {}), ...q })}`

  const leaveSheet = (
    <FormSheet
      title={t('timeclock.leave.sheetTitle')}
      description={t('timeclock.leave.sheetBody')}
      action={requestLeaveAction.bind(null, slug)}
      submitLabel={t('timeclock.leave.submit')}
      trigger={
        <Button>
          <Plus /> {t('timeclock.leave.request')}
        </Button>
      }
    >
      {approver ? (
        <Field label={t('timeclock.leave.member')} name="staffId">
          <Select id="staffId" name="staffId" defaultValue={data.own ?? ''}>
            <option value="" disabled>
              {t('timeclock.leave.choose')}
            </option>
            {data.people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="staffId" value={data.own ?? ''} />
      )}
      <Field label={t('timeclock.leave.type')} name="type">
        <Select id="type" name="type" defaultValue="annual">
          {(['annual', 'sick', 'unpaid'] as const).map((ty) => (
            <option key={ty} value={ty}>
              {enumLabel(t, 'leaveType', ty)}
            </option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t('timeclock.leave.start')} name="startDate">
          <Input id="startDate" name="startDate" type="date" defaultValue={data.today} required />
        </Field>
        <Field label={t('timeclock.leave.end')} name="endDate">
          <Input id="endDate" name="endDate" type="date" defaultValue={data.today} required />
        </Field>
      </div>
      <Field label={t('timeclock.leave.note')} name="note">
        <Textarea id="note" name="note" rows={2} maxLength={300} />
      </Field>
    </FormSheet>
  )

  return (
    <>
      <PageHeader
        title={t('timeclock.title')}
        description={t('timeclock.description')}
        actions={
          <>
            {data.branches.length > 1 && (
              <Seg
                label={t('timeclock.branch')}
                value={data.branch.id}
                items={data.branches.map((b) => ({
                  value: b.id,
                  label: b.name,
                  href: `${base}?${new URLSearchParams({ tab, branch: b.id })}`,
                }))}
              />
            )}
            {tab === 'leave' && (approver || data.own) && leaveSheet}
          </>
        }
      />
      <PageBody>
        {tabs.length > 1 && (
          <SectionTabs
            label={t('timeclock.tabs.label')}
            value={tab}
            items={tabs.map((v) => ({ value: v, label: t(`timeclock.tabs.${v}`), href: link({ tab: v }) }))}
          />
        )}

        {tab === 'kiosk' && (
          <Stack>
            <Card title={t('timeclock.kiosk.title')} sub={t('timeclock.kiosk.sub')}>
              {data.people.length === 0 ? (
                <EmptyState
                  icon={<KeyRound className="size-5" strokeWidth={1.5} />}
                  title={t('timeclock.kiosk.empty')}
                />
              ) : (
                <Grid cols="g3">
                  {data.people.map((p) => {
                    const open = data.open.find((o) => o.staffId === p.id)
                    return (
                      <KioskTile
                        key={p.id}
                        slug={slug}
                        branchId={data.branch.id}
                        person={{
                          id: p.id,
                          name: p.displayName,
                          color: p.color,
                          since: open ? fmt.time(open.since) : null,
                          hasPin: Boolean(p.pinHash),
                        }}
                      />
                    )
                  })}
                </Grid>
              )}
            </Card>
            {approver && (
              <Card title={t('timeclock.pin.title')} sub={t('timeclock.pin.sub')}>
                {data.people.map((p) => (
                  <ListRow
                    key={p.id}
                    icon={<KeyRound />}
                    title={p.displayName}
                    body={p.pinHash ? t('timeclock.pin.has') : t('timeclock.pin.none')}
                    end={
                      <FormSheet
                        title={t('timeclock.pin.sheetTitle', { name: p.displayName })}
                        description={t('timeclock.pin.sheetBody')}
                        action={setPinAction.bind(null, slug)}
                        trigger={
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={t('timeclock.pin.aria', { name: p.displayName })}
                          >
                            {p.pinHash ? t('timeclock.pin.change') : t('timeclock.pin.set')}
                          </Button>
                        }
                      >
                        <input type="hidden" name="staffId" value={p.id} />
                        <Field
                          label={t('timeclock.pin.label')}
                          name="pin"
                          hint={p.pinHash ? t('timeclock.pin.clearHint') : undefined}
                        >
                          <Input
                            id="pin"
                            name="pin"
                            type="password"
                            inputMode="numeric"
                            autoComplete="new-password"
                            maxLength={8}
                          />
                        </Field>
                      </FormSheet>
                    }
                  />
                ))}
              </Card>
            )}
          </Stack>
        )}

        {tab === 'sheet' && (
          <Card
            flush
            title={t('timeclock.sheet.title')}
            sub={t('timeclock.sheet.sub', { from: day(data.from), to: day(data.to) })}
            actions={
              <span className="flex gap-1">
                <Button asChild variant="ghost" size="sm">
                  <Link href={link({ from: addDays(data.from, -7) })} aria-label={t('timeclock.sheet.prev')}>
                    <ChevronLeft className="rtl:rotate-180" />
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="sm">
                  <Link href={link({ from: addDays(data.from, 7) })} aria-label={t('timeclock.sheet.next')}>
                    <ChevronRight className="rtl:rotate-180" />
                  </Link>
                </Button>
              </span>
            }
          >
            {data.sheet.length === 0 ? (
              <p className="crm-muted px-[var(--crm-pad-card)] pb-[var(--crm-pad-card)] text-sm">
                {t('timeclock.sheet.empty')}
              </p>
            ) : (
              <div className="crm-tbl-wrap px-[var(--crm-pad-card)] pb-2">
                <table className="crm-tbl" data-stack="true">
                  <thead>
                    <tr>
                      <th>{t('timeclock.sheet.col.date')}</th>
                      <th>{t('timeclock.sheet.col.member')}</th>
                      <th className="crm-num-c">{t('timeclock.sheet.col.planned')}</th>
                      <th className="crm-num-c">{t('timeclock.sheet.col.worked')}</th>
                      <th className="crm-num-c">{t('timeclock.sheet.col.diff')}</th>
                      <th>{t('timeclock.sheet.col.entries')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sheet.map((r) => {
                      const diff = r.workedMin - r.plannedMin
                      return (
                        <tr key={`${r.staffId}-${r.date}`}>
                          <td data-label={t('timeclock.sheet.col.date')} className="crm-num">
                            {day(r.date)}
                          </td>
                          <td data-label={t('timeclock.sheet.col.member')}>
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="font-medium">{name(r.staffId)}</span>
                              {r.leave && <Pill tone="info">{enumLabel(t, 'leaveType', r.leave)}</Pill>}
                            </span>
                          </td>
                          <td data-label={t('timeclock.sheet.col.planned')} className="crm-num-c">
                            {r.plannedMin ? hm(r.plannedMin) : '—'}
                          </td>
                          <td data-label={t('timeclock.sheet.col.worked')} className="crm-num-c">
                            {r.workedMin || r.open ? hm(r.workedMin) : '—'}
                          </td>
                          <td data-label={t('timeclock.sheet.col.diff')} className="crm-num-c">
                            {r.plannedMin && (r.workedMin || !r.open) ? (
                              <Pill tone={diff < -15 ? 'warn' : diff > 15 ? 'info' : 'ok'}>
                                {diff < 0 ? '−' : '+'}
                                {hm(diff)}
                              </Pill>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td data-label={t('timeclock.sheet.col.entries')}>
                            <span className="flex flex-col gap-1">
                              {r.entries.map((e) => (
                                <span key={e.id} className="flex items-center gap-1.5 whitespace-nowrap">
                                  <span className="crm-num">
                                    {fmt.time(e.clockIn)}–
                                    {e.clockOut ? fmt.time(e.clockOut) : t('timeclock.sheet.open')}
                                  </span>
                                  <FormSheet
                                    title={t('timeclock.sheet.fixTitle', { name: name(r.staffId) })}
                                    description={t('timeclock.sheet.fixBody')}
                                    action={fixEntryAction.bind(null, slug)}
                                    trigger={
                                      <Button variant="ghost" size="sm">
                                        {t('timeclock.sheet.fix')}
                                      </Button>
                                    }
                                  >
                                    <input type="hidden" name="entryId" value={e.id} />
                                    <Field label={t('timeclock.sheet.clockIn')} name="clockIn">
                                      <Input
                                        id="clockIn"
                                        name="clockIn"
                                        type="datetime-local"
                                        defaultValue={localValue(e.clockIn)}
                                        required
                                      />
                                    </Field>
                                    <Field
                                      label={t('timeclock.sheet.clockOut')}
                                      name="clockOut"
                                      hint={t('timeclock.sheet.clockOutHint')}
                                    >
                                      <Input
                                        id="clockOut"
                                        name="clockOut"
                                        type="datetime-local"
                                        defaultValue={e.clockOut ? localValue(e.clockOut) : ''}
                                      />
                                    </Field>
                                  </FormSheet>
                                </span>
                              ))}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}

        {tab === 'leave' && (
          <Card title={t('timeclock.leave.title')} sub={t('timeclock.leave.sub')}>
            {!approver && !data.own ? (
              <p className="crm-muted text-sm">{t('timeclock.leave.noStaff')}</p>
            ) : data.leave.length === 0 ? (
              <p className="crm-muted text-sm">{t('timeclock.leave.empty')}</p>
            ) : (
              data.leave.map((l) => {
                const days = overlapDays(l.startDate, l.endDate, l.startDate, l.endDate)
                const mine = l.staffId === data.own
                return (
                  <ListRow
                    key={l.id}
                    title={
                      <span className="flex flex-wrap items-center gap-1.5">
                        {name(l.staffId)}
                        <Pill>{enumLabel(t, 'leaveType', l.type)}</Pill>
                        <Pill tone={LEAVE_TONE[l.status]} dot>
                          {enumLabel(t, 'leaveStatus', l.status)}
                        </Pill>
                      </span>
                    }
                    body={[
                      l.startDate === l.endDate
                        ? day(l.startDate)
                        : t('timeclock.leave.range', { from: day(l.startDate), to: day(l.endDate) }),
                      t('timeclock.leave.days', { count: days }),
                      l.note,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                    end={
                      <LeaveButtons
                        slug={slug}
                        id={l.id}
                        canDecide={approver && l.status === 'pending'}
                        canWithdraw={
                          (mine && l.status === 'pending') ||
                          (approver &&
                            (l.status === 'pending' || (l.status === 'approved' && l.startDate > data.today)))
                        }
                      />
                    }
                  />
                )
              })
            )}
          </Card>
        )}
      </PageBody>
    </>
  )
}

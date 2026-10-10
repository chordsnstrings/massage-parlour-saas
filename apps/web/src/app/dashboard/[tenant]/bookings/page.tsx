import { addDays, businessDateOf, MARK_STATUSES } from '@spa/core'
import { bookingSourceLabel, enumLabel } from '@spa/core/i18n'
import { bookings, staff, withTenant } from '@spa/db'
import { listBookings } from '@spa/services'
import { asc, eq } from 'drizzle-orm'
import { ClipboardList, ListTodo, SearchX } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { allowedBranches, ownStaffId } from '@/app/dashboard/[tenant]/calendar/data'
import { Card, Pill, Stack } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Label, Select } from '@/components/ui/input'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { MarkPill } from './mark-pill'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('bookings.title') }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f-]{36}$/
const MARKS = ['pending', 'completed', 'cancelled'] as const
const SOURCES = bookings.source.enumValues
const PAGE_SIZE = 25

export default async function BookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'calendar.view')) notFound()
  const { t, fmt } = await getI18n()
  const slug = ctx.tenant.slug
  const sp = await searchParams
  const canManage = can(ctx, 'calendar.manage')

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const branchRows = await allowedBranches(tx, ctx)
    if (!branchRows.length) return null
    const today = businessDateOf(new Date(), branchRows[0]!.businessDayCutoff)
    const monthStart = `${today.slice(0, 8)}01`
    const nextMonth = new Date(`${monthStart}T12:00:00Z`)
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)
    let from = one(sp.from) ?? ''
    let to = one(sp.to) ?? ''
    if (!DATE.test(from)) from = monthStart
    if (!DATE.test(to)) to = addDays(nextMonth.toISOString().slice(0, 10), -1)
    if (from > to) [from, to] = [to, from]
    const mark = MARKS.find((m) => m === one(sp.mark))
    const source = SOURCES.find((s) => s === one(sp.source))
    const branch = branchRows.find((b) => b.id === one(sp.branch))
    const missing = one(sp.missing) === '1'
    // Therapists (no calendar.manage) see only their own bookings.
    const mine = canManage ? null : await ownStaffId(tx, ctx)
    if (!canManage && !mine)
      return { branchRows, people: [], from, to, mark, source, branch, missing, list: null }
    const wantedStaff = one(sp.staff)
    const staffId = mine ?? (wantedStaff && UUID.test(wantedStaff) ? wantedStaff : undefined)
    const page = Math.max(Number.parseInt(one(sp.page) ?? '1', 10) || 1, 1)
    const list = await listBookings(tx, {
      from,
      to,
      branchIds: branch ? [branch.id] : branchRows.map((b) => b.id),
      statuses: mark ? (MARK_STATUSES[mark] as (typeof bookings.$inferSelect)['status'][]) : undefined,
      source,
      staffId,
      commissionMissing: missing,
      page,
      pageSize: PAGE_SIZE,
    })
    const people = await tx
      .select({ id: staff.id, name: staff.displayName })
      .from(staff)
      .where(eq(staff.active, true))
      .orderBy(asc(staff.sort), asc(staff.displayName))
    return { branchRows, people, from, to, mark, source, branch, missing, list, staffId }
  })

  if (!data) {
    return (
      <>
        <PageHeader title={t('bookings.title')} description={t('bookings.description')} />
        <Card>
          <EmptyState icon={<ClipboardList className="size-5" />} title={t('bookings.noBranch')} />
        </Card>
      </>
    )
  }
  const { list, people } = data
  const names = new Map(people.map((p) => [p.id, p.name]))
  const base = appPath(`/${slug}/bookings`)
  const query = (page: number) => {
    const q = new URLSearchParams({ from: data.from, to: data.to })
    if (data.mark) q.set('mark', data.mark)
    if (data.source) q.set('source', data.source)
    if (data.branch) q.set('branch', data.branch.id)
    if (canManage && 'staffId' in data && data.staffId) q.set('staff', data.staffId)
    if (data.missing) q.set('missing', '1')
    if (page > 1) q.set('page', String(page))
    return `${base}?${q}`
  }
  const pages = list ? Math.max(Math.ceil(list.total / list.pageSize), 1) : 1
  const col = {
    when: t('bookings.col.when'),
    ref: t('bookings.col.ref'),
    client: t('bookings.col.client'),
    services: t('bookings.col.services'),
    therapists: t('bookings.col.therapists'),
    source: t('bookings.col.source'),
    status: t('bookings.col.status'),
    total: t('bookings.col.total'),
    commission: t('bookings.col.commission'),
  }

  return (
    <>
      <PageHeader
        title={t('bookings.title')}
        description={t('bookings.description')}
        actions={
          <Button variant="secondary" asChild>
            <Link href={appPath(`/${ctx.tenant.slug}/waitlist`)}>
              <ListTodo /> {t('waitlist.open')}
            </Link>
          </Button>
        }
      />
      <Stack>
        <Card>
          <form method="get" action={base} aria-label={t('bookings.filter.label')}>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <div className="space-y-1.5">
                <Label htmlFor="from">{t('bookings.filter.from')}</Label>
                <Input id="from" name="from" type="date" defaultValue={data.from} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="to">{t('bookings.filter.to')}</Label>
                <Input id="to" name="to" type="date" defaultValue={data.to} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="mark">{t('bookings.filter.status')}</Label>
                <Select id="mark" name="mark" defaultValue={data.mark ?? ''}>
                  <option value="">{t('bookings.filter.all')}</option>
                  {MARKS.map((m) => (
                    <option key={m} value={m}>
                      {t(`bookings.mark.${m}`)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="source">{t('bookings.filter.source')}</Label>
                <Select id="source" name="source" defaultValue={data.source ?? ''}>
                  <option value="">{t('bookings.filter.all')}</option>
                  {SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {enumLabel(t, 'bookingSource', s)}
                    </option>
                  ))}
                </Select>
              </div>
              {canManage && (
                <div className="space-y-1.5">
                  <Label htmlFor="staff">{t('bookings.filter.therapist')}</Label>
                  <Select id="staff" name="staff" defaultValue={('staffId' in data && data.staffId) || ''}>
                    <option value="">{t('bookings.filter.all')}</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {data.branchRows.length > 1 && (
                <div className="space-y-1.5">
                  <Label htmlFor="branch">{t('bookings.filter.branch')}</Label>
                  <Select id="branch" name="branch" defaultValue={data.branch?.id ?? ''}>
                    <option value="">{t('bookings.filter.all')}</option>
                    {data.branchRows.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Label className="inline-flex items-center gap-2 font-normal">
                <Checkbox name="missing" value="1" defaultChecked={data.missing} />
                {t('bookings.filter.commissionMissing')}
              </Label>
              <span className="ms-auto flex gap-2">
                <Button variant="ghost" asChild>
                  <Link href={base}>{t('bookings.filter.reset')}</Link>
                </Button>
                <Button type="submit">{t('bookings.filter.apply')}</Button>
              </span>
            </div>
          </form>
        </Card>

        <Card
          flush
          title={t('bookings.title')}
          sub={list ? t('bookings.count', { count: list.total }) : undefined}
        >
          {!list || list.rows.length === 0 ? (
            <EmptyState
              icon={<SearchX className="size-5" />}
              title={t('bookings.none')}
              description={t('bookings.noneSub')}
            />
          ) : (
            <div className="crm-tbl-wrap px-[var(--crm-pad-card)] pb-2">
              <table className="crm-tbl" data-stack="true">
                <thead>
                  <tr>
                    <th>{col.when}</th>
                    <th>{col.ref}</th>
                    <th>{col.client}</th>
                    <th>{col.services}</th>
                    <th>{col.therapists}</th>
                    <th>{col.source}</th>
                    <th>{col.status}</th>
                    <th className="crm-num-c">{col.total}</th>
                    <th className="crm-num-c">{col.commission}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) => (
                    <tr key={r.id}>
                      <td data-label={col.when} className="whitespace-nowrap">
                        {fmt.dateShort(r.startsAt)} · {fmt.time(r.startsAt)}
                      </td>
                      <td data-label={col.ref}>
                        <Link href={`${base}/${r.id}`} className="font-medium text-accent hover:underline">
                          {r.refCode}
                        </Link>
                      </td>
                      <td data-label={col.client}>{r.clientName ?? t('bookings.walkIn')}</td>
                      <td data-label={col.services} className="crm-muted">
                        {r.services.join(', ')}
                      </td>
                      <td data-label={col.therapists}>
                        {r.staffIds.length
                          ? r.staffIds.map((id) => names.get(id) ?? '—').join(', ')
                          : t('bookings.noTherapist')}
                      </td>
                      <td data-label={col.source} className="crm-muted">
                        {bookingSourceLabel(t, r.source, r.attribution)}
                      </td>
                      <td data-label={col.status}>
                        <MarkPill status={r.status} t={t} />
                      </td>
                      <td data-label={col.total} className="crm-num-c">
                        {fmt.aed(r.totalAed)}
                      </td>
                      <td data-label={col.commission} className="crm-num-c">
                        {r.commissionMissing ? (
                          <Pill tone="warn">{t('bookings.missing')}</Pill>
                        ) : r.commissionAed !== null ? (
                          fmt.aed(r.commissionAed)
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {list && list.total > list.pageSize && (
            <nav
              className="flex items-center justify-between gap-2 px-[var(--crm-pad-card)] pb-[var(--crm-pad-card)]"
              aria-label={t('bookings.page', { page: list.page, pages })}
            >
              <span className="crm-muted text-[length:var(--crm-fs-sub)]">
                {t('bookings.page', { page: list.page, pages })}
              </span>
              <span className="flex gap-2">
                {list.page > 1 && (
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={query(list.page - 1)}>{t('bookings.prev')}</Link>
                  </Button>
                )}
                {list.page < pages && (
                  <Button variant="secondary" size="sm" asChild>
                    <Link href={query(list.page + 1)}>{t('bookings.next')}</Link>
                  </Button>
                )}
              </span>
            </nav>
          )}
        </Card>
      </Stack>
    </>
  )
}

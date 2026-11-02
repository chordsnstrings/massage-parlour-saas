import { addDays, businessDateOf, MARK_STATUSES } from '@spa/core'
import { bookingSourceLabel, enumLabel } from '@spa/core/i18n'
import { bookings, staff, withTenant } from '@spa/db'
import { listBookingsAndSales, rangeMoney } from '@spa/services'
import { asc, eq } from 'drizzle-orm'
import {
  Banknote,
  CalendarPlus,
  ClipboardList,
  CreditCard,
  ListTodo,
  Lock,
  ReceiptText,
  SearchX,
  ShoppingBag,
  TriangleAlert,
  Wallet,
} from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { allowedBranches, ownStaffId } from '@/app/dashboard/[tenant]/calendar/data'
import { PayBookingButton } from '@/components/bookings/pay-booking'
import { Card, Grid, Pill, Stack, Stat } from '@/components/crm'
import { SaleStatusPill } from '@/components/pos/status'
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
  // R45: money (revenue, payments) for whoever sees money elsewhere; taking payment needs pos.use.
  const canPay = can(ctx, 'pos.use')
  const seeMoney = canPay || can(ctx, 'dashboard.revenue')

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
      return { branchRows, people: [], from, to, mark, source, branch, missing, list: null, money: null }
    const wantedStaff = one(sp.staff)
    const staffId = mine ?? (wantedStaff && UUID.test(wantedStaff) ? wantedStaff : undefined)
    const page = Math.max(Number.parseInt(one(sp.page) ?? '1', 10) || 1, 1)
    const branchIds = branch ? [branch.id] : branchRows.map((b) => b.id)
    const list = await listBookingsAndSales(tx, {
      from,
      to,
      branchIds,
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
    const money = seeMoney && canManage ? await rangeMoney(tx, { from, to, branchIds }) : null
    return { branchRows, people, from, to, mark, source, branch, missing, list, staffId, money }
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
    payment: t('bookings.col.payment'),
  }
  const salesBase = appPath(`/${slug}/sales`)
  const checkout = (id: string) => `${salesBase}/new?booking=${id}`
  const methods = (ms: string[]) => ms.map((m) => enumLabel(t, 'paymentMethodKind', m)).join(' + ')
  const { money } = data
  const cashAed = money?.byMethod.cash ?? 0
  const otherAed = money ? Object.values(money.byMethod).reduce((s, v) => s + v, 0) - cashAed : 0

  return (
    <>
      <PageHeader
        title={t('bookings.title')}
        description={t('bookings.description')}
        actions={
          <>
            <Button variant="secondary" asChild>
              <Link href={appPath(`/${ctx.tenant.slug}/waitlist`)}>
                <ListTodo /> {t('waitlist.open')}
              </Link>
            </Button>
            {canPay && can(ctx, 'pos.close') && (
              <Button variant="secondary" asChild>
                <Link href={`${salesBase}/close`}>
                  <Lock /> {t('bookings.actions.dailyClose')}
                </Link>
              </Button>
            )}
            {canPay && (
              <Button variant="secondary" asChild>
                <Link href={`${salesBase}/new`}>
                  <ShoppingBag /> {t('bookings.actions.counterSale')}
                </Link>
              </Button>
            )}
            {canManage && (
              <Button asChild>
                <Link href={appPath(`/${slug}/calendar`)}>
                  <CalendarPlus /> {t('bookings.actions.newBooking')}
                </Link>
              </Button>
            )}
          </>
        }
      />
      <Stack>
        {money && (
          <Grid cols="g4">
            <Stat
              icon={<Wallet />}
              label={t('bookings.money.revenue')}
              value={fmt.aed(money.revenueAed)}
              change={{ text: t('bookings.money.sales', { count: money.salesCount }) }}
            />
            <Stat icon={<Banknote />} label={t('bookings.money.cash')} value={fmt.aed(cashAed)} />
            <Stat
              icon={<CreditCard />}
              label={t('bookings.money.card')}
              value={fmt.aed(otherAed)}
              change={
                money.tipsAed
                  ? { text: t('bookings.money.tips', { amount: fmt.aed(money.tipsAed) }) }
                  : undefined
              }
            />
            <Stat
              icon={<TriangleAlert />}
              label={t('bookings.money.notPaid')}
              value={fmt.number(money.notPaid)}
              change={{ text: t('bookings.money.notPaidSub'), dir: money.notPaid ? 'down' : undefined }}
            />
          </Grid>
        )}
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
                    {seeMoney && <th>{col.payment}</th>}
                    <th className="crm-num-c">{col.commission}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((r) =>
                    r.kind === 'sale' ? (
                      <tr key={`s-${r.id}`}>
                        <td data-label={col.when} className="whitespace-nowrap">
                          {fmt.dateShort(r.createdAt)} · {fmt.time(r.createdAt)}
                        </td>
                        <td data-label={col.ref}>
                          <Link
                            href={`${salesBase}/${r.id}`}
                            className="font-medium text-accent tabular-nums hover:underline"
                          >
                            #{r.number}
                          </Link>
                        </td>
                        <td data-label={col.client}>{r.clientName ?? t('bookings.walkIn')}</td>
                        <td data-label={col.services} className="crm-muted">
                          {r.items.join(', ')}
                        </td>
                        <td data-label={col.therapists}>
                          {r.staffIds.map((id) => names.get(id) ?? '—').join(', ') || '—'}
                        </td>
                        <td data-label={col.source} className="crm-muted">
                          {t('bookings.counterSale')}
                        </td>
                        <td data-label={col.status}>
                          {r.status === 'paid' ? (
                            <Pill tone="acc">
                              <ReceiptText className="size-3" aria-hidden /> {t('bookings.counterSale')}
                            </Pill>
                          ) : (
                            <SaleStatusPill t={t} status={r.status} />
                          )}
                        </td>
                        <td data-label={col.total} className="crm-num-c">
                          <span className={r.status === 'void' ? 'crm-muted line-through' : undefined}>
                            {fmt.aed(r.totalAed)}
                          </span>
                        </td>
                        {seeMoney && (
                          <td data-label={col.payment} className="crm-muted whitespace-nowrap">
                            {methods(r.methods) || '—'}
                          </td>
                        )}
                        <td data-label={col.commission} className="crm-num-c">
                          —
                        </td>
                      </tr>
                    ) : (
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
                        {seeMoney && (
                          <td data-label={col.payment} className="whitespace-nowrap">
                            {r.sale ? (
                              <Link href={`${salesBase}/${r.sale.id}`} className="hover:underline">
                                <span className="font-medium tabular-nums">#{r.sale.number}</span>
                                <span className="crm-muted">
                                  {' '}
                                  · {methods(r.sale.methods) || fmt.aed(r.sale.totalAed)}
                                </span>
                              </Link>
                            ) : r.status === 'completed' ? (
                              <span className="inline-flex flex-wrap items-center gap-2">
                                <Pill tone="warn">{t('bookings.notPaid')}</Pill>
                                {canPay && (
                                  <PayBookingButton
                                    slug={slug}
                                    bookingId={r.id}
                                    refCode={r.refCode}
                                    checkoutHref={checkout(r.id)}
                                    label={t('bookings.pay.take')}
                                    size="sm"
                                  />
                                )}
                              </span>
                            ) : canPay && ['confirmed', 'checked_in', 'in_service'].includes(r.status) ? (
                              <PayBookingButton
                                slug={slug}
                                bookingId={r.id}
                                refCode={r.refCode}
                                checkoutHref={checkout(r.id)}
                                label={t('bookings.pay.complete')}
                                variant="secondary"
                                size="sm"
                              />
                            ) : (
                              <span className="crm-muted">—</span>
                            )}
                          </td>
                        )}
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
                    ),
                  )}
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

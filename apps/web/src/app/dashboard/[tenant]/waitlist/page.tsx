import { businessDateOf } from '@spa/core'
import { enumLabel } from '@spa/core/i18n'
import { services, serviceVariants, staff, withTenant } from '@spa/db'
import { listWaitlist, OPEN_WAITLIST } from '@spa/services'
import { and, asc, eq } from 'drizzle-orm'
import { ListTodo, MessageCircle } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Card, Grid, Note, Pill, Seg, Stack, Stat, statusTone, TName } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/ui/page'
import { getI18n, getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'
import { can, requireMember } from '@/server/access'
import { allowedBranches } from '../calendar/data'
import { AddWaitlistSheet, BookWaitlistSheet, RemoveWaitlistButton } from './waitlist-client'

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())('waitlist.title') }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const DATE = /^\d{4}-\d{2}-\d{2}$/

export default async function WaitlistPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const ctx = await requireMember((await params).tenant)
  if (!can(ctx, 'calendar.view')) notFound()
  const { t, fmt } = await getI18n()
  const sp = await searchParams
  const show = one(sp.show) === 'all' ? 'all' : 'open'
  const day = one(sp.date)
  const date = day && DATE.test(day) ? day : undefined
  const manage = can(ctx, 'calendar.manage')
  const slug = ctx.tenant.slug

  const data = await withTenant(ctx.tenant.id, async (tx) => {
    const branches = await allowedBranches(tx, ctx)
    const wanted = one(sp.branch)
    const branch = branches.find((b) => b.id === wanted) ?? branches[0]
    if (!branch) return null
    const today = businessDateOf(new Date(), branch.businessDayCutoff.slice(0, 5))
    const rows = await listWaitlist(tx, {
      branchIds: [branch.id],
      date,
      fromDate: date || show === 'all' ? undefined : today,
      statuses: show === 'all' ? undefined : OPEN_WAITLIST,
    })
    const menu = manage
      ? await tx
          .select({
            serviceId: services.id,
            name: services.name,
            variantId: serviceVariants.id,
            durationMin: serviceVariants.durationMin,
          })
          .from(services)
          .innerJoin(serviceVariants, eq(serviceVariants.serviceId, services.id))
          .where(and(eq(services.active, true), eq(serviceVariants.active, true)))
          .orderBy(asc(services.sort), asc(serviceVariants.durationMin))
      : []
    const therapists = manage
      ? await tx
          .select({ id: staff.id, name: staff.displayName })
          .from(staff)
          .where(eq(staff.active, true))
          .orderBy(asc(staff.sort))
      : []
    return { branches, branch, today, rows, menu, therapists }
  })
  if (!data) notFound()
  const { branches, branch, today, rows, menu, therapists } = data
  const svcName = (n: { en: string; ar?: string } | null) => (n ? n.en : t('waitlist.anyService'))
  const serviceOptions = [...new Map(menu.map((m) => [m.serviceId, svcName(m.name)])).entries()].map(
    ([id, name]) => ({ id, name }),
  )
  const variantOptions = menu.map((m) => ({
    id: m.variantId,
    serviceId: m.serviceId,
    label: `${svcName(m.name)} · ${t('waitlist.minutes', { count: m.durationMin })}`,
  }))
  const base = appPath(`/${slug}/waitlist`)
  const href = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged = { branch: branches.length > 1 ? branch.id : undefined, date, show, ...patch }
    for (const [k, v] of Object.entries(merged)) if (v && !(k === 'show' && v === 'open')) p.set(k, v)
    const s = p.toString()
    return s ? `${base}?${s}` : base
  }
  const count = (s: string) => rows.filter((r) => r.entry.status === s).length
  const window = (from: Date | null, until: Date | null) =>
    from && until
      ? t('waitlist.windowRange', { from: fmt.time(from), until: fmt.time(until) })
      : from
        ? t('waitlist.windowFrom', { from: fmt.time(from) })
        : until
          ? t('waitlist.windowUntil', { until: fmt.time(until) })
          : t('waitlist.anyTime')
  const col = {
    date: t('waitlist.col.date'),
    client: t('waitlist.col.client'),
    service: t('waitlist.col.service'),
    window: t('waitlist.col.window'),
    status: t('waitlist.col.status'),
    notes: t('waitlist.col.notes'),
  }

  return (
    <>
      <PageHeader
        title={t('waitlist.title')}
        description={t('waitlist.description')}
        actions={
          manage ? (
            <AddWaitlistSheet
              slug={slug}
              branches={branches.map((b) => ({ id: b.id, name: b.name }))}
              branchId={branch.id}
              date={date ?? today}
              services={serviceOptions}
            />
          ) : null
        }
      />
      <Stack>
        <Grid cols="g3">
          <Stat label={t('waitlist.stats.waiting')} value={fmt.number(count('waiting'))} />
          <Stat label={t('waitlist.stats.notified')} value={fmt.number(count('notified'))} />
          <Stat label={t('waitlist.stats.booked')} value={fmt.number(count('booked'))} />
        </Grid>
        {count('notified') > 0 && can(ctx, 'marketing.send') && (
          <Note icon={<MessageCircle aria-hidden strokeWidth={1.8} />}>
            {t('waitlist.sendHint')}{' '}
            <Link className="underline" href={appPath(`/${slug}/messages`)}>
              {t('waitlist.toMessages')}
            </Link>
          </Note>
        )}
        <Card
          flush
          title={date ? t('waitlist.filter.day', { date: fmt.weekdayDate(date) }) : t('waitlist.title')}
          sub={branches.length > 1 ? branch.name : undefined}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {date && (
                <Button variant="ghost" size="sm" asChild>
                  <Link href={href({ date: undefined })}>{t('waitlist.filter.clearDay')}</Link>
                </Button>
              )}
              {branches.length > 1 && (
                <Seg
                  label={t('waitlist.sheet.branch')}
                  value={branch.id}
                  items={branches.map((b) => ({ value: b.id, label: b.name, href: href({ branch: b.id }) }))}
                />
              )}
              <Seg
                label={t('waitlist.filter.label')}
                value={show}
                items={[
                  { value: 'open', label: t('waitlist.filter.open'), href: href({ show: 'open' }) },
                  { value: 'all', label: t('waitlist.filter.all'), href: href({ show: 'all' }) },
                ]}
              />
            </div>
          }
        >
          {rows.length === 0 ? (
            <EmptyState
              icon={<ListTodo className="size-5" />}
              title={t('waitlist.empty')}
              description={t('waitlist.emptySub')}
            />
          ) : (
            <div className="crm-tbl-wrap px-[var(--crm-pad-card)] pb-2">
              <table className="crm-tbl" data-stack="true">
                <thead>
                  <tr>
                    <th>{col.date}</th>
                    <th>{col.client}</th>
                    <th>{col.service}</th>
                    <th>{col.window}</th>
                    <th>{col.status}</th>
                    <th>{col.notes}</th>
                    <th>
                      <span className="sr-only">{t('waitlist.col.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const open = OPEN_WAITLIST.includes(r.entry.status)
                    return (
                      <tr key={r.entry.id} data-testid="waitlist-row">
                        <td data-label={col.date}>{fmt.weekdayDate(r.entry.businessDate)}</td>
                        <td data-label={col.client}>
                          <Link href={appPath(`/${slug}/clients/${r.entry.clientId}`)}>
                            <TName name={r.clientName} />
                          </Link>
                        </td>
                        <td data-label={col.service}>
                          {svcName(r.serviceName)}
                          {r.durationMin ? ` · ${t('waitlist.minutes', { count: r.durationMin })}` : ''}
                        </td>
                        <td data-label={col.window} className="crm-muted tabular-nums">
                          {window(r.entry.fromAt, r.entry.untilAt)}
                        </td>
                        <td data-label={col.status}>
                          <Pill tone={statusTone(r.entry.status)}>
                            {enumLabel(t, 'waitlistStatus', r.entry.status)}
                          </Pill>
                          {r.entry.notifiedAt && r.entry.status === 'notified' && (
                            <span className="crm-muted block text-[length:var(--crm-fs-sub)]">
                              {t('waitlist.notifiedAt', { time: fmt.dateTime(r.entry.notifiedAt) })}
                            </span>
                          )}
                          {r.bookingRef && (
                            <span className="crm-muted block text-[length:var(--crm-fs-sub)]">
                              {t('waitlist.bookedRef', { ref: r.bookingRef })}
                            </span>
                          )}
                        </td>
                        <td data-label={col.notes} className="crm-muted">
                          {r.entry.notes ?? '—'}
                        </td>
                        <td>
                          {manage && open && (
                            <div className="flex flex-wrap justify-end gap-1">
                              <BookWaitlistSheet
                                slug={slug}
                                entryId={r.entry.id}
                                name={r.clientName}
                                dateLabel={fmt.weekdayDate(r.entry.businessDate)}
                                defaultTime={r.entry.fromAt ? fmt.time(r.entry.fromAt) : ''}
                                defaultVariant={r.entry.serviceVariantId ?? ''}
                                variants={variantOptions.filter(
                                  (v) => !r.entry.serviceId || v.serviceId === r.entry.serviceId,
                                )}
                                therapists={therapists}
                              />
                              <RemoveWaitlistButton slug={slug} entryId={r.entry.id} name={r.clientName} />
                            </div>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Stack>
    </>
  )
}

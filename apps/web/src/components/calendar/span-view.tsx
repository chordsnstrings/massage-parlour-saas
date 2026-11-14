'use client'
import { enumLabel } from '@spa/core/i18n'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMemo, useTransition } from 'react'
import { Card, Grid, Pill, Stat, statusTone } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Input, Select } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { useI18n } from '@/i18n/client'
import { cn } from '@/lib/utils'
import { RangeSeg } from './range-seg'
import { blockStyle, layoutLanes } from './resource-grid'
import { isHiddenStatus, minuteLabel } from './time'
import type { SpanData, SpanDay, SpanItem } from './types'

/** Pixels per minute in the Week grid (1 h = 48 px). */
const PPM = 0.8

export function SpanView({ data }: { data: SpanData }) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const [pending, startNav] = useTransition()
  const multi = data.branches.length > 1
  const href = (patch: { date?: string; branch?: string; range?: string; open?: string } = {}) => {
    const range = patch.range ?? data.range
    const q = new URLSearchParams({ date: patch.date ?? data.date })
    if (range !== 'day') q.set('range', range)
    if (multi) q.set('branch', patch.branch ?? data.branchId)
    if (patch.open) q.set('open', patch.open)
    return `${data.calendarBase}?${q}`
  }
  const dayHref = (date: string, open?: string) => href({ date, range: 'day', open })
  const go = (patch: { date?: string; branch?: string }) => startNav(() => router.push(href(patch)))
  const week = data.range === 'week'
  const inRange = data.today >= data.from && data.today <= data.to

  return (
    <>
      <PageHeader
        title={t('calendar.title')}
        description={data.ownOnly ? `${data.title} · ${t('calendar.yourBookings')}` : data.title}
      />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <div className="flex items-center gap-1 rounded-xl border bg-surface p-1">
            <Button variant="ghost" size="icon" className="size-9" asChild>
              <Link
                href={href({ date: data.prev })}
                aria-label={t(week ? 'calendar.prevWeek' : 'calendar.prevMonth')}
                scroll={false}
              >
                <ChevronLeft className="rtl:-scale-x-100" />
              </Link>
            </Button>
            <Button variant={inRange ? 'secondary' : 'ghost'} size="sm" className="h-9 px-3" asChild>
              <Link href={href({ date: data.today })} scroll={false}>
                {t('common.today')}
              </Link>
            </Button>
            <Button variant="ghost" size="icon" className="size-9" asChild>
              <Link
                href={href({ date: data.next })}
                aria-label={t(week ? 'calendar.nextWeek' : 'calendar.nextMonth')}
                scroll={false}
              >
                <ChevronRight className="rtl:-scale-x-100" />
              </Link>
            </Button>
          </div>
          <Input
            type="date"
            aria-label={t('calendar.goToDate')}
            value={data.date}
            onChange={(e) => e.target.value && go({ date: e.target.value })}
            className="h-10 w-auto min-w-[9.5rem] tabular"
          />
          {multi && (
            <Select
              aria-label={t('calendar.branch')}
              value={data.branchId}
              onChange={(e) => go({ branch: e.target.value })}
              className="h-10 w-auto min-w-40"
            >
              {data.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
          {pending && (
            <Loader2 className="size-4 animate-spin text-muted" aria-label={t('calendar.loading')} />
          )}
          <RangeSeg className="sm:ms-auto" value={data.range} href={(range) => href({ range })} />
        </div>

        {week ? <WeekView data={data} dayHref={dayHref} /> : <MonthView data={data} dayHref={dayHref} />}

        <Grid cols="g3">
          <Stat
            label={t('calendar.span.stats.bookings')}
            value={fmt.number(data.totals.bookings)}
            change={{
              text: t(week ? 'calendar.span.stats.bookingsWeek' : 'calendar.span.stats.bookingsMonth'),
            }}
          />
          <Stat
            label={t('calendar.span.stats.revenue')}
            value={data.totals.revenue}
            change={{ text: t('calendar.span.stats.revenueSub') }}
          />
          <Stat
            label={t('calendar.span.stats.occupancy')}
            value={data.totals.occupancy === null ? '–' : fmt.percent(data.totals.occupancy)}
            change={{
              text:
                data.totals.occupancy === null
                  ? t('calendar.span.stats.noShifts')
                  : t('calendar.span.stats.occupancySub'),
            }}
          />
        </Grid>
      </PageBody>
    </>
  )
}

type DayHref = (date: string, open?: string) => string

function WeekView({ data, dayHref }: { data: SpanData; dayHref: DayHref }) {
  const { t } = useI18n()
  const byDay = useMemo(() => {
    const m = new Map<string, SpanItem[]>()
    for (const i of data.items) if (!isHiddenStatus(i.status)) m.set(i.date, [...(m.get(i.date) ?? []), i])
    return m
  }, [data.items])
  const hours = useMemo(() => {
    const out: number[] = []
    for (let h = data.gridStart; h < data.gridEnd; h += 60) out.push(h)
    return out
  }, [data.gridStart, data.gridEnd])
  const height = (data.gridEnd - data.gridStart) * PPM

  return (
    <>
      {/* Desktop: 7 business-day columns × hours */}
      <div
        className="hidden overflow-x-auto rounded-xl border bg-surface md:block"
        data-testid="calendar-week"
      >
        <div className="grid min-w-[760px] grid-cols-[3.25rem_repeat(7,minmax(0,1fr))]">
          <div className="border-b" />
          {data.days.map((d) => (
            <Link
              key={d.date}
              href={dayHref(d.date)}
              className={cn(
                'flex items-center justify-between gap-2 border-s border-b px-2.5 py-2 text-[12.5px] font-semibold hover:bg-accent-soft/40',
                d.date === data.today && 'bg-accent-soft/60 text-accent',
              )}
              aria-label={t('calendar.span.openDay', { date: d.label })}
            >
              <span className="truncate">{d.label}</span>
              {d.bookings > 0 && (
                <span className="text-[11px] font-medium text-muted tabular">{d.bookings}</span>
              )}
            </Link>
          ))}
          <div className="relative border-e" style={{ height }}>
            {hours.map((h) => (
              <span
                key={h}
                className="absolute end-1.5 -translate-y-1/2 text-[10.5px] text-muted tabular first:translate-y-0"
                style={{ top: (h - data.gridStart) * PPM }}
              >
                {minuteLabel(h)}
              </span>
            ))}
          </div>
          {data.days.map((d) => (
            <WeekColumn
              key={d.date}
              day={d}
              items={byDay.get(d.date) ?? []}
              data={data}
              hours={hours}
              height={height}
              dayHref={dayHref}
            />
          ))}
        </div>
      </div>

      {/* Phones: the week as a vertical day list */}
      <div className="space-y-3 md:hidden" data-testid="calendar-week-list">
        {data.days.map((d) => {
          const list = byDay.get(d.date) ?? []
          return (
            <Card
              key={d.date}
              title={
                <Link href={dayHref(d.date)} className={cn(d.date === data.today && 'text-accent')}>
                  {d.label}
                </Link>
              }
              actions={
                d.bookings > 0 ? (
                  <Pill tone={d.pending ? 'warn' : 'neutral'}>
                    {t('calendar.span.bookings', { count: d.bookings })}
                  </Pill>
                ) : null
              }
            >
              {list.length === 0 ? (
                <p className="text-sm text-muted">{t('calendar.span.noBookings')}</p>
              ) : (
                <ul className="divide-y">
                  {list.map((i) => (
                    <li key={i.id}>
                      <Link
                        href={dayHref(i.date, i.bookingId)}
                        className="flex min-h-11 items-center gap-3 py-2"
                      >
                        <span className="w-11 shrink-0 text-xs text-muted tabular">
                          {minuteLabel(i.startMin)}
                        </span>
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ background: i.color }}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{i.title}</span>
                          <span className="block truncate text-xs text-muted">
                            {i.serviceName}
                            {i.staffName ? ` · ${i.staffName}` : ''}
                          </span>
                        </span>
                        <Pill tone={statusTone(i.status)}>{enumLabel(t, 'bookingStatus', i.status)}</Pill>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )
        })}
      </div>
    </>
  )
}

function WeekColumn({
  day,
  items,
  data,
  hours,
  height,
  dayHref,
}: {
  day: SpanDay
  items: SpanItem[]
  data: SpanData
  hours: number[]
  height: number
  dayHref: DayHref
}) {
  const { t } = useI18n()
  const lanes = useMemo(() => layoutLanes(items), [items])
  return (
    <div
      className={cn('relative border-s', day.date === data.today && 'bg-accent-soft/20')}
      style={{ height }}
    >
      {hours.map((h) => (
        <div
          key={h}
          className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/70"
          style={{ top: (h - data.gridStart) * PPM }}
        />
      ))}
      {items.map((i) => {
        const pos = lanes.get(i.id) ?? { lane: 0, lanes: 1 }
        const top = (Math.max(i.startMin, data.gridStart) - data.gridStart) * PPM
        const h = Math.max(
          (Math.min(i.endMin, data.gridEnd) - Math.max(i.startMin, data.gridStart)) * PPM - 2,
          18,
        )
        return (
          <Link
            key={i.id}
            href={dayHref(i.date, i.bookingId)}
            title={`${minuteLabel(i.startMin)}–${minuteLabel(i.endMin)} · ${i.title} · ${i.serviceName}`}
            aria-label={t('calendar.span.booking', {
              time: minuteLabel(i.startMin),
              name: i.title,
              service: i.serviceName,
            })}
            className="absolute z-[2] flex flex-col overflow-hidden rounded-md border px-1.5 py-0.5 text-start text-[11px] leading-tight text-fg transition-shadow hover:shadow-soft"
            style={{
              ...blockStyle(i.status, i.color),
              top: top + 1,
              height: h,
              insetInlineStart: `calc(${(pos.lane / pos.lanes) * 100}% + 2px)`,
              width: `calc(${100 / pos.lanes}% - 4px)`,
            }}
          >
            <span className="truncate text-[10.5px] text-muted tabular">{minuteLabel(i.startMin)}</span>
            <span className="truncate font-medium">{i.title}</span>
            {h > 44 && <span className="truncate text-muted">{i.serviceName}</span>}
          </Link>
        )
      })}
    </div>
  )
}

function MonthView({ data, dayHref }: { data: SpanData; dayHref: DayHref }) {
  const { t, fmt } = useI18n()
  return (
    <div className="overflow-hidden rounded-xl border bg-surface" data-testid="calendar-month">
      <div className="grid grid-cols-7 border-b">
        {data.weekdays.map((w) => (
          <div key={w} className="px-2 py-2 text-center text-[11px] font-semibold uppercase text-muted">
            {w}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {data.days.map((d, idx) => {
          const today = d.date === data.today
          return (
            <Link
              key={d.date}
              href={dayHref(d.date)}
              aria-label={t('calendar.span.dayCell', {
                date: d.label,
                bookings: t('calendar.span.bookings', { count: d.bookings }),
                revenue: d.revenue,
              })}
              className={cn(
                'flex min-h-16 flex-col gap-1 p-1.5 transition-colors hover:bg-accent-soft/40 sm:min-h-24 sm:p-2',
                idx % 7 !== 0 && 'border-s',
                idx >= 7 && 'border-t',
                !d.inMonth && 'bg-subtle/40 text-muted',
              )}
            >
              <span
                className={cn(
                  'grid size-6 place-items-center rounded-full text-xs font-semibold tabular',
                  today && 'bg-accent text-accent-fg',
                )}
              >
                {d.dayNum}
              </span>
              {d.bookings > 0 && (
                <>
                  <span
                    className={cn(
                      'w-fit rounded-full px-1.5 text-[11px] font-semibold tabular',
                      d.pending ? 'bg-warning-soft text-warning' : 'bg-accent-soft text-accent',
                    )}
                  >
                    <span className="sm:hidden">{fmt.number(d.bookings)}</span>
                    <span className="hidden sm:inline">
                      {t('calendar.span.bookings', { count: d.bookings })}
                    </span>
                  </span>
                  <span className="hidden truncate text-[11px] text-muted tabular sm:block">{d.revenue}</span>
                </>
              )}
              {d.occupancy !== null && d.inMonth && (
                <span
                  className="mt-auto hidden h-1 overflow-hidden rounded-full bg-border sm:block"
                  title={t('calendar.span.occupancy', { percent: fmt.percent(d.occupancy) })}
                >
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${Math.round(d.occupancy * 100)}%` }}
                  />
                </span>
              )}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

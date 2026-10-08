'use client'
import { addDays } from '@spa/core'
import { ChevronLeft, ChevronRight, Footprints, Loader2, Plus, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { rescheduleAction } from '@/app/dashboard/[tenant]/calendar/actions'
import { Grid, Note, Pill, Seg, Stat } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { toast } from '@/components/ui/toast'
import { resultText, useI18n } from '@/i18n/client'
import { cn } from '@/lib/utils'
import { Agenda } from './agenda'
import { BookingSheet } from './booking-sheet'
import { NewBookingSheet } from './new-booking-sheet'
import { type MoveTarget, ResourceGrid } from './resource-grid'
import { isHiddenStatus, minuteLabel } from './time'
import type { CalendarData, CalItem } from './types'
import { WalkInSheet, WalkInsPanel } from './walk-ins'

export type Draft = { startMin?: number; staffId?: string; roomId?: string }

export function CalendarView({ data }: { data: CalendarData }) {
  const { t, fmt } = useI18n()
  const router = useRouter()
  const [navPending, startNav] = useTransition()
  const [view, setView] = useState(data.view)
  const [showCancelled, setShowCancelled] = useState(data.showCancelled)
  const [items, setItems] = useState(data.items)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftKey, setDraftKey] = useState(0)
  const [openBooking, setOpenBooking] = useState<string | null>(null)
  const [walkInOpen, setWalkInOpen] = useState(false)

  useEffect(() => {
    setItems(data.items)
  }, [data.items])

  const href = useCallback(
    (patch: { date?: string; branch?: string } = {}) => {
      const q = new URLSearchParams({ date: patch.date ?? data.date })
      const branch = patch.branch ?? data.branchId
      if (data.branches.length > 1) q.set('branch', branch)
      if (view === 'rooms') q.set('view', 'rooms')
      if (showCancelled) q.set('cancelled', '1')
      return `${data.calendarBase}?${q}`
    },
    [data.date, data.branchId, data.branches.length, data.calendarBase, view, showCancelled],
  )
  const go = useCallback(
    (patch: { date?: string; branch?: string }) => startNav(() => router.push(href(patch))),
    [router, href],
  )

  // Keep view + toggle in the URL so a refresh lands in the same place.
  useEffect(() => {
    window.history.replaceState(window.history.state, '', href())
  }, [href])

  const openNew = useCallback((d: Draft) => {
    setDraft(d)
    setDraftKey((k) => k + 1)
  }, [])

  // Keyboard: ← → change day, T today, N new booking (when not typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input,textarea,select,[role=dialog]')) return
      if (e.key === 'ArrowLeft') go({ date: addDays(data.date, -1) })
      else if (e.key === 'ArrowRight') go({ date: addDays(data.date, 1) })
      else if (e.key === 't') go({ date: data.today })
      else if (e.key === 'n' && data.canManage) openNew({})
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, data.date, data.today, data.canManage, openNew])

  const visible = useMemo(
    () => items.filter((i) => showCancelled || !isHiddenStatus(i.status)),
    [items, showCancelled],
  )
  const hiddenCount = items.length - items.filter((i) => !isHiddenStatus(i.status)).length

  const move = useCallback(
    async (item: CalItem, to: MoveTarget) => {
      const before = items
      const shift = to.startMin - item.startMin
      setItems((list) =>
        list.map((i) =>
          i.id === item.id
            ? {
                ...i,
                startMin: to.startMin,
                endMin: i.endMin + shift,
                staffIds: to.staffIds ?? i.staffIds,
                roomId: to.roomId ?? i.roomId,
              }
            : i,
        ),
      )
      const r = await rescheduleAction(data.slug, {
        itemId: item.id,
        date: data.date,
        time: minuteLabel(to.startMin),
        staffIds: to.staffIds,
        roomId: to.roomId,
      })
      if (r?.ok) toast.success(resultText(t, r) ?? t('calendar.moved'))
      else {
        setItems(before)
        toast.error((r && resultText(t, r)) ?? t('calendar.moveFailed'))
      }
    },
    [items, data.slug, data.date, t],
  )

  const selected = openBooking ? items.filter((i) => i.bookingId === openBooking) : []
  const isToday = data.date === data.today
  const showWalkIns = data.rotation !== null
  const dayLabel = fmt.weekdayDate(`${data.date}T12:00:00Z`)

  // Day stats (crm-spec §5.2): booked vs shift hours, walk-ins, late-night bookings — from the loaded day only.
  const stats = useMemo(() => {
    const live = items.filter((i) => !isHiddenStatus(i.status))
    const bookedMin = live.reduce((s, i) => s + (i.endMin - i.startMin) * Math.max(1, i.staffIds.length), 0)
    const shiftMin = data.staff.reduce(
      (s, p) =>
        s +
        p.shifts.reduce(
          (a, sh) => a + Math.max(0, Math.min(sh.end, data.gridEnd) - Math.max(sh.start, data.gridStart)),
          0,
        ),
      0,
    )
    return {
      bookings: new Set(live.map((i) => i.bookingId)).size,
      bookedH: Math.round(bookedMin / 60),
      shiftH: Math.round(shiftMin / 60),
      walkIns: new Set(live.filter((i) => i.source === 'walk_in').map((i) => i.bookingId)).size,
      late: new Set(live.filter((i) => i.startMin >= 20 * 60).map((i) => i.bookingId)).size,
    }
  }, [items, data.staff, data.gridStart, data.gridEnd])

  return (
    <>
      <PageHeader
        title={t('calendar.title')}
        description={data.ownOnly ? `${dayLabel} · ${t('calendar.yourBookings')}` : dayLabel}
        actions={
          data.canManage ? (
            <>
              {showWalkIns && (
                <Button variant="secondary" onClick={() => setWalkInOpen(true)}>
                  <Footprints /> {t('calendar.walkIn')}
                </Button>
              )}
              <Button onClick={() => openNew({})}>
                <Plus /> {t('calendar.newBooking')}
              </Button>
            </>
          ) : null
        }
      />
      <PageBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <div className="flex items-center gap-1 rounded-xl border bg-surface p-1">
            <Button variant="ghost" size="icon" className="size-9" asChild>
              <Link href={href({ date: addDays(data.date, -1) })} aria-label={t('calendar.prevDay')} scroll={false}>
                <ChevronLeft className="rtl:-scale-x-100" />
              </Link>
            </Button>
            <Button variant={isToday ? 'secondary' : 'ghost'} size="sm" className="h-9 px-3" asChild>
              <Link href={href({ date: data.today })} scroll={false}>
                {t('common.today')}
              </Link>
            </Button>
            <Button variant="ghost" size="icon" className="size-9" asChild>
              <Link href={href({ date: addDays(data.date, 1) })} aria-label={t('calendar.nextDay')} scroll={false}>
                <ChevronRight className="rtl:-scale-x-100" />
              </Link>
            </Button>
          </div>
          {isToday && <Pill tone="acc">{t('calendar.todayPill', { date: dayLabel })}</Pill>}
          <Input
            type="date"
            aria-label={t('calendar.goToDate')}
            value={data.date}
            onChange={(e) => e.target.value && go({ date: e.target.value })}
            className="h-10 w-auto min-w-[9.5rem] tabular"
          />
          {data.branches.length > 1 && (
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
          {navPending && <Loader2 className="size-4 animate-spin text-muted" aria-label={t('calendar.loading')} />}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:ms-auto">
            {!data.ownOnly && (
              <Seg
                className="hidden md:inline-flex"
                label={t('calendar.columns')}
                value={view}
                onChange={(v) => setView(v as 'staff' | 'rooms')}
                items={[
                  { value: 'staff', label: t('calendar.therapists') },
                  { value: 'rooms', label: t('calendar.rooms') },
                ]}
              />
            )}
            <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm text-muted">
              <Checkbox checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
              {hiddenCount
                ? t('calendar.showCancelledCount', { count: hiddenCount })
                : t('calendar.showCancelled')}
            </label>
          </div>
        </div>

        {data.canManage && (
          <Note tone="acc" icon={<ShieldCheck aria-hidden />}>
            {t('calendar.reservedNote')}
          </Note>
        )}

        <div className={cn('grid gap-4', showWalkIns && 'xl:grid-cols-[minmax(0,1fr)_16rem]')}>
          <div className="min-w-0">
            <div className="hidden md:block">
              <ResourceGrid
                data={data}
                view={data.ownOnly ? 'staff' : view}
                items={visible}
                onSlot={(colId, startMin) =>
                  openNew({
                    startMin,
                    staffId: view === 'staff' ? colId : undefined,
                    roomId: view === 'rooms' ? colId : undefined,
                  })
                }
                onOpen={setOpenBooking}
                onMove={move}
              />
            </div>
            <div className="md:hidden">
              <Agenda
                data={data}
                items={visible}
                onOpen={setOpenBooking}
                onPrev={() => go({ date: addDays(data.date, -1) })}
                onNext={() => go({ date: addDays(data.date, 1) })}
              />
            </div>
          </div>
          {showWalkIns && (
            <div>
              <WalkInsPanel rotation={data.rotation ?? []} onWalkIn={() => setWalkInOpen(true)} />
            </div>
          )}
        </div>

        <Grid cols="g3">
          <Stat
            label={t('calendar.stats.booked')}
            value={fmt.number(stats.bookings)}
            change={{
              text: stats.shiftH
                ? t('calendar.stats.bookedSub', {
                    booked: fmt.number(stats.bookedH),
                    total: fmt.number(stats.shiftH),
                  })
                : t('calendar.stats.noShifts'),
            }}
          />
          <Stat
            label={t('calendar.stats.walkIns')}
            value={fmt.number(stats.walkIns)}
            change={{ text: t('calendar.stats.walkInsSub') }}
          />
          <Stat
            label={t('calendar.stats.lateNight')}
            value={fmt.number(stats.late)}
            change={{ text: t('calendar.stats.lateNightSub') }}
          />
        </Grid>
      </PageBody>

      {data.canManage && (
        <NewBookingSheet
          key={draftKey}
          data={data}
          draft={draft}
          open={draft !== null}
          onOpenChange={(o) => !o && setDraft(null)}
        />
      )}
      <BookingSheet
        data={data}
        items={selected}
        open={selected.length > 0}
        onOpenChange={(o) => !o && setOpenBooking(null)}
      />
      {showWalkIns && data.canManage && (
        <WalkInSheet data={data} open={walkInOpen} onOpenChange={setWalkInOpen} />
      )}
    </>
  )
}

'use client'
import { addDays } from '@spa/core'
import { ChevronLeft, ChevronRight, Footprints, Loader2, Plus } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { rescheduleAction } from '@/app/dashboard/[tenant]/calendar/actions'
import { Button } from '@/components/ui/button'
import { Checkbox, Input, Select } from '@/components/ui/input'
import { PageBody, PageHeader } from '@/components/ui/page'
import { toast } from '@/components/ui/toast'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { Agenda } from './agenda'
import { BookingSheet } from './booking-sheet'
import { NewBookingSheet } from './new-booking-sheet'
import { type MoveTarget, ResourceGrid } from './resource-grid'
import { dateLabel, isHiddenStatus, minuteLabel } from './time'
import type { CalendarData, CalItem } from './types'
import { WalkInSheet, WalkInsPanel } from './walk-ins'

export type Draft = { startMin?: number; staffId?: string; roomId?: string }

export function CalendarView({ data }: { data: CalendarData }) {
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
      if (r?.ok) toast.success(r.message ?? 'Booking moved')
      else {
        setItems(before)
        toast.error(r?.error ?? 'Could not move the booking')
      }
    },
    [items, data.slug, data.date],
  )

  const selected = openBooking ? items.filter((i) => i.bookingId === openBooking) : []
  const isToday = data.date === data.today
  const showWalkIns = data.rotation !== null

  return (
    <>
      <PageHeader
        eyebrow={isToday ? 'Today' : undefined}
        title="Calendar"
        description={`${dateLabel(data.date)}${data.ownOnly ? ' · your bookings' : ''}`}
        actions={
          data.canManage ? (
            <>
              {showWalkIns && (
                <Button variant="secondary" onClick={() => setWalkInOpen(true)}>
                  <Footprints /> Walk-in
                </Button>
              )}
              <Button onClick={() => openNew({})}>
                <Plus /> New booking
              </Button>
            </>
          ) : null
        }
      />
      <PageBody className="space-y-5 sm:space-y-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
          <div className="flex items-center gap-1 rounded-xl border bg-surface p-1">
            <Button variant="ghost" size="icon" className="size-9" asChild>
              <Link href={href({ date: addDays(data.date, -1) })} aria-label="Previous day" scroll={false}>
                <ChevronLeft />
              </Link>
            </Button>
            <Button variant={isToday ? 'secondary' : 'ghost'} size="sm" className="h-9 px-3" asChild>
              <Link href={href({ date: data.today })} scroll={false}>
                Today
              </Link>
            </Button>
            <Button variant="ghost" size="icon" className="size-9" asChild>
              <Link href={href({ date: addDays(data.date, 1) })} aria-label="Next day" scroll={false}>
                <ChevronRight />
              </Link>
            </Button>
          </div>
          <Input
            type="date"
            aria-label="Go to date"
            value={data.date}
            onChange={(e) => e.target.value && go({ date: e.target.value })}
            className="h-11 w-auto min-w-[9.5rem] tabular"
          />
          {data.branches.length > 1 && (
            <Select
              aria-label="Branch"
              value={data.branchId}
              onChange={(e) => go({ branch: e.target.value })}
              className="h-11 w-auto min-w-40"
            >
              {data.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
          {navPending && <Loader2 className="size-4 animate-spin text-muted" aria-label="Loading" />}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 sm:ms-auto">
            {!data.ownOnly && (
              <fieldset className="hidden items-center rounded-xl border bg-surface p-1 md:flex">
                <legend className="sr-only">Calendar columns</legend>
                {(['staff', 'rooms'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={cn(
                      'relative h-9 rounded-lg px-3.5 text-sm font-medium transition-colors',
                      view === v ? 'text-fg' : 'text-muted hover:text-fg',
                    )}
                  >
                    {view === v && (
                      <motion.span
                        layoutId="cal-view"
                        transition={spring}
                        className="absolute inset-0 rounded-lg bg-subtle"
                      />
                    )}
                    <span className="relative">{v === 'staff' ? 'Therapists' : 'Rooms'}</span>
                  </button>
                ))}
              </fieldset>
            )}
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-muted">
              <Checkbox checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
              Show cancelled{hiddenCount ? ` (${hiddenCount})` : ''}
            </label>
          </div>
        </div>

        <div className={cn('grid gap-6', showWalkIns && 'xl:grid-cols-[minmax(0,1fr)_17.5rem]')}>
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

'use client'
import {
  DndContext,
  type DragEndEvent,
  type Modifier,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { CheckCircle2, Clock } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { enumLabel } from '@spa/core/i18n'
import { useT } from '@/i18n/client'
import { cn } from '@/lib/utils'
import { minuteLabel } from './time'
import type { CalendarData, CalItem } from './types'

/** Pixels per minute: 72 px per hour, 18 px per 15-minute row. */
const PPM = 1.2
const STEP = 15
const ROW = STEP * PPM

export type MoveTarget = { startMin: number; staffIds?: string[]; roomId?: string }

type Col = { id: string; name: string; color?: string; shifts?: { start: number; end: number }[] }

const snapY: Modifier = ({ transform }) => ({ ...transform, y: Math.round(transform.y / ROW) * ROW })

/** Live "now" in grid minutes (client only, to avoid hydration drift). */
function useNowMinute(dayStartMs: number) {
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => {
    const tick = () => setNow((Date.now() - dayStartMs) / 60_000)
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [dayStartMs])
  return now
}

/** Side-by-side lanes for overlapping blocks within one column. */
function layoutLanes(list: CalItem[]) {
  const out = new Map<string, { lane: number; lanes: number }>()
  const sorted = [...list].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin)
  let cluster: string[] = []
  let laneEnds: number[] = []
  let clusterEnd = Number.NEGATIVE_INFINITY
  const flush = () => {
    for (const id of cluster) out.get(id)!.lanes = laneEnds.length
    cluster = []
    laneEnds = []
    clusterEnd = Number.NEGATIVE_INFINITY
  }
  for (const it of sorted) {
    if (it.startMin >= clusterEnd) flush()
    let lane = laneEnds.findIndex((end) => end <= it.startMin)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(it.endMin)
    } else laneEnds[lane] = it.endMin
    out.set(it.id, { lane, lanes: 1 })
    cluster.push(it.id)
    clusterEnd = Math.max(clusterEnd, it.endMin)
  }
  flush()
  return out
}

/** Block colours: therapist colour, styled by status. */
export function blockStyle(status: CalItem['status'], color: string): React.CSSProperties {
  const c = { '--c': color } as React.CSSProperties
  switch (status) {
    case 'pending':
      return {
        ...c,
        background: 'color-mix(in oklab, var(--c) 7%, var(--surface))',
        borderColor: 'color-mix(in oklab, var(--c) 65%, var(--surface))',
        borderStyle: 'dashed',
      }
    case 'confirmed':
      return {
        ...c,
        background: 'color-mix(in oklab, var(--c) 15%, var(--surface))',
        borderColor: 'color-mix(in oklab, var(--c) 35%, var(--surface))',
        borderInlineStartColor: 'var(--c)',
        borderInlineStartWidth: 3,
      }
    case 'checked_in':
    case 'in_service':
      return {
        ...c,
        background: 'var(--accent-soft)',
        borderColor: 'var(--accent)',
        borderInlineStartWidth: 3,
      }
    case 'completed':
      return { ...c, background: 'var(--subtle)', borderColor: 'var(--border)', color: 'var(--muted)' }
    default:
      return {
        ...c,
        background: 'var(--surface)',
        borderColor: 'var(--border)',
        borderStyle: 'dashed',
        color: 'var(--muted)',
        opacity: 0.75,
      }
  }
}

export function ResourceGrid({
  data,
  view,
  items,
  onSlot,
  onOpen,
  onMove,
}: {
  data: CalendarData
  view: 'staff' | 'rooms'
  items: CalItem[]
  onSlot: (colId: string, startMin: number) => void
  onOpen: (bookingId: string) => void
  onMove: (item: CalItem, to: MoveTarget) => void
}) {
  const t = useT()
  const { gridStart, gridEnd } = data
  const height = (gridEnd - gridStart) * PPM
  const now = useNowMinute(data.dayStartMs)
  const nowVisible = now !== null && now >= gridStart && now <= gridEnd
  const scroller = useRef<HTMLDivElement>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const cols: Col[] = view === 'staff' ? data.staff : data.rooms
  const byCol = useMemo(() => {
    const map = new Map<string, CalItem[]>()
    for (const c of cols) map.set(c.id, [])
    for (const it of items) {
      const keys = view === 'staff' ? it.staffIds : it.roomId ? [it.roomId] : []
      for (const k of keys) map.get(k)?.push(it)
    }
    return map
  }, [cols, items, view])

  // Open the day scrolled to "now" (or the first booking).
  const scrolled = useRef('')
  useEffect(() => {
    const el = scroller.current
    const key = `${data.date}:${data.branchId}`
    if (!el || scrolled.current === key) return
    if (now === null && data.date === data.today) return
    scrolled.current = key
    const target = nowVisible ? now! : (items[0]?.startMin ?? gridStart)
    el.scrollTop = Math.max(0, (target - gridStart) * PPM - 96)
  }, [data.date, data.branchId, data.today, now, nowVisible, items, gridStart])

  const hours: number[] = []
  for (let m = gridStart; m <= gridEnd; m += 60) hours.push(m)

  const onDragEnd = ({ active, over, delta }: DragEndEvent) => {
    const { itemId, colId } = active.data.current as { itemId: string; colId: string }
    const item = items.find((i) => i.id === itemId)
    if (!item) return
    const dm = Math.round(delta.y / ROW) * STEP
    const target = (over?.id as string | undefined) ?? colId
    if (dm === 0 && target === colId) return
    const dur = item.endMin - item.startMin
    const startMin = Math.min(Math.max(item.startMin + dm, gridStart), gridEnd - Math.min(dur, STEP))
    if (view === 'staff') {
      const staffIds = item.staffIds.map((id) => (id === colId ? target : id))
      if (new Set(staffIds).size !== staffIds.length) return
      onMove(item, { startMin, staffIds: target === colId ? undefined : staffIds })
    } else {
      onMove(item, { startMin, roomId: target === colId ? undefined : target })
    }
  }

  if (cols.length === 0) {
    return (
      <div className="rounded-xl border bg-surface px-6 py-14 text-center">
        <p className="text-[15px] font-medium">
          {view === 'staff' ? t('calendar.grid.noTherapists') : t('calendar.grid.noRooms')}
        </p>
        <p className="mt-1 text-sm text-muted">
          {data.ownOnly
            ? t('calendar.grid.notLinked')
            : view === 'staff'
              ? t('calendar.grid.addTherapists')
              : t('calendar.grid.addRooms')}
        </p>
      </div>
    )
  }

  return (
    <DndContext id="calendar-dnd" sensors={sensors} modifiers={[snapY]} onDragEnd={onDragEnd}>
      <div
        ref={scroller}
        className="relative max-h-[calc(100dvh-15rem)] min-h-[440px] overflow-auto overscroll-contain rounded-xl border bg-surface"
      >
        <div
          className="grid"
          style={{
            gridTemplateColumns: `64px repeat(${cols.length}, minmax(168px, 1fr))`,
            minWidth: 64 + cols.length * 168,
          }}
        >
          {/* Header row */}
          <div className="sticky start-0 top-0 z-40 border-b bg-surface" />
          {cols.map((c) => {
            const count = (byCol.get(c.id) ?? []).filter(
              (i) => i.status !== 'cancelled' && i.status !== 'no_show',
            ).length
            return (
              <div
                key={c.id}
                className="sticky top-0 z-30 flex min-w-0 items-center gap-2.5 border-s border-b bg-surface/95 px-3.5 py-3 backdrop-blur"
              >
                {c.color && (
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{c.name}</span>
                  <span className="block text-xs text-muted tabular">
                    {t('calendar.grid.bookings', { count })}
                  </span>
                </span>
              </div>
            )
          })}

          {/* Time axis */}
          <div className="sticky start-0 z-20 border-e bg-surface" style={{ height }}>
            {hours.map((m, i) => (
              <span
                key={m}
                className={cn(
                  'absolute end-2.5 text-[11px] text-muted tabular',
                  i === 0 ? 'translate-y-1' : '-translate-y-1/2',
                  (m === gridEnd || (nowVisible && Math.abs(now! - m) < 14)) && 'hidden',
                )}
                style={{ top: (m - gridStart) * PPM }}
              >
                {minuteLabel(m)}
              </span>
            ))}
            {nowVisible && (
              <span
                className="absolute end-1 z-10 -translate-y-1/2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-fg tabular"
                style={{ top: (now! - gridStart) * PPM }}
              >
                {minuteLabel(now!)}
              </span>
            )}
          </div>

          {cols.map((c) => (
            <Column
              key={c.id}
              col={c}
              view={view}
              data={data}
              items={byCol.get(c.id) ?? []}
              height={height}
              now={nowVisible ? now : null}
              onSlot={onSlot}
              onOpen={onOpen}
            />
          ))}
        </div>
      </div>
    </DndContext>
  )
}

function Column({
  col,
  view,
  data,
  items,
  height,
  now,
  onSlot,
  onOpen,
}: {
  col: Col
  view: 'staff' | 'rooms'
  data: CalendarData
  items: CalItem[]
  height: number
  now: number | null
  onSlot: (colId: string, startMin: number) => void
  onOpen: (bookingId: string) => void
}) {
  const t = useT()
  const { gridStart, gridEnd } = data
  const { setNodeRef, isOver } = useDroppable({ id: col.id })
  const lanes = useMemo(() => layoutLanes(items), [items])
  const slots: number[] = []
  if (data.canManage) for (let m = gridStart; m < gridEnd; m += STEP) slots.push(m)
  const tinted = view === 'staff' && col.shifts !== undefined

  return (
    // biome-ignore lint/a11y/useSemanticElements: a labelled group of slot buttons and booking blocks
    <div
      ref={setNodeRef}
      role="group"
      aria-label={col.name}
      className={cn(
        'relative border-s transition-colors',
        tinted &&
          'bg-[repeating-linear-gradient(135deg,var(--subtle)_0_7px,color-mix(in_oklab,var(--border)_55%,var(--subtle))_7px_8px)]',
        isOver && 'bg-accent-soft/40',
      )}
      style={{ height }}
    >
      {tinted &&
        col.shifts!.map((s) => {
          const top = Math.max(s.start, gridStart)
          const bottom = Math.min(s.end, gridEnd)
          if (bottom <= top) return null
          return (
            <div
              key={`${s.start}-${s.end}`}
              className={cn('absolute inset-x-0 bg-surface', isOver && 'bg-accent-soft/40')}
              style={{ top: (top - gridStart) * PPM, height: (bottom - top) * PPM }}
            />
          )
        })}
      {/* Hour and quarter-hour rules */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to bottom, var(--border) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in oklab, var(--border) 45%, transparent) 1px, transparent 1px)',
          backgroundSize: `100% ${60 * PPM}px, 100% ${ROW}px`,
        }}
      />
      {slots.map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onSlot(col.id, m)}
          aria-label={t(view === 'staff' ? 'calendar.grid.newWith' : 'calendar.grid.newIn', {
            name: col.name,
            time: minuteLabel(m),
          })}
          className="group absolute inset-x-1 z-[1] flex items-center rounded-md px-2 text-[11px] font-medium text-accent opacity-0 transition-opacity duration-150 hover:bg-accent-soft hover:opacity-100 focus-visible:bg-accent-soft focus-visible:opacity-100"
          style={{ top: (m - gridStart) * PPM + 1, height: ROW - 2 }}
        >
          + {minuteLabel(m)}
        </button>
      ))}
      {items.map((it) => {
        const l = lanes.get(it.id) ?? { lane: 0, lanes: 1 }
        const color =
          data.staffNames[view === 'staff' ? col.id : (it.staffIds[0] ?? '')]?.color ?? 'var(--accent)'
        return (
          <Block
            key={it.id}
            item={it}
            colId={col.id}
            color={color}
            lane={l.lane}
            lanes={l.lanes}
            gridStart={gridStart}
            canDrag={
              data.canManage && !['completed', 'cancelled', 'no_show'].includes(it.status) && !data.ownOnly
            }
            subtitle={
              view === 'staff'
                ? (data.rooms.find((r) => r.id === it.roomId)?.name ?? '')
                : it.staffIds.map((id) => data.staffNames[id]?.name ?? '').join(' & ')
            }
            onOpen={onOpen}
          />
        )
      })}
      {now !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-[5] h-px bg-accent"
          style={{ top: (now - gridStart) * PPM }}
        />
      )}
    </div>
  )
}

function Block({
  item,
  colId,
  color,
  lane,
  lanes,
  gridStart,
  canDrag,
  subtitle,
  onOpen,
}: {
  item: CalItem
  colId: string
  color: string
  lane: number
  lanes: number
  gridStart: number
  canDrag: boolean
  subtitle: string
  onOpen: (bookingId: string) => void
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `${item.id}:${colId}`,
    data: { itemId: item.id, colId },
    disabled: !canDrag,
  })
  const height = Math.max((item.endMin - item.startMin) * PPM - 2, 22)
  const compact = height < 44
  const dy = transform ? Math.round(transform.y / PPM) : 0
  const struck = item.status === 'cancelled' || item.status === 'no_show'
  return (
    <div
      ref={setNodeRef}
      className={cn('absolute z-[3]', isDragging && 'z-50')}
      style={{
        top: (item.startMin - gridStart) * PPM + 1,
        height,
        insetInlineStart: `calc(${(lane / lanes) * 100}% + 4px)`,
        width: `calc(${100 / lanes}% - 8px)`,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
      }}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-roledescription={canDrag ? t('calendar.grid.draggable') : undefined}
        onClick={() => onOpen(item.bookingId)}
        className={cn(
          'flex size-full flex-col overflow-hidden rounded-lg border px-2.5 text-start text-fg transition-[box-shadow,transform] duration-150 ease-[var(--ease-calm)] hover:-translate-y-px hover:shadow-soft',
          compact ? 'justify-center py-0.5' : 'py-1.5',
          canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          isDragging && 'scale-[1.02] shadow-pop',
        )}
        style={blockStyle(item.status, color)}
      >
        <span className="flex items-center gap-1.5 text-[11px] text-muted tabular">
          {isDragging ? (
            <span className="font-semibold text-accent">→ {minuteLabel(item.startMin + dy)}</span>
          ) : (
            <span>
              {minuteLabel(item.startMin)}–{minuteLabel(item.endMin)}
            </span>
          )}
          {item.status === 'in_service' && (
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:hidden" />
              <span className="relative inline-flex size-1.5 rounded-full bg-accent" />
            </span>
          )}
          {item.status === 'completed' && <CheckCircle2 className="size-3" strokeWidth={1.75} />}
          {item.status === 'pending' && <Clock className="size-3" strokeWidth={1.75} />}
          {compact && (
            <span className={cn('truncate font-medium text-fg', struck && 'line-through')}>
              {item.clientName ?? t('calendar.walkIn')}
            </span>
          )}
        </span>
        {!compact && (
          <>
            <span className={cn('truncate text-[13px] font-medium leading-5', struck && 'line-through')}>
              {item.clientName ?? t('calendar.walkIn')}
            </span>
            <span className="truncate text-xs text-muted">
              {item.serviceName}
              {subtitle ? ` · ${subtitle}` : ''}
            </span>
            {item.status !== 'confirmed' && height > 80 && (
              <span className="mt-auto text-[11px] font-medium text-muted">{enumLabel(t, 'bookingStatus', item.status)}</span>
            )}
          </>
        )}
      </button>
    </div>
  )
}

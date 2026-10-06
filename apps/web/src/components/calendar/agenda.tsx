'use client'
import { CalendarX2 } from 'lucide-react'
import { motion } from 'motion/react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { minuteLabel, STATUS_LABEL, STATUS_TONE } from './time'
import type { CalendarData, CalItem } from './types'

/** Phone view: an agenda per therapist, tabs to filter, swipe left/right to change day. */
export function Agenda({
  data,
  items,
  onOpen,
  onPrev,
  onNext,
}: {
  data: CalendarData
  items: CalItem[]
  onOpen: (bookingId: string) => void
  onPrev: () => void
  onNext: () => void
}) {
  const [tab, setTab] = useState<string>('all')
  const people = data.staff
  const shown = tab === 'all' ? people : people.filter((p) => p.id === tab)
  const unassigned = items.filter((i) => !i.staffIds.some((id) => people.some((p) => p.id === id)))

  return (
    <div className="space-y-4">
      {people.length > 1 && (
        <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none]">
          <div className="flex w-max gap-1.5" role="tablist" aria-label="Therapists">
            {[{ id: 'all', name: 'Everyone', color: '' }, ...people].map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={tab === p.id}
                onClick={() => setTab(p.id)}
                className={cn(
                  'relative flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors',
                  tab === p.id ? 'border-transparent text-accent' : 'bg-surface text-muted',
                )}
              >
                {tab === p.id && (
                  <motion.span
                    layoutId="agenda-tab"
                    transition={spring}
                    className="absolute inset-0 rounded-full bg-accent-soft"
                  />
                )}
                {p.color && <span className="relative size-2 rounded-full" style={{ background: p.color }} />}
                <span className="relative">{p.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <motion.div
        key={`${data.date}:${tab}`}
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.18}
        dragDirectionLock
        onDragEnd={(_, info) => {
          if (info.offset.x < -90) onNext()
          else if (info.offset.x > 90) onPrev()
        }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-4"
      >
        {shown.length === 0 && (
          <div className="rounded-xl border bg-surface px-6 py-12 text-center text-sm text-muted">
            {data.ownOnly
              ? 'Your login isn’t linked to a staff profile yet. Ask a manager to link it.'
              : 'No therapists to show.'}
          </div>
        )}
        {shown.map((p) => {
          const list = items.filter((i) => i.staffIds.includes(p.id))
          const onShift = p.shifts.filter((s) => s.end > data.gridStart && s.start < data.gridEnd)
          return (
            <section key={p.id} className="overflow-hidden rounded-xl border bg-surface">
              <header className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: p.color }} />
                  <span className="truncate text-[15px] font-medium">{p.name}</span>
                </span>
                <span className="text-xs text-muted tabular">
                  {onShift.length
                    ? onShift.map((s) => `${minuteLabel(s.start)}–${minuteLabel(s.end)}`).join(', ')
                    : 'Off'}
                </span>
              </header>
              {list.length === 0 ? (
                <p className="flex items-center gap-2 px-4 py-5 text-sm text-muted">
                  <CalendarX2 className="size-4" strokeWidth={1.5} /> No bookings
                </p>
              ) : (
                <ul className="divide-y">
                  {list.map((it) => (
                    <AgendaRow key={it.id} item={it} color={p.color} data={data} onOpen={onOpen} />
                  ))}
                </ul>
              )}
            </section>
          )
        })}
        {tab === 'all' && unassigned.length > 0 && (
          <section className="overflow-hidden rounded-xl border bg-surface">
            <header className="border-b px-4 py-3 text-[15px] font-medium">Unassigned</header>
            <ul className="divide-y">
              {unassigned.map((it) => (
                <AgendaRow key={it.id} item={it} color="var(--accent)" data={data} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        )}
        <p className="text-center text-xs text-muted">Swipe sideways to change day</p>
      </motion.div>
    </div>
  )
}

function AgendaRow({
  item,
  color,
  data,
  onOpen,
}: {
  item: CalItem
  color: string
  data: CalendarData
  onOpen: (bookingId: string) => void
}) {
  const room = data.rooms.find((r) => r.id === item.roomId)?.name
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.bookingId)}
        className="flex min-h-16 w-full items-stretch gap-3 px-4 py-3 text-start transition-colors active:bg-subtle"
      >
        <span className="w-12 shrink-0 pt-0.5 text-sm font-medium tabular">
          {minuteLabel(item.startMin)}
          <span className="block text-xs font-normal text-muted">{minuteLabel(item.endMin)}</span>
        </span>
        <span
          className={cn(
            'w-1 shrink-0 rounded-full',
            item.status === 'pending' && 'opacity-40',
            (item.status === 'completed' || item.status === 'cancelled' || item.status === 'no_show') &&
              'opacity-25',
          )}
          style={{
            background:
              item.status === 'checked_in' || item.status === 'in_service' ? 'var(--accent)' : color,
          }}
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              'block truncate text-[15px] font-medium',
              (item.status === 'cancelled' || item.status === 'no_show') && 'text-muted line-through',
            )}
          >
            {item.clientName ?? 'Walk-in'}
          </span>
          <span className="block truncate text-sm text-muted">
            {item.serviceName}
            {room ? ` · ${room}` : ''}
          </span>
        </span>
        {item.status !== 'confirmed' && (
          <Badge tone={STATUS_TONE[item.status]} className="self-center">
            {STATUS_LABEL[item.status]}
          </Badge>
        )}
      </button>
    </li>
  )
}

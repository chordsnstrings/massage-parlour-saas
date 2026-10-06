'use client'
import {
  CalendarDays,
  CheckCheck,
  Clock,
  ExternalLink,
  Inbox,
  Keyboard,
  Send,
  ShieldCheck,
  SkipForward,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { markMessageAction } from '@/app/dashboard/[tenant]/messages/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { NumberTicker } from '@/components/ui/motion'
import { EmptyState, PageBody } from '@/components/ui/page'
import { toast } from '@/components/ui/toast'
import { duration, ease, spring } from '@/lib/motion'
import { cn, formatDateTime, initials } from '@/lib/utils'
import { KIND_LABEL, KIND_TONE, type OutboxRow, WA_MODE_KEY, WA_MODES, type WaMode } from './shared'

type Tab = 'due' | 'scheduled' | 'sent'
type Counts = { due: number; scheduled: number; sentToday: number; sentWeek: number }

const TAB_LABEL: Record<Tab, string> = { due: 'Due now', scheduled: 'Scheduled', sent: 'Sent' }

const EMPTY: Record<Tab, { title: string; description: string; icon: React.ReactNode }> = {
  due: {
    title: 'All caught up',
    description: 'Nothing is waiting to be sent. Confirmations and reminders land here when they’re due.',
    icon: <CheckCheck className="size-5" strokeWidth={1.5} />,
  },
  scheduled: {
    title: 'Nothing scheduled',
    description: 'Reminders for upcoming bookings wait here until it’s time to send them.',
    icon: <Clock className="size-5" strokeWidth={1.5} />,
  },
  sent: {
    title: 'No messages sent this week',
    description: 'Everything you mark as sent shows up here for seven days.',
    icon: <Inbox className="size-5" strokeWidth={1.5} />,
  },
}

/** Reads the per-device send mode; phones default to the wa.me link. */
function useSendMode() {
  const [mode, setMode] = useState<WaMode>('web')
  useEffect(() => {
    let stored: string | null = null
    try {
      stored = window.localStorage.getItem(WA_MODE_KEY)
    } catch {}
    if (stored === 'web' || stored === 'desktop' || stored === 'mobile') setMode(stored)
    else if (window.matchMedia?.('(pointer: coarse)').matches) setMode('mobile')
  }, [])
  const update = useCallback((next: WaMode) => {
    setMode(next)
    try {
      window.localStorage.setItem(WA_MODE_KEY, next)
    } catch {}
  }, [])
  return [mode, update] as const
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement &&
  (el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    el.closest('[role=dialog]'))

export function OutboxQueue({
  slug,
  tab,
  base,
  rows,
  counts,
}: {
  slug: string
  tab: Tab
  base: string
  rows: OutboxRow[]
  counts: Counts
}) {
  const [mode, setMode] = useSendMode()
  // Optimistic state: rows handled here disappear at once; the server refresh then catches up.
  const [handled, setHandled] = useState<Map<string, 'sent' | 'skipped'>>(new Map())
  const [opened, setOpened] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(rows[0]?.id ?? null)
  const [, startTransition] = useTransition()
  const listRef = useRef<HTMLOListElement>(null)

  const visible = useMemo(() => rows.filter((r) => !handled.has(r.id)), [rows, handled])
  const pendingSent = rows.filter((r) => handled.get(r.id) === 'sent').length
  const pendingGone = rows.length - visible.length
  const live: Counts = {
    due: Math.max(0, counts.due - (tab === 'due' ? pendingGone : 0)),
    scheduled: Math.max(0, counts.scheduled - (tab === 'scheduled' ? pendingGone : 0)),
    sentToday: counts.sentToday + pendingSent,
    sentWeek: counts.sentWeek + pendingSent,
  }
  const readOnly = tab === 'sent'
  const selectedIndex = Math.max(
    0,
    visible.findIndex((r) => r.id === selectedId),
  )
  const selected = visible[selectedIndex] ?? null

  const select = useCallback(
    (index: number) => {
      const row = visible[Math.min(Math.max(index, 0), visible.length - 1)]
      if (!row) return
      setSelectedId(row.id)
      listRef.current
        ?.querySelector(`[data-id="${row.id}"]`)
        ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    },
    [visible],
  )

  const open = useCallback(
    (row: OutboxRow) => {
      const url = row.links[mode]
      // Desktop app links are handled by the OS; web/phone links reuse one named tab.
      if (mode === 'desktop') window.location.href = url
      else window.open(url, 'wa-send')
      setSelectedId(row.id)
      if (row.status === 'queued' && !opened.has(row.id)) {
        setOpened((s) => new Set(s).add(row.id))
        startTransition(async () => {
          const res = await markMessageAction(slug, { id: row.id, status: 'opened' })
          if (res && !res.ok) toast.error(res.error)
        })
      }
    },
    [mode, opened, slug],
  )

  const finish = useCallback(
    (row: OutboxRow, status: 'sent' | 'skipped') => {
      const index = visible.findIndex((r) => r.id === row.id)
      const next = visible[index + 1] ?? visible[index - 1]
      setHandled((m) => new Map(m).set(row.id, status))
      if (selectedId === row.id) setSelectedId(next?.id ?? null)
      startTransition(async () => {
        const res = await markMessageAction(slug, { id: row.id, status })
        if (res?.ok) {
          if (res.message) toast.success(`${res.message} · ${row.clientName}`)
        } else {
          toast.error(res?.error ?? 'Something went wrong')
          setHandled((m) => {
            const copy = new Map(m)
            copy.delete(row.id)
            return copy
          })
        }
      })
    },
    [visible, selectedId, slug],
  )

  useEffect(() => {
    if (readOnly) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      const key = e.key.toLowerCase()
      if (key === 'j' || e.key === 'ArrowDown') select(selectedIndex + 1)
      else if (key === 'k' || e.key === 'ArrowUp') select(selectedIndex - 1)
      else if (e.key === 'Enter' && selected) {
        if (e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement) return
        open(selected)
      } else if (key === 's' && selected) finish(selected, 'sent')
      else if (key === 'x' && selected) finish(selected, 'skipped')
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [readOnly, select, selectedIndex, selected, open, finish])

  return (
    <PageBody>
      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <Counter label="Due now" value={live.due} highlight={live.due > 0} />
        <Counter label="Scheduled" value={live.scheduled} />
        <Counter label="Sent today" value={live.sentToday} />
      </div>

      <div className="flex flex-col-reverse gap-2 border-b sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <nav className="-mb-px flex gap-6 overflow-x-auto text-sm" aria-label="Messages">
          {(['due', 'scheduled', 'sent'] as const).map((t) => {
            const n = t === 'due' ? live.due : t === 'scheduled' ? live.scheduled : live.sentWeek
            return (
              <Link
                key={t}
                href={t === 'due' ? base : `${base}?tab=${t}`}
                aria-current={tab === t ? 'page' : undefined}
                className={cn(
                  'relative flex h-11 shrink-0 items-center gap-2 transition-colors',
                  tab === t ? 'font-medium text-fg' : 'text-muted hover:text-fg',
                )}
              >
                {TAB_LABEL[t]}
                <span className="tabular rounded-full bg-subtle px-2 py-0.5 text-xs text-muted">{n}</span>
                {tab === t && (
                  <motion.span
                    layoutId="messages-tab"
                    transition={spring}
                    className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-fg"
                  />
                )}
              </Link>
            )
          })}
        </nav>
        {!readOnly && <ModePicker mode={mode} onChange={setMode} />}
      </div>

      <div className="grid gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="min-w-0 lg:col-span-8">
          {visible.length === 0 ? (
            <Card>
              <EmptyState {...EMPTY[tab]} />
            </Card>
          ) : (
            <ol ref={listRef} className="space-y-3" aria-label={TAB_LABEL[tab]}>
              <AnimatePresence initial={false}>
                {visible.map((row, i) => (
                  <motion.li
                    key={row.id}
                    data-id={row.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{
                      opacity: 1,
                      y: 0,
                      transition: { duration: duration.layout, ease, delay: Math.min(i, 8) * 0.03 },
                    }}
                    exit={{ opacity: 0, x: -16, transition: { duration: duration.base, ease } }}
                  >
                    <MessageCard
                      row={row}
                      mode={mode}
                      readOnly={readOnly}
                      selected={!readOnly && selected?.id === row.id}
                      opened={row.status === 'opened' || opened.has(row.id)}
                      onSelect={() => setSelectedId(row.id)}
                      onOpen={() => open(row)}
                      onSent={() => finish(row, 'sent')}
                      onSkip={() => finish(row, 'skipped')}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ol>
          )}
        </div>

        <aside className="space-y-4 lg:col-span-4">
          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent">
                <ShieldCheck className="size-4" strokeWidth={1.75} />
              </span>
              <h2 className="text-[15px] font-semibold tracking-tight">Send responsibly</h2>
            </div>
            <ul className="mt-4 space-y-2.5 text-sm text-muted">
              <li>Only message clients who have booked or visited.</li>
              <li>
                Never use auto-senders, bulk tools or WhatsApp Web bots — WhatsApp bans numbers that do. A
                person presses send, every time.
              </li>
              <li>
                Keep a human pace. Sent today:{' '}
                <span className="tabular font-medium text-fg">{live.sentToday}</span>
              </li>
            </ul>
          </Card>
          {!readOnly && (
            <Card className="hidden p-5 sm:p-6 lg:block">
              <div className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
                <Keyboard className="size-4 text-muted" strokeWidth={1.5} /> Keyboard
              </div>
              <dl className="mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-sm">
                {[
                  [['J', 'K'], 'Next / previous'],
                  [['Enter'], 'Open in WhatsApp'],
                  [['S'], 'Mark sent'],
                  [['X'], 'Skip'],
                ].map(([keys, label]) => (
                  <div key={String(label)} className="contents">
                    <dt className="flex gap-1">
                      {(keys as string[]).map((k) => (
                        <kbd
                          key={k}
                          className="min-w-6 rounded-md border bg-subtle px-1.5 py-0.5 text-center font-sans text-xs text-fg"
                        >
                          {k}
                        </kbd>
                      ))}
                    </dt>
                    <dd className="text-muted">{label as string}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </aside>
      </div>
    </PageBody>
  )
}

function Counter({ label, value, highlight }: { label: string; value: number; highlight?: boolean }) {
  return (
    <Card className="px-3.5 py-4 transition-[transform,box-shadow] duration-200 hover:-translate-y-0.5 hover:shadow-soft sm:p-6">
      <p className="text-xs font-medium text-muted sm:uppercase sm:tracking-[0.06em]">{label}</p>
      <p
        className={cn(
          'mt-2 text-xl font-semibold tracking-tight sm:mt-3 sm:text-[26px]',
          highlight && 'text-accent',
        )}
      >
        <NumberTicker value={value} />
      </p>
    </Card>
  )
}

function ModePicker({ mode, onChange }: { mode: WaMode; onChange: (m: WaMode) => void }) {
  return (
    <fieldset className="grid grid-cols-3 rounded-lg border bg-subtle/60 p-0.5 sm:mb-3 sm:inline-flex">
      <legend className="sr-only">Send with</legend>
      {WA_MODES.map((m) => (
        <button
          key={m.key}
          type="button"
          aria-pressed={mode === m.key}
          title={m.hint}
          onClick={() => onChange(m.key)}
          className={cn(
            'relative h-10 whitespace-nowrap rounded-md px-2 text-[13px] transition-colors sm:h-9 sm:px-3',
            mode === m.key ? 'text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {mode === m.key && (
            <motion.span
              layoutId="wa-mode"
              transition={spring}
              className="absolute inset-0 rounded-md border bg-surface shadow-[0_1px_0_rgb(0_0_0/0.04)]"
            />
          )}
          <span className="relative">{m.label}</span>
        </button>
      ))}
    </fieldset>
  )
}

function MessageCard({
  row,
  mode,
  readOnly,
  selected,
  opened,
  onSelect,
  onOpen,
  onSent,
  onSkip,
}: {
  row: OutboxRow
  mode: WaMode
  readOnly: boolean
  selected: boolean
  opened: boolean
  onSelect: () => void
  onOpen: () => void
  onSent: () => void
  onSkip: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const long = row.text.length > 160 || row.text.split('\n').length > 3
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled globally (J/K)
    <article
      onClick={onSelect}
      aria-label={`${KIND_LABEL[row.kind]} for ${row.clientName}`}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'rounded-xl border bg-surface transition-[border-color,box-shadow,transform] duration-200',
        selected ? 'border-accent/50 ring-4 ring-accent/10' : 'hover:-translate-y-0.5 hover:shadow-soft',
      )}
    >
      <div className="flex items-start gap-3 px-4 pt-4 sm:gap-4 sm:px-6 sm:pt-5">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
          {initials(row.clientName)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="truncate text-[15px] font-medium">{row.clientName}</h3>
            <Badge tone={KIND_TONE[row.kind]}>{KIND_LABEL[row.kind]}</Badge>
            {opened && !readOnly && <Badge tone="warning">Opened</Badge>}
          </div>
          <p className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted">
            <span className="tabular">{row.phone}</span>
            {!readOnly && <span className="sm:hidden">Due {formatDateTime(row.dueAt)}</span>}
            {row.bookingAt && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="size-3.5" strokeWidth={1.5} /> {formatDateTime(row.bookingAt)}
              </span>
            )}
          </p>
        </div>
        <p className="hidden shrink-0 text-end text-xs text-muted sm:block">
          {readOnly ? 'Sent' : 'Due'}
          <span className="tabular block text-[13px] text-fg">
            {formatDateTime(readOnly ? (row.sentAt ?? row.dueAt) : row.dueAt)}
          </span>
        </p>
      </div>

      <div className="px-4 pt-3 sm:ps-20 sm:pe-6">
        <div
          className={cn(
            'whitespace-pre-wrap rounded-xl rounded-ss-sm bg-subtle px-4 py-3 text-sm leading-relaxed',
            !expanded && long && 'line-clamp-3',
          )}
          dir="auto"
        >
          {row.text}
        </div>
        {long && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            className="mt-1.5 h-8 text-[13px] font-medium text-accent hover:underline"
          >
            {expanded ? 'Show less' : 'Show full message'}
          </button>
        )}
      </div>

      {readOnly ? (
        <p className="px-4 pt-3 pb-4 text-[13px] text-muted sm:ps-20 sm:pe-6 sm:pb-5">
          <Send className="me-1.5 inline size-3.5" strokeWidth={1.5} />
          Sent {row.sentAt ? formatDateTime(row.sentAt) : ''}
          {row.sentBy ? ` by ${row.sentBy}` : ''}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-4 pt-4 pb-4 sm:ps-20 sm:pe-6 sm:pb-5">
          <Button
            variant={opened ? 'secondary' : 'primary'}
            className="h-11 flex-1 sm:h-10 sm:flex-none"
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
          >
            <ExternalLink /> {opened ? 'Open again' : 'Open in WhatsApp'}
            <span className="sr-only"> ({WA_MODES.find((m) => m.key === mode)?.label})</span>
          </Button>
          <Button
            variant={opened ? 'primary' : 'secondary'}
            className="h-11 flex-1 sm:h-10 sm:flex-none"
            onClick={(e) => {
              e.stopPropagation()
              onSent()
            }}
          >
            <CheckCheck /> Mark sent
          </Button>
          <Button
            variant="ghost"
            className="h-11 sm:h-10"
            onClick={(e) => {
              e.stopPropagation()
              onSkip()
            }}
          >
            <SkipForward /> Skip
          </Button>
        </div>
      )}
    </article>
  )
}

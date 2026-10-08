'use client'
import { CalendarDays, CheckCheck, Clock, ExternalLink, Inbox, Keyboard, MessageCircle, ShieldCheck, SkipForward } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { markMessageAction } from '@/app/dashboard/[tenant]/messages/actions'
import { Card, Grid, Pill, Seg, Stat } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { NumberTicker } from '@/components/ui/motion'
import { EmptyState, PageBody } from '@/components/ui/page'
import { toast } from '@/components/ui/toast'
import { resultText, useI18n } from '@/i18n/client'
import { duration, ease } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { KIND_TONE, type OutboxRow, rowLabel, WA_MODE_KEY, WA_MODES, type WaMode } from './shared'

type Tab = 'due' | 'scheduled' | 'sent'
type Counts = { due: number; scheduled: number; sentToday: number; sentWeek: number }

const EMPTY_ICON: Record<Tab, React.ReactNode> = {
  due: <CheckCheck className="size-5" strokeWidth={1.5} />,
  scheduled: <Clock className="size-5" strokeWidth={1.5} />,
  sent: <Inbox className="size-5" strokeWidth={1.5} />,
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
  aside,
}: {
  slug: string
  tab: Tab
  base: string
  rows: OutboxRow[]
  counts: Counts
  /** Server-rendered side cards (campaigns, AI receptionist). */
  aside?: React.ReactNode
}) {
  const { t, fmt } = useI18n()
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
          if (res && !res.ok) toast.error(resultText(t, res) ?? t('errors.generic'))
        })
      }
    },
    [mode, opened, slug, t],
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
          if (res.message) toast.success(`${resultText(t, res)} · ${row.clientName}`)
        } else {
          toast.error((res && resultText(t, res)) || t('errors.generic'))
          setHandled((m) => {
            const copy = new Map(m)
            copy.delete(row.id)
            return copy
          })
        }
      })
    },
    [visible, selectedId, slug, t],
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

  const tabCount = { due: live.due, scheduled: live.scheduled, sent: live.sentWeek }
  const tabLabel = {
    due: t('messages.tabs.due'),
    scheduled: t('messages.tabs.scheduled'),
    sent: t('messages.tabs.sent'),
  }
  const empty = {
    due: [t('messages.empty.dueTitle'), t('messages.empty.dueBody')],
    scheduled: [t('messages.empty.scheduledTitle'), t('messages.empty.scheduledBody')],
    sent: [t('messages.empty.sentTitle'), t('messages.empty.sentBody')],
  }[tab] as [string, string]
  const keys: [string[], string][] = [
    [['J', 'K'], t('messages.keyboard.nav')],
    [['Enter'], t('messages.keyboard.open')],
    [['S'], t('messages.keyboard.sent')],
    [['X'], t('messages.keyboard.skip')],
  ]

  return (
    <PageBody>
      <Grid cols="g3">
        <Stat
          label={t('messages.stats.due')}
          value={
            <span className={cn(live.due > 0 && 'text-[var(--crm-accent)]')}>
              <NumberTicker value={live.due} />
            </span>
          }
        />
        <Stat label={t('messages.stats.scheduled')} value={<NumberTicker value={live.scheduled} />} />
        <Stat label={t('messages.stats.sentToday')} value={<NumberTicker value={live.sentToday} />} />
      </Grid>

      <Grid cols="col-2">
        <Card
          className="min-w-0"
          title={t('messages.queue.title')}
          sub={
            tab === 'due'
              ? t('messages.queue.sub')
              : tab === 'scheduled'
                ? t('messages.queue.scheduledSub')
                : t('messages.queue.sentSub')
          }
          actions={
            tab === 'due' && live.due > 0 ? (
              <Pill tone="bad">{t('messages.queue.ready', { count: fmt.number(live.due) })}</Pill>
            ) : undefined
          }
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Seg
              label={t('messages.tabs.label')}
              value={tab}
              items={(['due', 'scheduled', 'sent'] as const).map((k) => ({
                value: k,
                href: k === 'due' ? base : `${base}?tab=${k}`,
                label: (
                  <>
                    {tabLabel[k]} <span className="crm-num opacity-70">{fmt.number(tabCount[k])}</span>
                  </>
                ),
              }))}
            />
            {!readOnly && (
              <Seg
                label={t('messages.mode.label')}
                value={mode}
                onChange={(v) => setMode(v as WaMode)}
                items={WA_MODES.map((m) => ({ value: m, label: t(`messages.mode.${m}`) }))}
              />
            )}
          </div>
          {visible.length === 0 ? (
            <EmptyState icon={EMPTY_ICON[tab]} title={empty[0]} description={empty[1]} />
          ) : (
            <ol ref={listRef} aria-label={tabLabel[tab]}>
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
        </Card>

        <div className="crm-stack min-w-0">
          <Card
            title={
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="size-4 text-[var(--crm-accent)]" strokeWidth={1.75} />
                {t('messages.responsible.title')}
              </span>
            }
          >
            <ul className="crm-muted space-y-2 text-[length:var(--crm-fs-note)]">
              <li>{t('messages.responsible.onlyBooked')}</li>
              <li>{t('messages.responsible.noBots')}</li>
              <li>
                {t('messages.responsible.pace')}{' '}
                <span className="crm-num font-semibold text-[var(--crm-text)]">{fmt.number(live.sentToday)}</span>
              </li>
            </ul>
          </Card>
          {aside}
          {!readOnly && (
            <Card
              className="hidden lg:block"
              title={
                <span className="inline-flex items-center gap-2">
                  <Keyboard className="size-4 text-[var(--crm-muted)]" strokeWidth={1.5} />
                  {t('messages.keyboard.title')}
                </span>
              }
            >
              <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-[length:var(--crm-fs-note)]">
                {keys.map(([ks, label]) => (
                  <div key={label} className="contents">
                    <dt className="flex gap-1">
                      {ks.map((k) => (
                        <kbd
                          key={k}
                          className="min-w-6 rounded-md border border-[var(--crm-line)] bg-[var(--crm-surface2)] px-1.5 py-0.5 text-center font-sans text-xs"
                        >
                          {k}
                        </kbd>
                      ))}
                    </dt>
                    <dd className="crm-muted">{label}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}
        </div>
      </Grid>
    </PageBody>
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
  const { t, fmt } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const long = row.text.length > 160 || row.text.split('\n').length > 3
  const label = rowLabel(t, row)
  const when = fmt.dateTime(readOnly ? (row.sentAt ?? row.dueAt) : row.dueAt)
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard selection is handled globally (J/K)
    <article
      onClick={onSelect}
      aria-label={t('messages.card.aria', { kind: label, name: row.clientName })}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'crm-q-item transition-[border-color,box-shadow] duration-200',
        selected && 'border-[var(--crm-accent)] ring-4 ring-[var(--crm-glow)]',
      )}
    >
      <span className="crm-qi" aria-hidden>
        <MessageCircle />
      </span>
      <div className="crm-qb">
        <div className="crm-hd">
          <b className="truncate">{row.clientName}</b>
          <Pill tone={row.campaign ? 'acc' : KIND_TONE[row.kind]}>{label}</Pill>
          {opened && !readOnly && <Pill tone="warn">{t('messages.card.opened')}</Pill>}
          <span className="crm-muted ms-auto text-[length:var(--crm-fs-sub)]">
            {readOnly ? t('messages.card.sentLabel') : t('messages.card.due')}{' '}
            <span className="crm-num">{when}</span>
          </span>
        </div>
        <p className="crm-muted mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[length:var(--crm-fs-sub)]">
          <span className="crm-num" dir="ltr">
            {row.phone}
          </span>
          {row.bookingAt && (
            <span className="inline-flex items-center gap-1">
              <CalendarDays className="size-3.5" strokeWidth={1.5} /> {fmt.dateTime(row.bookingAt)}
            </span>
          )}
        </p>
        <div className={cn('crm-msg', !expanded && long && 'line-clamp-3')} dir="auto">
          {row.text}
        </div>
        {long && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((v) => !v)
            }}
            className="mt-1 h-8 text-[length:var(--crm-fs-sub)] font-semibold text-[var(--crm-accent)] hover:underline"
          >
            {expanded ? t('messages.card.showLess') : t('messages.card.showFull')}
          </button>
        )}
        {readOnly ? (
          <p className="crm-muted mt-2 text-[length:var(--crm-fs-sub)]">
            <CheckCheck className="me-1.5 inline size-3.5" strokeWidth={1.5} />
            {row.sentAt
              ? row.sentBy
                ? t('messages.card.sentBy', { time: fmt.dateTime(row.sentAt), name: row.sentBy })
                : t('messages.card.sentAt', { time: fmt.dateTime(row.sentAt) })
              : t('messages.card.sentLabel')}
          </p>
        ) : (
          <div className="crm-qa">
            <Button
              size="sm"
              variant={opened ? 'secondary' : 'primary'}
              className="flex-1 sm:flex-none"
              onClick={(e) => {
                e.stopPropagation()
                onOpen()
              }}
            >
              <ExternalLink /> {opened ? t('messages.card.openAgain') : t('messages.card.open')}
              <span className="sr-only"> ({t(`messages.mode.${mode}`)})</span>
            </Button>
            <Button
              size="sm"
              variant={opened ? 'primary' : 'secondary'}
              className="flex-1 sm:flex-none"
              onClick={(e) => {
                e.stopPropagation()
                onSent()
              }}
            >
              <CheckCheck /> {t('messages.card.markSent')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation()
                onSkip()
              }}
            >
              <SkipForward /> {t('messages.card.skip')}
            </Button>
          </div>
        )}
      </div>
    </article>
  )
}

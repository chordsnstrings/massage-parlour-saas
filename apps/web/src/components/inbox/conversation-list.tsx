import type { InboxFilter, listInbox } from '@spa/services'
import { Flag, MessageSquareText, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { displayName, MODE_LABEL, shortTime } from './format'
import { InstagramGlyph } from './icons'

type Row = Awaited<ReturnType<typeof listInbox>>[number]

export const FILTERS: { key: InboxFilter; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'flagged', label: 'Flagged' },
  { key: 'closed', label: 'Closed' },
  { key: 'all', label: 'All' },
]

export const inboxHref = (slug: string, q: { f?: InboxFilter; c?: string }) => {
  const sp = new URLSearchParams()
  if (q.f && q.f !== 'open') sp.set('f', q.f)
  if (q.c) sp.set('c', q.c)
  const s = sp.toString()
  return appPath(`/${slug}/inbox${s ? `?${s}` : ''}`)
}

/** Segmented filter (open / flagged / closed / all) with counts where they help. */
export function InboxFilters({
  slug,
  active,
  counts,
}: {
  slug: string
  active: InboxFilter
  counts: { open: number; flagged: number }
}) {
  const count = (k: InboxFilter) => (k === 'open' ? counts.open : k === 'flagged' ? counts.flagged : null)
  return (
    <nav aria-label="Filter conversations" className="flex gap-1 rounded-lg bg-subtle p-1">
      {FILTERS.map((f) => {
        const n = count(f.key)
        const on = f.key === active
        return (
          <Link
            key={f.key}
            href={inboxHref(slug, { f: f.key })}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'inline-flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[13px] font-medium transition-[background-color,color,box-shadow] duration-150',
              on ? 'bg-surface text-fg shadow-[0_1px_2px_rgb(0_0_0/0.06)]' : 'text-muted hover:text-fg',
            )}
          >
            {f.label}
            {n ? <span className="text-xs text-muted tabular-nums">{n}</span> : null}
          </Link>
        )
      })}
    </nav>
  )
}

const preview = (r: Row) => {
  if (!r.lastText) return 'No messages yet'
  const who = r.lastSender === 'bot' ? 'AI: ' : r.lastSender === 'staff' ? 'You: ' : ''
  return `${who}${r.lastText}`
}

export function ConversationList({
  slug,
  rows,
  filter,
  selectedId,
}: {
  slug: string
  rows: Row[]
  filter: InboxFilter
  selectedId?: string
}) {
  if (!rows.length)
    return (
      <p className="px-5 py-12 text-center text-sm text-muted">
        {filter === 'flagged'
          ? 'Nothing flagged. The AI flags threads it shouldn’t handle.'
          : filter === 'closed'
            ? 'No closed conversations.'
            : 'No conversations here yet.'}
      </p>
    )
  const now = new Date()
  return (
    <ul className="divide-y" data-testid="conversation-list">
      {rows.map((r) => {
        const active = r.id === selectedId
        const unread = r.unread && !active
        const name = displayName(r)
        return (
          <li key={r.id}>
            <Link
              href={inboxHref(slug, { f: filter, c: r.id })}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex min-h-[4.5rem] gap-3 px-4 py-3.5 transition-colors duration-150 sm:px-5',
                active ? 'bg-accent-soft/60' : 'hover:bg-subtle/60',
              )}
            >
              <span
                className={cn(
                  'relative grid size-10 shrink-0 place-items-center rounded-full',
                  active ? 'bg-surface text-accent' : 'bg-subtle text-muted',
                )}
              >
                {r.channel === 'instagram_comment' ? (
                  <MessageSquareText className="size-4" strokeWidth={1.5} aria-label="Comment" />
                ) : (
                  <InstagramGlyph />
                )}
              </span>
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={cn('truncate text-sm', unread ? 'font-semibold' : 'font-medium')}>
                    {name}
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    <time
                      className={cn('text-xs tabular-nums', unread ? 'text-accent' : 'text-muted')}
                      dateTime={r.lastAt.toISOString()}
                    >
                      {shortTime(r.lastAt, now)}
                    </time>
                    {unread && (
                      <span
                        className="anim-pop-in size-2 rounded-full bg-accent"
                        role="img"
                        aria-label="Unread"
                      />
                    )}
                  </span>
                </span>
                <span
                  dir="auto"
                  className={cn('block truncate text-[13px]', unread ? 'text-fg' : 'text-muted')}
                >
                  {preview(r)}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        r.mode === 'bot' ? 'bg-accent' : r.mode === 'human' ? 'bg-warning' : 'bg-border',
                      )}
                    />
                    {MODE_LABEL[r.mode]}
                  </span>
                  {r.hasDraft && (
                    <span className="inline-flex items-center gap-1 text-accent">
                      <Sparkles className="size-3" strokeWidth={1.75} /> Draft to approve
                    </span>
                  )}
                  {r.flagged && (
                    <span className="inline-flex items-center gap-1 text-danger">
                      <Flag className="size-3" strokeWidth={1.75} /> Flagged
                    </span>
                  )}
                </span>
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}

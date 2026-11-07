import type { Format } from '@spa/core/i18n/format'
import type { Translator } from '@spa/core/i18n/translate'
import type { InboxFilter, listInbox } from '@spa/services'
import { Flag, MessageSquareText, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Seg } from '@/components/crm'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { displayName, modeLabel, shortTime } from './format'
import { InstagramGlyph } from './icons'

type Row = Awaited<ReturnType<typeof listInbox>>[number]

export const FILTERS: InboxFilter[] = ['open', 'flagged', 'closed', 'all']

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
  t,
  fmt,
}: {
  slug: string
  active: InboxFilter
  counts: { open: number; flagged: number }
  t: Translator
  fmt: Format
}) {
  const count = (k: InboxFilter) => (k === 'open' ? counts.open : k === 'flagged' ? counts.flagged : null)
  return (
    <Seg
      fill
      label={t('inbox.filters.label')}
      value={active}
      items={FILTERS.map((f) => {
        const n = count(f)
        return {
          value: f,
          href: inboxHref(slug, { f }),
          label: (
            <>
              {t(`inbox.filters.${f}`)}
              {n ? <span className="crm-num opacity-70">{fmt.number(n)}</span> : null}
            </>
          ),
        }
      })}
    />
  )
}

const preview = (t: Translator, r: Row) => {
  if (!r.lastText) return t('inbox.list.noMessages')
  if (r.lastSender === 'bot') return t('inbox.list.ai', { text: r.lastText })
  if (r.lastSender === 'staff') return t('inbox.list.you', { text: r.lastText })
  return r.lastText
}

export function ConversationList({
  slug,
  rows,
  filter,
  selectedId,
  t,
  fmt,
}: {
  slug: string
  rows: Row[]
  filter: InboxFilter
  selectedId?: string
  t: Translator
  fmt: Format
}) {
  if (!rows.length)
    return (
      <p className="crm-muted px-5 py-12 text-center text-[length:var(--crm-fs-note)]">
        {filter === 'flagged'
          ? t('inbox.list.emptyFlagged')
          : filter === 'closed'
            ? t('inbox.list.emptyClosed')
            : t('inbox.list.emptyAll')}
      </p>
    )
  const now = new Date()
  return (
    <ul className="divide-y divide-[var(--crm-line)]" data-testid="conversation-list">
      {rows.map((r) => {
        const active = r.id === selectedId
        const unread = r.unread && !active
        const name = displayName(t, r)
        return (
          <li key={r.id}>
            <Link
              href={inboxHref(slug, { f: filter, c: r.id })}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex min-h-[4.5rem] gap-3 px-4 py-3.5 transition-colors duration-150 sm:px-5',
                active ? 'bg-[var(--crm-info-bg)]' : 'hover:bg-[var(--crm-surface2)]',
              )}
            >
              <span
                className={cn(
                  'relative grid size-10 shrink-0 place-items-center rounded-full',
                  active
                    ? 'bg-[var(--crm-surface)] text-[var(--crm-accent)]'
                    : 'bg-[var(--crm-surface2)] text-[var(--crm-muted)]',
                )}
              >
                {r.channel === 'instagram_comment' ? (
                  <MessageSquareText
                    className="size-4"
                    strokeWidth={1.5}
                    aria-label={t('inbox.list.comment')}
                  />
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
                      {shortTime(fmt, r.lastAt, now)}
                    </time>
                    {unread && (
                      <span
                        className="anim-pop-in size-2 rounded-full bg-accent"
                        role="img"
                        aria-label={t('inbox.list.unread')}
                      />
                    )}
                  </span>
                </span>
                <span
                  dir="auto"
                  className={cn('block truncate text-[13px]', unread ? 'text-fg' : 'text-muted')}
                >
                  {preview(t, r)}
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        r.mode === 'bot' ? 'bg-accent' : r.mode === 'human' ? 'bg-warning' : 'bg-border',
                      )}
                    />
                    {modeLabel(t, r.mode)}
                  </span>
                  {r.hasDraft && (
                    <span className="inline-flex items-center gap-1 text-accent">
                      <Sparkles className="size-3" strokeWidth={1.75} /> {t('inbox.list.draft')}
                    </span>
                  )}
                  {r.flagged && (
                    <span className="inline-flex items-center gap-1 text-danger">
                      <Flag className="size-3" strokeWidth={1.75} /> {t('inbox.list.flagged')}
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

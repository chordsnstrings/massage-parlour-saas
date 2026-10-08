import type { Format } from '@spa/core/i18n/format'
import type { Translator } from '@spa/core/i18n/translate'
import type { getThread, InboxFilter } from '@spa/services'
import { dmWindowLeftMs } from '@spa/services'
import {
  ArrowLeft,
  Bot,
  CalendarDays,
  Link2,
  MessageSquareText,
  TriangleAlert,
  UserRound,
} from 'lucide-react'
import Link from 'next/link'
import { linkClientAction } from '@/app/dashboard/[tenant]/inbox/actions'
import { Card, Pill } from '@/components/crm'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/form'
import { FormSheet } from '@/components/ui/form-sheet'
import { Input } from '@/components/ui/input'
import { appPath } from '@/lib/paths'
import { cn } from '@/lib/utils'
import { inboxHref } from './conversation-list'
import { channelLabel, dayKey, dayLabel, displayName, modeLabel, windowLeft } from './format'
import { InstagramGlyph } from './icons'
import { Composer, DraftCard, MarkRead, MessageScroller, RetryButton, ThreadActions } from './thread-client'

type Thread = NonNullable<Awaited<ReturnType<typeof getThread>>>

export function ThreadView({
  slug,
  thread,
  filter,
  sendNotice,
  canLinkClient,
  canViewClients,
  t,
  fmt,
}: {
  slug: string
  thread: Thread
  filter: InboxFilter
  /** Set when replies can't reach Instagram (not configured / not connected / expired). */
  sendNotice: string | null
  canLinkClient: boolean
  canViewClients: boolean
  t: Translator
  fmt: Format
}) {
  const c = thread.conversation
  const isComment = c.channel === 'instagram_comment'
  const name = displayName(t, { ...c, clientName: thread.clientName })
  const now = new Date()
  const left = isComment ? null : windowLeft(t, dmWindowLeftMs(c.lastCustomerMsgAt, now))
  const windowNotice = !isComment && !left ? t('inbox.notice.window') : null
  const sent = thread.messages.filter((m) => m.sender !== 'ai_draft')
  const drafts = thread.messages.filter((m) => m.sender === 'ai_draft')
  const unread = Boolean(c.lastCustomerMsgAt && (!c.readAt || c.lastCustomerMsgAt > c.readAt))

  return (
    <Card flush className="flex flex-col overflow-hidden" data-testid="thread">
      {unread && <MarkRead slug={slug} id={c.id} />}
      <header className="space-y-4 border-b border-[var(--crm-line)] px-4 py-4 sm:px-5">
        <div className="flex items-start gap-3">
          <Link
            href={inboxHref(slug, { f: filter })}
            className="-ms-2 grid size-11 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg lg:hidden"
            aria-label={t('inbox.thread.back')}
          >
            <ArrowLeft className="size-5 rtl:-scale-x-100" strokeWidth={1.5} />
          </Link>
          <div className="min-w-0 flex-1 space-y-1 pt-0.5 lg:pt-0">
            <h2 className="truncate text-base font-semibold tracking-tight">{name}</h2>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted">
              <span className="inline-flex items-center gap-1.5">
                {isComment ? (
                  <MessageSquareText className="size-3.5" strokeWidth={1.5} />
                ) : (
                  <InstagramGlyph className="size-3.5" />
                )}
                {channelLabel(t, c.channel)}
              </span>
              <span aria-hidden>·</span>
              <span>{modeLabel(t, c.mode)}</span>
              {left && (
                <>
                  <span aria-hidden>·</span>
                  <span>{t('inbox.thread.replyWindow', { left })}</span>
                </>
              )}
            </p>
          </div>
          {c.flagged && (
            <Pill tone="bad" dot className="mt-0.5 hidden sm:inline-flex">
              {t('inbox.thread.flagged')}
            </Pill>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ThreadActions slug={slug} id={c.id} mode={c.mode} flagged={c.flagged} />
          <div className="flex flex-wrap items-center gap-2">
            {thread.bookingRef && (
              <Link
                href={appPath(`/${slug}/calendar${thread.bookingDate ? `?date=${thread.bookingDate}` : ''}`)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors hover:bg-subtle sm:min-h-9"
              >
                <CalendarDays className="size-3.5" strokeWidth={1.5} />
                {t('inbox.thread.booking', { ref: thread.bookingRef })}
                {thread.bookingDate && <span className="text-muted">· {fmt.date(thread.bookingDate)}</span>}
              </Link>
            )}
            {c.clientId && thread.clientName ? (
              canViewClients ? (
                <Link
                  href={appPath(`/${slug}/clients/${c.clientId}`)}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-colors hover:bg-subtle sm:min-h-9"
                >
                  <UserRound className="size-3.5" strokeWidth={1.5} /> {thread.clientName}
                </Link>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
                  <UserRound className="size-3.5" strokeWidth={1.5} /> {thread.clientName}
                </span>
              )
            ) : canLinkClient ? (
              <FormSheet
                title={t('inbox.link.title')}
                description={t('inbox.link.description')}
                action={linkClientAction.bind(null, slug, c.id)}
                submitLabel={t('inbox.link.submit')}
                trigger={
                  <Button variant="secondary" size="sm">
                    <Link2 /> {t('inbox.link.trigger')}
                  </Button>
                }
              >
                <Field label={t('inbox.link.name')} name="name">
                  <Input
                    id="name"
                    name="name"
                    defaultValue={c.participant?.replace(/^@/, '') ?? ''}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('inbox.link.phone')} name="phone" hint={t('inbox.link.phoneHint')}>
                  <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="off" />
                </Field>
              </FormSheet>
            ) : null}
          </div>
        </div>
      </header>

      <MessageScroller
        count={thread.messages.length}
        className="max-h-[62dvh] min-h-64 space-y-3 overflow-y-auto bg-[var(--crm-surface2)] px-4 py-5 sm:px-5"
        label={t('inbox.thread.log')}
      >
        {sent.length === 0 && (
          <p className="py-10 text-center text-sm text-muted">{t('inbox.thread.noMessages')}</p>
        )}
        {sent.map((m, i) => {
          const out = m.direction === 'out'
          const prev = sent[i - 1]
          const showDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt)
          return (
            <div key={m.id} className="space-y-3">
              {showDay && (
                <p className="pt-1 text-center text-xs text-muted">{dayLabel(t, fmt, m.createdAt, now)}</p>
              )}
              <div className={cn('flex', out ? 'justify-end' : 'justify-start')} data-testid="message">
                <div className={cn('max-w-[85%] space-y-1 sm:max-w-[75%]', out && 'items-end text-end')}>
                  <div
                    dir="auto"
                    className={cn(
                      'whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-start text-sm leading-relaxed',
                      out
                        ? cn(
                            'rounded-ee-md bg-accent-soft text-fg',
                            m.error && 'border border-warning/40 bg-warning-soft/60',
                          )
                        : 'rounded-es-md border bg-surface',
                    )}
                  >
                    {m.text}
                  </div>
                  <p className="flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-muted">
                    {out &&
                      (m.sender === 'bot' ? (
                        <span className="inline-flex items-center gap-1">
                          <Bot className="size-3" strokeWidth={1.75} /> {t('inbox.thread.ai')}
                        </span>
                      ) : (
                        <span>{t('inbox.thread.team')}</span>
                      ))}
                    {out && <span aria-hidden>·</span>}
                    <time dateTime={m.createdAt.toISOString()}>{fmt.time(m.createdAt)}</time>
                  </p>
                  {out && m.error && (
                    <p className="flex flex-wrap items-center justify-end gap-x-1.5 px-1 text-xs text-warning">
                      <TriangleAlert className="size-3.5 shrink-0" strokeWidth={1.75} />
                      <span>{t('inbox.thread.notSent', { reason: m.error })}</span>
                      {!m.error.includes('24 hours') && <RetryButton slug={slug} messageId={m.id} />}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )
        })}
        {drafts.map((d) => (
          <DraftCard
            key={d.id}
            slug={slug}
            draft={{ id: d.id, text: d.text, error: d.error }}
            isComment={isComment}
          />
        ))}
      </MessageScroller>

      {c.mode === 'closed' ? (
        <p className="border-t border-[var(--crm-line)] px-4 py-4 text-sm text-muted sm:px-5">
          {t('inbox.thread.closed')}
        </p>
      ) : (
        <Composer slug={slug} id={c.id} isComment={isComment} notice={sendNotice ?? windowNotice} />
      )}
    </Card>
  )
}

'use client'
import {
  Bot,
  Check,
  Flag,
  FlagOff,
  Lock,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import {
  approveDraftAction,
  discardDraftAction,
  markReadAction,
  retryMessageAction,
  sendReplyAction,
  setFlagAction,
  setModeAction,
} from '@/app/dashboard/[tenant]/inbox/actions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import type { ActionResult } from '@/lib/action'
import { cn } from '@/lib/utils'
import type { ConversationMode } from './format'

/** Instagram limits DM text to 1,000 UTF-8 bytes (Arabic letters take 2), so DMs show a byte counter. */
const MAX_DM_BYTES = 1000
const dmBytes = (text: string) => new TextEncoder().encode(text.trim()).length

function DmLimit({ bytes }: { bytes: number }) {
  const t = useT()
  if (bytes < MAX_DM_BYTES * 0.8) return null
  const params = { bytes, max: MAX_DM_BYTES }
  return (
    <span className={cn('text-xs tabular-nums', bytes > MAX_DM_BYTES ? 'text-danger' : 'text-muted')}>
      {bytes > MAX_DM_BYTES ? t('inbox.composer.tooLong', params) : t('inbox.composer.bytes', params)}
    </span>
  )
}

/** Toasts an action result; delivery problems come back as ok + `sent: false` and show as a warning. */
function useReport() {
  const t = useT()
  return (r: ActionResult) => {
    if (!r) return false
    if (!r.ok) {
      toast.error(resultText(t, r) ?? t('errors.generic'))
      return false
    }
    if (r.data?.sent === false) toast.error(resultText(t, r) ?? t('inbox.results.savedNotSent'))
    else if (r.message) toast.success(resultText(t, r) ?? r.message)
    return true
  }
}

export function ThreadActions({
  slug,
  id,
  mode,
  flagged,
}: {
  slug: string
  id: string
  mode: ConversationMode
  flagged: boolean
}) {
  const t = useT()
  const report = useReport()
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<string | null>(null)
  const run = (key: string, fn: () => Promise<ActionResult>) => {
    setBusy(key)
    start(async () => {
      report(await fn())
      setBusy(null)
    })
  }
  const setMode = (m: ConversationMode) => run(m, () => setModeAction(slug, id, m))
  return (
    <div className="flex flex-wrap items-center gap-2">
      {mode === 'bot' && (
        <Button
          variant="secondary"
          className="min-h-11 sm:min-h-10"
          pending={busy === 'human'}
          disabled={pending}
          onClick={() => setMode('human')}
        >
          {busy !== 'human' && <UserRound />} {t('inbox.actions.takeOver')}
        </Button>
      )}
      {mode === 'human' && (
        <Button
          variant="secondary"
          className="min-h-11 sm:min-h-10"
          pending={busy === 'bot'}
          disabled={pending}
          onClick={() => setMode('bot')}
        >
          {busy !== 'bot' && <Bot />} {t('inbox.actions.giveBack')}
        </Button>
      )}
      {mode === 'closed' ? (
        <Button
          variant="secondary"
          className="min-h-11 sm:min-h-10"
          pending={busy === 'human'}
          disabled={pending}
          onClick={() => setMode('human')}
        >
          {busy !== 'human' && <RotateCcw />} {t('inbox.actions.reopen')}
        </Button>
      ) : (
        <Button
          variant="ghost"
          className="min-h-11 sm:min-h-10"
          pending={busy === 'closed'}
          disabled={pending}
          onClick={() => setMode('closed')}
        >
          {busy !== 'closed' && <Lock />} {t('inbox.actions.close')}
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={cn('size-11 sm:size-10', flagged && 'text-danger hover:text-danger')}
        aria-label={flagged ? t('inbox.actions.clearFlag') : t('inbox.actions.flag')}
        title={flagged ? t('inbox.actions.clearFlag') : t('inbox.actions.flag')}
        aria-pressed={flagged}
        pending={busy === 'flag'}
        disabled={pending}
        onClick={() => run('flag', () => setFlagAction(slug, id, !flagged))}
      >
        {busy !== 'flag' && (flagged ? <FlagOff /> : <Flag />)}
      </Button>
    </div>
  )
}

/** An AI reply waiting for approval: send as-is, edit then send, or discard. */
export function DraftCard({
  slug,
  draft,
  isComment,
}: {
  slug: string
  draft: { id: string; text: string; error: string | null }
  isComment: boolean
}) {
  const t = useT()
  const report = useReport()
  const [text, setText] = useState(draft.text)
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<'send' | 'discard' | null>(null)
  const edited = text.trim() !== draft.text.trim()
  const bytes = isComment ? 0 : dmBytes(text)
  return (
    <div
      className="anim-fade-in ms-auto w-full max-w-[34rem] space-y-3 rounded-2xl border border-dashed border-accent/50 bg-surface p-4"
      data-testid="ai-draft"
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-accent">
        <Sparkles className="size-3.5" strokeWidth={1.75} />
        {isComment ? t('inbox.draft.titleComment') : t('inbox.draft.title')}
      </p>
      {draft.error && <p className="text-[13px] text-warning">{draft.error}</p>}
      <Textarea
        aria-label={t('inbox.draft.aria')}
        dir="auto"
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="min-h-20 text-sm"
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {!isComment && (
          <span className="me-auto">
            <DmLimit bytes={bytes} />
          </span>
        )}
        <Button
          variant="ghost"
          className="min-h-11 sm:min-h-10"
          pending={busy === 'discard'}
          disabled={pending}
          onClick={() => {
            setBusy('discard')
            start(async () => {
              report(await discardDraftAction(slug, draft.id))
              setBusy(null)
            })
          }}
        >
          {busy !== 'discard' && <X />} {t('inbox.draft.discard')}
        </Button>
        <Button
          className="min-h-11 sm:min-h-10"
          pending={busy === 'send'}
          disabled={pending || !text.trim() || bytes > MAX_DM_BYTES}
          onClick={() => {
            setBusy('send')
            start(async () => {
              report(await approveDraftAction(slug, draft.id, text.trim()))
              setBusy(null)
            })
          }}
        >
          {busy !== 'send' && <Check />} {edited ? t('inbox.draft.sendEdited') : t('inbox.draft.approve')}
        </Button>
      </div>
    </div>
  )
}

export function Composer({
  slug,
  id,
  isComment,
  notice,
}: {
  slug: string
  id: string
  isComment: boolean
  /** Why a reply would not reach Instagram right now (shown above the box; the reply is still saved). */
  notice: string | null
}) {
  const t = useT()
  const report = useReport()
  const [text, setText] = useState('')
  const [pending, start] = useTransition()
  const bytes = isComment ? 0 : dmBytes(text)
  const send = () => {
    const value = text.trim()
    if (!value || bytes > MAX_DM_BYTES) return
    start(async () => {
      if (report(await sendReplyAction(slug, id, value))) setText('')
    })
  }
  return (
    <form
      className="space-y-2.5 border-t border-[var(--crm-line)] px-4 py-4 sm:px-5"
      onSubmit={(e) => {
        e.preventDefault()
        send()
      }}
    >
      {notice && <p className="text-[13px] text-warning">{notice}</p>}
      <div className="flex items-end gap-2">
        <Textarea
          aria-label={isComment ? t('inbox.composer.publicReply') : t('inbox.composer.reply')}
          placeholder={isComment ? t('inbox.composer.publicPlaceholder') : t('inbox.composer.placeholder')}
          dir="auto"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              send()
            }
          }}
          maxLength={2000}
          className="min-h-11 flex-1 resize-y text-sm"
          rows={2}
        />
        <Button
          type="submit"
          className="size-11 shrink-0 px-0 sm:w-auto sm:px-4"
          pending={pending}
          disabled={!text.trim() || bytes > MAX_DM_BYTES}
        >
          {!pending && <SendHorizontal className="rtl:-scale-x-100" />}
          <span className="sr-only sm:not-sr-only">{t('inbox.composer.send')}</span>
        </Button>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="text-xs text-muted">
          {isComment ? t('inbox.composer.commentHint') : t('inbox.composer.dmHint')}
        </p>
        {!isComment && <DmLimit bytes={bytes} />}
      </div>
    </form>
  )
}

export function RetryButton({ slug, messageId }: { slug: string; messageId: string }) {
  const t = useT()
  const report = useReport()
  const [pending, start] = useTransition()
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void report(await retryMessageAction(slug, messageId)))}
      className="inline-flex min-h-8 items-center gap-1 rounded-md px-1.5 font-medium text-fg underline-offset-2 hover:underline disabled:opacity-50"
    >
      <RotateCcw className={cn('size-3', pending && 'animate-spin')} strokeWidth={1.75} /> {t('inbox.actions.retry')}
    </button>
  )
}

/** Clears the unread dot once the thread is open. */
export function MarkRead({ slug, id }: { slug: string; id: string }) {
  useEffect(() => {
    void markReadAction(slug, id)
  }, [slug, id])
  return null
}

/** Message area that starts (and stays) scrolled to the newest message. */
export function MessageScroller({
  children,
  count,
  className,
  label,
}: {
  children: React.ReactNode
  count: number
  className?: string
  label: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el && count >= 0) el.scrollTop = el.scrollHeight
  }, [count])
  return (
    <div ref={ref} className={className} role="log" aria-label={label}>
      {children}
    </div>
  )
}

/** New DMs arrive by webhook: refresh the open inbox every 20 s while the tab is visible. */
export function InboxAutoRefresh() {
  const router = useRouter()
  useEffect(() => {
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh()
    }, 20_000)
    return () => {
      window.clearInterval(t)
    }
  }, [router])
  return null
}

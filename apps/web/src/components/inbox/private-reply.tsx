'use client'
import { LockKeyhole, SendHorizontal, Sparkles } from 'lucide-react'
import { useState, useTransition } from 'react'
import { draftPrivateReplyAction, sendPrivateReplyAction } from '@/app/dashboard/[tenant]/inbox/actions'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { toast } from '@/components/ui/toast'
import { resultText, useT } from '@/i18n/client'
import { cn } from '@/lib/utils'

const MAX_DM_BYTES = 1000
const dmBytes = (text: string) => new TextEncoder().encode(text.trim()).length

type State =
  | { status: 'available'; until: string }
  | { status: 'sent'; at: string }
  | { status: 'sending' | 'expired' }

/**
 * F18 on a comment thread: the one private DM reply Instagram allows per comment (within 7 days). "Draft with AI"
 * only fills the box (gateway, budget applies); a staff member always presses Send.
 */
export function PrivateReplyBox({
  slug,
  id,
  state,
  notice,
}: {
  slug: string
  id: string
  state: State
  /** Why replies can't reach Instagram right now (not configured / connected). */
  notice: string | null
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [aiDrafted, setAiDrafted] = useState(false)
  const [pending, start] = useTransition()
  const [busy, setBusy] = useState<'draft' | 'send' | null>(null)
  const bytes = dmBytes(text)

  if (state.status !== 'available')
    return (
      <p
        className="flex items-center gap-1.5 border-t border-[var(--crm-line)] px-4 py-3 text-[13px] text-muted sm:px-5"
        data-testid="private-reply-state"
      >
        <LockKeyhole className="size-3.5 shrink-0" strokeWidth={1.75} />
        {state.status === 'sent'
          ? t('inbox.private.alreadySent', { when: state.at })
          : state.status === 'sending'
            ? t('inbox.private.sending')
            : t('inbox.private.expired')}
      </p>
    )

  if (!open)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--crm-line)] px-4 py-3 sm:px-5">
        <p className="text-[13px] text-muted">{state.until}</p>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid="private-reply-open">
          <LockKeyhole /> {t('inbox.private.open')}
        </Button>
      </div>
    )

  return (
    <div
      className="space-y-2.5 border-t border-[var(--crm-line)] px-4 py-4 sm:px-5"
      data-testid="private-reply"
    >
      <p className="flex items-center gap-1.5 text-[13px] font-medium">
        <LockKeyhole className="size-3.5" strokeWidth={1.75} /> {t('inbox.private.title')}
      </p>
      <p className="text-xs text-muted">
        {t('inbox.private.hint')} {state.until}
      </p>
      {notice && <p className="text-[13px] text-warning">{notice}</p>}
      <Textarea
        aria-label={t('inbox.private.aria')}
        dir="auto"
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={2000}
        className="min-h-20 text-sm"
        placeholder={t('inbox.private.placeholder')}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {bytes >= MAX_DM_BYTES * 0.8 && (
          <span
            className={cn(
              'me-auto text-xs tabular-nums',
              bytes > MAX_DM_BYTES ? 'text-danger' : 'text-muted',
            )}
          >
            {bytes > MAX_DM_BYTES
              ? t('inbox.composer.tooLong', { bytes, max: MAX_DM_BYTES })
              : t('inbox.composer.bytes', { bytes, max: MAX_DM_BYTES })}
          </span>
        )}
        <Button
          variant="ghost"
          className="min-h-11 sm:min-h-10"
          pending={busy === 'draft'}
          disabled={pending}
          onClick={() => {
            setBusy('draft')
            start(async () => {
              const r = await draftPrivateReplyAction(slug, id)
              setBusy(null)
              if (r?.ok && typeof r.data?.text === 'string') {
                setText(r.data.text)
                setAiDrafted(true)
                if (r.data.inappropriate) toast.error(t('inbox.private.inappropriate'))
              } else if (r && !r.ok) toast.error(resultText(t, r) ?? t('errors.generic'))
            })
          }}
        >
          {busy !== 'draft' && <Sparkles />} {t('inbox.private.draft')}
        </Button>
        <Button
          className="min-h-11 sm:min-h-10"
          pending={busy === 'send'}
          disabled={pending || !text.trim() || bytes > MAX_DM_BYTES}
          onClick={() => {
            setBusy('send')
            start(async () => {
              const r = await sendPrivateReplyAction(slug, id, text.trim(), aiDrafted)
              setBusy(null)
              if (r?.ok) {
                toast.success(resultText(t, r) ?? '')
                setText('')
                setOpen(false)
              } else if (r) toast.error(resultText(t, r) ?? t('errors.generic'))
            })
          }}
        >
          {busy !== 'send' && <SendHorizontal className="rtl:-scale-x-100" />} {t('inbox.private.send')}
        </Button>
      </div>
    </div>
  )
}

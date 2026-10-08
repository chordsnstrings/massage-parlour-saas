'use client'
import { ArrowUp, Flag, Loader2, RotateCcw, Ticket, UserRound } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/client'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { type ChatTurn, tryDmAction } from '../actions'

type Bubble = ChatTurn & {
  id: number
  note?: { kind: 'booking' | 'flag' | 'handoff' | 'error'; text: string }
}

// Sample client messages (what a client would type — kept in the clients' languages, not translated).
const SUGGESTIONS = [
  'How much is a 60 minute massage?',
  'Do you have anything free tomorrow evening?',
  'Where are you located?',
  'هل لديكم مساج سويدي اليوم؟',
]

export function ReceptionistChat({ slug, spaName }: { slug: string; spaName: string }) {
  const t = useT()
  const [items, setItems] = useState<Bubble[]>([])
  const [text, setText] = useState('')
  const [pending, start] = useTransition()
  const end = useRef<HTMLDivElement>(null)
  const id = useRef(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll to the newest message whenever the thread changes
  useEffect(() => {
    // Block body: newer Chromium returns a value from scrollIntoView, which React would treat as a cleanup.
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [items, pending])

  const send = (message: string) => {
    const msg = message.trim()
    if (!msg || pending) return
    const history: ChatTurn[] = items
      .filter((i) => i.note?.kind !== 'error')
      .map(({ from, text }) => ({ from, text }))
    setItems((x) => [...x, { id: ++id.current, from: 'customer', text: msg }])
    setText('')
    start(async () => {
      const r = await tryDmAction(slug, history, msg)
      if (!r.ok) {
        setItems((x) => [
          ...x,
          {
            id: ++id.current,
            from: 'spa',
            text: t.maybe(r.error) ?? r.error,
            note: { kind: 'error', text: t('ai.notSent') },
          },
        ])
        return
      }
      const note = r.bookingRef
        ? {
            kind: 'booking' as const,
            text: t('ai.noteBooking', { ref: r.bookingRef }),
          }
        : r.flagged
          ? { kind: 'flag' as const, text: t('ai.noteFlag') }
          : r.handoff
            ? { kind: 'handoff' as const, text: t('ai.noteHandoff') }
            : undefined
      setItems((x) => [...x, { id: ++id.current, from: 'spa', text: r.reply || '…', note }])
    })
  }

  return (
    <div className="mx-auto flex h-[calc(100dvh-14rem)] min-h-[28rem] max-w-2xl flex-col overflow-hidden rounded-2xl border bg-surface md:h-[calc(100dvh-16rem)]">
      <div className="flex items-center gap-3 border-b px-5 py-3.5">
        <span className="grid size-9 place-items-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
          {spaName.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{spaName}</p>
          <p className="text-xs text-muted">{t('ai.chatSub')}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setItems([])} aria-label={t('ai.startOver')}>
          <RotateCcw /> {t('ai.reset')}
        </Button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-5 sm:px-6">
        {items.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="max-w-sm text-sm text-muted">
              {t('ai.chatIntro')}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border px-3.5 py-1.5 text-[13px] transition-colors hover:bg-subtle"
                  dir="auto"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        <AnimatePresence initial={false}>
          {items.map((b) => (
            <motion.div
              key={b.id}
              layout
              initial={{ opacity: 0, y: 8, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={spring}
              className={cn('flex flex-col gap-1.5', b.from === 'customer' ? 'items-end' : 'items-start')}
            >
              <div
                dir="auto"
                className={cn(
                  'max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed',
                  b.from === 'customer'
                    ? 'rounded-br-md bg-accent text-accent-fg'
                    : b.note?.kind === 'error'
                      ? 'rounded-bl-md bg-danger-soft text-danger'
                      : 'rounded-bl-md bg-subtle',
                )}
              >
                {b.text}
              </div>
              {b.note && b.note.kind !== 'error' && (
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs',
                    b.note.kind === 'booking' ? 'bg-accent-soft text-accent' : 'bg-warning-soft text-warning',
                  )}
                >
                  {b.note.kind === 'booking' ? (
                    <Ticket className="size-3.5" />
                  ) : b.note.kind === 'flag' ? (
                    <Flag className="size-3.5" />
                  ) : (
                    <UserRound className="size-3.5" />
                  )}
                  {b.note.text}
                </span>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
        {pending && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-sm text-muted"
          >
            <Loader2 className="size-4 animate-spin" /> {t('ai.typing')}
          </motion.div>
        )}
        <div ref={end} />
      </div>
      <form
        className="flex items-center gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault()
          send(text)
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          dir="auto"
          placeholder={t('ai.messagePh')}
          aria-label={t('ai.message')}
          className="h-11 flex-1 rounded-full border bg-bg px-4 text-[15px] outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-4 focus:ring-accent/15"
        />
        <Button
          type="submit"
          size="icon"
          className="size-11 rounded-full"
          pending={pending}
          aria-label={t('ai.send')}
        >
          {!pending && <ArrowUp />}
        </Button>
      </form>
    </div>
  )
}

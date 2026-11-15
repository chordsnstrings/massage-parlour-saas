'use client'
// Top-bar "Ask AI" (F30, PLAN §17): a side drawer where staff ask about their own spa. Answers come from read-only,
// permission-checked tools (server action), with buttons to the matching screens and WhatsApp click-to-send drafts
// the human opens. Standard spas (no `ai` feature) get the Premium upsell in the same drawer. Styles: crm.css
// `.crm-ask*`. The conversation lives in this component only (short history, gone on reload).
import { ExternalLink, MessageCircle, SendHorizontal, Sparkles, X } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Dialog } from 'radix-ui'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useI18n } from '@/i18n/client'
import { type AskAction, type AskLink, askAssistantAction, confirmAssistantAction } from './actions'

/** R46: a prepared change and what happened to it in this drawer. */
type Card = AskAction & { state: 'open' | 'busy' | 'done'; result?: { ok: boolean; text: string } }
type Turn = { role: 'user' | 'assistant'; text: string; links?: AskLink[]; cards?: Card[]; error?: boolean }

const SUGGESTIONS = ['tomorrow', 'unpaid', 'topMonth', 'lapsed', 'revenue', 'friday'] as const

export function AskAi({
  slug,
  enabled,
  upsell,
}: {
  slug: string
  /** The spa's plan includes AI (Premium). */
  enabled: boolean
  upsell: { compareHref: string; billingHref: string | null }
}) {
  const { t, locale } = useI18n()
  const [open, setOpen] = useState(false)
  const [turns, setTurns] = useState<Turn[]>([])
  const [q, setQ] = useState('')
  const [pending, start] = useTransition()
  const bodyRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const setCard = (turn: number, token: string, patch: Partial<Card>) =>
    setTurns((prev) =>
      prev.map((x, i) =>
        i === turn ? { ...x, cards: x.cards?.map((c) => (c.token === token ? { ...c, ...patch } : c)) } : x,
      ),
    )
  const confirm = (turn: number, card: Card) => {
    setCard(turn, card.token, { state: 'busy' })
    confirmAssistantAction(slug, card.token)
      .catch(() => ({ ok: false, text: t('assistant.errors.busy') }))
      .then((result) => {
        setCard(turn, card.token, { state: 'done', result })
        if (result.ok) router.refresh()
      })
  }

  // Keep the newest answer in view.
  useEffect(() => {
    if (turns.length || pending) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [turns, pending])

  const ask = (text: string) => {
    const question = text.trim()
    if (!question || pending) return
    const history = turns.filter((x) => !x.error).map((x) => ({ role: x.role, text: x.text }))
    setTurns((prev) => [...prev, { role: 'user', text: question }])
    setQ('')
    start(async () => {
      const res = await askAssistantAction(slug, question, history).catch(() => null)
      setTurns((prev) => [
        ...prev,
        res?.ok
          ? {
              role: 'assistant',
              text: res.answer,
              links: res.links,
              cards: res.actions.map((a) => ({ ...a, state: 'open' as const })),
              error: res.incomplete,
            }
          : { role: 'assistant', text: res?.error ?? t('assistant.errors.busy'), error: true },
      ])
    })
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="crm-ask-btn"
          data-testid="ask-ai-open"
          aria-label={t('assistant.openLabel')}
        >
          <Sparkles aria-hidden strokeWidth={1.8} />
          <span>{t('assistant.open')}</span>
          {!enabled && <small className="crm-ask-tag">{t('plan.premiumBadge')}</small>}
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="crm-search-scrim" />
        <Dialog.Content className="crm-ask" lang={locale} data-testid="ask-ai">
          <header className="crm-ask-head">
            <span className="crm-ask-mark" aria-hidden>
              <Sparkles strokeWidth={1.8} />
            </span>
            <div className="crm-ask-titles">
              <Dialog.Title>{t('assistant.title')}</Dialog.Title>
              <Dialog.Description>{t('assistant.subtitle')}</Dialog.Description>
            </div>
            {enabled && turns.length > 0 && (
              <button
                type="button"
                className="crm-ask-new"
                disabled={pending}
                onClick={() => {
                  setTurns([])
                }}
              >
                {t('assistant.newChat')}
              </button>
            )}
            <Dialog.Close className="crm-iconbtn" aria-label={t('assistant.close')}>
              <X aria-hidden />
            </Dialog.Close>
          </header>

          <div className="crm-ask-body" ref={bodyRef} aria-live="polite" aria-busy={pending}>
            {!enabled ? (
              <div className="crm-ask-upsell" data-testid="ask-ai-upsell">
                <small>{t('plan.upsell.eyebrow')}</small>
                <b>{t('assistant.upsell.title')}</b>
                <p>{t('assistant.upsell.text')}</p>
                <div className="crm-ask-links">
                  <a className="crm-ask-link" href={upsell.compareHref} target="_blank" rel="noreferrer">
                    {t('plan.upsell.compare')} <ExternalLink aria-hidden />
                  </a>
                  {upsell.billingHref && (
                    <Link className="crm-ask-link" href={upsell.billingHref} onClick={() => setOpen(false)}>
                      {t('plan.upsell.billing')}
                    </Link>
                  )}
                </div>
                {!upsell.billingHref && <p className="crm-ask-fine">{t('plan.upsell.contact')}</p>}
              </div>
            ) : turns.length === 0 ? (
              <div className="crm-ask-intro">
                <p>{t('assistant.intro')}</p>
                {SUGGESTIONS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className="crm-ask-chip"
                    disabled={pending}
                    onClick={() => ask(t(`assistant.suggestions.${k}`))}
                  >
                    {t(`assistant.suggestions.${k}`)}
                  </button>
                ))}
              </div>
            ) : (
              turns.map((turn, i) => (
                <div
                  // biome-ignore lint/suspicious/noArrayIndexKey: append-only conversation
                  key={i}
                  className="crm-ask-turn"
                  data-role={turn.role}
                  data-error={turn.error || undefined}
                  data-testid={turn.role === 'assistant' ? 'ask-ai-answer' : 'ask-ai-question'}
                >
                  <span className="sr-only">
                    {turn.role === 'user' ? t('assistant.you') : t('assistant.ai')}:{' '}
                  </span>
                  {turn.text && <p>{turn.text}</p>}
                  {turn.cards?.map((card) => (
                    <div
                      key={card.token}
                      className="crm-ask-card"
                      data-kind={card.kind}
                      data-testid="ask-ai-action"
                    >
                      <p>{card.text}</p>
                      {card.result ? (
                        <p className="crm-ask-card-result" data-ok={card.result.ok} role="status">
                          {card.result.text}
                        </p>
                      ) : (
                        <div className="crm-ask-card-actions">
                          <button
                            type="button"
                            data-primary
                            disabled={card.state !== 'open'}
                            onClick={() => confirm(i, card)}
                          >
                            {t('assistant.action.confirm')}
                          </button>
                          <button
                            type="button"
                            disabled={card.state !== 'open'}
                            onClick={() =>
                              setCard(i, card.token, {
                                state: 'done',
                                result: { ok: false, text: t('assistant.action.dismissed') },
                              })
                            }
                          >
                            {t('assistant.action.dismiss')}
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {turn.links && turn.links.length > 0 && (
                    <nav className="crm-ask-links" aria-label={t('assistant.links')}>
                      {turn.links.map((l) =>
                        l.kind === 'whatsapp' ? (
                          <a
                            key={l.href}
                            className="crm-ask-link"
                            data-kind="whatsapp"
                            href={l.href}
                            target="_blank"
                            rel="noreferrer"
                            title={t('assistant.whatsappNote')}
                          >
                            <MessageCircle aria-hidden /> {l.label}
                          </a>
                        ) : (
                          <Link
                            key={l.href}
                            className="crm-ask-link"
                            href={l.href}
                            onClick={() => setOpen(false)}
                          >
                            {l.label}
                          </Link>
                        ),
                      )}
                    </nav>
                  )}
                </div>
              ))
            )}
            {pending && (
              <p className="crm-ask-typing" role="status">
                {t('assistant.thinking')}
              </p>
            )}
          </div>

          {enabled && (
            <form
              className="crm-ask-form"
              onSubmit={(e) => {
                e.preventDefault()
                ask(q)
              }}
            >
              <textarea
                // biome-ignore lint/a11y/noAutofocus: the drawer exists to type into
                autoFocus
                rows={2}
                maxLength={500}
                aria-label={t('assistant.question')}
                placeholder={t('assistant.placeholder')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    ask(q)
                  }
                }}
              />
              <button
                type="submit"
                className="crm-ask-send"
                aria-label={t('assistant.send')}
                disabled={pending || !q.trim()}
              >
                <SendHorizontal aria-hidden strokeWidth={1.8} />
              </button>
            </form>
          )}
          {enabled && <p className="crm-ask-note">{t('assistant.disclaimer')}</p>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

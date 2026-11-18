'use client'
// Contact enquiry form (PLAN §18.4): English only (marketing), server-validated; field errors inline, typed values
// kept on error (submitted in a transition, not `action=`, so React never resets the fields), success panel after.
import { CircleCheck, Send } from 'lucide-react'
import { useEffect, useRef, useState, useTransition } from 'react'
import { TURNSTILE_FIELD, useTurnstile } from '@/components/turnstile'
import type { ActionResult } from '@/lib/action'
import { ENQUIRY_HONEYPOT } from './enquiry-fields'

type Action = (prev: ActionResult, formData: FormData) => Promise<ActionResult>

const FIELDS = [
  { name: 'name', label: 'Your name', type: 'text', autoComplete: 'name' },
  {
    name: 'phone',
    label: 'Phone',
    type: 'tel',
    autoComplete: 'tel',
    hint: 'UAE mobile (05…) or international with the country code.',
  },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { name: 'spaName', label: 'Spa name', type: 'text', autoComplete: 'organization' },
] as const

export function EnquiryForm({
  action,
  maxLength,
  turnstileSiteKey,
}: {
  action: Action
  maxLength: number
  /** F9: Cloudflare Turnstile site key (null = no bot check). */
  turnstileSiteKey: string | null
}) {
  const bot = useTurnstile(turnstileSiteKey, 'contact', 'en')
  const [state, setState] = useState<ActionResult>(null)
  const [pending, start] = useTransition()
  const [length, setLength] = useState(0)
  const done = useRef<HTMLDivElement>(null)
  const sent = state?.ok === true
  useEffect(() => {
    if (sent) done.current?.focus()
  }, [sent])
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name] : undefined)
  const describedBy = (name: string, hint: boolean) =>
    [hint && `enq-${name}-hint`, error(name) && `enq-${name}-error`].filter(Boolean).join(' ') || undefined

  if (sent)
    return (
      <div
        ref={done}
        tabIndex={-1}
        role="status"
        className="mkt-card mkt-enq outline-none"
        data-testid="enquiry-sent"
      >
        <span className="mkt-mi">
          <CircleCheck strokeWidth={1.7} />
        </span>
        <h2 className="text-[24px]">Message sent</h2>
        <p className="mt-2">{state.message}</p>
      </div>
    )

  return (
    <form
      className="mkt-card mkt-enq"
      aria-labelledby="enquiry-title"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (pending) return
        const fd = new FormData(e.currentTarget)
        start(async () => {
          fd.set(TURNSTILE_FIELD, await bot.getToken())
          const res = await action(null, fd)
          if (!res?.ok) bot.reset()
          setState(res)
        })
      }}
    >
      <h2 id="enquiry-title" className="text-[24px]">
        Send us a message
      </h2>
      <p className="mt-2">Tell us about your spa and what you need — we’ll get back to you.</p>
      {state && !state.ok && (
        <p role="alert" className="mkt-enq-alert">
          {state.error}
        </p>
      )}
      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.name}>
            <label htmlFor={`enq-${f.name}`}>{f.label}</label>
            <input
              id={`enq-${f.name}`}
              name={f.name}
              type={f.type}
              autoComplete={f.autoComplete}
              required
              aria-invalid={error(f.name) ? true : undefined}
              aria-describedby={describedBy(f.name, 'hint' in f)}
              className="mkt-input"
            />
            {'hint' in f && (
              <p id={`enq-${f.name}-hint`} className="mkt-enq-hint">
                {f.hint}
              </p>
            )}
            {error(f.name) && (
              <p id={`enq-${f.name}-error`} className="mkt-enq-err">
                {error(f.name)}
              </p>
            )}
          </div>
        ))}
        <div className="sm:col-span-2">
          <label htmlFor="enq-message">What do you need?</label>
          <textarea
            id="enq-message"
            name="message"
            required
            rows={6}
            maxLength={maxLength}
            onChange={(e) => setLength(e.target.value.length)}
            aria-invalid={error('message') ? true : undefined}
            aria-describedby={describedBy('message', true)}
            className="mkt-input"
            placeholder="e.g. We have two branches and want online booking and a new website."
          />
          <p id="enq-message-hint" className="mkt-enq-hint">
            {length} / {maxLength} characters
          </p>
          {error('message') && (
            <p id="enq-message-error" className="mkt-enq-err">
              {error('message')}
            </p>
          )}
        </div>
      </div>
      <div className="mkt-enq-hp" aria-hidden="true">
        <label htmlFor={`enq-${ENQUIRY_HONEYPOT}`}>Leave this field empty</label>
        <input
          id={`enq-${ENQUIRY_HONEYPOT}`}
          name={ENQUIRY_HONEYPOT}
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>
      <div ref={bot.ref} className="mt-5 empty:hidden" />
      <button
        type="submit"
        className="mkt-btn mkt-btn-primary mt-7 w-full sm:w-auto"
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? 'Sending…' : 'Send message'}
        <Send aria-hidden="true" />
      </button>
    </form>
  )
}

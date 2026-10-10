'use client'
// F15 EnquiryForm block (client part): name, phone, message + honeypot + Turnstile (managed, interaction-only, like
// /book). Server-validated by sendSiteEnquiryAction; field errors inline in the page language, typed values kept.
import { CircleCheck, Send } from 'lucide-react'
import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useTurnstile } from '@/components/turnstile'
import type { ActionResult } from '@/lib/action'
import { cn } from '@/lib/utils'
import { sendSiteEnquiryAction } from '../enquiry-actions'
import type { Locale } from '../types'

export type EnquiryLabels = {
  name: string
  phone: string
  phoneHint: string
  message: string
  send: string
  sending: string
  success: string
  preview: string
}

export function SiteEnquiryForm({
  labels,
  locale,
  page,
  form,
  editing,
}: {
  labels: EnquiryLabels
  locale: Locale
  page: string
  /** Absent in the editor / previews: the form shows but can't be sent. */
  form?: { site: { slug: string } | { hostname: string }; turnstileSiteKey: string | null }
  editing?: boolean
}) {
  const uid = useId()
  const bot = useTurnstile(form?.turnstileSiteKey ?? null, 'enquiry', locale)
  const [state, setState] = useState<ActionResult>(null)
  const [pending, start] = useTransition()
  const done = useRef<HTMLDivElement>(null)
  const sent = state?.ok === true
  useEffect(() => {
    if (sent) done.current?.focus()
  }, [sent])
  const disabled = !form || editing
  const error = (name: string) => (state && !state.ok ? state.fieldErrors?.[name] : undefined)
  const id = (name: string) => `${uid}-${name}`
  const describedBy = (name: string, hint?: boolean) =>
    [hint && `${id(name)}-hint`, error(name) && `${id(name)}-error`].filter(Boolean).join(' ') || undefined

  if (sent)
    return (
      <div
        ref={done}
        tabIndex={-1}
        role="status"
        data-testid="site-enquiry-sent"
        className="sb-card flex flex-col items-center gap-3 border bg-surface p-8 text-center outline-none"
      >
        <CircleCheck className="size-8 text-[var(--brand)]" strokeWidth={1.5} />
        <p className="sb-prose text-[17px]">{state.message}</p>
      </div>
    )

  const field = 'sb-input w-full'
  return (
    <form
      noValidate
      data-site-enquiry=""
      className="sb-card space-y-5 border bg-surface p-6 sm:p-8"
      onSubmit={(e) => {
        e.preventDefault()
        if (pending || disabled || !form) return
        const fd = new FormData(e.currentTarget)
        start(async () => {
          const res = await sendSiteEnquiryAction({
            site: form.site,
            locale,
            page,
            name: String(fd.get('name') ?? ''),
            phone: String(fd.get('phone') ?? ''),
            message: String(fd.get('message') ?? ''),
            company: String(fd.get('company') ?? ''),
            token: await bot.getToken(),
            success: labels.success,
          })
          if (!res?.ok) bot.reset()
          setState(res)
        })
      }}
    >
      {state && !state.ok && (
        <p role="alert" className="rounded-[var(--radius)] bg-[var(--accent-soft)] px-4 py-3 text-sm">
          {state.error}
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label htmlFor={id('name')} className="block text-sm font-medium">
            {labels.name}
          </label>
          <input
            id={id('name')}
            name="name"
            autoComplete="name"
            required
            maxLength={80}
            disabled={disabled}
            aria-invalid={error('name') ? true : undefined}
            aria-describedby={describedBy('name')}
            className={field}
          />
          {error('name') && (
            <p id={`${id('name')}-error`} className="text-sm text-[#b42318]">
              {error('name')}
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor={id('phone')} className="block text-sm font-medium">
            {labels.phone}
          </label>
          <input
            id={id('phone')}
            name="phone"
            type="tel"
            dir="ltr"
            inputMode="tel"
            autoComplete="tel"
            required
            maxLength={40}
            disabled={disabled}
            aria-invalid={error('phone') ? true : undefined}
            aria-describedby={describedBy('phone', true)}
            className={cn(field, 'text-start')}
          />
          <p id={`${id('phone')}-hint`} className="text-xs text-muted">
            {labels.phoneHint}
          </p>
          {error('phone') && (
            <p id={`${id('phone')}-error`} className="text-sm text-[#b42318]">
              {error('phone')}
            </p>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <label htmlFor={id('message')} className="block text-sm font-medium">
          {labels.message}
        </label>
        <textarea
          id={id('message')}
          name="message"
          required
          rows={5}
          maxLength={1500}
          disabled={disabled}
          aria-invalid={error('message') ? true : undefined}
          aria-describedby={describedBy('message')}
          className={cn(field, 'min-h-32 resize-y')}
        />
        {error('message') && (
          <p id={`${id('message')}-error`} className="text-sm text-[#b42318]">
            {error('message')}
          </p>
        )}
      </div>
      {/* Honeypot: off-screen, no tab stop; bots fill it. */}
      <div aria-hidden className="absolute -start-[9999px] h-px w-px overflow-hidden">
        <label>
          Company
          <input name="company" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div ref={bot.ref} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={disabled || pending} className="sb-btn sb-btn-primary">
          <Send strokeWidth={1.75} />
          {pending ? labels.sending : labels.send}
        </button>
        {!form && !editing && <span className="text-sm text-muted">{labels.preview}</span>}
      </div>
    </form>
  )
}

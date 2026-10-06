'use client'
import { AlertTriangle, CalendarClock, Loader2, Plus, Send } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { estimateAudienceAction, saveCampaignAction } from '@/app/dashboard/[tenant]/campaigns/actions'
import { Card, CardBody, CardFooter, CardHeader } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select, Textarea } from '@/components/ui/input'
import { NumberTicker } from '@/components/ui/motion'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import {
  CAMPAIGN_VARIABLES,
  linkLength,
  MAX_LINK,
  MAX_MESSAGE,
  previewCampaignMessage,
  unknownCampaignVariables,
} from './rules'

type Lang = 'en' | 'ar'
type Audience = {
  matched: number
  recipients: number
  skippedRecent: number
  skippedOverLimit: number
  en: number
  ar: number
  sampleEn: string | null
  sampleAr: string | null
}

export type ComposerInitial = {
  name: string
  segmentId: string
  bodyEn: string
  bodyAr: string
  promoCodeId: string
  when: 'now' | 'later'
  sendAt: string
}

export function CampaignComposer({
  slug,
  campaignId,
  segments,
  promos,
  spaName,
  bookingLink,
  newSegmentHref,
  minSendAt,
  initial,
}: {
  slug: string
  campaignId: string | null
  segments: { id: string; name: string; summary: string }[]
  promos: { id: string; code: string; label: string }[]
  spaName: string
  bookingLink: string
  newSegmentHref: string
  /** Dubai wall clock now, "YYYY-MM-DDTHH:MM". */
  minSendAt: string
  initial: ComposerInitial
}) {
  const router = useRouter()
  const [segmentId, setSegmentId] = useState(initial.segmentId)
  const [body, setBody] = useState<Record<Lang, string>>({ en: initial.bodyEn, ar: initial.bodyAr })
  const [promoId, setPromoId] = useState(initial.promoCodeId)
  const [when, setWhen] = useState(initial.when)
  const [sendAt, setSendAt] = useState(initial.sendAt)
  const [focused, setFocused] = useState<Lang>('en')
  const [audience, setAudience] = useState<Audience | null>(null)
  const [loading, startEstimate] = useTransition()
  const refs = { en: useRef<HTMLTextAreaElement>(null), ar: useRef<HTMLTextAreaElement>(null) }
  const request = useRef(0)

  useEffect(() => {
    if (!segmentId) {
      setAudience(null)
      return
    }
    const id = ++request.current
    const timer = setTimeout(() => {
      startEstimate(async () => {
        const res = await estimateAudienceAction(slug, { segmentId, when, sendAt, campaignId })
        if (id === request.current && res?.ok) setAudience(res.data as Audience)
      })
    }, 250)
    return () => {
      clearTimeout(timer)
    }
  }, [slug, segmentId, when, sendAt, campaignId])

  const insert = (variable: string) => {
    const el = refs[focused].current
    const token = `{${variable}}`
    const text = body[focused]
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    setBody((b) => ({ ...b, [focused]: text.slice(0, start) + token + text.slice(end) }))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const offerCode = promos.find((p) => p.id === promoId)?.code ?? null
  const sample = (lang: Lang) =>
    (lang === 'ar' ? audience?.sampleAr : audience?.sampleEn) ?? (lang === 'ar' ? 'فاطمة' : 'Fatima')
  const render = (lang: Lang) =>
    previewCampaignMessage(lang === 'ar' && !body.ar.trim() ? body.en : body[lang], {
      name: sample(lang),
      spa: spaName,
      bookingLink,
      offerCode,
    })
  const recipients = audience?.recipients ?? 0

  return (
    <ActionForm
      action={saveCampaignAction.bind(null, slug, campaignId)}
      onSuccess={(r) => {
        const href = r.data?.href
        if (typeof href === 'string') router.push(href)
      }}
      className="grid gap-6 lg:grid-cols-12 lg:gap-x-8"
    >
      {/* Phones: audience → message → preview → when. Desktop: preview sticks in the right column. */}
      <Card className="min-w-0 lg:col-span-7">
        <CardHeader title="Audience" description="Who receives this campaign." />
        <CardBody className="space-y-5">
          <Field label="Campaign name" name="name">
            <Input
              id="name"
              name="name"
              defaultValue={initial.name}
              placeholder="e.g. October win-back"
              maxLength={80}
            />
          </Field>
          <Field
            label="Segment"
            name="segmentId"
            hint={
              <Link
                href={newSegmentHref}
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <Plus className="size-3.5" strokeWidth={1.75} /> New segment
              </Link>
            }
          >
            <Select
              id="segmentId"
              name="segmentId"
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
            >
              <option value="">Choose a segment…</option>
              {segments.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          {segmentId && (
            <p className="text-[13px] text-muted">{segments.find((s) => s.id === segmentId)?.summary}</p>
          )}
          <AudienceSummary audience={audience} loading={loading} hasSegment={Boolean(segmentId)} />
        </CardBody>
      </Card>

      <Card className="min-w-0 lg:col-span-7 lg:col-start-1">
        <CardHeader
          title="Message"
          description="Each client gets it in their language. Arabic speakers get English if you leave Arabic empty."
        />
        <CardBody className="space-y-6">
          <div>
            <p className="text-[13px] font-medium">Insert a variable</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {CAMPAIGN_VARIABLES.map((v) => (
                <button
                  key={v.key}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(v.key)}
                  title={v.label}
                  className="inline-flex h-11 items-center gap-1 rounded-full border bg-surface px-3.5 font-mono text-xs transition-[background-color,border-color,transform] duration-150 hover:-translate-y-px hover:border-accent/40 hover:bg-accent-soft active:scale-[0.97] sm:h-9"
                >
                  <Plus className="size-3 text-accent" strokeWidth={2} />
                  {`{${v.key}}`}
                </button>
              ))}
            </div>
          </div>
          {(['en', 'ar'] as const).map((lang) => {
            const unknown = unknownCampaignVariables(body[lang])
            return (
              <Field
                key={lang}
                label={lang === 'en' ? 'English message' : 'Arabic message (optional)'}
                name={lang === 'en' ? 'bodyEn' : 'bodyAr'}
                hint={
                  unknown.length ? (
                    <span className="text-warning">Unknown: {unknown.map((u) => `{${u}}`).join(', ')}</span>
                  ) : (
                    `${body[lang].length} / ${MAX_MESSAGE}`
                  )
                }
              >
                <Textarea
                  ref={refs[lang]}
                  id={lang === 'en' ? 'bodyEn' : 'bodyAr'}
                  name={lang === 'en' ? 'bodyEn' : 'bodyAr'}
                  dir={lang === 'ar' ? 'rtl' : 'ltr'}
                  lang={lang}
                  rows={4}
                  maxLength={MAX_MESSAGE}
                  value={body[lang]}
                  onFocus={() => setFocused(lang)}
                  onChange={(e) => setBody((b) => ({ ...b, [lang]: e.target.value }))}
                  className="leading-relaxed"
                />
              </Field>
            )
          })}
          <Field
            label="Offer code"
            name="promoCodeId"
            hint="Optional. Fills {offer_code}. Create codes under Packages & gifts → Promo codes."
          >
            <Select
              id="promoCodeId"
              name="promoCodeId"
              value={promoId}
              onChange={(e) => setPromoId(e.target.value)}
            >
              <option value="">No offer code</option>
              {promos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <aside className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-span-3 lg:row-start-1">
        <Card aria-label="Message preview" className="lg:sticky lg:top-6">
          <CardHeader title="Preview" description="How it reads in WhatsApp for a client in each language." />
          <CardBody className="space-y-5">
            {(['en', 'ar'] as const).map((lang) => {
              const text = render(lang)
              const tooLong = linkLength(text) > MAX_LINK
              const n = audience ? (lang === 'en' ? audience.en : audience.ar) : null
              return (
                <div key={lang}>
                  <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">
                    {lang === 'en' ? 'English' : 'Arabic'} · {sample(lang)}
                    {n !== null && ` · ${n} ${n === 1 ? 'client' : 'clients'}`}
                  </p>
                  <div className="mt-2 rounded-xl bg-subtle/70 p-3 sm:p-4">
                    <div
                      data-testid={`campaign-preview-${lang}`}
                      dir={lang === 'ar' && body.ar.trim() ? 'rtl' : 'ltr'}
                      className="ms-auto w-fit max-w-[92%] whitespace-pre-wrap break-words rounded-xl rounded-se-sm bg-accent-soft px-3.5 py-2.5 text-sm leading-relaxed"
                    >
                      {text || <span className="text-muted">Nothing to send yet</span>}
                    </div>
                  </div>
                  {tooLong && (
                    <p className="mt-2 flex items-center gap-1.5 text-[13px] text-warning">
                      <AlertTriangle className="size-3.5" strokeWidth={1.75} />
                      Long message — WhatsApp may not open it. Shorten it a little.
                    </p>
                  )}
                </div>
              )
            })}
          </CardBody>
        </Card>
      </aside>

      <Card className="min-w-0 lg:col-span-7 lg:col-start-1">
        <CardHeader
          title="When"
          description="Messages appear in WhatsApp → Due at this time. Nothing is sent automatically — your team presses send for each one."
        />
        <CardBody className="space-y-4">
          <div
            role="radiogroup"
            aria-label="When"
            className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1"
          >
            {(
              [
                ['now', 'Now', Send],
                ['later', 'Schedule', CalendarClock],
              ] as const
            ).map(([value, label, Icon]) => (
              <label
                key={value}
                className={cn(
                  'relative flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg text-sm transition-colors',
                  when === value ? 'text-fg' : 'text-muted hover:text-fg',
                )}
              >
                {when === value && (
                  <motion.span
                    layoutId="campaign-when"
                    transition={spring}
                    className="absolute inset-0 rounded-lg bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.06)]"
                  />
                )}
                <input
                  type="radio"
                  name="when"
                  value={value}
                  checked={when === value}
                  onChange={() => setWhen(value)}
                  className="sr-only"
                />
                <Icon className="relative size-4" strokeWidth={1.5} />
                <span className="relative">{label}</span>
              </label>
            ))}
          </div>
          {when === 'later' && (
            <Field label="Date and time (Dubai)" name="sendAt">
              <Input
                id="sendAt"
                name="sendAt"
                type="datetime-local"
                min={minSendAt}
                value={sendAt}
                onChange={(e) => setSendAt(e.target.value)}
              />
            </Field>
          )}
        </CardBody>
        <CardFooter>
          <SubmitButton variant="secondary" name="intent" value="draft" className="w-full sm:w-auto">
            Save draft
          </SubmitButton>
          <SubmitButton
            name="intent"
            value="queue"
            disabled={!segmentId || (audience !== null && recipients === 0)}
            className="w-full sm:w-auto"
          >
            <Send /> Queue {recipients > 0 ? recipients : ''} {recipients === 1 ? 'message' : 'messages'}
          </SubmitButton>
        </CardFooter>
      </Card>
    </ActionForm>
  )
}

function AudienceSummary({
  audience,
  loading,
  hasSegment,
}: {
  audience: Audience | null
  loading: boolean
  hasSegment: boolean
}) {
  if (!hasSegment) return null
  return (
    <div className="rounded-xl border bg-subtle/40 px-4 py-4 sm:px-5" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted">Will receive it</p>
        {loading && <Loader2 className="size-4 animate-spin text-muted" strokeWidth={1.75} aria-hidden />}
      </div>
      <p className="mt-1 text-[28px] font-semibold tracking-tight" data-testid="campaign-recipients">
        {audience ? <NumberTicker value={audience.recipients} /> : '—'}
        <span className="ms-2 text-sm font-normal text-muted">
          of {audience?.matched ?? '—'} in the segment
        </span>
      </p>
      {audience && (audience.skippedRecent > 0 || audience.skippedOverLimit > 0) && (
        <ul className="mt-3 space-y-1 text-[13px] text-muted">
          {audience.skippedRecent > 0 && (
            <li>{audience.skippedRecent} skipped — already messaged by another campaign within 7 days</li>
          )}
          {audience.skippedOverLimit > 0 && (
            <li>{audience.skippedOverLimit} left out — a campaign reaches at most 500 clients</li>
          )}
        </ul>
      )}
    </div>
  )
}

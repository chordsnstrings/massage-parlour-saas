'use client'
import { AlertTriangle, CalendarClock, Loader2, Plus, Send } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { estimateAudienceAction, saveCampaignAction } from '@/app/dashboard/[tenant]/campaigns/actions'
import { Card } from '@/components/crm'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Select, Textarea } from '@/components/ui/input'
import { NumberTicker } from '@/components/ui/motion'
import { useI18n } from '@/i18n/client'
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
  const { t } = useI18n()
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
      <Card
        className="min-w-0 lg:col-span-7"
        title={t('campaigns.composer.audienceTitle')}
        sub={t('campaigns.composer.audienceSub')}
      >
        <div className="space-y-5">
          <Field label={t('campaigns.composer.name')} name="name">
            <Input
              id="name"
              name="name"
              defaultValue={initial.name}
              placeholder={t('campaigns.composer.namePlaceholder')}
              maxLength={80}
            />
          </Field>
          <Field
            label={t('campaigns.composer.segment')}
            name="segmentId"
            hint={
              <Link
                href={newSegmentHref}
                className="inline-flex items-center gap-1 text-accent hover:underline"
              >
                <Plus className="size-3.5" strokeWidth={1.75} /> {t('campaigns.newSegment')}
              </Link>
            }
          >
            <Select
              id="segmentId"
              name="segmentId"
              value={segmentId}
              onChange={(e) => setSegmentId(e.target.value)}
            >
              <option value="">{t('campaigns.composer.chooseSegment')}</option>
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
        </div>
      </Card>

      <Card
        className="min-w-0 lg:col-span-7 lg:col-start-1"
        title={t('campaigns.composer.messageTitle')}
        sub={t('campaigns.composer.messageSub')}
      >
        <div className="space-y-6">
          <div>
            <p className="text-[13px] font-medium">{t('campaigns.composer.insertVariable')}</p>
            <div className="mt-2.5 flex flex-wrap gap-2">
              {CAMPAIGN_VARIABLES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insert(v)}
                  title={t(`campaigns.variables.${v}`)}
                  className="inline-flex h-11 items-center gap-1 rounded-full border bg-surface px-3.5 font-mono text-xs transition-[background-color,border-color,transform] duration-150 hover:-translate-y-px hover:border-accent/40 hover:bg-accent-soft active:scale-[0.97] sm:h-9"
                >
                  <Plus className="size-3 text-accent" strokeWidth={2} />
                  {`{${v}}`}
                </button>
              ))}
            </div>
          </div>
          {(['en', 'ar'] as const).map((lang) => {
            const unknown = unknownCampaignVariables(body[lang])
            return (
              <Field
                key={lang}
                label={
                  lang === 'en' ? t('campaigns.composer.englishMessage') : t('campaigns.composer.arabicMessage')
                }
                name={lang === 'en' ? 'bodyEn' : 'bodyAr'}
                hint={
                  unknown.length ? (
                    <span className="text-warning">
                      {t('campaigns.composer.unknown', { list: unknown.map((u) => `{${u}}`).join(', ') })}
                    </span>
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
            label={t('campaigns.composer.offerCode')}
            name="promoCodeId"
            hint={t('campaigns.composer.offerHint', { variable: '{offer_code}' })}
          >
            <Select
              id="promoCodeId"
              name="promoCodeId"
              value={promoId}
              onChange={(e) => setPromoId(e.target.value)}
            >
              <option value="">{t('campaigns.composer.noOffer')}</option>
              {promos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.code} · {p.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <aside className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-span-3 lg:row-start-1">
        <Card
          aria-label={t('campaigns.composer.previewAria')}
          className="lg:sticky lg:top-6"
          title={t('campaigns.composer.previewTitle')}
          sub={t('campaigns.composer.previewSub')}
        >
          <div className="space-y-5">
            {(['en', 'ar'] as const).map((lang) => {
              const text = render(lang)
              const tooLong = linkLength(text) > MAX_LINK
              const n = audience ? (lang === 'en' ? audience.en : audience.ar) : null
              return (
                <div key={lang}>
                  <p className="text-xs font-medium uppercase tracking-[0.06em] text-muted">
                    {lang === 'en' ? t('campaigns.composer.english') : t('campaigns.composer.arabic')} ·{' '}
                    {sample(lang)}
                    {n !== null && ` · ${t('campaigns.composer.clients', { count: n })}`}
                  </p>
                  <div className="mt-2 rounded-xl bg-subtle/70 p-3 sm:p-4">
                    <div
                      data-testid={`campaign-preview-${lang}`}
                      dir={lang === 'ar' && body.ar.trim() ? 'rtl' : 'ltr'}
                      className="ms-auto w-fit max-w-[92%] whitespace-pre-wrap break-words rounded-xl rounded-se-sm bg-accent-soft px-3.5 py-2.5 text-sm leading-relaxed"
                    >
                      {text || <span className="text-muted">{t('campaigns.composer.nothing')}</span>}
                    </div>
                  </div>
                  {tooLong && (
                    <p className="mt-2 flex items-center gap-1.5 text-[13px] text-warning">
                      <AlertTriangle className="size-3.5" strokeWidth={1.75} />
                      {t('campaigns.composer.tooLong')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      </aside>

      <Card
        className="min-w-0 lg:col-span-7 lg:col-start-1"
        title={t('campaigns.composer.whenTitle')}
        sub={t('campaigns.composer.whenSub')}
      >
        <div className="space-y-4">
          <div
            role="radiogroup"
            aria-label={t('campaigns.composer.whenTitle')}
            className="grid grid-cols-2 gap-1 rounded-xl bg-subtle p-1"
          >
            {(
              [
                ['now', t('campaigns.composer.now'), Send],
                ['later', t('campaigns.composer.schedule'), CalendarClock],
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
            <Field label={t('campaigns.composer.sendAt')} name="sendAt">
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
        </div>
        <div className="mt-4 flex flex-col-reverse gap-2 border-t border-[var(--crm-line)] pt-4 sm:flex-row sm:justify-end">
          <SubmitButton variant="secondary" name="intent" value="draft" className="w-full sm:w-auto">
            {t('campaigns.composer.saveDraft')}
          </SubmitButton>
          <SubmitButton
            name="intent"
            value="queue"
            disabled={!segmentId || (audience !== null && recipients === 0)}
            className="w-full sm:w-auto"
          >
            <Send />{' '}
            {recipients > 0
              ? t('campaigns.composer.queue', { count: recipients })
              : t('campaigns.composer.queueNone')}
          </SubmitButton>
        </div>
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
  const { t, fmt } = useI18n()
  if (!hasSegment) return null
  return (
    <div className="rounded-xl border border-[var(--crm-line)] bg-[var(--crm-surface2)] px-4 py-4 sm:px-5" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted">{t('campaigns.composer.willReceive')}</p>
        {loading && <Loader2 className="size-4 animate-spin text-muted" strokeWidth={1.75} aria-hidden />}
      </div>
      <p className="mt-1 text-[28px] font-semibold tracking-tight" data-testid="campaign-recipients">
        {audience ? <NumberTicker value={audience.recipients} /> : '—'}
        <span className="ms-2 text-sm font-normal text-muted">
          {t('campaigns.composer.ofSegment', {
            count: audience ? fmt.number(audience.matched) : '—',
          })}
        </span>
      </p>
      {audience && (audience.skippedRecent > 0 || audience.skippedOverLimit > 0) && (
        <ul className="mt-3 space-y-1 text-[13px] text-muted">
          {audience.skippedRecent > 0 && (
            <li>{t('campaigns.detail.skippedRecent', { count: fmt.number(audience.skippedRecent) })}</li>
          )}
          {audience.skippedOverLimit > 0 && (
            <li>
              {t('campaigns.detail.skippedOverLimit', { count: fmt.number(audience.skippedOverLimit) })}
            </li>
          )}
        </ul>
      )}
    </div>
  )
}

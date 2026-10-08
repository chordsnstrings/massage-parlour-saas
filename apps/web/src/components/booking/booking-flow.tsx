'use client'
import {
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  Check,
  Clock,
  Languages,
  MapPin,
  MessageCircle,
  Sparkles,
  User,
} from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ActionForm, Field, SubmitButton } from '@/components/ui/form'
import { Input, Textarea } from '@/components/ui/input'
import { Stagger, StaggerItem } from '@/components/ui/motion'
import { EmptyState, Skeleton } from '@/components/ui/page'
import { toast } from '@/components/ui/toast'
import type { ActionResult } from '@/lib/action'
import { duration, ease, spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { bookOnline, getSlots } from './actions'
import { fmtDate, fmtPrice, fmtTime, type Locale, pick, t } from './i18n'
import { icsDataUrl } from './ics'
import type {
  BookingCatalog,
  BookingDone,
  BookingService,
  BookingVariant,
  SiteKey,
  SlotOption,
} from './types'

type Step = 'service' | 'when' | 'details' | 'done'
const STEPS: { key: Exclude<Step, 'done'>; label: 'stepService' | 'stepWhen' | 'stepDetails' }[] = [
  { key: 'service', label: 'stepService' },
  { key: 'when', label: 'stepWhen' },
  { key: 'details', label: 'stepDetails' },
]

const chip =
  'select-none rounded-xl border bg-surface text-sm transition-[background-color,border-color,color,transform,box-shadow] duration-150 ease-[var(--ease-calm)] hover:-translate-y-px hover:border-fg/20 active:scale-[0.98] aria-pressed:border-accent aria-pressed:bg-accent-soft aria-pressed:text-fg focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-45'

export function BookingFlow({
  site,
  catalog,
  locale,
  homeHref,
  langHref,
  initialServiceId,
}: {
  site: SiteKey
  catalog: BookingCatalog
  locale: Locale
  homeHref: string
  langHref: string
  initialServiceId?: string
}) {
  const L = (key: Parameters<typeof t>[0]) => t(key, locale)
  const rtl = locale === 'ar'
  const reduce = useReducedMotion()
  const services = useMemo(() => catalog.groups.flatMap((g) => g.services), [catalog])
  const initial = services.find((s) => s.id === initialServiceId)

  const [step, setStep] = useState<Step>(initial?.variants.length === 1 ? 'when' : 'service')
  const [dirSign, setDirSign] = useState(1)
  const [service, setService] = useState<BookingService | null>(initial ?? null)
  const [variant, setVariant] = useState<BookingVariant | null>(
    initial?.variants.length === 1 ? initial.variants[0]! : null,
  )
  const [date, setDate] = useState(() => catalog.dates.find((d) => !d.closed)?.date ?? catalog.dates[0]!.date)
  const [staffId, setStaffId] = useState('')
  const [slot, setSlot] = useState<SlotOption | null>(null)
  const [slots, setSlots] = useState<SlotOption[] | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [done, setDone] = useState<BookingDone | null>(null)
  const [loading, startLoading] = useTransition()
  const request = useRef(0)
  const topRef = useRef<HTMLDivElement>(null)

  const therapists = useMemo(
    () =>
      service && service.therapistsRequired === 1
        ? catalog.therapists.filter((p) => p.serviceIds.includes(service.id))
        : [],
    [catalog.therapists, service],
  )
  const therapist = catalog.therapists.find((p) => p.id === staffId) ?? null

  const go = useCallback(
    (next: Step) => {
      const order: Step[] = ['service', 'when', 'details', 'done']
      setDirSign(order.indexOf(next) >= order.indexOf(step) ? 1 : -1)
      setStep(next)
      requestAnimationFrame(() => {
        const top = topRef.current?.getBoundingClientRect().top ?? 0
        if (top < 0) topRef.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
      })
    },
    [step, reduce],
  )

  const loadSlots = useCallback(() => {
    if (!variant) return
    const id = ++request.current
    setSlots(null)
    startLoading(async () => {
      const res = await getSlots({ site, variantId: variant.id, date, staffId, lang: locale })
      if (id !== request.current) return
      if (res?.ok) setSlots((res.data?.slots as SlotOption[]) ?? [])
      else {
        setSlots([])
        toast.error(res?.error ?? t('error', locale))
      }
    })
  }, [site, variant, date, staffId, locale])

  useEffect(() => {
    if (step === 'when') loadSlots()
  }, [step, loadSlots])

  const chooseVariant = (s: BookingService, v: BookingVariant) => {
    setService(s)
    setVariant(v)
    if (s.id !== service?.id) setStaffId('')
    setSlot(null)
    setNotice(null)
    go('when')
  }

  const submit = async (_: ActionResult, fd: FormData): Promise<ActionResult> => {
    if (!variant || !slot) return { ok: false, error: L('error') }
    const res = await bookOnline({
      site,
      variantId: variant.id,
      start: slot.start,
      staffId,
      name: String(fd.get('name') ?? ''),
      phone: String(fd.get('phone') ?? ''),
      notes: String(fd.get('notes') ?? ''),
      website: String(fd.get('website') ?? ''),
      lang: locale,
    })
    if (res && !res.ok && res.fieldErrors?.start) {
      // Someone else got there first: back to times with a fresh list.
      setSlot(null)
      setNotice(res.fieldErrors.start)
      go('when')
      loadSlots()
    }
    return res
  }

  const grouped = useMemo(() => {
    const parts = { morning: [] as SlotOption[], afternoon: [] as SlotOption[], evening: [] as SlotOption[] }
    for (const s of slots ?? []) {
      const m = s.minutes
      if (m < 12 * 60) parts.morning.push(s)
      else if (m < 17 * 60) parts.afternoon.push(s)
      else parts.evening.push(s)
    }
    return parts
  }, [slots])

  const today = catalog.dates[0]?.date
  const tomorrow = catalog.dates[1]?.date
  const dayLabel = (d: string) => (d === today ? L('today') : d === tomorrow ? L('tomorrow') : null)
  const stepIndex = STEPS.findIndex((s) => s.key === step)

  const summary = (
    <Summary
      locale={locale}
      service={service}
      variant={variant}
      date={step === 'service' ? null : date}
      slot={slot}
      therapist={therapist?.name ?? null}
      catalog={catalog}
    />
  )

  return (
    <div dir={rtl ? 'rtl' : 'ltr'} lang={locale} className="min-h-dvh bg-bg text-fg">
      <header className="sticky top-0 z-20 border-b bg-surface/85 backdrop-blur supports-[backdrop-filter]:bg-surface/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
          <a
            href={homeHref}
            className="group -ms-2 inline-flex min-h-11 min-w-0 items-center gap-2 rounded-lg px-2 text-[15px] font-semibold tracking-tight"
          >
            <ArrowLeft className="size-4 shrink-0 text-muted transition-transform duration-150 group-hover:-translate-x-0.5 rtl:rotate-180 rtl:group-hover:translate-x-0.5" />
            <span className="truncate">{catalog.spa}</span>
            <span className="sr-only">— {L('backToSite')}</span>
          </a>
          <a
            href={langHref}
            hrefLang={rtl ? 'en' : 'ar'}
            className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm text-muted transition-colors hover:bg-subtle hover:text-fg"
          >
            <Languages className="size-4" />
            {L('langSwitch')}
          </a>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl grid-cols-12 gap-x-6 gap-y-8 px-4 py-8 sm:px-6 sm:py-12 lg:gap-x-12 lg:px-8 lg:py-16">
        <div ref={topRef} className="col-span-12 scroll-mt-20 lg:col-span-8">
          {step !== 'done' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                  {L('title')}
                </h1>
                <p className="max-w-xl text-[15px] text-muted text-pretty">{L('intro')}</p>
              </div>
              <ol className="flex items-center gap-2 sm:gap-3" aria-label={L('summary')}>
                {STEPS.map((s, i) => {
                  const state = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo'
                  return (
                    <li
                      key={s.key}
                      className={cn(
                        'flex min-w-0 items-center gap-2 sm:gap-3',
                        i < STEPS.length - 1 ? 'flex-1' : 'shrink-0',
                      )}
                    >
                      <button
                        type="button"
                        disabled={state !== 'done'}
                        onClick={() => go(s.key)}
                        aria-current={state === 'current' ? 'step' : undefined}
                        className="flex min-h-11 shrink-0 items-center gap-2 rounded-lg text-start disabled:cursor-default"
                      >
                        <span
                          className={cn(
                            'grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold tabular-nums transition-colors duration-200',
                            state === 'current' && 'border-accent bg-accent text-accent-fg',
                            state === 'done' && 'border-accent/40 bg-accent-soft text-accent',
                            state === 'todo' && 'text-muted',
                          )}
                        >
                          {state === 'done' ? <Check className="size-3.5" /> : i + 1}
                        </span>
                        <span
                          className={cn(
                            'whitespace-nowrap text-[13px] font-medium',
                            state === 'todo' ? 'text-muted' : 'text-fg',
                            state !== 'current' && 'max-sm:hidden',
                          )}
                        >
                          {L(s.label)}
                        </span>
                      </button>
                      {i < STEPS.length - 1 && (
                        <span className="h-px min-w-4 flex-1 bg-border" aria-hidden>
                          <motion.span
                            className="block h-px origin-left bg-accent rtl:origin-right"
                            initial={false}
                            animate={{ scaleX: i < stepIndex ? 1 : 0 }}
                            transition={{ duration: duration.layout, ease }}
                          />
                        </span>
                      )}
                    </li>
                  )
                })}
              </ol>
              {step !== 'service' && <div className="lg:hidden">{summary}</div>}
            </div>
          )}

          <AnimatePresence mode="wait" initial={false} custom={dirSign}>
            <motion.div
              key={step}
              custom={dirSign}
              initial={{ opacity: 0, x: (rtl ? -1 : 1) * dirSign * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: (rtl ? 1 : -1) * dirSign * 24 }}
              transition={{ duration: duration.layout, ease }}
              className={cn(step !== 'done' && 'mt-8 sm:mt-10')}
            >
              {step === 'service' && (
                <ServiceStep catalog={catalog} locale={locale} variant={variant} onPick={chooseVariant} />
              )}

              {step === 'when' && variant && (
                <section className="space-y-8" aria-labelledby="when-title">
                  <h2 id="when-title" className="sr-only">
                    {L('stepWhen')}
                  </h2>
                  <div className="space-y-3">
                    <h3 className="text-[15px] font-semibold tracking-tight">{L('chooseDate')}</h3>
                    <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:overflow-visible sm:px-0">
                      <div className="flex gap-2 sm:grid sm:grid-cols-7">
                        {catalog.dates.map((d) => {
                          const special = dayLabel(d.date)
                          return (
                            <button
                              key={d.date}
                              type="button"
                              disabled={d.closed}
                              aria-pressed={d.date === date}
                              onClick={() => {
                                setDate(d.date)
                                setSlot(null)
                                setNotice(null)
                              }}
                              className={cn(
                                chip,
                                'flex min-h-16 w-[4.75rem] shrink-0 flex-col items-center justify-center gap-0.5 px-2 py-2 sm:w-auto',
                              )}
                            >
                              <span className="text-[11px] font-medium uppercase tracking-wide text-muted">
                                {special ?? fmtDate(d.date, locale, { day: undefined, month: undefined })}
                              </span>
                              <span className="text-lg font-semibold leading-none tabular-nums">
                                {fmtDate(d.date, locale, { weekday: undefined, month: undefined })}
                              </span>
                              <span className="text-[11px] text-muted">
                                {d.closed
                                  ? L('closed')
                                  : fmtDate(d.date, locale, { weekday: undefined, day: undefined })}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  </div>

                  {therapists.length > 1 && (
                    <fieldset className="space-y-3">
                      <legend className="mb-3 text-[15px] font-semibold tracking-tight">
                        {L('therapist')}
                      </legend>
                      <div className="flex flex-wrap gap-2">
                        {[{ id: '', name: L('anyTherapist'), photoUrl: null }, ...therapists].map((p) => (
                          <button
                            key={p.id || 'any'}
                            type="button"
                            aria-pressed={staffId === p.id}
                            onClick={() => {
                              setStaffId(p.id)
                              setSlot(null)
                            }}
                            className={cn(chip, 'inline-flex min-h-11 items-center gap-2 px-3.5')}
                          >
                            {p.id ? (
                              <span className="grid size-6 place-items-center overflow-hidden rounded-full bg-subtle text-[11px] font-semibold text-muted">
                                {p.photoUrl ? (
                                  // biome-ignore lint/performance/noImgElement: tenant-uploaded photo, tiny avatar
                                  <img src={p.photoUrl} alt="" className="size-full object-cover" />
                                ) : (
                                  p.name.slice(0, 1)
                                )}
                              </span>
                            ) : (
                              <Sparkles className="size-4 text-muted" />
                            )}
                            {p.name}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  )}

                  <div className="space-y-4" aria-busy={loading}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h3 className="text-[15px] font-semibold tracking-tight">{L('chooseTime')}</h3>
                      <span className="text-[13px] text-muted">
                        {fmtDate(date, locale, { weekday: 'long', month: 'long' })}
                      </span>
                    </div>
                    {notice && (
                      <p
                        role="status"
                        className="anim-fade-in rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning"
                      >
                        {notice}
                      </p>
                    )}
                    {slots === null ? (
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                        <span className="sr-only">{L('loadingTimes')}</span>
                        {Array.from({ length: 12 }, (_, i) => (
                          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
                          <Skeleton key={i} className="h-11" />
                        ))}
                      </div>
                    ) : slots.length === 0 ? (
                      <Card className="anim-fade-in">
                        <EmptyState
                          icon={<Clock className="size-5" />}
                          title={L('noTimes')}
                          description={L('noTimesHint')}
                        />
                      </Card>
                    ) : (
                      <div className="space-y-6" data-testid="slots">
                        {(['morning', 'afternoon', 'evening'] as const).map((part) =>
                          grouped[part].length ? (
                            <div key={part} className="space-y-2.5">
                              <p className="text-[12px] font-medium uppercase tracking-wide text-muted">
                                {L(part)}
                              </p>
                              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
                                {grouped[part].map((s, i) => (
                                  <motion.div
                                    key={s.start}
                                    initial={{ opacity: 0, y: 6 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{
                                      duration: duration.base,
                                      ease,
                                      delay: Math.min(i, 12) * 0.015,
                                    }}
                                  >
                                    <button
                                      type="button"
                                      aria-pressed={slot?.start === s.start}
                                      onClick={() => {
                                        setSlot(s)
                                        setNotice(null)
                                        go('details')
                                      }}
                                      className={cn(chip, 'h-11 w-full font-medium tabular-nums')}
                                    >
                                      {fmtTime(s.start, locale)}
                                    </button>
                                  </motion.div>
                                ))}
                              </div>
                            </div>
                          ) : null,
                        )}
                      </div>
                    )}
                  </div>

                  <div>
                    <Button variant="ghost" className="-ms-3 min-h-11" onClick={() => go('service')}>
                      <ArrowLeft className="rtl:rotate-180" />
                      {L('back')}
                    </Button>
                  </div>
                </section>
              )}

              {step === 'details' && variant && slot && (
                <section aria-labelledby="details-title">
                  <h2 id="details-title" className="mb-5 text-[15px] font-semibold tracking-tight">
                    {L('stepDetails')}
                  </h2>
                  <ActionForm
                    action={submit}
                    onSuccess={(r) => {
                      setDone(r.data?.booking as BookingDone)
                      // Cookieless site analytics (public/t.js) — closes the booking funnel.
                      ;(window as { spaTrack?: (type: string, extra?: object) => void }).spaTrack?.(
                        'booking_complete',
                        { element: `${variant.durationMin} min` },
                      )
                      go('done')
                    }}
                    className="space-y-5"
                  >
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <Field label={L('name')} name="name">
                        <Input
                          id="name"
                          name="name"
                          autoComplete="name"
                          required
                          maxLength={80}
                          className="h-11 text-base sm:text-sm"
                        />
                      </Field>
                      <Field label={L('phone')} name="phone" hint={L('phoneHint')}>
                        <Input
                          id="phone"
                          name="phone"
                          type="tel"
                          inputMode="tel"
                          autoComplete="tel"
                          placeholder="050 123 4567"
                          dir="ltr"
                          required
                          className="h-11 text-base sm:text-sm rtl:text-right"
                        />
                      </Field>
                    </div>
                    <Field label={L('notes')} name="notes" hint={L('notesHint')}>
                      <Textarea
                        id="notes"
                        name="notes"
                        maxLength={500}
                        rows={3}
                        className="text-base sm:text-sm"
                      />
                    </Field>
                    {/* Honeypot: hidden from people and assistive tech; bots tend to fill it. */}
                    <div
                      aria-hidden
                      className="pointer-events-none absolute h-px w-px overflow-hidden opacity-0 [clip:rect(0,0,0,0)]"
                    >
                      <label htmlFor="website">Website</label>
                      <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
                    </div>
                    <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center sm:justify-between">
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-11 sm:-ms-3"
                        onClick={() => go('when')}
                      >
                        <ArrowLeft className="rtl:rotate-180" />
                        {L('back')}
                      </Button>
                      <SubmitButton size="lg" className="min-h-12 w-full sm:w-auto">
                        {L('confirm')}
                        <ArrowRight className="rtl:rotate-180" />
                      </SubmitButton>
                    </div>
                    <p className="text-[13px] text-muted">{L('payAtSpa')}</p>
                  </ActionForm>
                </section>
              )}

              {step === 'done' && done && (
                <DoneView
                  done={done}
                  locale={locale}
                  onAgain={() => {
                    setDone(null)
                    setSlot(null)
                    setVariant(null)
                    setService(null)
                    go('service')
                  }}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {step !== 'done' && (
          <aside className="hidden lg:col-span-4 lg:block">
            <div className="sticky top-24">{summary}</div>
          </aside>
        )}
      </main>
    </div>
  )
}

function ServiceStep({
  catalog,
  locale,
  variant,
  onPick,
}: {
  catalog: BookingCatalog
  locale: Locale
  variant: BookingVariant | null
  onPick: (s: BookingService, v: BookingVariant) => void
}) {
  const L = (key: Parameters<typeof t>[0]) => t(key, locale)
  return (
    <section className="space-y-10" aria-labelledby="service-title">
      <h2 id="service-title" className="sr-only">
        {L('chooseService')}
      </h2>
      {catalog.groups.map((g) => (
        <div key={g.id} className="space-y-4">
          {catalog.groups.length > 1 && (
            <h3 className="text-[12px] font-medium uppercase tracking-wide text-muted">
              {g.name ? pick(g.name, locale) : L('other')}
            </h3>
          )}
          <Stagger className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {g.services.map((s) => {
              const name = pick(s.name, locale)
              const desc = pick(s.description, locale)
              return (
                <StaggerItem key={s.id} className="h-full">
                  <Card
                    aria-label={name}
                    className="flex h-full flex-col gap-4 p-5 transition-[border-color,transform] duration-200 ease-[var(--ease-calm)] hover:-translate-y-0.5 hover:border-fg/15 sm:p-6"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-start justify-between gap-3">
                        <h4 className="text-base font-semibold tracking-tight">{name}</h4>
                        {s.therapistsRequired > 1 && (
                          <Badge tone="accent">
                            <User className="size-3" />×{s.therapistsRequired}
                          </Badge>
                        )}
                      </div>
                      {desc && <p className="line-clamp-3 text-sm text-muted text-pretty">{desc}</p>}
                    </div>
                    <div className="mt-auto flex flex-wrap gap-2">
                      {s.variants.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          aria-pressed={variant?.id === v.id}
                          onClick={() => onPick(s, v)}
                          className={cn(chip, 'inline-flex min-h-11 items-center gap-2 px-3.5')}
                        >
                          <span className="font-medium tabular-nums">
                            {v.durationMin} {L('min')}
                          </span>
                          <span className="text-muted" aria-hidden>
                            ·
                          </span>
                          <span className="tabular-nums">{fmtPrice(v.priceAed, locale)}</span>
                        </button>
                      ))}
                    </div>
                  </Card>
                </StaggerItem>
              )
            })}
          </Stagger>
        </div>
      ))}
      <p className="text-[13px] text-muted">{L('vatIncl')}</p>
    </section>
  )
}

function Summary({
  locale,
  service,
  variant,
  date,
  slot,
  therapist,
  catalog,
}: {
  locale: Locale
  service: BookingService | null
  variant: BookingVariant | null
  date: string | null
  slot: SlotOption | null
  therapist: string | null
  catalog: BookingCatalog
}) {
  const L = (key: Parameters<typeof t>[0]) => t(key, locale)
  return (
    <Card className="overflow-hidden" aria-label={L('summary')}>
      <div className="space-y-4 p-5 sm:p-6">
        <p className="text-[12px] font-medium uppercase tracking-wide text-muted">{L('summary')}</p>
        {!service || !variant ? (
          <p className="text-sm text-muted">{L('nothingYet')}</p>
        ) : (
          <dl className="space-y-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <dt className="sr-only">{L('stepService')}</dt>
              <dd className="font-medium">
                {pick(service.name, locale)}
                <span className="block text-[13px] font-normal text-muted">
                  {variant.durationMin} {L('min')}
                </span>
              </dd>
              <dd className="font-medium tabular-nums">{fmtPrice(variant.priceAed, locale)}</dd>
            </div>
            {date && (
              <div className="flex items-center gap-2 text-muted">
                <dt className="sr-only">{L('stepWhen')}</dt>
                <Clock className="size-4 shrink-0" />
                <dd>
                  {fmtDate(date, locale, { weekday: 'long', month: 'long' })}
                  {slot && <span className="text-fg"> · {fmtTime(slot.start, locale)}</span>}
                </dd>
              </div>
            )}
            {therapist && (
              <div className="flex items-center gap-2 text-muted">
                <dt className="sr-only">{L('therapist')}</dt>
                <User className="size-4 shrink-0" />
                <dd>{therapist}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
      {(catalog.branch.address || catalog.branch.name) && (
        <div className="flex items-start gap-2 border-t bg-subtle/40 px-5 py-3.5 text-[13px] text-muted sm:px-6">
          <MapPin className="mt-0.5 size-3.5 shrink-0" />
          <span>{catalog.branch.address || catalog.branch.name}</span>
        </div>
      )}
    </Card>
  )
}

function DoneView({ done, locale, onAgain }: { done: BookingDone; locale: Locale; onAgain: () => void }) {
  const L = (key: Parameters<typeof t>[0]) => t(key, locale)
  const day = new Intl.DateTimeFormat(locale === 'ar' ? 'ar-AE-u-nu-latn' : 'en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Asia/Dubai',
  }).format(new Date(done.start))
  const ics = icsDataUrl({
    uid: `${done.ref}@spamanagement.ae`,
    start: done.start,
    end: done.end,
    title: `${done.service} — ${done.spa}`,
    location: done.address,
    description: `${L('ref')}: ${done.ref}`,
  })
  const rows: [string, string][] = [
    [L('stepService'), done.service],
    [L('stepWhen'), `${day} · ${fmtTime(done.start, locale)}`],
    ...(done.therapist ? ([[L('therapist'), done.therapist]] as [string, string][]) : []),
    [L('total'), fmtPrice(done.priceAed, locale)],
  ]
  return (
    <section className="mx-auto max-w-xl space-y-8 py-4 text-center sm:py-8" aria-live="polite">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={spring}
        className="mx-auto grid size-16 place-items-center rounded-full bg-accent-soft text-accent"
      >
        <Check className="size-7" strokeWidth={2.25} />
      </motion.div>
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{L('doneTitle')}</h1>
        <p className="mx-auto max-w-md text-[15px] text-muted text-pretty">{L('doneBody')}</p>
      </div>
      <Card className="text-start">
        <div className="flex items-center justify-between gap-3 border-b px-5 py-4 sm:px-6">
          <span className="text-[13px] text-muted">{L('ref')}</span>
          <span
            data-testid="booking-ref"
            className="text-xl font-semibold tabular-nums tracking-[0.12em]"
            dir="ltr"
          >
            {done.ref}
          </span>
        </div>
        <dl className="divide-y">
          {rows.map(([k, v]) => (
            <div key={k} className="flex items-start justify-between gap-4 px-5 py-3.5 text-sm sm:px-6">
              <dt className="shrink-0 whitespace-nowrap text-muted">{k}</dt>
              <dd className="text-end font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
        {done.whatsappUrl && (
          <Button asChild size="lg" className="min-h-12">
            <a href={done.whatsappUrl} target="_blank" rel="noopener noreferrer">
              <MessageCircle />
              {L('confirmWhatsapp')}
            </a>
          </Button>
        )}
        <Button asChild size="lg" variant="secondary" className="min-h-12">
          <a href={ics} download={`booking-${done.ref}.ics`}>
            <CalendarPlus />
            {L('addCalendar')}
          </a>
        </Button>
      </div>
      <Button variant="ghost" className="min-h-11" onClick={onAgain}>
        {L('bookAnother')}
      </Button>
    </section>
  )
}

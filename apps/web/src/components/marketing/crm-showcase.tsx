'use client'
import type { Locale } from '@spa/core/i18n/types'
import { CalendarCheck, MessageCircle, ReceiptText, Wallet } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CrmDashboard, DeviceBar, LanguageToggle, Typed, TypedNote } from '@/components/marketing/crm-demo'
import type { CrmDemoCopy } from '@/components/marketing/crm-demo-copy'

// Home "Spa CRM" showcase (PLAN §18.8): the dashboard mock lies back in 3D and straightens as the section scrolls in,
// while four feature cards float around it at their own depth. The motion is CSS scroll-driven
// (`animation-timeline`, marketing.css `.mkt-show*`, transform/opacity only); browsers without it get the same
// curves from `useScrollFallback` below. `prefers-reduced-motion: reduce` → static, flat layout (both paths).

export function CrmShowcase({ copy }: { copy: Record<Locale, CrmDemoCopy> }) {
  const [locale, setLocale] = useState<Locale>('en')
  const c = copy[locale]
  const stage = useRef<HTMLDivElement>(null)
  useScrollFallback(stage)

  return (
    <div className="mt-12">
      <LanguageToggle locale={locale} onChange={setLocale} />
      <div ref={stage} className="mkt-show-stage" data-testid="crm-showcase-stage">
        <div className="mkt-show-dwrap">
          <figure data-show="dash" className="mkt-show-dash mkt-device" aria-label="Example spa dashboard">
            <DeviceBar />
            <CrmDashboard key={locale} c={c} overview />
          </figure>
        </div>

        <Card slot="cal" icon={CalendarCheck} caption="Calendar · no double-booking" locale={locale}>
          <div className="flex items-center justify-between gap-2">
            <p className="crm-demo-h">{c.calendar.title}</p>
            <span className="text-[11px] text-[var(--mute)]">{c.calendar.today}</span>
          </div>
          <div className="mkt-show-slotrow mt-2">
            <span className="tabular-nums">{c.calendar.booked.time}</span>
            <div className="mkt-show-booked">
              <p className="truncate font-semibold">
                <Typed>{c.calendar.booked.client}</Typed>
              </p>
              <p className="truncate text-[11px]">
                <Typed>{c.calendar.booked.service}</Typed> · <Typed>{c.calendar.booked.therapist}</Typed>
              </p>
            </div>
          </div>
          <div className="mkt-show-slotrow mt-1.5">
            <span className="tabular-nums">{c.calendar.clashTime}</span>
            <p className="mkt-show-clash">{c.calendar.clash}</p>
          </div>
        </Card>

        <Card slot="pos" icon={ReceiptText} caption="Till · full tax invoice" locale={locale}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="crm-demo-h">{c.invoice.title}</p>
            <span className="text-[11px] text-[var(--mute)] tabular-nums">{c.invoice.number}</span>
          </div>
          <ul className="mt-2 space-y-1 text-[12px]">
            {c.invoice.lines.map((l) => (
              <li key={l.name} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">
                  <Typed>{l.name}</Typed>
                </span>
                <span className="shrink-0 tabular-nums">{l.amount}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-2 space-y-0.5 border-t border-[var(--line)] pt-2 text-[12px]">
            <div className="flex justify-between gap-2 text-[var(--mute)]">
              <dt className="truncate">{c.invoice.vat}</dt>
              <dd className="shrink-0 tabular-nums">{c.invoice.vatAmount}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <dt className="font-semibold">{c.invoice.total}</dt>
              <dd className="crm-demo-num text-[15px]">{c.invoice.totalAmount}</dd>
            </div>
          </dl>
        </Card>

        <Card slot="wa" icon={MessageCircle} caption="WhatsApp · you tap send" locale={locale}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="crm-demo-h truncate">{c.whatsapp.title}</p>
            <span className="shrink-0 text-[11px] text-[var(--mute)]">{c.whatsapp.ready}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2 text-[12px]">
            <span className="min-w-0 truncate">
              <span className="crm-demo-st" data-tone="confirmed">
                {c.whatsapp.kind}
              </span>{' '}
              <Typed>{c.whatsapp.client}</Typed>
            </span>
            <span className="shrink-0 text-[11px] text-[var(--mute)] tabular-nums">{c.whatsapp.due}</span>
          </div>
          <p className="mkt-show-wa mt-2.5">{c.whatsapp.open}</p>
        </Card>

        <Card slot="earn" icon={Wallet} caption="Therapists · own earnings" locale={locale}>
          <div className="flex items-center justify-between gap-2">
            <p className="crm-demo-h">{c.earnings.title}</p>
            <span className="crm-demo-pill" data-on>
              {c.earnings.period}
            </span>
          </div>
          <dl className="mt-2 space-y-0.5 text-[12px]">
            {c.earnings.rows.map((r) => (
              <div key={r.key} className="flex justify-between gap-2 text-[var(--mute)]">
                <dt>{r.label}</dt>
                <dd className="tabular-nums">{r.amount}</dd>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-2 border-t border-[var(--line)] pt-1.5">
              <dt className="font-semibold">
                {c.earnings.total} · <Typed>{c.earnings.therapist}</Typed>
              </dt>
              <dd className="crm-demo-num text-[15px]">{c.earnings.totalAmount}</dd>
            </div>
          </dl>
        </Card>
      </div>
      <TypedNote className="mt-9" />
    </div>
  )
}

/** A floating feature card: English caption (marketing copy) over a slice of the real screen in the chosen language. */
function Card({
  slot,
  icon: Icon,
  caption,
  locale,
  children,
}: {
  slot: string
  icon: typeof Wallet
  caption: string
  locale: Locale
  children: React.ReactNode
}) {
  return (
    <div className="mkt-show-slot" data-slot={slot}>
      <div data-show="card" data-testid="crm-showcase-card" className="mkt-show-card">
        <p className="mkt-show-cap">
          <Icon aria-hidden className="size-4" /> {caption}
        </p>
        <div key={locale} lang={locale} className="crm-demo mkt-show-ui">
          {children}
        </div>
      </div>
    </div>
  )
}

const cl = (v: number) => Math.min(1, Math.max(0, v))
// ease-in-out, ~ the CSS cubic-bezier(0.45, 0, 0.55, 1)
const ez = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (2 - 2 * x) ** 2 / 2)
const f2 = (n: number) => Math.round(n * 100) / 100
const VARS = ['rx', 'rz', 'sc', 'ty', 'end', 'y0', 'y1', 'z'] as const

/**
 * Same curves as the CSS scroll timelines, for browsers without `animation-timeline`. Idle while the stage is off
 * screen (IntersectionObserver); on scroll it only schedules one frame, which reads `scrollY` and writes transforms
 * from cached layout offsets (offsetTop ignores transforms) — no layout reads per frame.
 */
function useScrollFallback(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const stage = ref.current
    if (!stage || CSS.supports('animation-timeline', 'view()')) return
    const reduce = matchMedia('(prefers-reduced-motion: reduce)')
    const stackMq = matchMedia('(max-width: 1023px)')
    const ac = new AbortController()
    const opt = { passive: true, signal: ac.signal }
    const items = [...stage.querySelectorAll<HTMLElement>('[data-show]')].map((el) => ({
      el,
      dash: el.dataset.show === 'dash',
      top: 0,
      h: 0,
      v: {} as Record<(typeof VARS)[number], number>,
      last: '',
      op: '',
    }))
    let vh = innerHeight
    let raf = 0
    let visible = false

    const pageTop = (el: HTMLElement) => {
      let y = 0
      for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop
      return y
    }
    const paint = () => {
      raf = 0
      const y = scrollY
      for (const it of items) {
        // cover progress of the timeline subject, as view(): 0 = its top meets the viewport bottom, 1 = bottom meets top
        const p = cl((y + vh - it.top) / (vh + it.h))
        const { rx, rz, sc, ty, end, y0, y1, z } = it.v
        let tf = ''
        let op = ''
        if (!reduce.matches && it.dash) {
          const u = 1 - ez(cl(p / (end / 100)))
          tf = `translate3d(0,${f2(u * ty)}px,0) rotateX(${f2(u * rx)}deg) rotateZ(${f2(u * rz)}deg) scale(${f2(1 - u * (1 - sc))})`
        } else if (!reduce.matches) {
          const u = cl(1 - p / 0.5)
          const w = cl((p - 0.5) / 0.5)
          tf =
            p < 0.5
              ? `translate3d(0,${f2(u * y0)}px,${f2(u * z)}px) rotateX(${f2(u * rx)}deg)`
              : `translate3d(0,${f2(w * y1)}px,0)`
          op = String(f2(cl(p / 0.22)))
        }
        if (tf !== it.last) {
          it.last = tf
          it.el.style.transform = tf
        }
        if (op !== it.op) {
          it.op = op
          it.el.style.opacity = op
        }
      }
    }
    const schedule = () => {
      if (visible && !raf) raf = requestAnimationFrame(paint)
    }
    const measure = () => {
      vh = innerHeight
      const stacked = stackMq.matches
      for (const it of items) {
        // the dashboard and stacked cards (< 1024px) follow their own wrapper, floating cards the stage (as in the CSS)
        const sub = it.dash || stacked ? (it.el.parentElement ?? stage) : stage
        it.top = pageTop(sub)
        it.h = sub.offsetHeight
        const cs = getComputedStyle(it.el)
        for (const k of VARS) it.v[k] = Number.parseFloat(cs.getPropertyValue(`--show-${k}`)) || 0
        it.v.sc ||= 1
        it.v.end ||= 50
      }
      schedule()
    }

    const io = new IntersectionObserver(
      ([e]) => {
        visible = Boolean(e?.isIntersecting)
        schedule()
      },
      { rootMargin: '200px 0px' },
    )
    io.observe(stage)
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    addEventListener('scroll', schedule, opt)
    addEventListener('resize', measure, opt)
    reduce.addEventListener('change', schedule, { signal: ac.signal })
    stackMq.addEventListener('change', measure, { signal: ac.signal })
    document.fonts?.ready.then(measure)
    measure()

    return () => {
      ac.abort()
      io.disconnect()
      ro.disconnect()
      cancelAnimationFrame(raf)
      for (const it of items) {
        it.el.style.transform = ''
        it.el.style.opacity = ''
      }
    }
  }, [ref])
}

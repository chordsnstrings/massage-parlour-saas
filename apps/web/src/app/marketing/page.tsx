import { ArrowRight, Check } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AREAS, DAY } from '@/components/marketing/content'
import { CalendarMock } from '@/components/marketing/mocks'
import { activePlans } from '@/components/marketing/plans'
import { CtaBand, MarketingShell } from '@/components/marketing/shell'
import { formatAed } from '@/lib/utils'
import { appUrl } from '@/server/origin'

export const metadata: Metadata = {
  title: { absolute: 'Spa Management — more bookings, less work for UAE spas' },
}
export const dynamic = 'force-dynamic' // prices are edited live in the super-admin

const css = (vars: Record<string, number>) => vars as React.CSSProperties

export default async function MarketingPage() {
  const [plan] = await activePlans()
  return (
    <MarketingShell active="home">
      {/* Hero */}
      <section className="mkt-hero">
        <div className="mkt-wrap text-center">
          <p className="mkt-eyebrow mkt-rise">Automation for UAE spas</p>
          <h1 className="mkt-h1 mkt-rise mx-auto mt-3 max-w-3xl" style={css({ '--d': 1 })}>
            More bookings. Less work.
          </h1>
          <p className="mkt-hsub mkt-rise mx-auto" style={css({ '--d': 2 })}>
            Clients book themselves around the clock. Reminders, follow-ups, offers and your accounts take
            care of themselves. Your team just looks after guests.
          </p>
          <div className="mkt-ctas mkt-rise justify-center" style={css({ '--d': 3 })}>
            <a href={await appUrl('/signup')} className="mkt-btn mkt-btn-primary">
              Start your spa <ArrowRight />
            </a>
            <Link href="/features" className="mkt-btn mkt-btn-ghost">
              See every feature
            </Link>
          </div>
          <p className="mkt-hnotes mkt-rise" style={css({ '--d': 4.5 })}>
            Bookings 24/7 · Reminders queued for you · Accounts & VAT done · English & Arabic
          </p>
        </div>
      </section>

      {/* A day at the spa */}
      <section className="mkt-sec">
        <div className="mkt-wrap">
          <div data-rise className="mkt-shead">
            <p className="mkt-eyebrow">On autopilot</p>
            <h2 className="mkt-h2 max-w-2xl">What happens while your team is busy with guests.</h2>
          </div>
          <div className="relative mt-[54px]">
            <div
              aria-hidden
              className="absolute top-[2.6rem] right-6 left-6 hidden h-px bg-[var(--line2)] lg:block"
            />
            <ol className="relative grid gap-[18px] lg:grid-cols-5">
              {DAY.map((d) => (
                <li key={d.title} data-rise="card" className="mkt-tile">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-[12px] tabular-nums tint-${d.tint}`}
                  >
                    {d.t}
                  </span>
                  <h3 className="mt-4">{d.title}</h3>
                  <p>{d.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* Product — the calendar straightens from its 3D tilt as it scrolls in */}
      <section className="mkt-band mkt-sec">
        <div className="mkt-wrap grid items-center gap-12 lg:grid-cols-[1fr_1.35fr]">
          <div data-rise>
            <p className="mkt-eyebrow">Bookings land by themselves</p>
            <h2 className="mkt-h2">Every booking, from every channel, on one calendar.</h2>
            <ul className="mt-7 space-y-3 text-[15px] text-[var(--muted)]">
              {[
                'Website, AI chat and Instagram bookings arrive on their own',
                'Therapist and room reserved together — never double-booked',
                'Couples, walk-ins and late nights handled for you',
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <Check className="mkt-check mt-0.5 size-[18px] shrink-0" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="mkt-stage">
            <div data-tilt className="mkt-tilt">
              <CalendarMock />
            </div>
          </div>
        </div>
      </section>

      {/* Everything in one place */}
      <section className="mkt-sec">
        <div className="mkt-wrap">
          <div data-rise className="mkt-shead">
            <p className="mkt-eyebrow">Everything automated</p>
            <h2 className="mkt-h2 max-w-2xl">Six jobs you no longer do by hand.</h2>
          </div>
          <div className="mt-[54px] grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
            {AREAS.map((a) => (
              <Link key={a.key} href={`/features#${a.key}`} data-rise="card" className="mkt-card block">
                <h3 className="flex items-center justify-between">
                  {a.title} <ArrowRight className="size-[18px] text-[var(--accent-ink)]" />
                </h3>
                <p>{a.blurb}</p>
                <p className="mt-5 text-[12px] text-[var(--mute)]">{a.features.length} features</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Price */}
      <section className="mkt-sec">
        <div data-rise className="mkt-wrap text-center">
          <p className="mkt-eyebrow">One simple price</p>
          <p className="mkt-head mt-4 text-[44px] font-bold tabular-nums sm:text-[56px]">
            {plan ? formatAed(plan.priceAed) : 'AED 24,000'}
            <span className="font-sans text-lg font-normal text-[var(--mute)]"> / year</span>
          </p>
          <p className="mkt-lead mx-auto">
            Every automation and feature, unlimited staff and bookings, your website and domain.
          </p>
          <Link
            href="/pricing"
            className="mkt-link mt-6 inline-flex items-center gap-1.5 text-[15px] font-semibold text-[var(--accent-ink)]"
          >
            See what’s included <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <CtaBand />
    </MarketingShell>
  )
}

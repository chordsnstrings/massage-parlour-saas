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
      {/* Hero — loads in, then sinks back as you scroll away */}
      <section data-scene="depart" data-mode="leave" className="relative overflow-x-clip">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute top-10 left-[8%] size-72 rounded-full bg-[var(--sage-soft)] blur-3xl" />
          <div className="absolute top-32 right-[6%] size-80 rounded-full bg-[var(--clay-soft)] blur-3xl" />
          <div className="absolute bottom-0 left-1/3 size-64 rounded-full bg-[var(--mist-soft)] blur-3xl" />
        </div>
        <div data-world className="mkt-wrap relative pt-20 pb-28 text-center sm:pt-28 sm:pb-36">
          <p className="mkt-eyebrow mkt-rise">Automation for UAE spas</p>
          <h1
            className="mkt-rise mx-auto mt-5 max-w-3xl text-[42px] leading-[1.04] font-semibold tracking-tight sm:text-[68px]"
            style={css({ '--d': 1 })}
          >
            More bookings. Less work.
          </h1>
          <p
            className="mkt-rise mx-auto mt-6 max-w-xl text-[17px] leading-relaxed text-[var(--ink-2)]"
            style={css({ '--d': 2 })}
          >
            Clients book themselves around the clock. Reminders, follow-ups, offers and your accounts take
            care of themselves. Your team just looks after guests.
          </p>
          <div className="mkt-rise mt-9 flex flex-wrap justify-center gap-3" style={css({ '--d': 3 })}>
            <a href={await appUrl('/signup')} className="mkt-btn mkt-btn-primary">
              Start your spa <ArrowRight className="mkt-arrow size-4" />
            </a>
            <Link href="/features" className="mkt-btn mkt-btn-ghost bg-white/70">
              See every feature
            </Link>
          </div>
          <p className="mkt-rise mt-8 text-[13px] text-[var(--mute)]" style={css({ '--d': 4 })}>
            Bookings 24/7 · Reminders queued for you · Accounts & VAT done · English & Arabic
          </p>
        </div>
      </section>

      {/* A day at the spa — five steps build up in turn */}
      <section
        data-scene="beats"
        data-pin="wide"
        style={css({ '--len': 360 })}
        className="border-t border-[var(--line)]"
      >
        <div data-stage>
          <div className="mkt-wrap py-20">
            <p className="mkt-eyebrow">On autopilot</p>
            <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">
              What happens while your team is busy with guests.
            </h2>
            <div className="relative mt-12">
              <div
                data-beat="1"
                data-from="sx:0 o:0"
                data-origin="0 50%"
                aria-hidden
                className="absolute top-[1.15rem] right-6 left-6 hidden h-px bg-[var(--line)] lg:block"
              />
              <ol className="relative grid gap-4 lg:grid-cols-5">
                {DAY.map((d, i) => (
                  <li
                    key={d.title}
                    data-beat={i + 1}
                    data-from="y:28 rx:-14 o:0"
                    className="rounded-2xl border border-[var(--line)] bg-white p-5"
                  >
                    <span
                      className={`inline-flex rounded-full px-2.5 py-1 text-[12px] tabular-nums tint-${d.tint}`}
                    >
                      {d.t}
                    </span>
                    <h3 className="mt-4 font-medium">{d.title}</h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--ink-2)]">{d.text}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* Product — the calendar turns to face you while bookings drop in */}
      <section
        data-scene="device"
        data-pin="wide"
        style={css({ '--len': 320 })}
        className="tint-sand border-y border-[var(--line)]"
      >
        <div data-stage>
          <div className="mkt-wrap grid items-center gap-12 py-20 lg:grid-cols-[1fr_1.35fr]">
            <div>
              <p className="mkt-eyebrow">Bookings land by themselves</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">
                Every booking, from every channel, on one calendar.
              </h2>
              <ul className="mt-7 space-y-3 text-[15px] text-[var(--ink-2)]">
                {[
                  'Website, AI chat and Instagram bookings arrive on their own',
                  'Therapist and room reserved together — never double-booked',
                  'Couples, walk-ins and late nights handled for you',
                ].map((t) => (
                  <li key={t} className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-[var(--sage-deep)]" /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <div data-world>
              <CalendarMock />
            </div>
          </div>
        </div>
      </section>

      {/* Everything in one place — cards fly into the grid */}
      <section data-scene="assemble" className="mkt-wrap py-24">
        <p className="mkt-eyebrow">Everything automated</p>
        <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">
          Six jobs you no longer do by hand.
        </h2>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AREAS.map((a) => (
            <Link
              key={a.key}
              href={`/features#${a.key}`}
              data-beat
              className={`mkt-card group block p-6 tint-${a.tint}`}
            >
              <h3 className="flex items-center justify-between font-medium">
                {a.title} <ArrowRight className="mkt-arrow size-4 text-[var(--mute)]" />
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--ink-2)]">{a.blurb}</p>
              <p className="mt-5 text-[12px] text-[var(--mute)]">{a.features.length} features</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Price */}
      <section className="border-t border-[var(--line)]">
        <div data-scene="reveal" data-span=".45" className="mkt-wrap py-24 text-center">
          <p className="mkt-eyebrow">One simple price</p>
          <p className="mt-4 text-[44px] font-semibold tracking-tight tabular-nums sm:text-[56px]">
            {plan ? formatAed(plan.priceAed) : 'AED 24,000'}
            <span className="text-lg font-normal text-[var(--mute)]"> / year</span>
          </p>
          <p className="mx-auto mt-3 max-w-md text-[var(--ink-2)]">
            Every automation and feature, unlimited staff and bookings, your website and domain.
          </p>
          <Link
            href="/pricing"
            className="mkt-link mt-6 inline-flex items-center gap-1.5 text-[15px] font-medium"
          >
            See what’s included <ArrowRight className="mkt-arrow size-4" />
          </Link>
        </div>
      </section>

      <CtaBand />
    </MarketingShell>
  )
}

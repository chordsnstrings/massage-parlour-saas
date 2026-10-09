import { en, th } from '@spa/core/i18n'
import { ArrowRight, Check } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AREAS, DAY } from '@/components/marketing/content'
import { CalendarMock } from '@/components/marketing/mocks'
import { activePlans } from '@/components/marketing/plans'
import { CtaBand, HeroDepth, MarketingShell } from '@/components/marketing/shell'
import { formatAed } from '@/lib/utils'
import { appUrl } from '@/server/origin'

export const metadata: Metadata = {
  title: { absolute: 'spamanagement.co — more bookings, less work for UAE spas' },
}
export const dynamic = 'force-dynamic' // prices are edited live in the super-admin

const css = (vars: Record<string, number>) => vars as React.CSSProperties

/** Real dashboard labels (spa-dashboard catalogues), shown side by side in the Spa CRM section. */
const LABELS = [
  [en.nav.calendar, th.nav.calendar],
  [en.nav.bookings, th.nav.bookings],
  [en.nav.sales, th.nav.sales],
  [en.nav.clients, th.nav.clients],
  [en.overview.upNext.title, th.overview.upNext.title],
] as const

export default async function MarketingPage() {
  const [plan] = await activePlans()
  return (
    <MarketingShell active="home">
      {/* Hero */}
      <section className="mkt-hero">
        <HeroDepth />
        <div className="mkt-wrap text-center">
          <p data-depth="0.03" className="mkt-eyebrow mkt-rise">
            Automation for UAE spas
          </p>
          <h1 data-depth="0.06" className="mkt-h1 mkt-rise mx-auto mt-6 max-w-4xl" style={css({ '--d': 1 })}>
            More bookings. Less work.
          </h1>
          <p data-depth="0.08" className="mkt-hsub mkt-rise mx-auto" style={css({ '--d': 2 })}>
            Clients book themselves around the clock. Reminders, follow-ups, offers and your accounts take
            care of themselves. Your team just looks after guests.
          </p>
          <div data-depth="0.1" className="mkt-ctas mkt-rise justify-center" style={css({ '--d': 3 })}>
            <a href={await appUrl('/signup')} className="mkt-btn mkt-btn-primary">
              Apply for your spa <ArrowRight />
            </a>
            <Link href="/features" className="mkt-btn mkt-btn-ghost">
              See every feature
            </Link>
          </div>
          <p data-depth="0.11" className="mkt-hnotes mkt-rise" style={css({ '--d': 4.5 })}>
            Bookings 24/7 · Reminders queued for you · Accounts & VAT done · Sites in English & Arabic ·
            Dashboard in English & Thai
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

      {/* The spa CRM — the dashboard the team works in, English or Thai */}
      <section className="mkt-sec">
        <div className="mkt-wrap grid items-center gap-12 lg:grid-cols-2">
          <div data-rise>
            <p className="mkt-eyebrow">Spa CRM</p>
            <h2 className="mkt-h2">One dashboard for your whole team — in English or Thai.</h2>
            <p className="mkt-lead max-w-md">
              Calendar, till, clients, staff and accounts in one place. We build it and set it up with your
              spa, and every person picks their own language.
            </p>
            <ul className="mt-7 space-y-3 text-[15px] text-[var(--muted)]">
              {[
                'Front desk, therapists, managers and the owner each see what their role needs',
                'Till with packages, gift cards, memberships and full tax invoices',
                'Names you type — clients, therapists, treatments — stay exactly as written',
              ].map((t) => (
                <li key={t} className="flex gap-3">
                  <Check className="mkt-check mt-0.5 size-[18px] shrink-0" /> {t}
                </li>
              ))}
            </ul>
            <Link
              href="/crm"
              className="mkt-link mt-8 inline-flex items-center gap-1.5 text-[15px] font-semibold text-[var(--accent-ink)]"
            >
              Explore the spa CRM <ArrowRight className="size-4" />
            </Link>
          </div>
          <div data-rise="card" className="mkt-tile p-0">
            <div className="grid grid-cols-2 gap-4 border-b border-[var(--line)] px-6 py-4 text-[12px] font-bold tracking-[0.12em] text-[var(--mute)] uppercase">
              <span>English</span>
              <span lang="th" className="tracking-normal">
                ภาษาไทย
              </span>
            </div>
            <ul className="divide-y divide-[var(--line)]">
              {LABELS.map(([a, b]) => (
                <li key={a} className="grid grid-cols-2 gap-4 px-6 py-3.5 text-[15px]">
                  <span>{a}</span>
                  <span lang="th">{b}</span>
                </li>
              ))}
              <li className="grid grid-cols-2 gap-4 px-6 py-3.5 text-[15px] font-semibold">
                <span>Hot stone ritual</span>
                <span>Hot stone ritual</span>
              </li>
            </ul>
            <p className="border-t border-[var(--line)] px-6 py-3.5 text-[13px] text-[var(--mute)]">
              Labels switch with each person’s language; the treatment name your spa typed never changes.
            </p>
          </div>
        </div>
      </section>

      {/* Everything in one place */}
      <section className="mkt-sec mkt-dark">
        <div className="mkt-wrap">
          <div data-rise className="mkt-shead">
            <p className="mkt-eyebrow">Everything automated</p>
            <h2 className="mkt-h2 max-w-2xl">Six jobs you no longer do by hand.</h2>
          </div>
          <div className="mt-[54px] grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
            {AREAS.map((a) => (
              <Link key={a.key} href={`/features#${a.key}`} data-rise="card" className="mkt-card block">
                <span aria-hidden className="mkt-lbar" />
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
          <p className="mkt-head mt-5 text-[44px] leading-none font-bold tabular-nums sm:text-[66px]">
            {plan ? formatAed(plan.priceAed) : 'AED 24,000'}
            <span className="text-lg font-medium tracking-normal text-[var(--mute)]"> / year</span>
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

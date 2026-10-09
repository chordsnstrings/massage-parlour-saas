import { ArrowRight, Check } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AREAS, DAY } from '@/components/marketing/content'
import { crmDemoCopy } from '@/components/marketing/crm-demo-copy'
import { CrmShowcase } from '@/components/marketing/crm-showcase'
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

/** Spa CRM showcase benefits (each checked against the product: PLAN §14.6, §18.5). */
const SHOWCASE_BENEFITS = [
  'Front desk, therapists, managers and the owner each see what their role needs',
  'Every person picks English or Thai; names your team types never change',
  'Menu, rooms, therapists and opening hours set up with you, plus your first client import',
]

export default async function MarketingPage() {
  const [plan] = await activePlans()
  const signupUrl = await appUrl('/signup')
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
            <a href={signupUrl} className="mkt-btn mkt-btn-primary">
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

      {/* Spa CRM showcase: the dashboard straightens from 3D as it scrolls in, feature cards float around it */}
      <section className="mkt-sec mkt-show" data-testid="crm-showcase" aria-labelledby="crm-showcase-title">
        <div className="mkt-wrap">
          <div className="mkt-show-head mkt-shead">
            <div className="mkt-show-in">
              <p className="mkt-eyebrow">Spa CRM</p>
              <h2 id="crm-showcase-title" className="mkt-h2 max-w-3xl">
                Run the whole spa from one dashboard.
              </h2>
              <p className="mkt-lead mx-auto">
                Calendar, till, clients, staff and accounts in one place, in English or Thai. We set it up
                with your spa.
              </p>
              <ul className="mkt-show-ben">
                {SHOWCASE_BENEFITS.map((t) => (
                  <li key={t} className="flex gap-2.5 text-[15px] text-[var(--muted)]">
                    <Check className="mkt-check mt-0.5 size-[18px] shrink-0" /> {t}
                  </li>
                ))}
              </ul>
              <div className="mkt-ctas justify-center">
                <Link href="/crm" className="mkt-btn mkt-btn-primary">
                  See the Spa CRM <ArrowRight />
                </Link>
                <a href={signupUrl} className="mkt-btn mkt-btn-ghost">
                  Apply for your spa
                </a>
              </div>
            </div>
          </div>
          <CrmShowcase copy={crmDemoCopy()} />
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

import { ArrowRight, Check } from 'lucide-react'
import type { Metadata } from 'next'
import { FAQ, INCLUDED } from '@/components/marketing/content'
import { activePlans } from '@/components/marketing/plans'
import { CtaBand, MarketingShell } from '@/components/marketing/shell'
import { appUrl } from '@/lib/paths'
import { formatAed } from '@/lib/utils'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'One simple yearly price in AED, every feature included.',
}
export const dynamic = 'force-dynamic' // prices are edited live in the super-admin

const BANDS = [
  {
    title: 'Bookings on autopilot',
    text: 'Online booking, AI receptionist, Instagram replies, one calendar',
    tint: 'tint-sage',
  },
  {
    title: 'Books that do themselves',
    text: 'Sales post to accounts; VAT, commissions and WPS ready',
    tint: 'tint-sand',
  },
  {
    title: 'A website crafted for you',
    text: 'Designed and written by our studio, English & Arabic, your own domain',
    tint: 'tint-mist',
  },
  {
    title: 'Marketing on repeat',
    text: 'Campaigns, quiet-slot offers, reviews and Instagram',
    tint: 'tint-plum',
  },
]

export default async function PricingPage() {
  const plans = await activePlans()
  const shown = plans.length
    ? plans
    : [{ id: 'launch', name: 'Spa', priceAed: '24000', billingInterval: 'year', setupFeeAed: null }]
  return (
    <MarketingShell active="pricing">
      <section className="mkt-wrap pt-20 pb-12 text-center sm:pt-28">
        <p className="mkt-eyebrow mkt-rise">Pricing</p>
        <h1 className="mkt-rise mx-auto mt-4 max-w-2xl text-[38px] leading-[1.06] font-semibold tracking-tight sm:text-[56px]">
          One price. Everything automated.
        </h1>
      </section>

      <section className="mkt-wrap pb-20">
        <div
          data-scene="reveal"
          data-span=".45"
          className="mx-auto grid max-w-4xl gap-6"
          style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 20rem), 1fr))` }}
        >
          {shown.map((p) => (
            <div key={p.id} className="rounded-[1.75rem] border border-[var(--line)] bg-white p-8 sm:p-10">
              <p className="text-[15px] font-medium">{p.name}</p>
              <p className="mt-4 text-[48px] leading-none font-semibold tracking-tight tabular-nums">
                {formatAed(p.priceAed)}
                <span className="text-lg font-normal text-[var(--mute)]"> / {p.billingInterval}</span>
              </p>
              <p className="mt-3 text-[14px] text-[var(--mute)]">
                Excl. VAT. Pay by card, bank transfer or cash.
                {p.setupFeeAed && Number(p.setupFeeAed) > 0
                  ? ` One-time setup ${formatAed(p.setupFeeAed)}.`
                  : ''}
              </p>
              <ul className="mt-8 space-y-3 text-[15px]">
                {INCLUDED.map((t) => (
                  <li key={t} className="flex gap-3">
                    <Check className="mt-0.5 size-4 shrink-0 text-[var(--sage-deep)]" /> {t}
                  </li>
                ))}
              </ul>
              <a href={appUrl('/signup')} className="mkt-btn mkt-btn-primary mt-9 w-full justify-center">
                Start your spa <ArrowRight className="mkt-arrow size-4" />
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* What you get — bands wipe in one by one */}
      <section data-scene="rise" data-grow="x" className="border-t border-[var(--line)]">
        <div className="mkt-wrap py-20">
          <p className="mkt-eyebrow">What you get</p>
          <div className="mt-8 grid gap-3">
            {BANDS.map((b) => (
              <div
                key={b.title}
                data-beat
                className={`flex flex-col gap-1 rounded-2xl px-6 py-5 sm:flex-row sm:items-center sm:justify-between ${b.tint}`}
              >
                <p className="font-medium">{b.title}</p>
                <p className="text-[14px] text-[var(--ink-2)]">{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-[var(--line)]">
        <div className="mkt-wrap max-w-3xl py-20">
          <h2 className="text-2xl font-semibold tracking-tight">Questions</h2>
          <div className="mt-6 divide-y divide-[var(--line)] border-y border-[var(--line)]">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-6 font-medium">
                  {f.q}
                  <span className="text-[var(--mute)] transition-transform duration-300 group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 text-[15px] leading-relaxed text-[var(--ink-2)]">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </MarketingShell>
  )
}

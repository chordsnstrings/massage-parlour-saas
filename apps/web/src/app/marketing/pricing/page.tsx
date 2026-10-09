import { ArrowRight, Check } from 'lucide-react'
import type { Metadata } from 'next'
import { FAQ, INCLUDED } from '@/components/marketing/content'
import { activePlans } from '@/components/marketing/plans'
import { CtaBand, MarketingShell } from '@/components/marketing/shell'
import { formatAed } from '@/lib/utils'
import { appUrl } from '@/server/origin'

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'One simple yearly price in AED, every feature included.',
}
export const dynamic = 'force-dynamic' // prices are edited live in the super-admin

const BANDS = [
  {
    title: 'Bookings on autopilot',
    text: 'Online booking, AI receptionist, Instagram replies, one calendar',
  },
  {
    title: 'Books that do themselves',
    text: 'Sales post to accounts; VAT, commissions and WPS ready',
  },
  {
    title: 'A website crafted for you',
    text: 'Designed and written by our studio, English & Arabic, your own domain',
  },
  {
    title: 'Marketing on repeat',
    text: 'Campaigns, quiet-slot offers, reviews and Instagram',
  },
]

export default async function PricingPage() {
  const plans = await activePlans()
  const signup = await appUrl('/signup')
  const shown = plans.length
    ? plans
    : [{ id: 'launch', name: 'Spa', priceAed: '24000', billingInterval: 'year', setupFeeAed: null }]
  return (
    <MarketingShell active="pricing">
      <section className="mkt-wrap pt-20 pb-12 text-center sm:pt-28">
        <p data-depth="0.03" className="mkt-eyebrow mkt-rise">
          Pricing
        </p>
        <h1
          data-depth="0.06"
          className="mkt-h1 mkt-rise mx-auto mt-6 max-w-4xl"
          style={{ '--d': 1 } as React.CSSProperties}
        >
          One price. Everything automated.
        </h1>
      </section>

      <section className="mkt-wrap pb-20">
        <div
          className="mx-auto grid max-w-4xl gap-[18px]"
          style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 20rem), 1fr))` }}
        >
          {shown.map((p) => (
            <div key={p.id} data-rise="card" className="mkt-plan sm:p-10">
              <p className="mkt-head text-[24px] font-bold">{p.name}</p>
              <p className="mkt-head mt-4 text-[48px] leading-none font-bold tabular-nums">
                {formatAed(p.priceAed)}
                <span className="text-lg font-medium tracking-normal text-[var(--mute)]"> / year</span>
              </p>
              <p className="mt-3 text-[14.5px] text-[var(--muted)]">
                Excl. VAT. Pay by card, bank transfer or cash.
                {p.setupFeeAed && Number(p.setupFeeAed) > 0
                  ? ` One-time setup ${formatAed(p.setupFeeAed)}.`
                  : ''}
              </p>
              <ul className="mt-8 grid gap-2.5 text-[15px]">
                {INCLUDED.map((t) => (
                  <li key={t} className="flex gap-2.5">
                    <Check className="mkt-check mt-0.5 size-[18px] shrink-0" /> {t}
                  </li>
                ))}
              </ul>
              <a href={signup} className="mkt-btn mkt-btn-primary mt-9 w-full">
                Apply for your spa <ArrowRight />
              </a>
            </div>
          ))}
        </div>
      </section>

      {/* What you get */}
      <section className="mkt-sec pt-10">
        <div className="mkt-wrap">
          <div data-rise className="mkt-shead">
            <p className="mkt-eyebrow">What you get</p>
          </div>
          <div className="mt-8 grid gap-3">
            {BANDS.map((b) => (
              <div
                key={b.title}
                data-rise
                className="mkt-ben flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
              >
                <p className="text-[17px] font-semibold">{b.title}</p>
                <p className="text-[14.5px] text-[var(--muted)]">{b.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mkt-sec pt-0">
        <div className="mkt-wrap max-w-[820px]">
          <div data-rise className="mkt-shead">
            <h2 className="mkt-h2">Questions</h2>
          </div>
          <div className="mkt-faq mt-[46px]">
            {FAQ.map((f) => (
              <details key={f.q} data-rise>
                <summary>
                  {f.q}
                  <span aria-hidden>+</span>
                </summary>
                <p className="text-[15px] leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </MarketingShell>
  )
}

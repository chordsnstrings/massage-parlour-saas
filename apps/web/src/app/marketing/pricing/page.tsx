import { monthlyAed, PLAN_CODES, PLAN_FEATURES, type PlanLimits, planTier, rowIncluded } from '@spa/core'
import { ArrowRight, Check, Minus } from 'lucide-react'
import type { Metadata } from 'next'
import { FAQ } from '@/components/marketing/content'
import { activePlans } from '@/components/marketing/plans'
import { CtaBand, MarketingShell } from '@/components/marketing/shell'
import { formatAed } from '@/lib/utils'
import { appUrl } from '@/server/origin'

export const metadata: Metadata = {
  title: 'Pricing',
  description:
    'Premium and Standard plans in AED: a one-time setup fee plus a monthly fee, excl. VAT. Standard runs the whole spa; Premium adds AI, marketing and more branches.',
}
export const dynamic = 'force-dynamic' // prices are edited live in the super-admin

type ShownPlan = {
  id: string
  code: string
  name: string
  description: string | null
  priceAed: string
  setupFeeAed: string
  billingInterval: string
  limits: PlanLimits
}

// Only for a build without a database (the page is dynamic: live plans replace these). Same values as the seed.
const FALLBACK: ShownPlan[] = [
  {
    id: PLAN_CODES.premium,
    code: PLAN_CODES.premium,
    name: 'Premium',
    description: null,
    priceAed: '36000',
    setupFeeAed: '14000',
    billingInterval: 'month',
    limits: { ai: true, marketing: true, multiBranch: true },
  },
  {
    id: PLAN_CODES.standard,
    code: PLAN_CODES.standard,
    name: 'Standard',
    description: null,
    priceAed: '24000',
    setupFeeAed: '9000',
    billingInterval: 'month',
    limits: { ai: false, marketing: false, multiBranch: false },
  },
]

const GATED = PLAN_FEATURES.filter((r) => r.feature !== null)
const CORE = PLAN_FEATURES.filter((r) => r.feature === null)

/** Price block: monthly fee (or yearly for a yearly plan) + the one-time setup fee, excl. VAT. */
function Price({ p }: { p: ShownPlan }) {
  const monthly = p.billingInterval === 'month'
  return (
    <>
      <p className="mkt-head mt-4 text-[48px] leading-none font-bold tabular-nums">
        {formatAed(monthly ? monthlyAed(p.priceAed) : p.priceAed)}
        <span className="text-lg font-medium tracking-normal text-[var(--mute)]">
          {monthly ? ' / month' : ' / year'}
        </span>
      </p>
      <p className="mt-3 text-[14.5px] text-[var(--muted)]">
        {Number(p.setupFeeAed) > 0 ? `+ one-time setup ${formatAed(p.setupFeeAed)}. ` : ''}
        Excl. VAT. Pay by card, bank transfer or cash.
      </p>
    </>
  )
}

export default async function PricingPage() {
  const live = (await activePlans()).filter((p) => p.code !== PLAN_CODES.legacyYearly)
  const plans: ShownPlan[] = live.length ? live : FALLBACK
  const signup = await appUrl('/signup')
  const premium = plans.find((p) => planTier(p.limits) === 'premium')
  const standard = plans.find((p) => planTier(p.limits) === 'standard')
  const cards = [premium, standard].filter((p): p is ShownPlan => Boolean(p))
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
          Pick your plan. We handle the rest.
        </h1>
        <p className="mkt-lead mkt-rise mx-auto mt-6 max-w-2xl" style={{ '--d': 2 } as React.CSSProperties}>
          A one-time setup fee, then one monthly fee. Standard runs your whole spa; Premium adds AI &amp;
          Instagram automation, marketing tools and more branches.
        </p>
      </section>

      <section id="plans" className="mkt-wrap pb-20">
        <div
          className="mx-auto grid max-w-4xl gap-[18px]"
          style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, 20rem), 1fr))` }}
        >
          {cards.map((p) => {
            const isPremium = p === premium
            return (
              <div
                key={p.id}
                data-rise="card"
                data-testid={`plan-card-${p.code}`}
                className={isPremium ? 'mkt-plan sm:p-10' : 'mkt-card sm:p-10'}
              >
                <p className="mkt-head text-[24px] font-bold">{p.name}</p>
                {p.description && <p className="mt-2 text-[14.5px] text-[var(--muted)]">{p.description}</p>}
                <Price p={p} />
                <p className="mt-8 text-[14px] font-semibold">
                  {isPremium ? 'Everything in Standard, plus:' : 'The whole spa CRM:'}
                </p>
                <ul className="mt-3 grid gap-2.5 text-[15px]">
                  {(isPremium ? GATED : CORE.slice(0, 8)).map((r) => (
                    <li key={r.key} className="flex gap-2.5">
                      <Check className="mkt-check mt-0.5 size-[18px] shrink-0" /> {r.label}
                    </li>
                  ))}
                  {!isPremium && (
                    <li className="flex gap-2.5 text-[var(--muted)]">
                      <Minus className="mt-0.5 size-[18px] shrink-0" /> One branch
                    </li>
                  )}
                </ul>
                <a
                  href={`${signup}?plan=${encodeURIComponent(p.code)}`}
                  className={`mkt-btn ${isPremium ? 'mkt-btn-primary' : 'mkt-btn-dark'} mt-9 w-full`}
                >
                  Apply for {p.name} <ArrowRight />
                </a>
              </div>
            )
          })}
        </div>
      </section>

      {/* Feature comparison, generated from the plan feature list in @spa/core (PLAN §18.8). */}
      <section id="compare" className="mkt-sec pt-10">
        <div className="mkt-wrap max-w-4xl">
          <div data-rise className="mkt-shead">
            <p className="mkt-eyebrow">Compare plans</p>
          </div>
          <div data-rise className="mkt-card mt-8 overflow-x-auto">
            <table className="w-full text-start text-[14.5px]" data-testid="plan-compare">
              <thead>
                <tr className="border-b border-[var(--line)]">
                  <th scope="col" className="px-4 py-3 text-start font-semibold sm:px-6">
                    Feature
                  </th>
                  {cards.map((p) => (
                    <th key={p.id} scope="col" className="w-24 px-3 py-3 text-center font-semibold sm:w-32">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PLAN_FEATURES.map((r) => (
                  <tr key={r.key} className="border-b border-[var(--line)] last:border-b-0">
                    <th scope="row" className="px-4 py-3 text-start font-normal sm:px-6">
                      {r.label}
                    </th>
                    {cards.map((p) => {
                      const yes = rowIncluded(r, planTier(p.limits))
                      return (
                        <td key={p.id} className="px-3 py-3 text-center">
                          {yes ? (
                            <Check
                              role="img"
                              className="mkt-check inline size-[18px]"
                              aria-label="Included"
                            />
                          ) : (
                            <Minus
                              className="inline size-[18px] text-[var(--mute)]"
                              role="img"
                              aria-label="Not included"
                            />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section id="faq" className="mkt-sec pt-0">
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

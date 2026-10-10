import { PLAN_CODES, type PlanFeatureRow, planTier, rowIncluded } from '@spa/core'
import { ArrowLeftRight, Check, CreditCard, FileSpreadsheet, Minus, Receipt } from 'lucide-react'
import type { Metadata } from 'next'
import { FAQ } from '@/components/marketing/content'
import {
  CORE_ROWS,
  FALLBACK_PLANS,
  GATED_GROUPS,
  gatedSummary,
  PlanCards,
  pickPlans,
  priceText,
  type ShownPlan,
} from '@/components/marketing/plan-cards'
import { activePlans } from '@/components/marketing/plans'
import { marketingMetadata } from '@/components/marketing/seo'
import { CtaBand, MarketingShell } from '@/components/marketing/shell'
import { appUrl } from '@/server/origin'

export const metadata: Metadata = marketingMetadata('pricing', {
  title: 'Pricing',
  description:
    'Premium and Standard plans in AED: a one-time setup fee plus a monthly fee, excl. VAT. Standard runs the whole spa; Premium adds AI, marketing and more branches.',
})
export const dynamic = 'force-dynamic' // prices are edited live in the super-admin

/** One comparison row: a mark per plan (role=img + Included / Not included for screen readers). */
function CompareRow({ row, cards }: { row: PlanFeatureRow; cards: ShownPlan[] }) {
  return (
    <tr>
      <th scope="row">{row.label}</th>
      {cards.map((p) => {
        const tier = planTier(p.limits)
        return (
          <td key={p.id} className={tier === 'premium' ? 'is-spot' : undefined}>
            {rowIncluded(row, tier) ? (
              <Check role="img" className="mkt-check" aria-label="Included" />
            ) : (
              <Minus role="img" className="is-no" aria-label="Not included" />
            )}
          </td>
        )
      })}
    </tr>
  )
}

export default async function PricingPage() {
  const live = (await activePlans()).filter((p) => p.code !== PLAN_CODES.legacyYearly)
  const plans: ShownPlan[] = live.length ? live : FALLBACK_PLANS
  const signup = await appUrl('/signup')
  const { premium, standard, cards } = pickPlans(plans)
  const cols = cards.length + 1
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
        <p
          className="mkt-lead mkt-rise mx-auto mt-6 max-w-[44rem]"
          style={{ '--d': 2 } as React.CSSProperties}
        >
          A one-time setup fee, then one monthly fee. {standard?.name ?? 'Standard'} runs your whole spa;{' '}
          {premium?.name ?? 'Premium'} adds {gatedSummary}.
        </p>
        <nav
          aria-label="On this page"
          className="mkt-rise mt-7 flex flex-wrap justify-center gap-2.5"
          style={{ '--d': 3 } as React.CSSProperties}
        >
          <a href="#compare" className="mkt-jump">
            Compare plans
          </a>
          <a href="#faq" className="mkt-jump">
            Questions
          </a>
        </nav>
      </section>

      <section id="plans" className="mkt-wrap pb-20">
        <div className="mx-auto max-w-[61rem]">
          <PlanCards plans={plans} signup={signup} variant="full" />
        </div>
        {/* Same facts as the FAQ (content.ts): excl. VAT, how to pay, plan changes, the first import. */}
        <ul className="mkt-assure">
          <li>
            <Receipt aria-hidden /> All prices excl. VAT
          </li>
          <li>
            <CreditCard aria-hidden /> Pay by card, bank transfer or cash
          </li>
          <li>
            <ArrowLeftRight aria-hidden /> Change plan through your account manager
          </li>
          <li>
            <FileSpreadsheet aria-hidden /> We help you with the first import
          </li>
        </ul>
      </section>

      {/* Feature comparison, generated from the plan feature list in @spa/core (PLAN §18.8). */}
      <section id="compare" className="mkt-sec pt-10">
        <div className="mkt-wrap max-w-[61rem]">
          <div data-rise className="mkt-shead">
            <p className="mkt-eyebrow">Compare plans</p>
            <h2 className="mkt-h2">Every feature, side by side.</h2>
          </div>
          <div data-rise className="mkt-cmp mt-9">
            <table data-testid="plan-compare">
              <thead>
                <tr>
                  <th scope="col">Feature</th>
                  {cards.map((p) => (
                    <th key={p.id} scope="col" className={p === premium ? 'is-spot' : undefined}>
                      <span className="mkt-cmp-plan">{p.name}</span>
                      <span className="mkt-cmp-price">{priceText(p)}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr className="mkt-grp">
                  <th scope="rowgroup" colSpan={cols}>
                    The spa CRM · every plan
                  </th>
                </tr>
                {CORE_ROWS.map((r) => (
                  <CompareRow key={r.key} row={r} cards={cards} />
                ))}
              </tbody>
              {GATED_GROUPS.map((g) => (
                <tbody key={g.feature}>
                  <tr className="mkt-grp">
                    <th scope="rowgroup" colSpan={cols}>
                      {g.label}
                    </th>
                  </tr>
                  {g.rows.map((r) => (
                    <CompareRow key={r.key} row={r} cards={cards} />
                  ))}
                </tbody>
              ))}
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

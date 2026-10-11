import {
  FEATURE_LABELS,
  FEATURES,
  monthlyAed,
  PLAN_CODES,
  PLAN_FEATURES,
  type PlanLimits,
  planTier,
  TIER_FEATURES,
} from '@spa/core'
import { ArrowDown, ArrowRight, Check, Minus, Plus } from 'lucide-react'
import Link from 'next/link'
import { formatAed } from '@/lib/utils'

/** A plan as the marketing pages show it (a `plans` row from activePlans(), or a FALLBACK entry). */
export type ShownPlan = {
  id: string
  code: string
  name: string
  description: string | null
  priceAed: string
  setupFeeAed: string
  billingInterval: string
  limits: PlanLimits
}

// Only for a build without a database (the pages are dynamic: live plans replace these). Same values as the seed.
export const FALLBACK_PLANS: ShownPlan[] = [
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

/** Rows on every plan, and the gated rows grouped by feature (labels from @spa/core, PLAN §18.8). */
export const CORE_ROWS = PLAN_FEATURES.filter((r) => r.feature === null)
export const GATED_GROUPS = FEATURES.map((f) => ({
  feature: f,
  label: FEATURE_LABELS[f],
  rows: PLAN_FEATURES.filter((r) => r.feature === f),
}))

/** "AI & Instagram automation, marketing tools and more branches" (from FEATURE_LABELS). */
export const gatedSummary = (() => {
  const l = FEATURES.map((f, i) =>
    i ? FEATURE_LABELS[f].charAt(0).toLowerCase() + FEATURE_LABELS[f].slice(1) : FEATURE_LABELS[f],
  )
  return l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l.at(-1)}` : (l[0] ?? '')
})()

/** Premium (every feature) first, then Standard — told apart by planTier, never by plan code. */
export function pickPlans<P extends ShownPlan>(plans: P[]) {
  const premium = plans.find((p) => planTier(p.limits) === 'premium')
  const standard = plans.find((p) => planTier(p.limits) === 'standard')
  return { premium, standard, cards: [premium, standard].filter((p): p is P => Boolean(p)) }
}

/** formatAed split at its NBSP ("AED", "3,000"); the element text stays "AED 3,000". */
function aedParts(amount: string) {
  const s = formatAed(amount)
  const i = s.indexOf(' ')
  return i > 0 ? [s.slice(0, i), s.slice(i + 1)] : ['', s]
}

/** Monthly fee (or yearly for a yearly plan): "AED 3,000 / month". */
export function priceText(p: ShownPlan) {
  const monthly = p.billingInterval === 'month'
  return `${formatAed(monthly ? monthlyAed(p.priceAed) : p.priceAed)} / ${monthly ? 'month' : 'year'}`
}

/** Price block: the monthly fee large, then "+ one-time setup AED X · Excl. VAT". */
function Price({ p }: { p: ShownPlan }) {
  const monthly = p.billingInterval === 'month'
  const [cur, amount] = aedParts(monthly ? monthlyAed(p.priceAed) : p.priceAed)
  return (
    <>
      <p className="mkt-price">
        {cur && <span className="mkt-price-cur">{cur}&nbsp;</span>}
        <span className="mkt-price-num">{amount}</span>
        <span className="mkt-price-per"> / {monthly ? 'month' : 'year'}</span>
      </p>
      <p className="mkt-psub">
        <span className="mkt-psub-in">
          {Number(p.setupFeeAed) > 0 && (
            <span>
              + one-time setup <strong>{formatAed(p.setupFeeAed)}</strong>
            </span>
          )}
          <span>Excl. VAT</span>
        </span>
      </p>
    </>
  )
}

const Yes = ({ children, strong }: { children: React.ReactNode; strong?: boolean }) => (
  <li className={strong ? 'is-strong' : undefined}>
    <span aria-hidden className="mkt-ic">
      <Check strokeWidth={3} />
    </span>
    {children}
  </li>
)

/** A limit row ("One branch"): muted, minus-marked, inside the list so it is read with it. */
const Limit = ({ children }: { children: React.ReactNode }) => (
  <li className="is-off">
    <span aria-hidden className="mkt-ic">
      <Minus strokeWidth={3} />
    </span>
    {children}
  </li>
)

/** A link row ("9 more spa tools"): accent text, dashed-circle marker, 44px tap target. */
const MoreLink = ({
  href,
  icon,
  children,
}: {
  href: string
  icon: React.ReactNode
  children: React.ReactNode
}) => (
  <Link href={href} className="mkt-pl-more mkt-link">
    <span aria-hidden className="mkt-ic">
      {icon}
    </span>
    {children}
  </Link>
)

/**
 * The plan cards of the home page (`compact`: price, CTA, short list; the limit is only the "One branch" tag) and
 * /pricing (`full`: + description and every row). Everything comes from the live plans and the @spa/core plan
 * helpers; Premium is the spotlight card.
 */
export function PlanCards({
  plans,
  signup,
  variant,
}: {
  plans: ShownPlan[]
  signup: string
  variant: 'compact' | 'full'
}) {
  const { standard, cards } = pickPlans(plans)
  if (!cards.length) return null
  const full = variant === 'full'
  const hasDesc = full && cards.some((p) => p.description)
  const H = full ? 'h2' : 'h3'
  const standardName = standard?.name ?? 'Standard'
  return (
    <div
      className={`mkt-plans${full ? '' : ' mkt-plans-compact'}`}
      style={{ '--rows': hasDesc ? 6 : 5 } as React.CSSProperties}
    >
      {cards.map((p) => {
        const tier = planTier(p.limits)
        const spot = tier === 'premium'
        const oneBranch = !TIER_FEATURES[tier].includes('multiBranch')
        const id = `${variant}-plan-${p.code}`
        const cta = (
          <a
            href={`${signup}?plan=${encodeURIComponent(p.code)}`}
            className={`mkt-btn ${spot ? 'mkt-btn-lime' : 'mkt-btn-primary'}`}
          >
            Apply for {p.name} <ArrowRight />
          </a>
        )
        const more = CORE_ROWS.length - 3
        const list = full ? (
          spot ? (
            <>
              <p className="mkt-pl-h">Everything in {standardName}, plus:</p>
              {GATED_GROUPS.map((g) => (
                <div key={g.feature}>
                  <h3 className="mkt-pl-g">{g.label}</h3>
                  <ul className="mkt-pl">
                    {g.rows.map((r) => (
                      <Yes key={r.key}>{r.label}</Yes>
                    ))}
                  </ul>
                </div>
              ))}
            </>
          ) : (
            <>
              <p className="mkt-pl-h">The whole spa CRM:</p>
              <ul className="mkt-pl">
                {CORE_ROWS.map((r) => (
                  <Yes key={r.key}>{r.label}</Yes>
                ))}
                {oneBranch && <Limit>One branch</Limit>}
              </ul>
            </>
          )
        ) : spot ? (
          <ul className="mkt-pl">
            <Yes>Everything in {standardName}</Yes>
            {GATED_GROUPS.map((g) => (
              <Yes key={g.feature} strong>
                {g.label}
              </Yes>
            ))}
          </ul>
        ) : (
          <ul className="mkt-pl">
            {CORE_ROWS.slice(0, 3).map((r) => (
              <Yes key={r.key}>{r.label}</Yes>
            ))}
          </ul>
        )
        // closing link row, pinned to the foot of the shared list row so both cards end level
        const plus = <Plus strokeWidth={3} />
        const endLink = full ? (
          spot && (
            <MoreLink href="#compare" icon={<ArrowDown strokeWidth={3} />}>
              Compare the plans row by row
            </MoreLink>
          )
        ) : spot ? (
          <MoreLink href="/pricing#compare" icon={plus}>
            See every {p.name} feature
          </MoreLink>
        ) : (
          more > 0 && (
            <MoreLink href="/pricing#compare" icon={plus}>
              {more} more spa tools
            </MoreLink>
          )
        )
        return (
          <article
            key={p.id}
            data-rise="card"
            data-testid={`plan-card-${p.code}`}
            aria-labelledby={id}
            className={`mkt-pc${spot ? ' mkt-pc-spot' : ''}`}
          >
            <div className="mkt-pc-top">
              <H id={id} className="mkt-pc-name">
                {p.name}
              </H>
              {(spot || oneBranch) && (
                <span className="mkt-pc-tag">{spot ? 'Every feature' : 'One branch'}</span>
              )}
            </div>
            {hasDesc && <p className="mkt-pc-desc">{p.description}</p>}
            <Price p={p} />
            {cta}
            <div className="mkt-pl-box">
              {list}
              {endLink && <p className="mkt-pl-end">{endLink}</p>}
            </div>
          </article>
        )
      })}
    </div>
  )
}

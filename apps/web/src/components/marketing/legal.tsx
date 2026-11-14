import Link from 'next/link'
import { LEGAL, LEGAL_LINKS } from '@/components/marketing/legal-config'
import { type MarketingPage, MarketingShell } from '@/components/marketing/shell'

export { LEGAL }

export function Mail() {
  return (
    <a href={`mailto:${LEGAL.email}`} className="mkt-link font-semibold text-[var(--accent-ink)]">
      {LEGAL.email}
    </a>
  )
}

/** Shared frame for the legal pages: marketing shell + a readable prose column. */
export function LegalPage({
  active,
  title,
  intro,
  children,
}: {
  active: MarketingPage
  title: string
  intro: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <MarketingShell active={active}>
      <section className="mkt-wrap pt-20 pb-24 sm:pt-28">
        <p className="mkt-eyebrow mkt-rise">Legal</p>
        <h1 className="mkt-h1 mkt-rise mt-6 max-w-3xl" style={{ '--d': 1 } as React.CSSProperties}>
          {title}
        </h1>
        <p className="mkt-hsub mkt-rise" style={{ '--d': 2 } as React.CSSProperties}>
          {intro}
        </p>
        <div className="mkt-prose mt-14">
          {children}
          <p className="mkt-prose-meta">
            Last updated {LEGAL.updated}. {LEGAL.companyName}, {LEGAL.address}. See also{' '}
            {LEGAL_LINKS.filter((l) => l.href !== `/${active}`).map((l, i) => (
              <span key={l.href}>
                {i > 0 && ' · '}
                <Link href={l.href} className="mkt-link underline">
                  {l.label}
                </Link>
              </span>
            ))}
            .
          </p>
        </div>
      </section>
    </MarketingShell>
  )
}

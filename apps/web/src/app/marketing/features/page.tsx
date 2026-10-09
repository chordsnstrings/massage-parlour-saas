import { ArrowRight, Check } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { AREAS, AUTOMATIONS } from '@/components/marketing/content'
import { CtaBand, MarketingShell } from '@/components/marketing/shell'

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Every automation in spamanagement.co: bookings, follow-ups, accounts, marketing and your website.',
}

const NEXT = [
  'Waitlist for busy days',
  'Merging duplicate clients',
  'Equipment as a bookable resource',
  'Staff time clock and leave',
  'Booking widget for existing websites',
  'Reserve with Google',
]

const css = (vars: Record<string, number>) => vars as React.CSSProperties

export default function FeaturesPage() {
  return (
    <MarketingShell active="features">
      <section className="mkt-wrap pt-20 pb-12 sm:pt-28">
        <p data-depth="0.03" className="mkt-eyebrow mkt-rise">
          Features
        </p>
        <h1 data-depth="0.06" className="mkt-h1 mkt-rise mt-6 max-w-4xl" style={css({ '--d': 1 })}>
          Everything that runs itself.
        </h1>
        <nav
          aria-label="Feature areas"
          data-depth="0.09"
          className="mkt-rise mt-10 flex flex-wrap gap-2"
          style={css({ '--d': 2 })}
        >
          {AREAS.map((a) => (
            <a key={a.key} href={`#${a.key}`} className="mkt-chip">
              {a.title}
            </a>
          ))}
        </nav>
      </section>

      {AREAS.map((a, i) => (
        <section key={a.key} id={a.key}>
          <div className="mkt-wrap grid gap-8 py-16 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
            <div data-rise>
              <span className="mkt-num tabular-nums">0{i + 1}</span>
              <h2 className="mt-4 text-[30px] sm:text-[38px]">{a.title}</h2>
              <p className="mt-3 max-w-sm text-[var(--muted)]">{a.blurb}</p>
            </div>
            <ul data-rise="card" className="mkt-tile grid gap-x-8 gap-y-3.5 sm:grid-cols-2 sm:p-8">
              {a.features.map((f) => (
                <li key={f} className="flex gap-3 text-[15px] leading-snug">
                  <span className={`mt-[7px] size-1.5 shrink-0 rounded-full dot-${a.tint}`} />
                  {f}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ))}

      {/* The team's language (links to the Spa CRM page) */}
      <section id="language" className="mkt-band">
        <div
          data-rise
          className="mkt-wrap grid gap-6 py-16 lg:grid-cols-[1fr_1.6fr] lg:items-center lg:gap-16"
        >
          <div>
            <p className="mkt-eyebrow">Your team’s language</p>
            <h2 className="mt-4 text-[30px] sm:text-[38px]">
              English or <span lang="th">ภาษาไทย</span>
            </h2>
          </div>
          <div>
            <p className="max-w-xl text-[17px] text-[var(--muted)]">
              The whole dashboard — menus, buttons, messages and dates — switches between English and Thai,
              and each person picks their own. Names your team types stay exactly as written.
            </p>
            <Link
              href="/crm"
              className="mkt-link mt-5 inline-flex items-center gap-1.5 font-semibold text-[var(--accent-ink)]"
            >
              See the spa CRM <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Included in every plan */}
      <section id="automations" className="mkt-sec mkt-dark">
        <div className="mkt-wrap grid gap-10 lg:grid-cols-2">
          <div data-rise>
            <p className="mkt-eyebrow">Runs on its own</p>
            <h2 className="mkt-h2">Working in the background, every day.</h2>
          </div>
          <ul data-rise className="mkt-tile divide-y divide-[var(--line)] p-0">
            {AUTOMATIONS.map((t) => (
              <li key={t} className="flex items-center gap-3 px-5 py-4 text-[15px]">
                <Check className="mkt-check size-[18px] shrink-0" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mkt-band">
        <div data-rise className="mkt-wrap py-16">
          <p className="mkt-eyebrow">Coming next</p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {NEXT.map((t) => (
              <li key={t} className="mkt-chip text-[var(--muted)]">
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <CtaBand title="See it with your own menu." />
    </MarketingShell>
  )
}

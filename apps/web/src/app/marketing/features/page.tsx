import { Check } from 'lucide-react'
import type { Metadata } from 'next'
import { AREAS, INCLUDED } from '@/components/marketing/content'
import { CtaBand, MarketingShell } from '@/components/marketing/shell'

export const metadata: Metadata = {
  title: 'Features',
  description:
    'Everything Spa Management does: calendar, WhatsApp, checkout, accounts, website builder and AI.',
}

const NEXT = [
  'Waitlist for busy days',
  'Merging duplicate clients',
  'Equipment as a bookable resource',
  'Staff time clock and leave',
  'Booking widget for existing websites',
  'Reserve with Google',
]

export default function FeaturesPage() {
  return (
    <MarketingShell active="features">
      <section className="mkt-wrap pt-20 pb-12 sm:pt-28">
        <p className="mkt-eyebrow mkt-rise">Features</p>
        <h1 className="mkt-rise mt-4 max-w-3xl text-[38px] leading-[1.06] font-semibold tracking-tight sm:text-[56px]">
          Everything a UAE spa runs on, in one place.
        </h1>
        <nav aria-label="Feature areas" className="mkt-rise mt-10 flex flex-wrap gap-2">
          {AREAS.map((a) => (
            <a
              key={a.key}
              href={`#${a.key}`}
              className={`mkt-card rounded-full px-4 py-2 text-[14px] tint-${a.tint}`}
            >
              {a.title}
            </a>
          ))}
        </nav>
      </section>

      {AREAS.map((a, i) => (
        <section key={a.key} id={a.key} className="border-t border-[var(--line)]">
          <div
            data-scene="reveal"
            data-span=".45"
            className="mkt-wrap grid gap-8 py-16 lg:grid-cols-[1fr_1.6fr] lg:gap-16"
          >
            <div>
              <span className="text-[13px] text-[var(--mute)] tabular-nums">0{i + 1}</span>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">{a.title}</h2>
              <p className="mt-3 max-w-sm text-[var(--ink-2)]">{a.blurb}</p>
            </div>
            <ul className={`grid gap-x-8 gap-y-3.5 rounded-2xl p-6 sm:grid-cols-2 sm:p-8 tint-${a.tint}`}>
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

      {/* Included in every plan — rows hinge open like a departure board */}
      <section data-scene="flip" className="border-t border-[var(--line)]">
        <div className="mkt-wrap grid gap-10 py-20 lg:grid-cols-2">
          <div>
            <p className="mkt-eyebrow">Included</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">No add-ons, no surprises.</h2>
          </div>
          <ul className="divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
            {INCLUDED.map((t) => (
              <li key={t} data-beat className="flex items-center gap-3 bg-white px-5 py-4 text-[15px]">
                <Check className="size-4 text-[var(--sage-deep)]" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="border-t border-[var(--line)]">
        <div data-scene="reveal" data-span=".45" className="mkt-wrap py-16">
          <p className="mkt-eyebrow">Coming next</p>
          <ul className="mt-5 flex flex-wrap gap-2">
            {NEXT.map((t) => (
              <li
                key={t}
                className="rounded-full border border-[var(--line)] px-4 py-2 text-[14px] text-[var(--ink-2)]"
              >
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

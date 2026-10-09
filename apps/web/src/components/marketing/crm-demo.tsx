'use client'
import type { Locale } from '@spa/core/i18n/types'
import { useState } from 'react'
import type { CrmDemoCopy } from '@/components/marketing/crm-demo-copy'

// /crm demo: a compact mock of the real spa dashboard whose labels switch between the English and Thai catalogue
// strings (resolved on the server, crm-demo-copy.ts). Typed names stay as written — they are marked in the mock.

const LANGS: { locale: Locale; label: string }[] = [
  { locale: 'en', label: 'English' },
  { locale: 'th', label: 'ภาษาไทย' },
]
const TONE: Record<string, string> = {
  checked_in: 'tint-mist',
  confirmed: 'tint-sage',
  pending: 'tint-sand',
}

/** A name the spa typed: never translated. */
const Typed = ({ children }: { children: React.ReactNode }) => (
  <span data-typed className="crm-demo-typed">
    {children}
  </span>
)

export function CrmLanguageDemo({ copy }: { copy: Record<Locale, CrmDemoCopy> }) {
  const [locale, setLocale] = useState<Locale>('en')
  const c = copy[locale]
  return (
    <div className="mx-auto max-w-[1040px]">
      <fieldset className="flex flex-col items-center gap-3">
        <legend className="sr-only">Dashboard language</legend>
        <div className="crm-demo-seg">
          {LANGS.map((l) => (
            <button
              key={l.locale}
              type="button"
              lang={l.locale}
              aria-pressed={locale === l.locale}
              onClick={() => setLocale(l.locale)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mkt-stage mt-8 min-w-0">
        <figure data-tilt className="mkt-tilt mkt-device" aria-label="Example spa dashboard">
          <div className="mkt-dots">
            <span />
            <span />
            <span />
            <span className="mkt-url">app.spamanagement.co</span>
          </div>
          {/* key: the labels fade in again on every switch (CSS, off under prefers-reduced-motion) */}
          <div
            key={locale}
            lang={locale}
            data-testid="crm-demo"
            className="mkt-screen crm-demo grid text-[13px] sm:grid-cols-[11.5rem_1fr]"
          >
            <div className="crm-demo-side">
              <div className="flex items-center gap-2.5 px-2 pb-3">
                <span className="grid size-8 place-items-center rounded-lg bg-[var(--accent)] text-[12px] font-bold text-white">
                  AW
                </span>
                <Typed>Al Waha Spa</Typed>
              </div>
              {c.groups.map((g, i) => (
                <div key={g.label} className={i > 0 ? 'max-sm:hidden' : undefined}>
                  <p className="crm-demo-group">{g.label}</p>
                  <ul className="flex flex-wrap gap-1 sm:block sm:space-y-0.5">
                    {g.items.map((it) => (
                      <li key={it.key} data-active={it.active || undefined} className="crm-demo-item">
                        <span className="truncate">{it.label}</span>
                        {it.badge ? <span className="crm-demo-badge">{it.badge}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            <div className="min-w-0 bg-[#f6f6f8] p-3 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <strong className="text-[15px]">{c.title}</strong>
                  <span className="rounded-full bg-[var(--lime)] px-2.5 py-0.5 text-[11px] font-semibold">
                    {c.todayCount}
                  </span>
                </div>
                <span aria-hidden className="crm-demo-mini">
                  <span className="crm-demo-opt" data-on={locale === 'en' || undefined}>
                    EN
                  </span>
                  <span lang="th" className="crm-demo-opt" data-on={locale === 'th' || undefined}>
                    ไทย
                  </span>
                </span>
              </div>

              <div className="grid gap-3 lg:grid-cols-[1.45fr_1fr]">
                <section className="crm-demo-card">
                  <header className="flex items-baseline justify-between gap-2">
                    <p className="crm-demo-h">{c.upNext.title}</p>
                    <span className="text-[11px] text-[var(--mute)]">{c.upNext.sub}</span>
                  </header>
                  <ul className="mt-2 divide-y divide-[var(--line)]">
                    {c.upNext.rows.map((r) => (
                      <li key={r.key} className="flex items-center gap-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">
                            {r.typedClient ? <Typed>{r.client}</Typed> : r.client}
                          </p>
                          <p className="truncate text-[12px] text-[var(--mute)]">
                            {r.line.split(r.service).map((part, i) =>
                              i === 0 ? (
                                part
                              ) : (
                                <span key={part}>
                                  <Typed>{r.service}</Typed>
                                  {part}
                                </span>
                              ),
                            )}
                            <span className="max-sm:hidden">
                              {' · '}
                              {c.upNext.therapist} <Typed>{r.therapist}</Typed>
                            </span>
                          </p>
                        </div>
                        <div className="shrink-0 text-end">
                          <p className="text-[12px] tabular-nums">{r.when}</p>
                          <span
                            className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${TONE[r.tone]}`}
                          >
                            {r.status}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>

                <section className="crm-demo-card">
                  <header>
                    <p className="crm-demo-h">{c.checkout.title}</p>
                  </header>
                  <ul className="mt-2 space-y-1.5">
                    {c.checkout.lines.map((l) => (
                      <li key={l.name} className="flex justify-between gap-3">
                        <Typed>{l.name}</Typed>
                        <span className="shrink-0 tabular-nums">{l.amount}</span>
                      </li>
                    ))}
                  </ul>
                  <dl className="mt-3 space-y-1 border-t border-[var(--line)] pt-2.5 text-[12px] text-[var(--mute)]">
                    <div className="flex justify-between gap-3">
                      <dt>{c.checkout.subtotal}</dt>
                      <dd className="tabular-nums">{c.checkout.subtotalAmount}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>{c.checkout.vat}</dt>
                      <dd className="tabular-nums">{c.checkout.vatAmount}</dd>
                    </div>
                    <div className="flex items-baseline justify-between gap-3 pt-1 text-[var(--text)]">
                      <dt className="text-[13px] font-semibold">{c.checkout.total}</dt>
                      <dd className="text-[18px] font-bold tabular-nums">{c.checkout.totalAmount}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.checkout.methods.map((m, i) => (
                      <span key={m} data-on={i === 0 || undefined} className="crm-demo-pill">
                        {m}
                      </span>
                    ))}
                  </div>
                  <p className="mt-3 flex justify-between gap-3 text-[12px] text-[var(--mute)]">
                    <span>{c.checkout.tips}</span>
                    <span className="tabular-nums">{c.checkout.tipAmount}</span>
                  </p>
                  <p className="crm-demo-cta">{c.checkout.complete}</p>
                </section>
              </div>
            </div>
          </div>
        </figure>
      </div>

      <p className="mt-6 text-center text-[14px] text-[var(--muted)]">
        <span className="crm-demo-typed">Underlined</span> names are typed by your team, so they stay exactly
        as written in both languages.
      </p>
    </div>
  )
}

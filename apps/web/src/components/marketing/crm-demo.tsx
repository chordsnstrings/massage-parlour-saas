'use client'
import type { Locale } from '@spa/core/i18n/types'
import {
  Calculator,
  CalendarDays,
  ClipboardList,
  Contact,
  HandHeart,
  House,
  type LucideIcon,
  MessagesSquare,
  ReceiptText,
  Users,
  Wallet,
} from 'lucide-react'
import { useState } from 'react'
import type { CrmDemoCopy } from '@/components/marketing/crm-demo-copy'

// Spa dashboard mock for the marketing site (/crm demo, home showcase): labels switch between the English and Thai
// catalogue strings (resolved on the server, crm-demo-copy.ts); typed names stay as written and are marked. Styled
// with the real CRM look (crm.css tokens mirrored in marketing.css `.crm-demo*`).

const LANGS: { locale: Locale; label: string }[] = [
  { locale: 'en', label: 'English' },
  { locale: 'th', label: 'ภาษาไทย' },
]
/** Sidebar icons, as in the real shell (components/shell/spa-shell.tsx). */
const ICONS: Record<string, LucideIcon> = {
  dashboard: House,
  calendar: CalendarDays,
  bookings: ClipboardList,
  sales: Wallet,
  inbox: MessagesSquare,
  clients: Contact,
  services: HandHeart,
  team: Users,
  accounts: Calculator,
  vatPayroll: ReceiptText,
}

/** A name the spa typed: never translated. */
export const Typed = ({ children }: { children: React.ReactNode }) => (
  <span data-typed className="crm-demo-typed">
    {children}
  </span>
)

/** English | ภาษาไทย switch for the demo. */
export function LanguageToggle({ locale, onChange }: { locale: Locale; onChange: (l: Locale) => void }) {
  return (
    <fieldset className="flex flex-col items-center gap-3">
      <legend className="sr-only">Dashboard language</legend>
      <div className="crm-demo-seg">
        {LANGS.map((l) => (
          <button
            key={l.locale}
            type="button"
            lang={l.locale}
            aria-pressed={locale === l.locale}
            onClick={() => onChange(l.locale)}
          >
            {l.label}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export const DeviceBar = () => (
  <div className="mkt-dots">
    <span />
    <span />
    <span />
    <span className="mkt-url">app.spamanagement.co</span>
  </div>
)

/**
 * The dashboard screen. Render it with `key={locale}` so the labels fade in again on every switch (CSS, off under
 * prefers-reduced-motion). `overview` adds today's KPI row (home showcase) and leaves the till to the floating card
 * on phones.
 */
export function CrmDashboard({ c, overview = false }: { c: CrmDemoCopy; overview?: boolean }) {
  return (
    <div
      lang={c.locale}
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
            <ul className="crm-demo-strip">
              {g.items.map((it) => {
                const Icon = ICONS[it.key]
                return (
                  <li key={it.key} data-active={it.active || undefined} className="crm-demo-item">
                    {Icon ? <Icon aria-hidden className="crm-demo-ico" /> : null}
                    <span className="min-w-0 flex-1 truncate">{it.label}</span>
                    {it.badge ? <span className="crm-demo-badge">{it.badge}</span> : null}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>

      <div className="crm-demo-main min-w-0 p-3 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <strong className="crm-demo-title">{c.title}</strong>
            <span className="rounded-full bg-[var(--lime)] px-2.5 py-0.5 text-[11px] font-semibold">
              {c.todayCount}
            </span>
          </div>
          <span aria-hidden className="crm-demo-mini">
            <span className="crm-demo-opt" data-on={c.locale === 'en' || undefined}>
              EN
            </span>
            <span lang="th" className="crm-demo-opt" data-on={c.locale === 'th' || undefined}>
              ไทย
            </span>
          </span>
        </div>

        {overview ? (
          <ul className="mb-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {c.kpis.map((k) => (
              <li key={k.key} className="crm-demo-card crm-demo-kpi">
                <p className="truncate text-[11.5px] text-[var(--mute)]">{k.label}</p>
                <p className="crm-demo-num truncate">{k.value}</p>
                <p className="truncate text-[11px] text-[var(--mute)]">{k.sub}</p>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[1.45fr_1fr]">
          <section className="crm-demo-card">
            <header className="flex items-baseline justify-between gap-2">
              <p className="crm-demo-h">{c.upNext.title}</p>
              <span className="truncate text-[11px] text-[var(--mute)]">{c.upNext.sub}</span>
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
                    <span data-tone={r.tone} className="crm-demo-st mt-1">
                      {r.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className={overview ? 'crm-demo-card max-sm:hidden' : 'crm-demo-card'}>
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
                <dd className="crm-demo-num">{c.checkout.totalAmount}</dd>
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
  )
}

export const TypedNote = ({ className = 'mt-6' }: { className?: string }) => (
  <p className={`${className} text-center text-[14px] text-[var(--muted)]`}>
    <span className="crm-demo-typed">Underlined</span> names are typed by your team, so they stay exactly as
    written in both languages.
  </p>
)

/** /crm: the dashboard in a tilting device frame (MarketingMotion `data-tilt`) with the EN/TH switch. */
export function CrmLanguageDemo({ copy }: { copy: Record<Locale, CrmDemoCopy> }) {
  const [locale, setLocale] = useState<Locale>('en')
  return (
    <div className="mx-auto max-w-[1040px]">
      <LanguageToggle locale={locale} onChange={setLocale} />
      <div className="mkt-stage mt-8 min-w-0">
        <figure data-tilt className="mkt-tilt mkt-device" aria-label="Example spa dashboard">
          <DeviceBar />
          <CrmDashboard key={locale} c={copy[locale]} />
        </figure>
      </div>
      <TypedNote />
    </div>
  )
}

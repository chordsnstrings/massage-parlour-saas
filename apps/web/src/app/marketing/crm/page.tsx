import {
  ArrowRight,
  Building2,
  CalendarDays,
  ChartColumn,
  ClipboardList,
  FileText,
  Globe,
  HandCoins,
  KeyRound,
  MessageCircle,
  Receipt,
  ShieldCheck,
  UserRound,
} from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { CrmLanguageDemo } from '@/components/marketing/crm-demo'
import { crmDemoCopy } from '@/components/marketing/crm-demo-copy'
import { marketingMetadata } from '@/components/marketing/seo'
import { CtaBand, HeroDepth, MarketingShell } from '@/components/marketing/shell'
import { requestUrls } from '@/server/origin'

const description =
  'The spa CRM we build and set up with you: calendar, till, clients, team and accounts in one dashboard — in English or Thai.'

export const metadata: Metadata = marketingMetadata('crm', {
  title: 'Spa CRM — the dashboard your whole team uses',
  description,
})

const css = (vars: Record<string, number>) => vars as React.CSSProperties

/** What the spa dashboard does today (docs/PLAN.md §14.6–§18). Keep every line true to the product. */
const MODULES = [
  {
    icon: CalendarDays,
    title: 'Calendar & rooms',
    text: 'A day view by therapist or room, plus week and month overviews. Therapist and room are reserved together — the database itself blocks double booking.',
  },
  {
    icon: Globe,
    title: 'Every booking, one calendar',
    text: 'Bookings from your website and from the AI receptionist in your Instagram messages land on the same calendar as walk-ins and phone bookings.',
  },
  {
    icon: Receipt,
    title: 'Till, packages, gift cards & memberships',
    text: 'Check out bookings and walk-ins, split across cash, your card terminal or a transfer. Sell packages, gift cards and memberships. Payments are recorded, never processed.',
  },
  {
    icon: FileText,
    title: 'Full UAE tax invoices',
    text: 'Any sale prints as a full tax invoice: your TRN, the customer’s name, address and TRN, and VAT line by line.',
  },
  {
    icon: HandCoins,
    title: 'Staff, commission & tips',
    text: 'Shifts, commission per booking and tips per therapist. Commission goes into the monthly payroll run and the WPS salary file; tips and advances are paid out separately.',
  },
  {
    icon: UserRound,
    title: 'Therapists see their own day',
    text: 'Therapists see only their own bookings, check guests in and out, and follow their own earnings — never the spa’s revenue.',
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp reminders, one tap',
    text: 'Confirmations, reminders and thank-yous are written and queued for you. Your staff tap to send each one from your own WhatsApp — nothing goes out automatically.',
  },
  {
    icon: ClipboardList,
    title: 'Clients & intake forms',
    text: 'Everyone who has booked or walked in, with their visits, preferences, packages and signed intake forms.',
  },
  {
    icon: ChartColumn,
    title: 'Reports & KPIs',
    text: 'Revenue, occupancy, no-shows, top services and therapists, booking sources, the daily close, profit and loss and VAT figures.',
  },
  {
    icon: Building2,
    title: 'Multi-branch',
    text: 'Each branch with its own hours and business day. Choose which branches every team member can see.',
  },
  {
    icon: ShieldCheck,
    title: 'Roles & permissions',
    text: 'Owner, manager, receptionist, therapist and accountant — or roles of your own — plus an audit log of every change.',
  },
  {
    icon: KeyRound,
    title: 'Two-factor sign-in',
    text: 'Owners and managers sign in with two-factor authentication, switched on from day one.',
  },
]

/** How we set the CRM up with the spa (matches the Contact page: "We set up your spa with you…"). */
const SETUP = [
  {
    n: '01',
    title: 'Apply for your spa',
    text: 'Tell us about your spa in a short application. We review it and get in touch.',
    lines: ['Al Waha Spa · Jumeirah', 'Application accepted ✓'],
  },
  {
    n: '02',
    title: 'We build it with you',
    text: 'Your menu and prices, rooms, therapists and shifts, and each branch’s opening hours — set up together, usually in one visit.',
    lines: ['Hot stone ritual · 90 min · AED 480', 'Rooms 1–6 · open until midnight'],
  },
  {
    n: '03',
    title: 'Bring your clients',
    text: 'Import clients, your menu and products from a spreadsheet. We do the first import with you.',
    lines: ['clients.xlsx → 1,240 clients', 'Phones, notes and tags kept'],
  },
  {
    n: '04',
    title: 'Your team signs in',
    text: 'Invite each person with their role and branches. Everyone picks English or Thai for themselves.',
    lines: ['Mei · Therapist · Thai', 'Sara · Receptionist · English'],
  },
]

export default async function CrmPage() {
  const urls = await requestUrls()
  const copy = crmDemoCopy()
  return (
    <MarketingShell active="crm">
      {/* Hero */}
      <section className="mkt-hero">
        <HeroDepth />
        <div className="mkt-wrap text-center">
          <p data-depth="0.03" className="mkt-eyebrow mkt-rise">
            Spa CRM
          </p>
          <h1 data-depth="0.06" className="mkt-h1 mkt-rise mx-auto mt-6 max-w-4xl" style={css({ '--d': 1 })}>
            The dashboard your whole team uses.
          </h1>
          <p data-depth="0.08" className="mkt-hsub mkt-rise mx-auto" style={css({ '--d': 2 })}>
            Calendar, till, clients, team and accounts in one place — built and set up with your spa, and used
            by your staff in English or Thai.
          </p>
          <div data-depth="0.1" className="mkt-ctas mkt-rise justify-center" style={css({ '--d': 3 })}>
            <a href={urls.app('/signup')} className="mkt-btn mkt-btn-primary">
              Apply for your spa <ArrowRight />
            </a>
            <Link href="/pricing" className="mkt-btn mkt-btn-ghost">
              See pricing
            </Link>
          </div>
          <p data-depth="0.11" className="mkt-hnotes mkt-rise" style={css({ '--d': 4.5 })}>
            Included in your plan · Set up with you · English & <span lang="th">ภาษาไทย</span>
          </p>
        </div>
      </section>

      {/* Interactive: the same dashboard in English and Thai */}
      <section id="language" className="mkt-band mkt-sec">
        <div className="mkt-wrap">
          <div data-rise className="mkt-shead">
            <p className="mkt-eyebrow">
              In English or <span lang="th">ภาษาไทย</span>
            </p>
            <h2 className="mkt-h2 max-w-2xl">Every screen in your team’s language.</h2>
            <p className="mkt-lead">
              Each person picks English or Thai, and the whole dashboard follows — menus, buttons, messages,
              dates. Names your team types, like clients, therapists and treatments, stay exactly as written.
            </p>
          </div>
          <div className="mt-[54px]">
            <CrmLanguageDemo copy={copy} />
          </div>
        </div>
      </section>

      {/* Modules */}
      <section className="mkt-sec mkt-dark">
        <div className="mkt-wrap">
          <div data-rise className="mkt-shead">
            <p className="mkt-eyebrow">What’s inside</p>
            <h2 className="mkt-h2 max-w-3xl">Everything the front desk, therapists and owner need.</h2>
          </div>
          <ul className="mt-[54px] grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
            {MODULES.map((m) => (
              <li key={m.title} data-rise="card" className="mkt-card">
                <span aria-hidden className="mkt-lbar" />
                <m.icon aria-hidden className="size-6 text-[var(--accent-ink)]" />
                <h3 className="mt-4">{m.title}</h3>
                <p>{m.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Set up for you */}
      <section className="mkt-sec">
        <div className="mkt-wrap">
          <div data-rise className="mkt-shead">
            <p className="mkt-eyebrow">Set up for you</p>
            <h2 className="mkt-h2 max-w-2xl">We build your CRM with you.</h2>
            <p className="mkt-lead">
              No empty software to fill in on your own. We set up your spa with you — menu, staff, rooms,
              hours and your first import — so your team starts on a dashboard that already knows your spa.
            </p>
          </div>
          <ol className="mt-[54px] grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
            {SETUP.map((s) => (
              <li key={s.n} data-rise="card" className="mkt-tile flex flex-col">
                <span className="mkt-num tabular-nums">{s.n}</span>
                <h3 className="mt-2">{s.title}</h3>
                <p className="flex-1">{s.text}</p>
                <ul className="tint-sage mt-5 space-y-1.5 rounded-xl px-3.5 py-3 text-[13px]">
                  {s.lines.map((l) => (
                    <li key={l} className="truncate">
                      {l}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <div data-rise className="mt-10 text-center">
            <Link
              href="/website-builder"
              className="mkt-link inline-flex items-center gap-1.5 font-semibold text-[var(--accent-ink)]"
            >
              Your website is crafted by our studio too <ArrowRight className="size-4" />
            </Link>
          </div>
        </div>
      </section>

      <CtaBand title="Let’s set up your spa’s CRM." />
    </MarketingShell>
  )
}

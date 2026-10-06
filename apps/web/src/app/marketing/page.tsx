import { plans, platformDb } from '@spa/db'
import { asc, eq } from 'drizzle-orm'
import {
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  Globe,
  MessageCircle,
  Sparkles,
  Wallet,
} from 'lucide-react'
import type { Metadata } from 'next'
import { Logo } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Reveal, Stagger, StaggerItem } from '@/components/ui/motion'
import { formatAed } from '@/lib/utils'

export const metadata: Metadata = { title: { absolute: 'Spa Management — software for spas in the UAE' } }
export const dynamic = 'force-dynamic' // prices are edited live in the super-admin

const features = [
  {
    icon: CalendarDays,
    title: 'Calm calendar',
    text: 'Therapists, rooms and walk-ins on one screen — no double bookings, ever.',
  },
  {
    icon: Wallet,
    title: 'Cash-first POS',
    text: 'Cash, card terminal or transfer. Packages, gift cards and a daily close in minutes.',
  },
  {
    icon: BarChart3,
    title: 'Simple accounts',
    text: 'Profit, VAT and therapist payouts without spreadsheets.',
  },
  {
    icon: Globe,
    title: 'A beautiful website',
    text: 'Drag-and-drop templates in English and Arabic, live on your own domain.',
  },
  {
    icon: MessageCircle,
    title: 'WhatsApp-first',
    text: 'Confirmations, reminders and offers ready to send in one click.',
  },
  {
    icon: Sparkles,
    title: 'AI that fills slots',
    text: 'Instagram posts, DM replies, Google reviews and SEO on autopilot.',
  },
]

async function activePlans() {
  try {
    return await platformDb().select().from(plans).where(eq(plans.active, true)).orderBy(asc(plans.sort))
  } catch {
    return [] // e.g. image build without a database; regenerated at runtime
  }
}

export default async function MarketingPage() {
  const app = process.env.APP_URL ?? 'http://app.localhost:3000'
  const planRows = await activePlans()
  return (
    <div className="overflow-x-hidden">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-6 sm:px-8">
        <Logo />
        <div className="flex items-center gap-2">
          <Button variant="ghost" asChild>
            <a href={`${app}/login`}>Sign in</a>
          </Button>
          <Button asChild className="hidden sm:inline-flex">
            <a href={`${app}/signup`}>Start free trial</a>
          </Button>
        </div>
      </header>

      <section className="relative mx-auto max-w-6xl px-5 pt-16 pb-24 sm:px-8 sm:pt-28 sm:pb-32">
        <div className="pointer-events-none absolute top-0 right-0 -z-10 size-[34rem] translate-x-1/3 rounded-full bg-accent-soft blur-3xl" />
        <Reveal className="max-w-3xl">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted">
            Made for spas across the UAE
          </p>
          <h1 className="mt-6 text-[40px] leading-[1.05] font-semibold tracking-tight sm:text-[64px]">
            Run a calmer, fuller spa.
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted">
            Bookings, cash payments, accounts, your website and AI marketing — in one quiet, beautiful place.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <a href={`${app}/signup`}>
                Start your free trial <ArrowRight />
              </a>
            </Button>
            <Button size="lg" variant="secondary" asChild>
              <a href="#pricing">See pricing</a>
            </Button>
          </div>
        </Reveal>
      </section>

      <section className="border-y bg-surface/60">
        <Stagger className="mx-auto grid max-w-6xl gap-px px-5 py-20 sm:grid-cols-2 sm:px-8 lg:grid-cols-3">
          {features.map((f) => (
            <StaggerItem key={f.title} className="p-6 sm:p-8">
              <f.icon className="size-5 text-accent" strokeWidth={1.5} />
              <h3 className="mt-5 font-semibold tracking-tight">{f.title}</h3>
              <p className="mt-2 text-[15px] text-muted">{f.text}</p>
            </StaggerItem>
          ))}
        </Stagger>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-5 py-24 sm:px-8">
        <h2 className="text-3xl font-semibold tracking-tight">One simple price</h2>
        <p className="mt-2 text-muted">Everything included. Pay yearly by bank transfer or cash.</p>
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {planRows.map((p) => (
            <div key={p.id} className="rounded-2xl border bg-surface p-8">
              <h3 className="font-semibold">{p.name}</h3>
              <p className="tabular mt-4 text-4xl font-semibold tracking-tight">{formatAed(p.priceAed)}</p>
              <p className="text-sm text-muted">
                per {p.billingInterval} · {p.trialDays}-day free trial
              </p>
              <ul className="mt-6 space-y-2.5 text-sm">
                {features.map((f) => (
                  <li key={f.title} className="flex gap-2.5">
                    <Check className="mt-0.5 size-4 text-accent" /> {f.title}
                  </li>
                ))}
              </ul>
              <Button className="mt-8 w-full" asChild>
                <a href={`${app}/signup`}>Start free trial</a>
              </Button>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-5 py-10 text-sm text-muted sm:px-8">
          <Logo />
          <span>© {new Date().getFullYear()} spamanagement.ae</span>
        </div>
      </footer>
    </div>
  )
}

import { ArrowRight, Check } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { CtaBand, HeroDepth, MarketingShell } from '@/components/marketing/shell'
import { StudioDemo } from '@/components/marketing/studio-demo'
import { appUrl } from '@/server/origin'

export const metadata: Metadata = {
  title: 'Website studio',
  description:
    'Your spa website, designed, written and built by our studio in English and Arabic — with online booking built in.',
}

const css = (vars: Record<string, number>) => vars as React.CSSProperties

/** How the studio builds a site — each step shows the real thing it produces. */
const STEPS = [
  {
    n: '01',
    title: 'Tell us about your spa',
    text: 'Fill in a short brief, or just send your current website. We read every page and bring your treatments, story and photos across.',
    tint: 'tint-sage',
    lines: [
      'Spa: Al Waha Spa, Jumeirah',
      'Current site: alwahaspa.com',
      'Feel: calm, warm, a little luxurious',
    ],
  },
  {
    n: '02',
    title: 'We design it by hand',
    text: 'Our designers compose every page section by section, choosing from a library of hand-tuned designs to suit your spa.',
    tint: 'tint-mist',
    lines: ['Hero — split, with your terrace photo', 'Treatments — two-column menu', 'Team — portrait cards'],
  },
  {
    n: '03',
    title: 'We write it in English and Arabic',
    text: 'Copy written for your treatments and your guests, in both languages, with right-to-left layouts done properly.',
    tint: 'tint-clay',
    lines: ['“Slow down. Breathe in.”', '«تمهّل. وتنفّس بعمق.»', 'Every page, both languages'],
  },
  {
    n: '04',
    title: 'You review, we refine',
    text: 'Preview the finished site, ask for anything you’d like changed, and approve it when it feels right. Then it goes live.',
    tint: 'tint-plum',
    lines: ['You: “Can the hero use our pool photo?”', 'Studio: “Done — have a look.”', 'You: Approved ✓'],
  },
]

/** Section library — each type has its own set of designs. */
const SECTIONS = [
  { name: 'Hero', sample: 'Slow down. Breathe in.', meta: 'Book a treatment' },
  { name: 'Treatments menu', sample: 'Hot stone ritual', meta: '90 min · AED 480' },
  { name: 'Team', sample: 'Maya, senior therapist', meta: 'Deep tissue · Thai' },
  { name: 'Offers', sample: 'Weekday calm', meta: '20% off before 2 pm' },
  { name: 'Reviews', sample: '“Best massage in Dubai.”', meta: '★★★★★ Google' },
  { name: 'Gallery', sample: 'Treatment rooms', meta: '12 photos' },
  { name: 'Packages', sample: 'Couples retreat', meta: '2 × 90 min · AED 900' },
  { name: 'Visit us', sample: 'Open until midnight', meta: 'Jumeirah Beach Road' },
]

const INCLUDED = [
  'English and Arabic on every page, right-to-left done properly',
  'Designed for phones first, perfect on every screen',
  'A Book button on every page — bookings land in your calendar',
  'Prices, team and opening hours always live from your dashboard',
  'Scroll effects and motion tuned section by section',
  'Your own domain with HTTPS, connected for you',
]

export default async function WebsiteStudioPage() {
  const signup = await appUrl('/signup')
  return (
    <MarketingShell active="website-builder">
      {/* Hero */}
      <section className="mkt-hero">
        <HeroDepth />
        <div className="mkt-wrap text-center">
          <p data-depth="0.03" className="mkt-eyebrow mkt-rise">
            Website studio
          </p>
          <h1 data-depth="0.06" className="mkt-h1 mkt-rise mx-auto mt-6 max-w-4xl" style={css({ '--d': 1 })}>
            A website handcrafted for your spa.
          </h1>
          <p data-depth="0.08" className="mkt-hsub mkt-rise mx-auto" style={css({ '--d': 2 })}>
            No templates to wrestle with. Our studio designs, writes and builds your site in English and
            Arabic — from your treatments, your team and your photos. You approve it. It takes bookings.
          </p>
          <div data-depth="0.1" className="mkt-ctas mkt-rise justify-center" style={css({ '--d': 3 })}>
            <a href={signup} className="mkt-btn mkt-btn-primary">
              Start your spa <ArrowRight />
            </a>
            <a href="#make-it-yours" className="mkt-btn mkt-btn-ghost">
              Try the styles
            </a>
          </div>
          <p data-depth="0.11" className="mkt-hnotes mkt-rise" style={css({ '--d': 4.5 })}>
            Included in your plan · Built by people, not a wizard · Changes on request
          </p>
        </div>
      </section>

      {/* Interactive: one spa, restyled */}
      <section id="make-it-yours" className="mkt-band mkt-sec">
        <div className="mkt-wrap">
          <div data-rise className="mkt-shead">
            <p className="mkt-eyebrow">Make it yours</p>
            <h2 className="mkt-h2 max-w-2xl">One spa, many ways to tell its story.</h2>
            <p className="mkt-lead">
              Switch the style, the hero design and the language. Our studio makes choices like these for
              every section of your site — so it looks like you, not like everyone else.
            </p>
          </div>
          <div className="mt-[54px]">
            <StudioDemo />
          </div>
        </div>
      </section>

      {/* How we build it */}
      <section className="mkt-sec">
        <div className="mkt-wrap">
          <div data-rise className="mkt-shead">
            <p className="mkt-eyebrow">How we build it</p>
            <h2 className="mkt-h2 max-w-2xl">From a short brief to a site you’re proud of.</h2>
          </div>
          <ol className="mt-[54px] grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} data-rise="card" className="mkt-tile flex flex-col">
                <span className="mkt-num tabular-nums">{s.n}</span>
                <h3 className="mt-2">{s.title}</h3>
                <p className="flex-1">{s.text}</p>
                <ul className={`mt-5 space-y-1.5 rounded-xl px-3.5 py-3 text-[13px] ${s.tint}`}>
                  {s.lines.map((l) => (
                    <li key={l} className="truncate">
                      {l}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Section library */}
      <section className="mkt-sec mkt-dark">
        <div className="mkt-wrap">
          <div data-rise className="mkt-shead">
            <p className="mkt-eyebrow">Crafted, not templated</p>
            <h2 className="mkt-h2 max-w-3xl">
              Every section has dozens of designs. We choose the right one for you.
            </h2>
            <p className="mkt-lead">
              Hundreds of hand-tuned section designs, each fully responsive and in both languages. Your site
              is composed from them piece by piece — then refined by hand.
            </p>
          </div>
          <div className="mt-[54px] grid gap-[18px] sm:grid-cols-2 lg:grid-cols-4">
            {SECTIONS.map((s) => (
              <div key={s.name} data-rise="card" className="mkt-card">
                <span aria-hidden className="mkt-lbar" />
                <p className="text-[12px] font-bold tracking-[0.12em] uppercase">{s.name}</p>
                <p className="mt-4 font-serif text-[18px] leading-snug text-[var(--text)]">{s.sample}</p>
                <p className="mt-1 text-[13px]">{s.meta}</p>
                <p className="mt-5 border-t border-[var(--line)] pt-3 text-[12px] text-[var(--mute)]">
                  30 designs
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* After launch */}
      <section className="mkt-band mkt-sec">
        <div className="mkt-wrap grid items-center gap-12 lg:grid-cols-2">
          <div data-rise>
            <p className="mkt-eyebrow">After launch</p>
            <h2 className="mkt-h2">Changes are a message away.</h2>
            <p className="mkt-lead max-w-md">
              New offer for Eid? Fresh photos? Ask from your dashboard and the studio takes care of it.
              Prices, team and opening hours update on their own — you never touch the website.
            </p>
          </div>
          <ul className="space-y-3">
            {[
              { who: 'You', text: 'Can we add our Eid offer to the home page?', mine: true },
              { who: 'Studio', text: 'Done — it’s live, and in Arabic too.', mine: false },
              { who: 'You', text: 'New hot stone price is AED 520.', mine: true },
              { who: 'Studio', text: 'No change needed — prices come from your menu.', mine: false },
            ].map((m) => (
              <li
                key={m.text}
                data-rise
                className={`max-w-sm rounded-2xl px-4 py-3 text-[14px] ${m.mine ? 'ms-auto border border-[var(--line)] bg-[var(--surface)]' : 'bg-[var(--text)] text-white'}`}
              >
                <span className={`block text-[11px] ${m.mine ? 'text-[var(--mute)]' : 'text-white/60'}`}>
                  {m.who}
                </span>
                {m.text}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Included */}
      <section className="mkt-sec">
        <div data-rise className="mkt-wrap">
          <p className="mkt-eyebrow">Included in every site</p>
          <ul className="mt-8 grid gap-x-10 gap-y-4 sm:grid-cols-2">
            {INCLUDED.map((t) => (
              <li key={t} className="flex gap-3 text-[15px]">
                <Check className="mkt-check mt-0.5 size-[18px] shrink-0" /> {t}
              </li>
            ))}
          </ul>
          <Link
            href="/pricing"
            className="mkt-link mt-10 inline-flex items-center gap-1.5 font-semibold text-[var(--accent-ink)]"
          >
            Part of your plan — see pricing <ArrowRight className="size-4" />
          </Link>
        </div>
      </section>

      <CtaBand title="Let’s craft your spa’s website." />
    </MarketingShell>
  )
}

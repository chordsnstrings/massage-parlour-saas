import { ArrowRight, Check } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { CtaBand, MarketingShell } from '@/components/marketing/shell'
import { StudioDemo } from '@/components/marketing/studio-demo'
import { appUrl } from '@/lib/paths'

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

export default function WebsiteStudioPage() {
  return (
    <MarketingShell active="website-builder">
      {/* Hero */}
      <section data-scene="depart" data-mode="leave" className="relative overflow-x-clip">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute top-12 left-[10%] size-72 rounded-full bg-[var(--mist-soft)] blur-3xl" />
          <div className="absolute top-28 right-[8%] size-80 rounded-full bg-[var(--clay-soft)] blur-3xl" />
        </div>
        <div data-world className="mkt-wrap relative pt-20 pb-20 text-center sm:pt-28 sm:pb-24">
          <p className="mkt-eyebrow mkt-rise">Website studio</p>
          <h1
            className="mkt-rise mx-auto mt-4 max-w-3xl text-[38px] leading-[1.06] font-semibold tracking-tight sm:text-[60px]"
            style={css({ '--d': 1 })}
          >
            A website handcrafted for your spa.
          </h1>
          <p
            className="mkt-rise mx-auto mt-5 max-w-xl text-[17px] leading-relaxed text-[var(--ink-2)]"
            style={css({ '--d': 2 })}
          >
            No templates to wrestle with. Our studio designs, writes and builds your site in English and
            Arabic — from your treatments, your team and your photos. You approve it. It takes bookings.
          </p>
          <div className="mkt-rise mt-9 flex flex-wrap justify-center gap-3" style={css({ '--d': 3 })}>
            <a href={appUrl('/signup')} className="mkt-btn mkt-btn-primary">
              Start your spa <ArrowRight className="mkt-arrow size-4" />
            </a>
            <a href="#make-it-yours" className="mkt-btn mkt-btn-ghost bg-white/70">
              Try the styles
            </a>
          </div>
          <p className="mkt-rise mt-8 text-[13px] text-[var(--mute)]" style={css({ '--d': 4 })}>
            Included in your plan · Built by people, not a wizard · Changes on request
          </p>
        </div>
      </section>

      {/* Interactive: one spa, restyled */}
      <section id="make-it-yours" className="tint-sand border-y border-[var(--line)]">
        <div className="mkt-wrap py-20">
          <p className="mkt-eyebrow">Make it yours</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">
            One spa, many ways to tell its story.
          </h2>
          <p className="mt-4 max-w-xl text-[var(--ink-2)]">
            Switch the style, the hero design and the language. Our studio makes choices like these for every
            section of your site — so it looks like you, not like everyone else.
          </p>
          <div className="mt-12">
            <StudioDemo />
          </div>
        </div>
      </section>

      {/* How we build it — four steps build up in turn */}
      <section data-scene="beats" data-pin="wide" style={css({ '--len': 360 })}>
        <div data-stage>
          <div className="mkt-wrap py-20">
            <p className="mkt-eyebrow">How we build it</p>
            <h2 className="mt-3 max-w-xl text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">
              From a short brief to a site you’re proud of.
            </h2>
            <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li
                  key={s.n}
                  data-beat={i + 1}
                  data-from="y:28 rx:-14 o:0"
                  className="flex flex-col rounded-2xl border border-[var(--line)] bg-white p-5"
                >
                  <span className="text-[13px] text-[var(--mute)] tabular-nums">{s.n}</span>
                  <h3 className="mt-2 font-medium">{s.title}</h3>
                  <p className="mt-1.5 flex-1 text-[14px] leading-relaxed text-[var(--ink-2)]">{s.text}</p>
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
        </div>
      </section>

      {/* Section library — cards fly into place */}
      <section data-scene="assemble" className="border-t border-[var(--line)]">
        <div className="mkt-wrap py-24">
          <p className="mkt-eyebrow">Crafted, not templated</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">
            Every section has dozens of designs. We choose the right one for you.
          </h2>
          <p className="mt-4 max-w-xl text-[var(--ink-2)]">
            Hundreds of hand-tuned section designs, each fully responsive and in both languages. Your site is
            composed from them piece by piece — then refined by hand.
          </p>
          <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SECTIONS.map((s) => (
              <div key={s.name} data-beat className="mkt-card border border-[var(--line)] bg-white p-5">
                <p className="text-[12px] tracking-[0.12em] text-[var(--mute)] uppercase">{s.name}</p>
                <p className="mt-4 font-serif text-[18px] leading-snug">{s.sample}</p>
                <p className="mt-1 text-[13px] text-[var(--ink-2)]">{s.meta}</p>
                <p className="mt-5 border-t border-[var(--line)] pt-3 text-[12px] text-[var(--mute)]">
                  30 designs
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* After launch */}
      <section className="tint-mist border-y border-[var(--line)]">
        <div className="mkt-wrap grid items-center gap-12 py-20 lg:grid-cols-2">
          <div>
            <p className="mkt-eyebrow">After launch</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight sm:text-[40px] sm:leading-tight">
              Changes are a message away.
            </h2>
            <p className="mt-4 max-w-md text-[var(--ink-2)]">
              New offer for Eid? Fresh photos? Ask from your dashboard and the studio takes care of it.
              Prices, team and opening hours update on their own — you never touch the website.
            </p>
          </div>
          <ul data-scene="flip" className="space-y-3">
            {[
              { who: 'You', text: 'Can we add our Eid offer to the home page?', mine: true },
              { who: 'Studio', text: 'Done — it’s live, and in Arabic too.', mine: false },
              { who: 'You', text: 'New hot stone price is AED 520.', mine: true },
              { who: 'Studio', text: 'No change needed — prices come from your menu.', mine: false },
            ].map((m) => (
              <li
                key={m.text}
                data-beat
                className={`max-w-sm rounded-2xl px-4 py-3 text-[14px] ${m.mine ? 'ms-auto bg-white' : 'bg-[var(--ink)] text-white'}`}
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
      <section>
        <div data-scene="reveal" data-span=".45" className="mkt-wrap py-24">
          <p className="mkt-eyebrow">Included in every site</p>
          <ul className="mt-8 grid gap-x-10 gap-y-4 sm:grid-cols-2">
            {INCLUDED.map((t) => (
              <li key={t} className="flex gap-3 text-[15px]">
                <Check className="mt-0.5 size-4 shrink-0 text-[var(--sage-deep)]" /> {t}
              </li>
            ))}
          </ul>
          <Link href="/pricing" className="mkt-link mt-10 inline-flex items-center gap-1.5 font-medium">
            Part of your plan — see pricing <ArrowRight className="mkt-arrow size-4" />
          </Link>
        </div>
      </section>

      <CtaBand title="Let’s craft your spa’s website." />
    </MarketingShell>
  )
}

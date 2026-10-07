import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { LogoMark } from '@/components/brand'
import { ScrollScenes } from '@/components/scroll-scenes'
import { requestUrls } from '@/server/origin'

export type MarketingPage = 'home' | 'features' | 'website-builder' | 'pricing' | 'contact'

const NAV: { key: MarketingPage; href: string; label: string }[] = [
  { key: 'features', href: '/features', label: 'Features' },
  { key: 'website-builder', href: '/website-builder', label: 'Website studio' },
  { key: 'pricing', href: '/pricing', label: 'Pricing' },
  { key: 'contact', href: '/contact', label: 'Contact' },
]

async function Header({ active }: { active: MarketingPage }) {
  const urls = await requestUrls()
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-white/85 backdrop-blur-md">
      <div className="mkt-wrap flex h-16 items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight">
          <LogoMark className="size-7" />
          <span>Spa Management</span>
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-7 text-[14px] text-[var(--ink-2)] md:flex">
          {NAV.map((n) => (
            <Link
              key={n.key}
              href={n.href}
              aria-current={active === n.key ? 'page' : undefined}
              className="mkt-link py-1 hover:text-[var(--ink)] aria-[current=page]:text-[var(--ink)]"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <a
            href={urls.app('/login')}
            className="mkt-link hidden px-2 text-[14px] text-[var(--ink-2)] sm:inline"
          >
            Sign in
          </a>
          <a href={urls.app('/signup')} className="mkt-btn mkt-btn-primary h-10 px-4 text-[14px]">
            Start
          </a>
        </div>
      </div>
      <nav
        aria-label="Main (mobile)"
        className="flex h-10 items-center gap-5 overflow-x-auto border-t border-[var(--line)] px-5 text-[13px] text-[var(--ink-2)] md:hidden"
      >
        {NAV.map((n) => (
          <Link
            key={n.key}
            href={n.href}
            aria-current={active === n.key ? 'page' : undefined}
            className="mkt-link shrink-0 aria-[current=page]:text-[var(--ink)]"
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}

export async function CtaBand({ title = 'Let your spa run itself.' }: { title?: string }) {
  const urls = await requestUrls()
  return (
    <section className="mkt-wrap py-24">
      <div className="tint-sage relative overflow-hidden rounded-[2rem] px-6 py-16 text-center sm:px-12">
        <div
          aria-hidden
          className="absolute -top-16 -left-10 size-56 rounded-full bg-[var(--mist-soft)] blur-2xl"
        />
        <div
          aria-hidden
          className="absolute -right-10 -bottom-20 size-64 rounded-full bg-[var(--clay-soft)] blur-2xl"
        />
        <div className="relative">
          <h2 className="mx-auto max-w-xl text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h2>
          <p className="mx-auto mt-4 max-w-md text-[var(--ink-2)]">
            Set up in an afternoon. We help you import your clients and menu.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <a href={urls.app('/signup')} className="mkt-btn mkt-btn-primary">
              Start your spa <ArrowRight className="mkt-arrow size-4" />
            </a>
            <Link href="/contact" className="mkt-btn mkt-btn-ghost bg-white/70">
              Talk to us
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

async function Footer() {
  const urls = await requestUrls()
  return (
    <footer className="border-t border-[var(--line)]">
      <div className="mkt-wrap grid gap-10 py-14 text-[14px] sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5 font-semibold">
            <LogoMark className="size-6" /> Spa Management
          </div>
          <p className="max-w-xs text-[var(--mute)]">Software for massage spas in the UAE. Made in Dubai.</p>
        </div>
        <div className="space-y-2.5">
          <p className="font-medium">Product</p>
          {NAV.slice(0, 3).map((n) => (
            <Link key={n.key} href={n.href} className="mkt-link block w-fit text-[var(--ink-2)]">
              {n.label}
            </Link>
          ))}
        </div>
        <div className="space-y-2.5">
          <p className="font-medium">Company</p>
          <Link href="/contact" className="mkt-link block w-fit text-[var(--ink-2)]">
            Contact
          </Link>
          <a href={urls.app('/login')} className="mkt-link block w-fit text-[var(--ink-2)]">
            Sign in
          </a>
        </div>
        <div className="space-y-2.5">
          <p className="font-medium">Built for the UAE</p>
          <p className="text-[var(--ink-2)]">AED pricing · VAT ready · English & Arabic sites</p>
        </div>
      </div>
      <div className="mkt-wrap border-t border-[var(--line)] py-6 text-[13px] text-[var(--mute)]">
        © {new Date().getFullYear()} spamanagement.ae
      </div>
    </footer>
  )
}

/** Shared marketing page frame. ScrollScenes mounts last so it commits with the sections it drives. */
export function MarketingShell({ active, children }: { active: MarketingPage; children: React.ReactNode }) {
  return (
    <div className="mkt min-h-dvh">
      <Header active={active} />
      <main>{children}</main>
      <Footer />
      <ScrollScenes />
    </div>
  )
}

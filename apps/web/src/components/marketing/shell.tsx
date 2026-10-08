import { ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'
import { Logo } from '@/components/brand'
import { MarketingMotion } from '@/components/marketing/motion'
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
    <header data-mkt-nav className="mkt-nav">
      <div className="mkt-wrap mkt-bar">
        <Link href="/" className="mkt-logo">
          <Logo className="h-6" />
        </Link>
        <nav aria-label="Main" className="mkt-links hidden items-center md:flex">
          {NAV.map((n) => (
            <Link key={n.key} href={n.href} aria-current={active === n.key ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mkt-links ms-auto flex items-center gap-2">
          <a href={urls.app('/login')} className="hidden px-2 sm:inline">
            Sign in
          </a>
          <a href={urls.app('/signup')} className="mkt-btn mkt-btn-dark mkt-btn-sm">
            Start
          </a>
        </div>
      </div>
      <nav aria-label="Main (mobile)" className="mkt-subnav md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.key}
            href={n.href}
            aria-current={active === n.key ? 'page' : undefined}
            className="shrink-0"
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}

/** Hero depth layers: abstract product fragments that drift around the headline at their own depth
 *  (`data-depth`, MarketingMotion). Decorative only. */
export function HeroDepth() {
  return (
    <div aria-hidden className="mkt-deco">
      <div data-depth="-0.22" className="mkt-frag f1">
        <b />
        <span className="mkt-lines">
          <i className="w-24 bg-white/80" />
          <i className="w-14 bg-white/30" />
        </span>
      </div>
      <div data-depth="-0.34" className="mkt-frag f2">
        <Check strokeWidth={2.6} />
      </div>
      <div data-depth="-0.2" className="mkt-frag f3">
        <b />
        <span className="mkt-lines">
          <i className="w-20 bg-[var(--text)]/80" />
          <i className="w-12 bg-[var(--line)]" />
        </span>
      </div>
      <div data-depth="-0.12" className="mkt-frag f4">
        <i />
      </div>
    </div>
  )
}

export async function CtaBand({ title = 'Let your spa run itself.' }: { title?: string }) {
  const urls = await requestUrls()
  return (
    <section className="mkt-sec pt-5">
      <div className="mkt-wrap">
        <div className="mkt-demo text-center">
          <div data-rise>
            <h2 className="mkt-h2 mx-auto mt-0 max-w-2xl">{title}</h2>
            <p className="mkt-lead mx-auto">
              Set up in an afternoon. We help you import your clients and menu.
            </p>
            <div className="mkt-ctas justify-center">
              <a href={urls.app('/signup')} className="mkt-btn mkt-btn-primary">
                Start your spa <ArrowRight />
              </a>
              <Link href="/contact" className="mkt-btn mkt-btn-ghost">
                Talk to us
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

async function Footer() {
  const urls = await requestUrls()
  return (
    <footer className="mkt-foot">
      <div className="mkt-wrap">
        <div className="mkt-fgrid">
          <div>
            <div className="mkt-logo">
              <Logo className="h-6" />
            </div>
            <p className="mt-3 max-w-[280px]">Software for massage spas in the UAE. Made in Dubai.</p>
          </div>
          <div>
            <b>Product</b>
            {NAV.slice(0, 3).map((n) => (
              <Link key={n.key} href={n.href}>
                {n.label}
              </Link>
            ))}
          </div>
          <div>
            <b>Company</b>
            <Link href="/contact">Contact</Link>
            <a href={urls.app('/login')}>Sign in</a>
          </div>
          <div>
            <b>Built for the UAE</b>
            <p>AED pricing · VAT ready · English & Arabic sites</p>
          </div>
        </div>
        <div className="mkt-fbot">
          <span>© {new Date().getFullYear()} spamanagement.co</span>
        </div>
      </div>
    </footer>
  )
}

/** Shared marketing page frame ("C · Bold product-led" look). MarketingMotion draws the fixed background (z-index keeps it
 *  behind) and mounts last so it commits with the elements it drives. */
export function MarketingShell({ active, children }: { active: MarketingPage; children: React.ReactNode }) {
  return (
    <div className="mkt min-h-dvh">
      <Header active={active} />
      <main>{children}</main>
      <Footer />
      <MarketingMotion />
    </div>
  )
}

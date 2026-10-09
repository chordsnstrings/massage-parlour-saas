import { ArrowRight, Check } from 'lucide-react'
import Link from 'next/link'
import { Logo } from '@/components/brand'
import { LEGAL, LEGAL_LINKS } from '@/components/marketing/legal-config'
import { MarketingMotion } from '@/components/marketing/motion'
import { companyContact, DEFAULT_CONTACT_EMAIL } from '@/components/marketing/plans'
import { requestUrls } from '@/server/origin'

export type MarketingPage =
  | 'home'
  | 'features'
  | 'crm'
  | 'website-builder'
  | 'pricing'
  | 'contact'
  | 'privacy'
  | 'terms'
  | 'data-deletion'

const NAV: { key: MarketingPage; href: string; label: string }[] = [
  { key: 'features', href: '/features', label: 'Features' },
  { key: 'crm', href: '/crm', label: 'Spa CRM' },
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
          <Logo className="h-10 sm:h-12" />
        </Link>
        <nav aria-label="Main" className="mkt-links hidden items-center md:flex">
          {NAV.map((n) => (
            <Link key={n.key} href={n.href} aria-current={active === n.key ? 'page' : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mkt-links ms-auto flex items-center gap-2">
          <a href={urls.app('/login')} className="px-2 text-[14px] font-semibold">
            Sign in
          </a>
          <a href={urls.app('/signup')} className="mkt-btn mkt-btn-dark mkt-btn-sm">
            Get started
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
                Apply for your spa <ArrowRight />
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

type FootLink = { label: string; href: string; external?: boolean }

/** Footer columns: only pages and in-page sections that exist (anchors are the `id`s on the features, website-builder
 *  and pricing sections; platform-domains.spec checks every link and anchor). */
function footColumns(app: (path: string) => string, email: string): { title: string; links: FootLink[] }[] {
  return [
    {
      title: 'Product',
      links: [
        ...NAV.slice(0, 4).map((n) => ({ label: n.label, href: n.href })),
        { label: 'Apply for your spa', href: app('/signup'), external: true },
        { label: 'Sign in', href: app('/login'), external: true },
      ],
    },
    {
      title: 'Features',
      links: [
        { label: 'Bookings & calendar', href: '/features#bookings' },
        { label: 'Reminders & follow-ups', href: '/features#follow-up' },
        { label: 'Sales & accounts', href: '/features#money' },
        { label: 'Instagram & Google', href: '/features#marketing' },
        { label: 'Roles & security', href: '/features#team' },
        { label: 'Background automations', href: '/features#automations' },
      ],
    },
    {
      title: 'Website studio',
      links: [
        { label: 'Make it yours', href: '/website-builder#make-it-yours' },
        { label: 'How we build it', href: '/website-builder#how-we-build-it' },
        { label: 'Section designs', href: '/website-builder#section-designs' },
        { label: 'Changes after launch', href: '/website-builder#after-launch' },
        { label: 'Included in every site', href: '/website-builder#included' },
      ],
    },
    {
      title: 'Built for the UAE',
      links: [
        { label: 'Plans in AED', href: '/pricing#plans' },
        { label: 'VAT for your FTA return', href: '/features#money' },
        { label: 'WhatsApp from your own number', href: '/features#follow-up' },
        { label: 'English & Arabic sites', href: '/website-builder#included' },
        { label: 'Dashboard in English & Thai', href: '/crm' },
        { label: 'Questions', href: '/pricing#faq' },
      ],
    },
    {
      title: 'Company',
      links: [
        { label: 'Contact', href: '/contact' },
        { label: email, href: `mailto:${email}`, external: true },
        ...LEGAL_LINKS.map((l) => ({ label: l.label, href: l.href })),
      ],
    },
  ]
}

/** Lets an email address wrap after the @ instead of mid-domain in a narrow column. */
const wrapAt = (s: string) => {
  const i = s.indexOf('@')
  return i < 0 ? (
    s
  ) : (
    <>
      {s.slice(0, i + 1)}
      <wbr />
      {s.slice(i + 1)}
    </>
  )
}

async function Footer() {
  const urls = await requestUrls()
  const email = (await companyContact())?.email || DEFAULT_CONTACT_EMAIL
  const cols = footColumns(urls.app, email)
  return (
    <footer className="mkt-foot">
      <div className="mkt-wrap">
        <div className="mkt-fgrid">
          <div className="mkt-fbrand">
            <div className="mkt-logo">
              <Logo className="h-11" />
            </div>
            <p className="mkt-ftag">Calm software for busy spas.</p>
            <p className="mkt-fdesc">
              Bookings, POS, staff and your website in one place. Built for the UAE, priced in AED.
            </p>
          </div>
          <nav aria-label="Footer" className="mkt-fnav">
            {cols.map((c, i) => (
              <div key={c.title}>
                <h2 id={`mkt-f${i}`} className="mkt-fhead">
                  {c.title}
                </h2>
                <ul aria-labelledby={`mkt-f${i}`}>
                  {c.links.map((l) => (
                    <li key={l.label}>
                      {l.external ? (
                        <a href={l.href}>{wrapAt(l.label)}</a>
                      ) : (
                        <Link href={l.href}>{l.label}</Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>
        <div className="mkt-fbot">
          <span>
            © {new Date().getFullYear()} {LEGAL.companyName} · {LEGAL.brand}
          </span>
          <span>
            Client payments are recorded, never processed. WhatsApp reminders and follow-ups are sent by you,
            from your own number.
          </span>
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

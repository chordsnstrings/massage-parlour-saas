import '@fontsource-variable/dm-sans'
import '@fontsource-variable/space-grotesk'
import '../brand-app.css'
import Link from 'next/link'
import { Logo, LogoMark } from '../brand'
import { BottomNav, type NavItem, SidebarNav } from './nav'
import { UserMenu } from './user-menu'

/**
 * Responsive shell (docs/PLAN.md §12.4) in the marketing look (.mkt-app, components/brand-app.css; R13 §14.8): sidebar 248px on lg, icon rail 72px on md, top bar + bottom tabs on phones.
 */
export function AppShell({
  title,
  subtitle,
  homeHref,
  nav,
  user,
  banner,
  switchHref,
  accountHref,
  children,
}: {
  title: string
  subtitle?: string
  homeHref: string
  nav: NavItem[]
  user: { name: string; email: string }
  banner?: React.ReactNode
  switchHref?: string
  accountHref?: string
  children: React.ReactNode
}) {
  const primary = nav.slice(0, 4)
  const more = nav.slice(4)
  return (
    <div className="mkt-app min-h-dvh md:grid md:grid-cols-[72px_minmax(0,1fr)] lg:grid-cols-[248px_minmax(0,1fr)]">
      <aside className="mkt-app-dark sticky top-0 hidden h-dvh flex-col md:flex">
        <Link
          href={homeHref}
          className="flex min-h-16 items-center gap-3 px-5 py-4 md:justify-center lg:justify-start"
        >
          <LogoMark tone="light" className="lg:hidden" />
          <span className="min-w-0 md:hidden lg:block">
            <Logo className="mb-2.5 hidden h-5 lg:block" />
            <span className="mkt-app-chip">{title}</span>
            {subtitle && <span className="mt-1.5 block truncate text-xs text-muted">{subtitle}</span>}
          </span>
        </Link>
        <div className="flex-1 overflow-y-auto px-3 py-4">
          <SidebarNav items={nav} />
        </div>
        <div className="border-t border-border p-3">
          <UserMenu user={user} switchHref={switchHref} accountHref={accountHref} />
        </div>
      </aside>
      <div className="min-w-0">
        {banner}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-bg/85 px-4 backdrop-blur-md md:hidden">
          <Link href={homeHref} className="flex min-w-0 items-center gap-2.5">
            <LogoMark className="size-6" />
            <span className="truncate text-sm font-semibold tracking-tight">{title}</span>
          </Link>
          <UserMenu user={user} compact switchHref={switchHref} accountHref={accountHref} />
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 pt-6 pb-28 sm:px-6 md:px-8 md:pt-10 md:pb-16 xl:px-12">
          {children}
        </main>
      </div>
      <BottomNav items={primary} more={more} />
    </div>
  )
}

export function Banner({ tone, children }: { tone: 'warning' | 'accent'; children: React.ReactNode }) {
  return (
    <div
      className={
        tone === 'warning'
          ? 'border-b bg-warning-soft px-4 py-2 text-center text-[13px] text-warning md:px-8'
          : 'border-b bg-accent-soft px-4 py-2 text-center text-[13px] text-accent md:px-8'
      }
    >
      {children}
    </div>
  )
}

'use client'
// Spa dashboard shell ("Be Relax CRM" design, docs/design/crm-spec.md §2): framed window with the spa's sidebar
// (logo + name, profile menu, grouped nav, plan card) and a top bar (crumb + title, EN | ไทย). Styles: crm.css.
// Super-admin keeps AppShell. The notifications bell is passed in (`bell`); search and Ask AI arrive in Phase 3.
import { authClient } from '@spa/auth/client'
import type { Locale } from '@spa/core/i18n/types'
import {
  AppWindow,
  ArrowLeftRight,
  Calculator,
  CalendarDays,
  ChevronDown,
  ClipboardList,
  Contact,
  CreditCard,
  HandHeart,
  House,
  LogOut,
  Megaphone,
  Menu,
  MessagesSquare,
  ReceiptText,
  Settings2,
  Star,
  UserRound,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { DropdownMenu } from 'radix-ui'
import { Fragment, useEffect, useState, useTransition } from 'react'
import { setLocaleAction } from '@/i18n/actions'
import { useI18n } from '@/i18n/client'
import { spring } from '@/lib/motion'
import { surfaceBaseOf } from '@/lib/paths'
import { initials } from '@/lib/utils'

const icons = {
  dashboard: House,
  calendar: CalendarDays,
  bookings: ClipboardList,
  sales: Wallet,
  inbox: MessagesSquare,
  clients: Contact,
  services: HandHeart,
  team: Users,
  marketing: Megaphone,
  website: AppWindow,
  reviews: Star,
  accounts: Calculator,
  vat: ReceiptText,
  billing: CreditCard,
  settings: Settings2,
} as const

export type ShellIcon = keyof typeof icons
/** A destination. `match` = extra path prefixes that also mark it active (e.g. /ai/try under AI studio). */
export type ShellLink = { href: string; label: string; exact?: boolean; match?: string[] }
/** Menu item; with `pages`, its section's pages show as tabs under the top bar (href = the first page). */
export type ShellItem = ShellLink & { icon: ShellIcon; pages?: ShellLink[] }
export type ShellGroup = { label: string; items: ShellItem[] }
export type ShellPlan = {
  name: string | null
  ai: { percent: number; text: string } | null
  renewal: string | null
}

const LANGS: { locale: Locale; label: string }[] = [
  { locale: 'en', label: 'EN' },
  { locale: 'th', label: 'ไทย' },
]

const within = (pathname: string, path: string) => pathname === path || pathname.startsWith(`${path}/`)
const matches = (pathname: string, l: ShellLink) =>
  l.exact ? pathname === l.href || (l.match ?? []).some((m) => within(pathname, m)) : within(pathname, l.href)

/** Most specific match wins (e.g. /ai/content beats a generic /ai prefix). */
function findActive(groups: ShellGroup[], pathname: string) {
  let best: { group: ShellGroup; item: ShellItem; page: ShellLink | null; len: number } | null = null
  for (const group of groups)
    for (const item of group.items)
      for (const link of item.pages?.length ? item.pages : [item]) {
        if (!matches(pathname, link)) continue
        const len = link.href.length
        if (!best || len > best.len) best = { group, item, page: item.pages?.length ? link : null, len }
      }
  return best
}

function dubaiHour() {
  return Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Dubai' }).format(
      new Date(),
    ),
  )
}

export function SpaShell({
  spa,
  user,
  nav,
  plan,
  banner,
  alert,
  bell,
  accountHref,
  switchHref,
  children,
}: {
  spa: { name: string; tagline: string | null; logoUrl: string | null; homeHref: string }
  user: { name: string; role: string }
  nav: ShellGroup[]
  plan: ShellPlan | null
  banner?: React.ReactNode
  /** Full-width one-line bar above the whole CRM (e.g. overdue invoice, R11). */
  alert?: React.ReactNode
  /** Notifications bell in the top bar (NotificationBell). */
  bell?: React.ReactNode
  accountHref: string
  switchHref: string
  children: React.ReactNode
}) {
  const { t, locale } = useI18n()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [switching, startSwitch] = useTransition()
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null)

  // Route changes close the phone drawer.
  useEffect(() => {
    if (pathname) setOpen(false)
  }, [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const active = findActive(nav, pathname)
  const isHome = active?.item.href === spa.homeHref && active.item.exact
  const firstName = user.name.split(/\s+/)[0] ?? user.name
  const hour = dubaiHour()
  const title = isHome
    ? t(`shell.greeting.${hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'}`, { name: firstName })
    : (active?.page?.label ?? active?.item.label ?? spa.name)
  const pages = active?.item.pages && active.item.pages.length > 1 ? active.item.pages : null
  const shownLocale = pendingLocale ?? locale

  const switchLocale = (next: Locale) => {
    if (next === locale || switching) return
    setPendingLocale(next)
    startSwitch(async () => {
      await setLocaleAction(next)
      setPendingLocale(null)
    })
  }

  return (
    <>
      <button
        type="button"
        className="crm-scrim"
        data-open={open}
        aria-label={t('shell.closeMenu')}
        tabIndex={-1}
        onClick={() => setOpen(false)}
      />
      {alert}
      <div className="crm-app">
        <aside className="crm-side" data-open={open} aria-label={spa.name}>
          <div className="crm-brand">
            <Link href={spa.homeHref} className="crm-brand-link">
              <span className={spa.logoUrl ? 'crm-mark has-logo' : 'crm-mark'}>
                {spa.logoUrl ? (
                  // biome-ignore lint/performance/noImgElement: tenant upload served by /files (already WebP, ≤512 px)
                  <img src={spa.logoUrl} alt={t('shell.logoAlt', { spa: spa.name })} />
                ) : (
                  <span aria-hidden>{initials(spa.name)}</span>
                )}
              </span>
              <span className="crm-bname">
                <b>{spa.name}</b>
                {spa.tagline && <span>{spa.tagline}</span>}
              </span>
            </Link>
            <button
              type="button"
              className="crm-iconbtn crm-close"
              aria-label={t('shell.closeMenu')}
              onClick={() => setOpen(false)}
            >
              <X strokeWidth={1.7} />
            </button>
          </div>

          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              className="crm-profile"
              aria-label={t('shell.profileMenu', { name: user.name })}
            >
              <span className="crm-pav" aria-hidden>
                {initials(user.name)}
              </span>
              <span className="crm-pn">
                <b>{user.name}</b>
                <span>{t('shell.profileRole', { role: user.role, spa: spa.name })}</span>
              </span>
              <ChevronDown className="crm-pc" strokeWidth={2} />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="start" sideOffset={6} className="crm-menu">
                <DropdownMenu.Item asChild className="crm-menu-item">
                  <Link href={accountHref}>
                    <UserRound /> {t('shell.account')}
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Item asChild className="crm-menu-item">
                  <Link href={switchHref}>
                    <ArrowLeftRight /> {t('shell.switchSpa')}
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="crm-menu-sep" />
                <DropdownMenu.Item
                  className="crm-menu-item"
                  onSelect={async () => {
                    await authClient.signOut()
                    window.location.href = `${surfaceBaseOf(window.location.pathname)}/login`
                  }}
                >
                  <LogOut /> {t('shell.signOut')}
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <nav className="crm-nav" aria-label={t('shell.mainMenu')}>
            {nav.map((group) => (
              <Fragment key={group.label}>
                <p className="crm-ngroup">{group.label}</p>
                {group.items.map((item) => {
                  const Icon = icons[item.icon]
                  const on = active?.item === item
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="crm-nlink"
                      aria-current={on ? 'page' : undefined}
                    >
                      {on && (
                        <motion.span layoutId="crm-nav-active" transition={spring} className="crm-nactive" />
                      )}
                      <Icon strokeWidth={1.6} />
                      <span>{item.label}</span>
                    </Link>
                  )
                })}
              </Fragment>
            ))}
          </nav>

          {plan && (
            <div className="crm-side-foot">
              <div className="crm-plan">
                {plan.name && <b>{plan.name}</b>}
                {plan.ai && (
                  <>
                    <small>{plan.ai.text}</small>
                    <div className="crm-meter" data-full={plan.ai.percent >= 100} aria-hidden>
                      <i style={{ width: `${Math.min(plan.ai.percent, 100)}%` }} />
                    </div>
                  </>
                )}
                {plan.renewal && <small>{plan.renewal}</small>}
              </div>
            </div>
          )}
        </aside>

        <div className="crm-main">
          {banner}
          <header className="crm-top">
            <button
              type="button"
              className="crm-iconbtn crm-burger"
              aria-label={t('shell.openMenu')}
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              <Menu strokeWidth={1.7} />
            </button>
            <div className="crm-crumb">
              <small>{active?.group.label ?? ''}</small>
              <b suppressHydrationWarning>{title}</b>
            </div>
            {bell}
            <fieldset className="crm-seg" aria-label={t('shell.language')} aria-busy={switching}>
              {LANGS.map((l) => (
                <button
                  key={l.locale}
                  type="button"
                  lang={l.locale}
                  aria-pressed={shownLocale === l.locale}
                  disabled={switching}
                  onClick={() => switchLocale(l.locale)}
                >
                  {l.label}
                </button>
              ))}
            </fieldset>
          </header>
          {pages && (
            <nav className="crm-tabs" aria-label={t('shell.sectionPages')}>
              {pages.map((p) => (
                <Link
                  key={p.href}
                  href={p.href}
                  className="crm-tab"
                  aria-current={active?.page === p ? 'page' : undefined}
                >
                  {p.label}
                </Link>
              ))}
            </nav>
          )}
          <main className="crm-view">{children}</main>
        </div>
      </div>
    </>
  )
}

export function SpaBanner({
  tone,
  children,
}: {
  tone: 'warning' | 'accent' | 'danger'
  children: React.ReactNode
}) {
  return (
    <div className="crm-banner" data-tone={tone} role={tone === 'danger' ? 'alert' : undefined}>
      {children}
    </div>
  )
}

'use client'
import {
  Building2,
  CalendarDays,
  Contact,
  Ellipsis,
  Globe,
  HandHeart,
  House,
  Landmark,
  Layers,
  MessageCircle,
  ReceiptText,
  ScrollText,
  Settings2,
  ShieldCheck,
  Sparkles,
  UserCog,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'
import { Sheet } from '../ui/sheet'

const icons = {
  home: House,
  team: Users,
  roles: ShieldCheck,
  settings: Settings2,
  billing: ReceiptText,
  account: UserRound,
  tenants: Building2,
  plans: Layers,
  ai: Sparkles,
  audit: ScrollText,
  company: Landmark,
  calendar: CalendarDays,
  clients: Contact,
  sales: Wallet,
  messages: MessageCircle,
  services: HandHeart,
  staff: UserCog,
  website: Globe,
} as const

export type NavItem = { href: string; label: string; icon: keyof typeof icons; exact?: boolean }

function useActive() {
  const pathname = usePathname()
  return (item: NavItem) => {
    // Pathnames here are the public ones (host rewrites are invisible to the client).
    if (item.exact) return pathname === item.href
    return pathname === item.href || pathname.startsWith(`${item.href}/`)
  }
}

export function SidebarNav({ items }: { items: NavItem[] }) {
  const isActive = useActive()
  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = icons[item.icon]
        const active = isActive(item)
        return (
          <Link
            key={item.href}
            href={item.href}
            title={item.label}
            className={cn(
              'relative flex h-10 items-center gap-3 rounded-lg px-3 text-sm transition-colors md:justify-center lg:justify-start',
              active ? 'text-fg' : 'text-muted hover:bg-subtle/70 hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId="sidebar-active"
                transition={spring}
                className="absolute inset-0 rounded-lg bg-subtle"
              />
            )}
            <Icon className="relative size-[18px] shrink-0" strokeWidth={1.5} />
            <span className="relative md:hidden lg:inline">{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

export function BottomNav({ items, more }: { items: NavItem[]; more: NavItem[] }) {
  const isActive = useActive()
  const [open, setOpen] = useState(false)
  const moreActive = more.some(isActive)
  const tab = (key: string, active: boolean, Icon: (typeof icons)[keyof typeof icons], label: string) => (
    <span
      className={cn(
        'relative flex flex-col items-center gap-1 py-1.5 text-[11px] transition-colors',
        active ? 'text-fg' : 'text-muted',
      )}
    >
      {active && (
        <motion.span
          layoutId="bottom-active"
          transition={spring}
          className="absolute -top-2 h-0.5 w-8 rounded-full bg-accent"
        />
      )}
      <Icon className="size-5" strokeWidth={1.5} />
      {label}
      <span className="sr-only">{key}</span>
    </span>
  )
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-surface/90 pb-safe backdrop-blur-md md:hidden">
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length + (more.length ? 1 : 0)}, minmax(0, 1fr))` }}
      >
        {items.map((item) => (
          <Link key={item.href} href={item.href} className="pt-2">
            {tab(item.href, isActive(item), icons[item.icon], item.label)}
          </Link>
        ))}
        {more.length > 0 && (
          <Sheet
            open={open}
            onOpenChange={setOpen}
            title="More"
            trigger={
              <button type="button" className="pt-2">
                {tab('more', moreActive, Ellipsis, 'More')}
              </button>
            }
          >
            <div className="grid gap-1">
              {more.map((item) => {
                const Icon = icons[item.icon]
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      'flex h-12 items-center gap-3 rounded-lg px-3 text-[15px] hover:bg-subtle',
                      isActive(item) && 'bg-subtle',
                    )}
                  >
                    <Icon className="size-5 text-muted" strokeWidth={1.5} />
                    {item.label}
                  </Link>
                )
              })}
            </div>
          </Sheet>
        )}
      </div>
    </nav>
  )
}

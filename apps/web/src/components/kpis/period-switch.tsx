'use client'
import { motion } from 'motion/react'
import Link from 'next/link'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'

export type PeriodOption = { key: string; label: string; href: string }

/** Segmented Today · 7 days · 30 days switch (URL-driven, so it works without JS too). */
export function PeriodSwitch({ options, current }: { options: PeriodOption[]; current: string }) {
  return (
    <nav aria-label="Period" className="flex items-center rounded-xl border bg-surface p-1">
      {options.map((o) => {
        const active = o.key === current
        return (
          <Link
            key={o.key}
            href={o.href}
            scroll={false}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative grid min-h-10 flex-1 place-items-center rounded-lg px-3.5 text-sm font-medium whitespace-nowrap transition-colors sm:min-h-9',
              active ? 'text-fg' : 'text-muted hover:text-fg',
            )}
          >
            {active && (
              <motion.span
                layoutId="kpi-period"
                transition={spring}
                className="absolute inset-0 rounded-lg bg-subtle"
              />
            )}
            <span className="relative">{o.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

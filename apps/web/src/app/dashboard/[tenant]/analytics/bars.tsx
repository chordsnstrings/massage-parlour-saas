'use client'
import { motion, useReducedMotion } from 'motion/react'
import { ease } from '@/lib/motion'

/** Daily bar chart with a staggered draw-in; values are labelled for screen readers. */
export function Bars({ data, label }: { data: { label: string; value: number }[]; label: string }) {
  const reduce = useReducedMotion()
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="flex h-40 items-end gap-[3px] sm:h-48" role="img" aria-label={label}>
      {data.map((d, i) => (
        <div key={d.label} className="group relative flex h-full min-w-0 flex-1 items-end">
          <motion.div
            className="w-full rounded-t-[3px] bg-accent/80 transition-colors group-hover:bg-accent"
            style={{ height: `${Math.max(2, (d.value / max) * 100)}%`, originY: 1 }}
            initial={reduce ? { opacity: 0 } : { scaleY: 0 }}
            animate={reduce ? { opacity: 1 } : { scaleY: 1 }}
            transition={{ duration: 0.4, delay: Math.min(i * 0.012, 0.5), ease }}
          />
          <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-fg px-2 py-0.5 text-[11px] text-bg group-hover:block">
            {d.label} · {d.value}
          </span>
        </div>
      ))}
    </div>
  )
}

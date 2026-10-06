'use client'
import { motion } from 'motion/react'
import type { ReactNode } from 'react'
import { spring } from '@/lib/motion'
import { cn } from '@/lib/utils'

/** Compact segmented control for the editor chrome (viewport, content language). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string; content: ReactNode }[]
  label: string
}) {
  return (
    <fieldset className="relative m-0 flex items-center rounded-lg border-0 bg-subtle p-0.5">
      <legend className="sr-only">{label}</legend>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          aria-label={o.label}
          title={o.label}
          onClick={() => onChange(o.value)}
          className={cn(
            'relative grid h-8 min-w-9 place-items-center rounded-md px-2.5 text-[13px] font-medium transition-colors',
            value === o.value ? 'text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {value === o.value && (
            <motion.span
              layoutId={`seg-${label}`}
              transition={spring}
              className="absolute inset-0 rounded-md bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.08)]"
            />
          )}
          <span className="relative">{o.content}</span>
        </button>
      ))}
    </fieldset>
  )
}

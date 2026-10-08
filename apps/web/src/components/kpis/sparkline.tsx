'use client'
import { motion, useReducedMotion } from 'motion/react'
import { useId, useState } from 'react'
import { ease } from '@/lib/motion'
import { useI18n } from '@/i18n/client'

const W = 600
const H = 140
const PAD = 8

/** Revenue line drawn in with a stroke animation; hover / tap reveals each day's value. */
export function Sparkline({
  points,
  format = 'aed',
  label: ariaLabel,
}: {
  points: { date: string; value: number }[]
  format?: 'aed' | 'int'
  /** Accessible name of the chart (translated by the caller). */
  label: string
}) {
  const { fmt: f } = useI18n()
  // Business dates are calendar days: noon UTC is the same date in Dubai.
  const label = (date: string) => f.dateShort(`${date}T12:00:00Z`)
  const id = useId()
  const reduced = useReducedMotion()
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(1, ...points.map((p) => p.value))
  const step = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0
  const xy = points.map((p, i) => ({
    x: points.length > 1 ? PAD + i * step : W / 2,
    y: H - PAD - (p.value / max) * (H - PAD * 2),
  }))
  const line = xy.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = xy.length ? `${line} L${xy.at(-1)!.x},${H} L${xy[0]!.x},${H} Z` : ''
  const fmt = (v: number) => (format === 'aed' ? f.aed(v) : f.number(v))
  const active = hover ?? points.length - 1
  const shown = points[active]

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted">{shown ? label(shown.date) : ''}</span>
        <span className="font-medium tabular">{shown ? fmt(shown.value) : ''}</span>
      </div>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="h-32 w-full overflow-visible sm:h-36"
          role="img"
          aria-label={ariaLabel}
          onPointerLeave={() => setHover(null)}
          onPointerMove={(e) => {
            const box = e.currentTarget.getBoundingClientRect()
            const x = ((e.clientX - box.left) / box.width) * W
            setHover(step ? Math.max(0, Math.min(points.length - 1, Math.round((x - PAD) / step))) : 0)
          }}
        >
          <defs>
            <linearGradient id={`${id}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.18" />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line
            x1={0}
            x2={W}
            y1={H - PAD}
            y2={H - PAD}
            stroke="var(--color-border)"
            vectorEffect="non-scaling-stroke"
          />
          {area && (
            <motion.path
              d={area}
              fill={`url(#${id}-fill)`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: reduced ? 0 : 0.5, ease }}
            />
          )}
          {line && (
            <motion.path
              d={line}
              fill="none"
              stroke="var(--color-accent)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              initial={reduced ? { opacity: 0 } : { pathLength: 0 }}
              animate={reduced ? { opacity: 1 } : { pathLength: 1 }}
              transition={{ duration: reduced ? 0.2 : 1.1, ease }}
            />
          )}
          {xy[active] && (
            <line
              x1={xy[active].x}
              x2={xy[active].x}
              y1={PAD}
              y2={H - PAD}
              stroke="var(--color-border)"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {xy[active] && (
          <span
            className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-surface bg-accent transition-[left,top] duration-150"
            style={{ left: `${(xy[active].x / W) * 100}%`, top: `${(xy[active].y / H) * 100}%` }}
          />
        )}
      </div>
      {points.length > 1 && (
        <div className="flex justify-between text-xs text-muted">
          <span>{label(points[0]!.date)}</span>
          <span>{label(points.at(-1)!.date)}</span>
        </div>
      )}
    </div>
  )
}

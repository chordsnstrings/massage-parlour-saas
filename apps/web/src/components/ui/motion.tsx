'use client'
import { animate, MotionConfig, motion, useInView, useMotionValue, useTransform } from 'motion/react'
import { useEffect, useRef } from 'react'
import { duration, ease } from '@/lib/motion'

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: duration.base, ease }}>
      {children}
    </MotionConfig>
  )
}

/** Fade + rise on mount. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode
  delay?: number
  className?: string
}) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: duration.layout, ease, delay }}
    >
      {children}
    </motion.div>
  )
}

/** Children reveal one after another (30 ms stagger). */
export function Stagger({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial="hidden"
      animate="show"
      variants={{ hidden: {}, show: { transition: { staggerChildren: 0.03 } } }}
    >
      {children}
    </motion.div>
  )
}

export function StaggerItem({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 8 },
        show: { opacity: 1, y: 0, transition: { duration: duration.layout, ease } },
      }}
    >
      {children}
    </motion.div>
  )
}

/** Counts up to `value` when scrolled into view. */
export function NumberTicker({ value, format }: { value: number; format?: 'aed' | 'int' | 'pct' }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true })
  const mv = useMotionValue(0)
  const text = useTransform(mv, (v) => {
    if (format === 'aed') return `AED ${Math.round(v).toLocaleString('en-AE')}`
    if (format === 'pct') return `${Math.round(v)}%`
    return Math.round(v).toLocaleString('en-AE')
  })
  useEffect(() => {
    if (!inView) return
    const controls = animate(mv, value, { duration: 0.9, ease })
    return () => controls.stop()
  }, [inView, mv, value])
  return (
    <motion.span ref={ref} className="tabular">
      {text}
    </motion.span>
  )
}

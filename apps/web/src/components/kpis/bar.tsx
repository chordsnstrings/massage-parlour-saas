'use client'
import { motion } from 'motion/react'
import { ease } from '@/lib/motion'

/** Proportion bar that grows in from the start edge (MotionConfig turns this into a fade for reduced motion). */
export function Bar({ pct, delay = 0 }: { pct: number; delay?: number }) {
  return (
    <div className="h-1 overflow-hidden rounded-full bg-subtle">
      <motion.div
        className="h-full origin-left rounded-full bg-accent/70 rtl:origin-right"
        style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        initial={{ scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.7, ease, delay }}
      />
    </div>
  )
}

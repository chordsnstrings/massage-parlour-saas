'use client'
import { CheckCircle2, CircleAlert, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { useT } from '@/i18n/client'
import { spring } from '@/lib/motion'

type Toast = { id: number; tone: 'success' | 'error'; text: string }
let nextId = 1
let listeners: ((t: Toast[]) => void)[] = []
let toasts: Toast[] = []
const emit = () => {
  for (const l of listeners) l(toasts)
}
function push(tone: Toast['tone'], text: string) {
  const t = { id: nextId++, tone, text }
  toasts = [...toasts, t].slice(-3)
  emit()
  setTimeout(() => dismiss(t.id), 3800)
}
function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id)
  emit()
}

export const toast = {
  success: (text: string) => push('success', text),
  error: (text: string) => push('error', text),
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([])
  const tr = useT()
  useEffect(() => {
    listeners.push(setItems)
    return () => {
      listeners = listeners.filter((l) => l !== setItems)
    }
  }, [])
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[100] flex flex-col items-center gap-2 px-4 md:bottom-6 md:items-end md:px-6"
    >
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={spring}
            className="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-[var(--ui-toast-radius,0.75rem)] border bg-surface px-4 py-[var(--ui-toast-py,0.75rem)] text-[length:var(--ui-toast-fs,0.875rem)] shadow-pop"
          >
            {t.tone === 'success' ? (
              <CheckCircle2 className="size-4 shrink-0 text-success" strokeWidth={1.75} />
            ) : (
              <CircleAlert className="size-4 shrink-0 text-danger" strokeWidth={1.75} />
            )}
            <span className="flex-1">{t.text}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="text-muted hover:text-fg"
              aria-label={tr('ui.dismiss')}
            >
              <X className="size-4" strokeWidth={1.5} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

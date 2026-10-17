'use client'
import { useEffect } from 'react'

const PUCK_VARS = [
  '--puck-color-azure-01:#16241c',
  '--puck-color-azure-02:#22372b',
  '--puck-color-azure-03:#2f4a3a',
  '--puck-color-azure-04:#3f5f4c',
  '--puck-color-azure-05:#5e7d6b',
  '--puck-color-azure-06:#7d978a',
  '--puck-color-azure-07:#9bb0a4',
  '--puck-color-azure-08:#b9c9bf',
  '--puck-color-azure-09:#d4dfd8',
  '--puck-color-azure-10:#e8eeea',
  '--puck-color-azure-11:#f2f6f3',
  '--puck-color-azure-12:#f8faf8',
].join(';')

/** Puck's selection colours in the canvas iframe follow our sage accent. */
export function FrameStyles({ children, document: doc }: { children: React.ReactNode; document?: Document }) {
  useEffect(() => {
    if (!doc) return
    const el = doc.createElement('style')
    el.textContent = `:root{${PUCK_VARS}}`
    doc.head.appendChild(el)
    return () => {
      el.remove()
    }
  }, [doc])
  return <>{children}</>
}

/**
 * Scrolls a block into view inside the editor canvas (for "Go to block" and library inserts). Only the canvas
 * document scrolls — `scrollIntoView` would also scroll the editor chrome on phones.
 */
export function scrollToBlock(id: string) {
  const frame = document.querySelector<HTMLIFrameElement>('#preview-frame')
  const win = frame?.contentWindow
  const el = frame?.contentDocument?.querySelector(`[data-puck-component="${CSS.escape(id)}"]`)
  if (!win || !el) return
  const rect = el.getBoundingClientRect()
  const top = rect.top + win.scrollY - Math.max(24, (win.innerHeight - rect.height) / 2)
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  win.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
}

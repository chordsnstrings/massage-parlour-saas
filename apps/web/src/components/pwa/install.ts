'use client'
// "Install app" (docs/PLAN.md §18.6): Chrome / Edge / Android hand us `beforeinstallprompt`; iOS has no prompt, so
// it gets Share → Add to Home Screen steps; nothing shows once the dashboard already runs as the installed app.
import { useSyncExternalStore } from 'react'

type PromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
type InstallWindow = Window & { __spaInstallPrompt?: PromptEvent | null }

export type InstallMode = 'prompt' | 'ios' | null

let installed = false
let stepsOpen = false
const listeners = new Set<() => void>()
const emit = () => {
  for (const l of listeners) l()
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    ;(window as InstallWindow).__spaInstallPrompt = e as PromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    ;(window as InstallWindow).__spaInstallPrompt = null
    emit()
  })
}

const standalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: window-controls-overlay)').matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true

// iPadOS reports a Mac user agent; touch support tells them apart.
const ios = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1)

function mode(): InstallMode {
  if (installed || standalone()) return null
  if ((window as InstallWindow).__spaInstallPrompt) return 'prompt'
  return ios() ? 'ios' : null
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** How this browser can install the app, or null (installed, already standalone, or no install path). */
export function useInstallMode(): InstallMode {
  return useSyncExternalStore(subscribe, mode, () => null)
}

/** iOS steps sheet (mounted once by PwaSetup, outside the user menu so closing the menu doesn't close it). */
export function useStepsOpen() {
  return useSyncExternalStore(
    subscribe,
    () => stepsOpen,
    () => false,
  )
}
export function setStepsOpen(open: boolean) {
  stepsOpen = open
  emit()
}

/** The browser's install dialog where there is one, else the iOS steps. */
export function startInstall() {
  if (mode() === 'prompt') void promptInstall()
  // Next tick: a menu item's own close and focus return finish before the sheet takes focus.
  else if (mode() === 'ios') setTimeout(() => setStepsOpen(true), 0)
}

/** Shows the browser's install dialog; true when the person accepted. */
export async function promptInstall() {
  const w = window as InstallWindow
  const event = w.__spaInstallPrompt
  if (!event) return false
  w.__spaInstallPrompt = null // a prompt can only be shown once
  emit()
  await event.prompt()
  const { outcome } = await event.userChoice
  if (outcome === 'accepted') installed = true
  emit()
  return outcome === 'accepted'
}

import { appPath } from '@/lib/paths'

// One service worker (public/sw.js, scope "/") serves web push and the installable dashboard (docs/PLAN.md §18.6).
// Everything registers it through here, with the same URL, so there is never a second, conflicting registration.

/** App surface base the worker prefixes links with ("" in host routing, "/app" in path routing). */
export const appBase = () => (appPath('/') === '/' ? '' : appPath('/'))

export const workerUrl = () => {
  const base = appBase()
  return `/sw.js${base ? `?base=${encodeURIComponent(base)}` : ''}`
}

export const registerWorker = () => navigator.serviceWorker.register(workerUrl(), { scope: '/' })

/** Cache + key the worker reads its offline page from (keep in sync with public/sw.js). */
export const OFFLINE_CACHE = 'spa-offline-v1'
export const offlineKey = () => `${appBase()}/__offline`

/**
 * Inline in the spa dashboard layout: keeps `beforeinstallprompt` even when it fires before React hydrates (it can
 * come right after the manifest loads) and stops Chrome's own mini-infobar — the "Install app" entry replaces it.
 */
export const EARLY_PROMPT_SCRIPT =
  "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__spaInstallPrompt=e})"

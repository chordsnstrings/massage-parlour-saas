/* spamanagement.co — the spa dashboards' service worker: web push + installable app (docs/PLAN.md §18.6). */
/* Registered as /sw.js?base=<app surface base> ("" in host routing, "/app" in path routing), scope "/", on every */
/* dashboard page (components/pwa). Pages always load from the network; nothing but the offline page is cached. */
const BASE = (new URL(self.location.href).searchParams.get('base') || '').replace(/\/$/, '')
/* The page stores a localised offline page here (EN/TH, no user data); the built-in copy covers a first visit. */
const OFFLINE_CACHE = 'spa-offline-v1'
const OFFLINE_KEY = `${BASE}/__offline`
const FALLBACK = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f6f6f9;color:#0b0b0f;font:15px/1.5 system-ui,sans-serif;text-align:center;padding:24px}h1{font-size:18px;margin:0 0 6px}p{margin:0 0 18px;color:#5a5a66}button{font:inherit;font-weight:600;border:0;border-radius:12px;padding:10px 18px;background:#0f6b4b;color:#fff}</style></head><body><main><h1>You’re offline</h1><p>Reconnect to continue.<br><span lang="th">คุณออฟไลน์อยู่ เชื่อมต่ออินเทอร์เน็ตเพื่อใช้งานต่อ</span></p><button onclick="location.reload()">Try again · ลองอีกครั้ง</button></main></body></html>`

const target = (url) => {
  if (!url) return `${BASE}/`
  if (/^https?:\/\//.test(url)) return url
  return `${BASE}${url.startsWith('/') ? url : `/${url}`}`
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Navigation preload: the page request starts while the worker boots, so being controlled costs no time.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable()
      await self.clients.claim()
    })(),
  )
})

const inApp = (url) =>
  url.origin === self.location.origin &&
  (!BASE || url.pathname === BASE || url.pathname.startsWith(`${BASE}/`))

async function offlinePage() {
  const stored = await caches.match(OFFLINE_KEY, { cacheName: OFFLINE_CACHE })
  return stored || new Response(FALLBACK, { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

/* Network-first for dashboard page loads, falling back to the offline page; everything else (API, server actions, */
/* POSTs, RSC fetches, files) is left to the browser untouched, and no response is ever stored. */
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.mode !== 'navigate' || req.method !== 'GET' || !inApp(new URL(req.url))) return
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse
        return preloaded || (await fetch(req))
      } catch {
        return offlinePage()
      }
    })(),
  )
})

self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = { body: event.data ? event.data.text() : '' }
  }
  const title = data.title || 'Spa Management'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || '',
      icon: '/push-icon.png',
      badge: '/push-badge.png',
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      data: { url: target(data.url) },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || `${BASE}/`, self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // Prefer a tab already on that page, then any dashboard tab of this origin, else open a new one.
      const exact = windows.find((w) => w.url === url)
      if (exact) return exact.focus()
      const tab = windows.find((w) => new URL(w.url).origin === self.location.origin)
      if (tab && 'navigate' in tab) {
        try {
          const focused = await tab.focus()
          const moved = await focused.navigate(url)
          if (moved) return moved
        } catch {
          // Tabs this worker doesn't control can't be navigated; open a fresh one instead.
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})

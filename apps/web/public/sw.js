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

/* Every page load in scope is answered with its navigation-preload response, so it reaches the server exactly once */
/* (a fetch handler that skipped some would make the browser request those twice); dashboard loads fall back to the */
/* offline page. Everything else (API, server actions, POSTs, RSC fetches, files) is left to the browser untouched, */
/* and no response is ever stored. */
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.mode !== 'navigate' || req.method !== 'GET') return
  const inside = inApp(new URL(req.url))
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse
        return preloaded || (await fetch(req))
      } catch (error) {
        if (inside) return offlinePage()
        throw error
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

/** The spa dashboard a URL belongs to (`{BASE}/{slug}`), or null for other pages / origins. */
function spaHome(href) {
  const url = new URL(href, self.location.origin)
  if (!inApp(url)) return null
  const slug = url.pathname.slice(BASE.length).split('/')[1]
  return slug ? `${BASE}/${slug}` : null
}

/** A window to reuse for `href`: one already on it, else one inside the same spa's dashboard (each spa is its own */
/* installed app, so another spa's window — or the console, a site — is never taken over). */
function windowFor(windows, href) {
  const exact = windows.find((w) => w.url === href)
  if (exact) return { client: exact, exact: true }
  const home = spaHome(href)
  if (!home) return null
  const same = windows.find((w) => {
    const url = new URL(w.url)
    return (
      url.origin === self.location.origin && (url.pathname === home || url.pathname.startsWith(`${home}/`))
    )
  })
  return same ? { client: same, exact: false } : null
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = new URL(event.notification.data?.url || `${BASE}/`, self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      // Prefer a window already on that page, then one in the same spa's dashboard, else open one (Chrome opens it in
      // that spa's installed app when there is one).
      const found = windowFor(windows, url)
      if (found?.exact) return found.client.focus()
      if (found && 'navigate' in found.client) {
        try {
          const focused = await found.client.focus()
          const moved = await focused.navigate(url)
          if (moved) return moved
        } catch {
          // Windows this worker doesn't control can't be navigated; open a fresh one instead.
        }
      }
      return self.clients.openWindow(url)
    })(),
  )
})

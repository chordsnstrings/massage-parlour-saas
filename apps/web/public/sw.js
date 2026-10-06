/* spamanagement.ae — web push for staff and owners. No fetch handler: pages always load from the network. */
/* Registered as /sw.js?base=<app surface base> ("" in host routing, "/app" in path routing). */
const BASE = (new URL(self.location.href).searchParams.get('base') || '').replace(/\/$/, '')

const target = (url) => {
  if (!url) return `${BASE}/`
  if (/^https?:\/\//.test(url)) return url
  return `${BASE}${url.startsWith('/') ? url : `/${url}`}`
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
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

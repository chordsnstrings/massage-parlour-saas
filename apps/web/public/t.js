/* spamanagement.co — cookieless, block-level site analytics. No cookies, no personal data. */
;(() => {
  var s = document.currentScript || document.querySelector('script[data-site]')
  var site = s && s.getAttribute('data-site')
  if (!site || navigator.doNotTrack === '1' || window.spaTrack) return
  var endpoint = s.getAttribute('data-endpoint') || '/api/collect'
  // Entry attribution (external referrer + utm) is kept for the tab session so every event shares one source.
  var entry = null
  try {
    entry = JSON.parse(sessionStorage.getItem('spa_entry') || 'null')
  } catch (_) {}
  var q = new URLSearchParams(location.search)
  var utm = {}
  // partner = F16 poster link of a hotel / concierge partner (bookings.partner_id).
  ;['utm_source', 'utm_medium', 'utm_campaign', 'src', 'partner'].forEach((k) => {
    var v = q.get(k)
    if (v) utm[k] = v.slice(0, 60)
  })
  // A tagged URL (campaign link, or the booking widget's iframe with src=widget) starts a new entry.
  if (!entry || Object.keys(utm).length) {
    var ref = document.referrer
    try {
      if (ref && new URL(ref).hostname === location.hostname) ref = ''
    } catch (_) {
      ref = ''
    }
    entry = { referrer: ref || null, utm: utm }
    try {
      sessionStorage.setItem('spa_entry', JSON.stringify(entry))
    } catch (_) {}
  }
  function send(type, extra) {
    var body = JSON.stringify(
      Object.assign({ site: site, type: type, path: location.pathname, referrer: entry.referrer, utm: entry.utm, w: innerWidth }, extra || {}),
    )
    if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: 'application/json' }))) return
    fetch(endpoint, { method: 'POST', body: body, keepalive: true, headers: { 'content-type': 'application/json' } }).catch(() => {})
  }

  // Block views: each section counts once per page view when 40% of it is on screen.
  var seen = {}
  var watched = new WeakSet()
  var io =
    'IntersectionObserver' in window &&
    new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          var id = e.isIntersecting && e.target.getAttribute('data-block-id')
          if (id && !seen[id]) {
            seen[id] = 1
            send('block_view', { blockId: id, blockType: e.target.getAttribute('data-block-type') })
          }
        })
      },
      { threshold: 0.4 },
    )
  var scanTimer = 0
  function scan() {
    clearTimeout(scanTimer)
    scanTimer = setTimeout(() => {
      if (!io) return
      document.querySelectorAll('[data-block-id]').forEach((el) => {
        if (!watched.has(el)) {
          watched.add(el)
          io.observe(el)
        }
      })
    }, 150)
  }

  // Page views, including client-side navigations.
  var lastPath = ''
  function pageview() {
    if (location.pathname === lastPath) return
    lastPath = location.pathname
    seen = {}
    if (io) {
      io.disconnect()
      watched = new WeakSet()
    }
    send('pageview')
    scan()
  }
  ;['pushState', 'replaceState'].forEach((m) => {
    var orig = history[m]
    history[m] = function () {
      var r = orig.apply(this, arguments)
      setTimeout(pageview, 0)
      return r
    }
  })
  addEventListener('popstate', () => setTimeout(pageview, 0))
  if ('MutationObserver' in window) new MutationObserver(scan).observe(document.body, { childList: true, subtree: true })
  pageview()

  document.addEventListener(
    'click',
    (ev) => {
      var a = ev.target && ev.target.closest && ev.target.closest('a,button')
      if (!a || a.hasAttribute('data-no-track')) return
      var b = a.closest('[data-block-id]')
      var href = a.getAttribute('href') || ''
      var type = /wa\.me|whatsapp/.test(href)
        ? 'wa_click'
        : /instagram\.com/.test(href)
          ? 'ig_click'
          : a.hasAttribute('data-track-booking') || /(^|\/)book(\/|$|\?)/.test(href)
            ? 'booking_start'
            : 'click'
      send(type, {
        blockId: b && b.getAttribute('data-block-id'),
        blockType: b && b.getAttribute('data-block-type'),
        element: (a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 60),
      })
    },
    true,
  )
  window.spaTrack = send
})()

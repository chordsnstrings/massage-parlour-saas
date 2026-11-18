/* spamanagement.co — cookieless, block-level site analytics. No cookies, no personal data. */
;(() => {
  var s = document.currentScript || document.querySelector('script[data-site]')
  var site = s && s.getAttribute('data-site')
  // R24: on an exact HTML design page (the design document itself, sandboxed: opaque origin) the tracker runs inside
  // the design's own document, so it leaves no trace the design's code could see — no storage, no globals, no
  // patched history — and carries the entry's tags to the next page through the links instead (see `carry`).
  var design = self.origin === 'null'
  if (!site || navigator.doNotTrack === '1' || (!design && window.spaTrack)) return
  var endpoint = s.getAttribute('data-endpoint') || '/api/collect'
  // Entry attribution (external referrer + utm) is kept for the tab session so every event shares one source.
  var entry = null
  if (!design)
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
    if (!design)
      try {
        sessionStorage.setItem('spa_entry', JSON.stringify(entry))
      } catch (_) {}
  }
  function send(type, extra) {
    var body = JSON.stringify(
      Object.assign({ site: site, type: type, path: location.pathname, referrer: entry.referrer, utm: entry.utm, w: innerWidth }, extra || {}),
    )
    // R24: on an HTML design page (sandboxed, opaque origin) the request is cross-origin: a CORS-safelisted type sends
    // it without a preflight (/api/collect reads any body type).
    var type = design ? 'text/plain;charset=UTF-8' : 'application/json'
    if (navigator.sendBeacon && navigator.sendBeacon(endpoint, new Blob([body], { type: type }))) return
    fetch(endpoint, { method: 'POST', body: body, keepalive: true, headers: { 'content-type': type } }).catch(() => {})
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
  if (design) {
    // Client-side navigations of the design, without touching its history object: the Navigation API where there is
    // one, else a cheap path check.
    var nav = window.navigation
    if (nav && nav.addEventListener) nav.addEventListener('currententrychange', () => setTimeout(pageview, 0))
    else setInterval(pageview, 1000)
    addEventListener('popstate', () => setTimeout(pageview, 0))
  } else {
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
  }
  pageview()

  // R24 (F13/F16 on design pages): the design page can't keep the entry for the tab, so a link to another page of
  // this site gets the entry's tags (utm_*, src, partner) for that one navigation — the booking page reads them from
  // its own address. Last listener (window, bubble), only when the design didn't handle the click; the link's own
  // href is put back right after, so the design never sees it changed.
  function carry(ev) {
    if (ev.defaultPrevented || (ev.type === 'click' && ev.button) || !Object.keys(entry.utm).length) return
    var a = ev.target && ev.target.closest && ev.target.closest('a[href]')
    if (!a) return
    var u
    try {
      u = new URL(a.href)
    } catch (_) {
      return
    }
    if (u.host !== location.host || !/^https?:$/.test(u.protocol)) return
    if (u.pathname === location.pathname && u.search === location.search) return // same page (#anchor)
    var changed = false
    for (var k in entry.utm)
      if (!u.searchParams.has(k)) {
        u.searchParams.set(k, entry.utm[k])
        changed = true
      }
    if (!changed) return
    var before = a.getAttribute('href')
    a.setAttribute('href', u.href)
    setTimeout(() => a.setAttribute('href', before), 0)
  }
  if (design) {
    addEventListener('click', carry)
    addEventListener('auxclick', carry)
  }

  document.addEventListener(
    'click',
    (ev) => {
      var a = ev.target && ev.target.closest && ev.target.closest('a,button')
      if (!a || a.hasAttribute('data-no-track')) return
      var b = a.closest('[data-block-id]')
      var href = a.getAttribute('href') || ''
      var host = ''
      try {
        host = new URL(href, location.href).hostname
      } catch (_) {}
      var type = /wa\.me|whatsapp/.test(href)
        ? 'wa_click'
        : host === 'instagram.com' || host.endsWith('.instagram.com')
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
  if (!design) window.spaTrack = send
})()

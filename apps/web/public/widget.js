/* spamanagement — embeddable booking widget. No dependencies, no cookies.
 * <script src="https://app.spamanagement.co/widget.js" data-spa="your-spa" data-url="https://your-spa.spamanagement.co/book/embed"
 *   data-lang="en" data-color="#5E7D6B" data-text="Book now" async></script>
 * Events: window 'spa-widget:booked' (detail: { ref, start, service }). API: window.SpaWidget.open() / .close(). */
;(() => {
  var s = document.currentScript || document.querySelector('script[data-spa][src*="widget.js"]')
  if (!s || window.SpaWidget) return
  var slug = s.getAttribute('data-spa') || ''
  var lang = s.getAttribute('data-lang') === 'ar' ? 'ar' : 'en'
  var color = /^#[0-9a-f]{3,8}$/i.test(s.getAttribute('data-color') || '') ? s.getAttribute('data-color') : '#5E7D6B'
  var label = s.getAttribute('data-text') || (lang === 'ar' ? 'احجز الآن' : 'Book now')
  var base = s.getAttribute('data-url') || new URL(s.src).origin + '/s/' + encodeURIComponent(slug) + '/book/embed'
  var src = new URL(base, location.href)
  src.searchParams.set('src', 'widget')
  src.searchParams.set('lang', lang)
  // The frame's origin, from its first message (only the frame's own window counts): data-url's origin, or, for a
  // snippet from the path-routing days, the spa's host-routed address its /s/{slug}/book/embed frame redirects to.
  var origin

  var btn = document.createElement('button')
  btn.type = 'button'
  btn.textContent = label
  btn.setAttribute('data-spa-widget', 'button')
  btn.style.cssText =
    'position:fixed;bottom:20px;' + (lang === 'ar' ? 'left' : 'right') + ':20px;z-index:2147483000;border:0;border-radius:999px;' +
    'padding:14px 22px;font:600 15px/1 system-ui,sans-serif;color:#fff;background:' + color + ';cursor:pointer;' +
    'box-shadow:0 6px 24px rgba(0,0,0,.18)'

  var overlay, frame, last
  function close() {
    if (!overlay) return
    overlay.remove()
    overlay = frame = origin = null
    document.removeEventListener('keydown', onKey)
    if (last) last.focus()
  }
  function onKey(e) {
    if (e.key === 'Escape') close()
  }
  function open() {
    if (overlay) return
    last = document.activeElement
    overlay = document.createElement('div')
    overlay.setAttribute('data-spa-widget', 'modal')
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483001;background:rgba(20,20,18,.45);display:flex;align-items:center;justify-content:center;padding:16px'
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close()
    })
    var box = document.createElement('div')
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    box.setAttribute('aria-label', label)
    box.style.cssText =
      'position:relative;width:100%;max-width:960px;height:min(720px,90vh);max-height:90vh;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.3)'
    var x = document.createElement('button')
    x.type = 'button'
    x.setAttribute('aria-label', lang === 'ar' ? 'إغلاق' : 'Close')
    x.textContent = '×'
    x.style.cssText =
      'position:absolute;top:10px;' + (lang === 'ar' ? 'left' : 'right') + ':10px;z-index:1;width:36px;height:36px;border:0;border-radius:999px;background:rgba(0,0,0,.06);font:400 22px/1 system-ui;cursor:pointer'
    x.addEventListener('click', close)
    frame = document.createElement('iframe')
    frame.src = src.toString()
    frame.title = label
    frame.setAttribute('data-spa-widget', 'frame')
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0'
    box.appendChild(x)
    box.appendChild(frame)
    overlay.appendChild(box)
    document.body.appendChild(overlay)
    document.addEventListener('keydown', onKey)
    x.focus()
  }

  window.addEventListener('message', (e) => {
    if (!frame || e.source !== frame.contentWindow || !e.data) return
    if (!origin) origin = e.origin
    if (e.origin !== origin) return
    if (e.data.type === 'spa-widget:resize' && typeof e.data.height === 'number') {
      frame.parentNode.style.height = 'min(' + Math.max(320, Math.ceil(e.data.height)) + 'px,90vh)'
    } else if (e.data.type === 'spa-widget:close') {
      close()
    } else if (e.data.type === 'spa-widget:booked') {
      window.dispatchEvent(
        new CustomEvent('spa-widget:booked', { detail: { ref: e.data.ref, start: e.data.start, service: e.data.service } }),
      )
    }
  })
  btn.addEventListener('click', open)
  window.SpaWidget = { open: open, close: close }
  if (document.body) document.body.appendChild(btn)
  else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn))
})()

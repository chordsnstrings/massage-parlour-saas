import { htmlDesignFrameCsp, permissionsPolicy } from '@spa/core'

// F10: shell document for uploaded HTML designs (R17). A `srcdoc` frame inherits the hosting page's strict CSP (no
// inline scripts, no outside fonts), so designs run here instead: this response carries the design's own policy
// (anything goes, but CSP `sandbox` = opaque origin even when opened directly, framed only by platform pages). The
// hosting page (components/site/html-design-frame.tsx) posts the design in; it is written once, then the shell is gone.
// R24 review: before writing, the design's data: images (<img>/<source> src + srcset) are decoded into this document's
// list of available images — a parsed page has them at once (a script right after an <img src=data:…> sees it
// complete), but under document.write they would load a moment later. (A blob: document instead would parse like a
// page load, but Chromium refuses its #fragment navigations, so in-page anchors would break.)
const SHELL = `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex"></head><body><script>
(function () {
  if (window.parent === window) return
  var done = false
  // From the hosting page only (in the site editor that is the top window: the canvas frame's React runs there).
  // Every ancestor is a platform page (frame-ancestors 'self').
  function onMessage(e) {
    if (done || (e.source !== window.parent && e.source !== window.top)) return
    if (!e.data || e.data.type !== 'spa:html-design') return
    if (typeof e.data.html !== 'string') return
    done = true
    window.removeEventListener('message', onMessage)
    var html = e.data.html
    var keep = []
    var urls = new Set()
    try {
      // An inert parse (no scripts run, nothing loads) just to find the embedded images.
      var parsed = new DOMParser().parseFromString(html, 'text/html')
      parsed.querySelectorAll('img[src], img[srcset], picture source[srcset]').forEach(function (el) {
        var src = (el.getAttribute('src') || '').trim()
        if (/^data:image\\//i.test(src)) urls.add(src)
        ;(el.getAttribute('srcset') || '').split(/[\\t\\n\\f\\r ]+/).forEach(function (t) {
          t = t.replace(/,+$/, '')
          if (/^data:image\\//i.test(t)) urls.add(t)
        })
      })
    } catch (_) {}
    Promise.all(
      Array.from(urls).map(function (u) {
        var img = new Image()
        img.src = u
        keep.push(img)
        return img.decode().catch(function () {})
      }),
    ).then(function () {
      document.open()
      document.write(html)
      document.close()
      keep = null
      window.parent.postMessage({ type: 'spa:html-design-shown' }, '*')
    })
  }
  window.addEventListener('message', onMessage)
  window.parent.postMessage({ type: 'spa:html-design-ready' }, '*')
})()
</script></body></html>`

export function GET() {
  return new Response(SHELL, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': htmlDesignFrameCsp(),
      // R24: the motion sensors stay undeclared (usable when the hosting page delegates them, see permissionsPolicy).
      'permissions-policy': permissionsPolicy({ design: true }),
      'cache-control': 'public, max-age=3600',
      'x-robots-tag': 'noindex',
    },
  })
}

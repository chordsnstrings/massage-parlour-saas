import { htmlDesignFrameCsp } from '@spa/core'

// F10: shell document for uploaded HTML designs (R17). A `srcdoc` frame inherits the hosting page's strict CSP (no
// inline scripts, no outside fonts), so designs run here instead: this response carries the design's own policy
// (anything goes, but CSP `sandbox` = opaque origin even when opened directly, framed only by platform pages). The
// hosting page (components/site/html-design-frame.tsx) posts the design in; it is written once, then the shell is gone.
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
    document.open()
    document.write(e.data.html)
    document.close()
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
      'cache-control': 'public, max-age=3600',
      'x-robots-tag': 'noindex',
    },
  })
}

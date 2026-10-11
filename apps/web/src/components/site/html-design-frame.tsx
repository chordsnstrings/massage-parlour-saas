'use client'
// F10: an uploaded HTML design (R17) runs in the shell document app/api/html-design/frame, which has its own policy
// (a `srcdoc` frame would inherit the hosting page's strict CSP and lose the design's scripts and fonts). The shell
// asks for the design once loaded; we also send it at mount in case the shell loaded before hydration.
import { useEffect, useRef, useState } from 'react'

/** Same as @spa/core HTML_DESIGN_FRAME_PATH (client code doesn't import the @spa/core root). */
const SHELL = '/api/html-design/frame'

/** Same as @spa/core withBaseHref: relative links resolve against the hosting page, as they did in `srcdoc`. */
function withBase(html: string, href: string) {
  if (/<base\b[^>]*\bhref\s*=/i.test(html)) return html
  const tag = `<base href="${href.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}">`
  for (const re of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    const m = re.exec(html)
    if (m) return html.slice(0, m.index + m[0].length) + tag + html.slice(m.index + m[0].length)
  }
  return tag + html
}

/**
 * R24: what a design may use, as when the file is opened directly (`*`: an opaque origin can't be named). The hosting
 * page's own Permissions-Policy still decides (preview pages keep the motion sensors off).
 */
const ALLOW =
  'autoplay *; fullscreen *; clipboard-write *; web-share *; picture-in-picture *; encrypted-media *; screen-wake-lock *; xr-spatial-tracking *; accelerometer *; gyroscope *; magnetometer *'

type Props = Omit<React.IframeHTMLAttributes<HTMLIFrameElement>, 'src' | 'srcDoc' | 'sandbox'> & {
  /** The full design document (placeholders already filled). */
  html: string
  /** Never include allow-same-origin. */
  sandbox: string
  /** In the site editor: never take the keyboard focus. */
  editing?: boolean
}

export function HtmlDesignFrame({ html, sandbox, editing, ...rest }: Props) {
  const ref = useRef<HTMLIFrameElement>(null)
  const latest = useRef(html)
  latest.current = html
  const shown = useRef<string | null>(null)
  const inEditor = useRef(editing)
  inEditor.current = editing
  // A new frame element per design shown (see below).
  const [frameKey, setFrameKey] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: `frameKey` = a new frame element to talk to
  useEffect(() => {
    const frame = ref.current
    // In the site editor the frame sits inside Puck's canvas iframe: the shell talks to that window.
    const host = frame?.ownerDocument.defaultView
    if (!frame || !host) return
    const send = () => {
      shown.current = latest.current
      frame.contentWindow?.postMessage(
        { type: 'spa:html-design', html: withBase(latest.current, frame.ownerDocument.baseURI) },
        '*',
      )
    }
    const onMessage = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return
      if (e.data?.type === 'spa:html-design-ready') send()
      // A full-page design (spa site fallback): keyboard scrolling works without a click first. Card / editor
      // previews never take the focus.
      else if (
        e.data?.type === 'spa:html-design-shown' &&
        !inEditor.current &&
        host.top === host &&
        host.document.activeElement === host.document.body
      )
        frame.contentWindow?.focus()
    }
    host.addEventListener('message', onMessage)
    send()
    return () => {
      host.removeEventListener('message', onMessage)
    }
  }, [frameKey])

  // A new design (upload, image adjustment, a restored version or local copy once its file is fetched): a new frame,
  // whose shell asks for the latest one. Not a reload of this one: a shell still writing the design it was sent
  // (document.open) cancels that navigation and stays on the old design.
  useEffect(() => {
    if (shown.current === null || shown.current === html) return
    shown.current = null
    setFrameKey((k) => k + 1)
  }, [html])

  return (
    <iframe key={frameKey} ref={ref} src={SHELL} sandbox={sandbox} allow={ALLOW} allowFullScreen {...rest} />
  )
}

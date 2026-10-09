'use client'
// F10: an uploaded HTML design (R17) runs in the shell document app/api/html-design/frame, which has its own policy
// (a `srcdoc` frame would inherit the hosting page's strict CSP and lose the design's scripts and fonts). The shell
// asks for the design once loaded; we also send it at mount in case the shell loaded before hydration.
import { useEffect, useRef } from 'react'

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

type Props = Omit<React.IframeHTMLAttributes<HTMLIFrameElement>, 'src' | 'srcDoc' | 'sandbox'> & {
  /** The full design document (placeholders already filled). */
  html: string
  /** Never include allow-same-origin. */
  sandbox: string
}

export function HtmlDesignFrame({ html, sandbox, ...rest }: Props) {
  const ref = useRef<HTMLIFrameElement>(null)
  const latest = useRef(html)
  latest.current = html
  const shown = useRef<string | null>(null)

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
      if (e.source === frame.contentWindow && e.data?.type === 'spa:html-design-ready') send()
    }
    host.addEventListener('message', onMessage)
    send()
    return () => {
      host.removeEventListener('message', onMessage)
    }
  }, [])

  // A new design (upload, image adjustment): reload the shell, which asks for the latest one.
  useEffect(() => {
    if (shown.current === null || shown.current === html || !ref.current) return
    ref.current.src = SHELL
  }, [html])

  return <iframe ref={ref} src={SHELL} sandbox={sandbox} {...rest} />
}

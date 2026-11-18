'use client'

/** Fire-and-forget report of a client-side error boundary hit. */
export function reportClientError(error: Error & { digest?: string }) {
  try {
    const body = JSON.stringify({
      message: error.message || 'Unknown error',
      stack: error.stack?.slice(0, 8000),
      digest: error.digest,
      url: window.location.pathname,
    })
    if (!navigator.sendBeacon?.('/api/client-error', new Blob([body], { type: 'application/json' })))
      fetch('/api/client-error', { method: 'POST', body, keepalive: true }).catch(() => {})
  } catch {}
}

'use client'
import { useEffect } from 'react'
import { reportClientError } from '@/lib/report-client'

/** Last-resort boundary (replaces the root layout), so it carries its own minimal styles. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    reportClientError(error)
  }, [error])
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#FAFAF8',
          color: '#1C1C1A',
        }}
      >
        <main style={{ maxWidth: 420, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ color: '#6B6A66', margin: '0 0 20px' }}>
            We’ve been notified. Please try again — your data is safe.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              background: '#5E7D6B',
              color: '#fff',
              border: 0,
              borderRadius: 8,
              padding: '10px 18px',
              fontSize: 14,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}

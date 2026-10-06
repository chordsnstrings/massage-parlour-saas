'use client'
import { RotateCcw } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { reportClientError } from '@/lib/report-client'

/** Route-level error boundary: keeps the shell, offers a retry. */
export default function RouteError({
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
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="text-sm text-muted">
        We’ve been notified. Try again, and if it keeps happening, let us know what you were doing.
      </p>
      {error.digest && <p className="font-mono text-xs text-muted">Ref {error.digest}</p>}
      <Button onClick={reset}>
        <RotateCcw /> Try again
      </Button>
    </div>
  )
}

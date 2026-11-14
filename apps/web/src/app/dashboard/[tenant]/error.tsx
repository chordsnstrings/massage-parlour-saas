'use client'
import { RotateCcw } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { useT } from '@/i18n/client'
import { appPath } from '@/lib/paths'
import { reportClientError } from '@/lib/report-client'

/** Dashboard error boundary: renders inside the spa shell, in the viewer's language (digest only, never the stack). */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useT()
  const { tenant } = useParams<{ tenant: string }>()
  useEffect(() => {
    reportClientError(error)
  }, [error])
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{t('errors.boundary.title')}</h1>
      <p className="text-sm text-muted">{t('errors.boundary.body')}</p>
      {error.digest && (
        <p className="font-mono text-xs text-muted">{t('errors.boundary.ref', { digest: error.digest })}</p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={reset}>
          <RotateCcw /> {t('errors.boundary.retry')}
        </Button>
        <Button variant="secondary" asChild>
          <a href={appPath(`/${tenant}`)}>{t('errors.page.toHome')}</a>
        </Button>
      </div>
    </div>
  )
}

'use client'
import { useEffect } from 'react'
import { Logo } from '@/components/brand'
import { StatusPage } from '@/components/status/status-page'
import { errorCopy, useSurface } from '@/components/status/surface'
import { reportClientError } from '@/lib/report-client'

/**
 * F24 route-level error boundary for every surface (the spa shell keeps its own, dashboard/[tenant]/error.tsx): the
 * surface's look and language from the root layout, the digest for support (never the message or stack), retry + a
 * way back.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const s = useSurface() ?? { surface: 'marketing' as const, lang: 'en', dir: 'ltr' as const, home: '/' }
  const copy = errorCopy(s.surface, s.lang)
  useEffect(() => {
    reportClientError(error)
  }, [error])
  return (
    <StatusPage
      look={copy.look}
      lang={s.lang}
      dir={s.dir}
      brand={copy.look === 'marketing' || copy.look === 'crm' ? <Logo /> : undefined}
      title={copy.title}
      body={copy.body}
      reference={error.digest ? copy.reference(error.digest) : null}
    >
      <button type="button" className="sp-btn" onClick={reset}>
        {copy.retry}
      </button>
      <a className="sp-btn sp-btn--ghost" href={s.home}>
        {copy.home}
      </a>
    </StatusPage>
  )
}

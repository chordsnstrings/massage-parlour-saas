import { headers } from 'next/headers'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getT } from '@/i18n/server'
import { appPath } from '@/lib/paths'

/**
 * F24: 404 inside the spa shell (unknown dashboard paths via [...missing], `notFound()` in a page), in the viewer's
 * language. Only reached past the layout's member check; an unknown spa address gets the root not-found instead.
 */
export default async function DashboardNotFound() {
  const t = await getT()
  const slug = (await headers()).get('x-internal-path')?.split('/')[2] ?? ''
  return (
    <div
      className="mx-auto flex min-h-[50vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center"
      data-status-page="404"
    >
      <p className="rounded-full bg-[var(--crm-lime)] px-3 py-1 font-[family-name:var(--crm-num)] text-xs font-bold text-[var(--crm-lime-ink)]">
        404
      </p>
      <h1 className="text-xl font-semibold tracking-tight">{t('errors.page.notFoundTitle')}</h1>
      <p className="text-sm text-muted">{t('errors.page.notFoundBody')}</p>
      <Button asChild>
        <Link href={appPath(`/${slug}`)}>{t('errors.page.toHome')}</Link>
      </Button>
    </div>
  )
}

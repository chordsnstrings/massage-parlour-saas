import { PLATFORM_NAME } from '@spa/core'
import { translator } from '@spa/core/i18n'
import { unstable_rethrow } from 'next/navigation'
import { Logo } from '@/components/brand'
import { ui } from '@/components/site/i18n'
import { StatusPage } from '@/components/status/status-page'
import { appPath } from '@/lib/paths'
import { marketingUrl } from '@/server/origin'
import { getSession } from '@/server/session'
import { resolveSiteTenant } from '@/server/sites'
import { requestSurface } from '@/server/surface'

const signedIn = () =>
  getSession()
    .then(Boolean)
    .catch((e) => {
      unstable_rethrow(e)
      return false
    })

/**
 * F24: the 404 for every surface (unmatched URLs and `notFound()` without a nearer boundary — the spa shell has its
 * own, dashboard/[tenant]/not-found.tsx), in the surface's look and language with a way back.
 */
export default async function NotFound() {
  const s = await requestSurface()
  if (s.surface === 'app') {
    const t = translator(s.lang === 'th' ? 'th' : 'en')
    const member = await signedIn()
    return (
      <StatusPage
        look="crm"
        lang={s.lang}
        code="404"
        brand={<Logo />}
        title={t('errors.page.notFoundTitle')}
        body={t('errors.page.notFoundBody')}
      >
        <a className="sp-btn" href={member ? appPath('/') : appPath('/login')}>
          {member ? t('errors.page.toDashboard') : t('errors.page.signIn')}
        </a>
      </StatusPage>
    )
  }
  if (s.surface === 'admin')
    return (
      <StatusPage
        look="console"
        lang="en"
        code="404"
        title="Page not found"
        body="This page doesn’t exist in the console, or it has moved."
      >
        <a className="sp-btn" href={s.home}>
          Back to the console
        </a>
      </StatusPage>
    )
  if (s.site) {
    const locale = s.lang === 'ar' ? 'ar' : 'en'
    const tenant = await resolveSiteTenant(s.site).catch((e) => {
      unstable_rethrow(e)
      return null
    })
    return (
      <StatusPage
        look="site"
        lang={locale}
        dir={s.dir}
        code="404"
        name={tenant?.name}
        title={ui('notFoundTitle', locale)}
        body={tenant ? ui('notFoundBody', locale) : ui('siteMissing', locale)}
      >
        {tenant ? (
          <a className="sp-btn" href={s.home}>
            {ui('backHome', locale)}
          </a>
        ) : (
          <a className="sp-btn sp-btn--ghost" href={await marketingUrl()} dir="ltr">
            {PLATFORM_NAME}
          </a>
        )}
      </StatusPage>
    )
  }
  return (
    <StatusPage
      look="marketing"
      lang="en"
      code="404"
      brand={<Logo />}
      title="Page not found"
      body="The page you’re looking for doesn’t exist or has moved."
    >
      <a className="sp-btn" href="/">
        Back to home
      </a>
      <a className="sp-btn sp-btn--ghost" href="/contact">
        Contact us
      </a>
    </StatusPage>
  )
}

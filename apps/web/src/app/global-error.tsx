'use client'
import { useEffect, useSyncExternalStore } from 'react'
import { StatusPage } from '@/components/status/status-page'
import { type DocSurface, errorCopy } from '@/components/status/surface'
import { PATH_ROUTING } from '@/lib/paths'
import { reportClientError } from '@/lib/report-client'

type Guess = { surface: DocSurface; lang: string; home: string }
const NEUTRAL: Guess = { surface: 'site', lang: 'en', home: '/' }
let guessed: Guess | null = null

/**
 * The root layout is gone here, so the surface comes from the page itself: the `<html data-surface lang>` the root
 * layout rendered (client-side failures), else the address — app./admin. hosts or /app, /admin, /s/ paths. Anything
 * else gets the theme-neutral look (it may be a spa's own domain), in Arabic with `?lang=ar`.
 */
function guess(): Guess {
  if (guessed) return guessed
  const html = document.documentElement
  const { hostname, pathname, search } = window.location
  const ar = new URLSearchParams(search).get('lang') === 'ar'
  const marked = html.dataset.surface as DocSurface | undefined
  const cookieLang = /(?:^|;\s*)spa_locale=th(?:;|$)/.test(document.cookie) ? 'th' : 'en'
  const surface: DocSurface =
    marked ??
    (PATH_ROUTING
      ? pathname.startsWith('/app')
        ? 'app'
        : pathname.startsWith('/admin')
          ? 'admin'
          : 'site'
      : hostname.startsWith('app.')
        ? 'app'
        : hostname.startsWith('admin.')
          ? 'admin'
          : 'site')
  const lang =
    surface === 'app'
      ? html.lang === 'th' || html.lang === 'en'
        ? html.lang
        : cookieLang
      : surface === 'site' || surface === 'domain'
        ? ar || html.lang === 'ar'
          ? 'ar'
          : 'en'
        : 'en'
  const home =
    surface === 'app'
      ? PATH_ROUTING
        ? '/app'
        : '/'
      : surface === 'admin'
        ? PATH_ROUTING
          ? '/admin'
          : '/'
        : PATH_ROUTING
          ? (pathname.match(/^\/s\/[^/]+/)?.[0] ?? '/')
          : '/'
  guessed = { surface, lang, home }
  return guessed
}
const noop = () => () => {}

/** Last-resort boundary (replaces the root layout): self-contained styles, the digest for support, no stack. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Server render (no window): the neutral English page; the browser then switches to the guessed surface.
  const g = useSyncExternalStore(noop, guess, () => NEUTRAL)
  const copy = errorCopy(g.surface, g.lang)
  const dir = g.lang === 'ar' ? 'rtl' : 'ltr'
  useEffect(() => {
    reportClientError(error)
  }, [error])
  return (
    <html lang={g.lang} dir={dir} data-surface={g.surface}>
      <body style={{ margin: 0 }}>
        <StatusPage
          look={copy.look}
          lang={g.lang}
          dir={dir}
          title={copy.title}
          body={copy.body}
          reference={error.digest ? copy.reference(error.digest) : null}
        >
          <button type="button" className="sp-btn" onClick={reset}>
            {copy.retry}
          </button>
          <a className="sp-btn sp-btn--ghost" href={g.home}>
            {copy.home}
          </a>
        </StatusPage>
      </body>
    </html>
  )
}

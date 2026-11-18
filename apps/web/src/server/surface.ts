// F24: which surface a page request is for (proxy.ts sets `x-internal-path` = its rewrite) and that surface's document
// language: marketing + console English, spa dashboard the viewer's EN/TH, spa sites EN/AR (`?lang=ar`, RTL).
import { pageKindOf } from '@spa/core'
import { headers } from 'next/headers'
import { unstable_rethrow } from 'next/navigation'
import { cache } from 'react'
import type { SurfaceInfo } from '@/components/status/surface'
import { getLocale } from '@/i18n/server'
import { adminPath, appPath, PATH_ROUTING } from '@/lib/paths'

export type RequestSurface = SurfaceInfo & {
  /** Spa site key from the route (`/site/{slug}`, `/domain/{host}`). */
  site?: { slug: string } | { hostname: string }
}

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

export const requestSurface = cache(async (): Promise<RequestSurface> => {
  const h = await headers()
  const internal = h.get('x-internal-path') ?? ''
  const original = h.get('x-original-path') ?? '/'
  const { surface } = pageKindOf(internal)
  if (surface === 'app') {
    // The member's language (row → cookie → en); a failing lookup must not take the page (or this 404) down.
    const lang = await getLocale().catch((e) => {
      unstable_rethrow(e)
      return 'en' as const
    })
    return { surface, lang, dir: 'ltr', home: appPath('/') }
  }
  if (surface === 'admin') return { surface, lang: 'en', dir: 'ltr', home: adminPath('/') }
  if (surface === 'site' || surface === 'domain') {
    const key = safeDecode(internal.split('/')[2] ?? '').toLowerCase()
    const ar = new URLSearchParams(original.split('?')[1] ?? '').get('lang') === 'ar'
    const base = surface === 'site' && PATH_ROUTING ? `/s/${key}` : '/'
    return {
      surface,
      lang: ar ? 'ar' : 'en',
      dir: ar ? 'rtl' : 'ltr',
      home: ar ? `${base}?lang=ar` : base,
      site: surface === 'site' ? { slug: key } : { hostname: key },
    }
  }
  return { surface: 'marketing', lang: 'en', dir: 'ltr', home: '/' }
})

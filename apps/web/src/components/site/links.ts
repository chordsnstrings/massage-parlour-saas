import { whatsappLink } from '@spa/core'
import { tr, ui } from './i18n'
import type { Bi, Locale, SiteMeta } from './types'

const withLang = (path: string, locale: Locale) => (locale === 'ar' ? `${path}?lang=ar` : path)

/** Public URL of a tenant page; works on {slug}.domain, custom domains and /s/{slug} path routing. */
export function pageHref(meta: Pick<SiteMeta, 'base' | 'locale'>, slug: string, locale = meta.locale) {
  const path = `${meta.base}${slug ? `/${slug}` : ''}` || '/'
  return withLang(path, locale)
}

/** The tenant's online booking page ({site}/book). */
export const bookHref = (meta: Pick<SiteMeta, 'base' | 'locale'>) =>
  withLang(`${meta.base}/book`, meta.locale)

export function whatsappHref(meta: SiteMeta, message?: Bi | null) {
  const phone = meta.data.branch?.whatsappE164
  if (!phone) return null
  const text = tr(message, meta) || `${ui('bookingHello', meta.locale)} — ${meta.data.tenant.name}`
  return whatsappLink(phone, text)
}

export const phoneHref = (meta: SiteMeta) =>
  meta.data.branch?.phone ? `tel:${meta.data.branch.phone.replace(/[^\d+]/g, '')}` : null

export const mapHref = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

export type LinkAction = 'book' | 'page' | 'whatsapp' | 'phone' | 'url'

/** Resolves a button action to an href (null when the spa hasn't set the number up yet). */
export function actionHref(meta: SiteMeta, action: LinkAction, target?: string): string | null {
  switch (action) {
    case 'book':
      return bookHref(meta)
    case 'page':
      return pageHref(meta, (target ?? '').replace(/^\/+/, ''))
    case 'whatsapp':
      return whatsappHref(meta)
    case 'phone':
      return phoneHref(meta)
    case 'url':
      return target && /^(https?:|mailto:|tel:|#)/.test(target) ? target : null
  }
}

/** Anchor props: inert inside the editor canvas so clicks select blocks instead of navigating. */
export function linkProps(meta: SiteMeta, href: string | null) {
  if (!href || meta.editing) return { role: 'link' as const, 'aria-disabled': true as const }
  const external = /^https?:/.test(href)
  return external ? { href, target: '_blank', rel: 'noopener noreferrer' } : { href }
}

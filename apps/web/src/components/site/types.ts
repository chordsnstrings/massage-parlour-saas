import type { OpeningHours } from '@spa/core'
import type { SiteTheme } from './theme'

export type Locale = 'en' | 'ar'
/** Bilingual content; Arabic falls back to English when empty. */
export type Bi = { en: string; ar?: string }
export type Device = 'base' | 'md' | 'lg'
/** Per-device value: base (mobile) → md (tablet ≥768) → lg (desktop ≥1024). Unset devices inherit. */
export type Responsive<T> = { base: T; md?: T; lg?: T }

export type SiteService = {
  id: string
  name: Bi
  description: Bi | null
  category: Bi | null
  /** null = "Price on request": none set, or hidden by the service / spa default (R4; never sent to the page). */
  variants: { durationMin: number; priceAed: string | null }[]
}
export type SiteStaff = { id: string; name: string; photoUrl: string | null; bio: Bi | null }
export type SiteBranch = {
  name: string
  address: string | null
  phone: string | null
  whatsappE164: string | null
  openingHours: OpeningHours
  /** Business day ends at this local time (HH:MM). */
  businessDayCutoff: string
}
/** Live dashboard data the smart blocks read (prices and hours never go stale). */
export type SiteData = {
  tenant: { name: string; slug: string }
  branch: SiteBranch | null
  services: SiteService[]
  staff: SiteStaff[]
  /** Visible pages for navigation. */
  pages: { slug: string; title: Bi }[]
}

/** Passed to every block as Puck metadata. */
export type SiteMeta = {
  locale: Locale
  /** Public path prefix of the tenant site: '' on a subdomain / custom domain, '/s/{slug}' in path routing. */
  base: string
  /** Slug of the page being rendered ('' = home). */
  slug: string
  data: SiteData
  theme: SiteTheme
  /** Rendering inside the editor canvas (links inert, hidden blocks ghosted, no entrance animation). */
  editing?: boolean
  /** Today's weekday in Dubai (mon…sun), for highlighting opening hours. */
  today?: string
}

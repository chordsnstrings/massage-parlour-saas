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
  /** Exact Google Maps pin set by the spa (else address links search Maps for the address). */
  mapsUrl: string | null
  phone: string | null
  whatsappE164: string | null
  openingHours: OpeningHours
  /** Business day ends at this local time (HH:MM). */
  businessDayCutoff: string
}
/** F15 BlogList card: a published post without its body. */
export type SitePostCard = {
  slug: string
  title: Bi
  excerpt: Bi
  coverImage: string | null
  /** ISO instant. */
  publishedAt: string | null
}
/** F15 Reviews block: synced Google reviews (good ones with text). */
export type SiteReviewsData = {
  average: number
  count: number
  items: { id: string; author: string; rating: number; text: string; reviewedAt: string | null }[]
}
/** F15 Instagram feed: the connected account + posts published from the dashboard. */
export type SiteInstagramData = {
  username: string | null
  profileUrl: string | null
  items: { id: string; image: string; caption: string }[]
}
/** Live dashboard data the smart blocks read (prices and hours never go stale). */
export type SiteData = {
  tenant: { name: string; slug: string }
  branch: SiteBranch | null
  services: SiteService[]
  staff: SiteStaff[]
  /** Visible pages for navigation. */
  pages: { slug: string; title: Bi }[]
  /** Published blog posts, newest first (F15). */
  posts?: SitePostCard[]
  /** Google reviews; null = not on the spa's plan (Premium `marketing`), undefined = not loaded (demo). */
  reviews?: SiteReviewsData | null
  /** Instagram feed; null = not on the spa's plan (Premium `marketing`). */
  instagram?: SiteInstagramData | null
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
  /**
   * Public site only (F15 EnquiryForm): which site the form posts for + the Turnstile site key (null = no bot
   * check). Absent in the editor and previews, where the form can't be sent.
   */
  form?: { site: { slug: string } | { hostname: string }; turnstileSiteKey: string | null }
  /** Blog post page only (F15): the post the hidden BlogPost block renders. */
  post?: SitePostView
}

/** A published post on its own page (`{site}/blog/{slug}`). */
export type SitePostView = SitePostCard & { body: Bi; backHref: string; backLabel: Bi }

// Search + social data for public pages (PLAN §17 F12): schema.org JSON-LD, robots.txt and sitemap.xml. Pure; no DB.
import type { OpeningHours, Weekday } from './booking'
import { EMIRATE_NAMES } from './emirates'
import { normalizeGoogleMapsUrl } from './maps'

type Json = Record<string, unknown>

/**
 * JSON for an inline `<script type="application/ld+json">`. `<`, `>` and `&` become \u escapes (still the same JSON
 * string values), so spa-entered text can never close the tag or open a comment; U+2028/9 are escaped too.
 */
export function jsonLdString(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

const DAY_NAMES: [Weekday, string][] = [
  ['mon', 'Monday'],
  ['tue', 'Tuesday'],
  ['wed', 'Wednesday'],
  ['thu', 'Thursday'],
  ['fri', 'Friday'],
  ['sat', 'Saturday'],
  ['sun', 'Sunday'],
]

/** 'HH:MM' (seconds dropped) or null; a 24:00 close becomes 23:59 (schema.org has no 24:00). */
function clock(v: unknown, closing: boolean): string | null {
  const m = typeof v === 'string' ? v.match(/^(\d{2}):(\d{2})(?::\d{2})?$/) : null
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h === 24 && min === 0) return closing ? '23:59' : null
  return h < 24 && min < 60 ? `${m[1]}:${m[2]}` : null
}

/**
 * Branch opening hours → OpeningHoursSpecification, one entry per distinct open/close pair listing its days
 * (Monday first). A close before the open (e.g. 12:00–02:00) runs past midnight, as Google reads it.
 */
export function openingHoursSpecification(hours: OpeningHours | null | undefined): Json[] {
  const groups = new Map<string, { opens: string; closes: string; days: string[] }>()
  for (const [key, day] of DAY_NAMES) {
    const list = hours?.[key]
    if (!Array.isArray(list)) continue
    for (const iv of list) {
      const opens = clock(iv?.open, false)
      const closes = clock(iv?.close, true)
      if (!opens || !closes || opens === closes) continue
      const id = `${opens}-${closes}`
      const g = groups.get(id) ?? { opens, closes, days: [] }
      if (!g.days.includes(day)) g.days.push(day)
      groups.set(id, g)
    }
  }
  return [...groups.values()].map((g) => ({
    '@type': 'OpeningHoursSpecification',
    dayOfWeek: g.days,
    opens: g.opens,
    closes: g.closes,
  }))
}

const COORD = /^(-?\d{1,3}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)$/
const round = (n: number) => Math.round(n * 1e6) / 1e6
const geo = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { latitude: round(lat), longitude: round(lng) }
    : null

/**
 * Coordinates in a Google Maps link, when it carries them: the place pin (`!3d…!4d…`), a `q`/`query`/`ll`/`center`
 * "lat,lng", or the map view (`@lat,lng`). Short share links (maps.app.goo.gl) carry none → null.
 */
export function geoFromMapsUrl(
  url: string | null | undefined,
): { latitude: number; longitude: number } | null {
  const href = normalizeGoogleMapsUrl(url)
  if (!href) return null
  const u = new URL(href)
  const pin = href.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  if (pin) return geo(Number(pin[1]), Number(pin[2]))
  for (const key of ['q', 'query', 'll', 'center']) {
    const m = u.searchParams.get(key)?.trim().match(COORD)
    if (m) return geo(Number(m[1]), Number(m[2]))
  }
  const at = u.pathname.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  return at ? geo(Number(at[1]), Number(at[2])) : null
}

/** "350" / "350.50" for a price in AED; null when hidden or not a number. */
function money(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return null
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

export type SeoService = {
  name: string
  description?: string | null
  category?: string | null
  /** `priceAed` null = the spa hides this price (publicPrice) — no price goes into the data either. */
  variants: { durationMin: number; priceAed: string | number | null }[]
}

export type SpaJsonLdInput = {
  name: string
  /** Canonical home page URL of the site. */
  url: string
  /** Canonical URL of the page being rendered (equals `url` on the home page). */
  pageUrl: string
  /** The page's title, for the breadcrumb (non-home pages). */
  pageName?: string | null
  description?: string | null
  logo?: string | null
  image?: string | null
  branch?: {
    name?: string | null
    address?: string | null
    mapsUrl?: string | null
    phone?: string | null
    openingHours?: OpeningHours | null
  } | null
  services?: SeoService[]
  /** Public profiles (Instagram, Google Maps place …). */
  sameAs?: (string | null | undefined)[]
}

const text = (v: string | null | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)

/** The emirate named in a free-text UAE address (addressRegion), if any. */
function emirateIn(address: string): string | undefined {
  const lower = address.toLowerCase()
  return Object.values(EMIRATE_NAMES).find((n) => lower.includes(n.toLowerCase()))
}

/** "AED 150–450" from the public prices; undefined when every price is hidden. */
function priceRange(services: SeoService[]): string | undefined {
  const prices = services.flatMap((s) => s.variants.map((v) => money(v.priceAed))).filter((p) => p !== null)
  if (!prices.length) return undefined
  const nums = prices.map(Number)
  const lo = money(Math.min(...nums))
  const hi = money(Math.max(...nums))
  return lo === hi ? `AED ${lo}` : `AED ${lo}–${hi}`
}

function offer(s: SeoService): Json {
  const service: Json = { '@type': 'Service', name: s.name }
  if (text(s.description)) service.description = text(s.description)
  if (text(s.category)) service.category = text(s.category)
  const priced = s.variants
    .map((v) => ({ durationMin: v.durationMin, price: money(v.priceAed) }))
    .filter((v): v is { durationMin: number; price: string } => v.price !== null)
  const o: Json = { '@type': 'Offer', itemOffered: service }
  if (!priced.length) return o
  o.price = money(Math.min(...priced.map((v) => Number(v.price))))
  o.priceCurrency = 'AED'
  // One price per treatment length (e.g. 60 / 90 min).
  o.priceSpecification = priced.map((v) => ({
    '@type': 'UnitPriceSpecification',
    price: v.price,
    priceCurrency: 'AED',
    referenceQuantity: { '@type': 'QuantitativeValue', value: v.durationMin, unitCode: 'MIN' },
  }))
  return o
}

/**
 * schema.org graph for a spa's public page: the DaySpa (a HealthAndBeautyBusiness) with its main branch's address,
 * pin, phone and hours, public profiles and its services as offers (prices only where the spa shows them), plus a
 * BreadcrumbList on inner pages. Serialise with jsonLdString.
 */
export function spaJsonLd(input: SpaJsonLdInput): Json {
  const b = input.branch ?? null
  const services = input.services ?? []
  const spa: Json = {
    '@type': 'DaySpa',
    '@id': `${input.url}#spa`,
    name: input.name,
    url: input.url,
  }
  if (text(input.description)) spa.description = text(input.description)
  if (input.logo) spa.logo = input.logo
  const image = input.image || input.logo
  if (image) spa.image = image
  if (text(b?.phone)) spa.telephone = text(b?.phone)
  const address = text(b?.address)
  if (address) {
    const region = emirateIn(address)
    spa.address = {
      '@type': 'PostalAddress',
      streetAddress: address,
      ...(region ? { addressRegion: region } : {}),
      addressCountry: 'AE',
    }
  }
  const coords = geoFromMapsUrl(b?.mapsUrl)
  if (coords) spa.geo = { '@type': 'GeoCoordinates', ...coords }
  const pin = normalizeGoogleMapsUrl(b?.mapsUrl)
  if (pin) spa.hasMap = pin
  const hours = openingHoursSpecification(b?.openingHours)
  if (hours.length) spa.openingHoursSpecification = hours
  const range = priceRange(services)
  if (range) spa.priceRange = range
  spa.currenciesAccepted = 'AED'
  const sameAs = [...new Set(input.sameAs?.filter((s): s is string => !!s && /^https:\/\//.test(s)))]
  if (sameAs.length) spa.sameAs = sameAs
  if (services.length)
    spa.hasOfferCatalog = {
      '@type': 'OfferCatalog',
      name: 'Treatments',
      itemListElement: services.map(offer),
    }
  const graph: Json[] = [spa]
  if (input.pageUrl !== input.url && text(input.pageName))
    graph.push({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: input.name, item: input.url },
        { '@type': 'ListItem', position: 2, name: text(input.pageName), item: input.pageUrl },
      ],
    })
  return { '@context': 'https://schema.org', '@graph': graph }
}

export type BlogPostJsonLdInput = {
  url: string
  headline: string
  description?: string | null
  image?: string | null
  datePublished?: Date | null
  dateModified?: Date | null
  /** 'en' | 'ar'. */
  inLanguage?: string
}

/**
 * F15 blog post page: the spa graph (DaySpa + breadcrumb Home → post) plus a BlogPosting published by the spa.
 * Serialise with jsonLdString.
 */
export function blogPostJsonLd(spa: SpaJsonLdInput, post: BlogPostJsonLdInput): Json {
  const base = spaJsonLd({ ...spa, pageUrl: post.url, pageName: post.headline })
  const article: Json = {
    '@type': 'BlogPosting',
    '@id': `${post.url}#post`,
    headline: post.headline.slice(0, 110),
    url: post.url,
    mainEntityOfPage: post.url,
    publisher: { '@id': `${spa.url}#spa` },
    author: { '@id': `${spa.url}#spa` },
  }
  if (text(post.description)) article.description = text(post.description)
  if (post.image) article.image = post.image
  if (post.datePublished) article.datePublished = post.datePublished.toISOString()
  if (post.dateModified) article.dateModified = post.dateModified.toISOString()
  if (post.inLanguage) article.inLanguage = post.inLanguage
  return { ...base, '@graph': [...(base['@graph'] as Json[]), article] }
}

export type PlatformJsonLdInput = {
  /** Canonical marketing origin, e.g. https://spamanagement.co */
  url: string
  name: string
  legalName: string
  email: string
  telephone?: string | null
  logo: string
  description: string
  plans?: { name: string; priceAed: string | number }[]
}

/** schema.org graph for the marketing site: the operating Organization, the WebSite and the SoftwareApplication. */
export function platformJsonLd(input: PlatformJsonLdInput): Json {
  const org = `${input.url}/#organization`
  const phone = text(input.telephone)
  const offers = (input.plans ?? [])
    .map((p) => ({ name: p.name, price: money(p.priceAed) }))
    .filter((p) => p.price !== null)
    .map((p) => ({
      '@type': 'Offer',
      name: p.name,
      price: p.price,
      priceCurrency: 'AED',
      url: `${input.url}/pricing`,
    }))
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': org,
        name: input.name,
        legalName: input.legalName,
        url: `${input.url}/`,
        logo: input.logo,
        email: input.email,
        ...(phone ? { telephone: phone } : {}),
        address: { '@type': 'PostalAddress', addressLocality: 'Dubai', addressCountry: 'AE' },
        contactPoint: {
          '@type': 'ContactPoint',
          contactType: 'sales',
          email: input.email,
          ...(phone ? { telephone: phone } : {}),
          areaServed: 'AE',
          availableLanguage: ['English', 'Arabic'],
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${input.url}/#website`,
        url: `${input.url}/`,
        name: input.name,
        inLanguage: 'en',
        publisher: { '@id': org },
      },
      {
        '@type': 'SoftwareApplication',
        name: input.name,
        url: `${input.url}/`,
        description: input.description,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        publisher: { '@id': org },
        ...(offers.length ? { offers } : {}),
      },
    ],
  }
}

export type RobotsRules = { disallow?: string[]; sitemaps?: string[]; disallowAll?: boolean }

/** robots.txt for every crawler: everything allowed except `disallow` (or nothing, with `disallowAll`). */
export function robotsTxt(rules: RobotsRules): string {
  const lines = ['User-agent: *']
  if (rules.disallowAll) lines.push('Disallow: /')
  else {
    lines.push('Allow: /')
    for (const p of rules.disallow ?? []) lines.push(`Disallow: ${p}`)
  }
  const maps = rules.sitemaps ?? []
  if (maps.length) lines.push('', ...maps.map((s) => `Sitemap: ${s}`))
  return `${lines.join('\n')}\n`
}

export type SitemapEntry = {
  url: string
  lastModified?: Date | null
  /** hreflang → URL (include the entry's own language and `x-default`). */
  alternates?: Record<string, string>
}

const xml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)

/** sitemap.xml (sitemaps.org) with xhtml:link hreflang alternates. */
export function sitemapXml(entries: SitemapEntry[]): string {
  const body = entries.map((e) => {
    const parts = [`<loc>${xml(e.url)}</loc>`]
    for (const [lang, href] of Object.entries(e.alternates ?? {}))
      parts.push(`<xhtml:link rel="alternate" hreflang="${xml(lang)}" href="${xml(href)}"/>`)
    if (e.lastModified) parts.push(`<lastmod>${e.lastModified.toISOString()}</lastmod>`)
    return `<url>${parts.join('')}</url>`
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${body.join('\n')}${body.length ? '\n' : ''}</urlset>\n`
}

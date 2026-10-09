// Google Maps links for spa addresses: a branch's exact pin (maps_url) when set, else an address search.

/** Longest stored Google Maps link (share links are short; full place URLs can be long). */
export const MAPS_URL_MAX = 2000

/** Google hosts a UAE spa's pin can live on (no open-ended TLD pattern: lookalike zones are registrable). */
const GOOGLE_HOSTS = new Set(['google.com', 'www.google.com', 'google.ae', 'www.google.ae'])
const MAPS_HOSTS = new Set(['maps.google.com', 'maps.google.ae'])
const MAPS_PATH = /^\/maps(\/|$)/
/** Pasted text may not carry markup/script breakout characters (whitespace, quotes, backslash, <, >, backtick). */
const UNSAFE_RAW = /[\s\p{Cc}"<>\\`]/u
/** The stored/rendered link is RFC 3986 characters only, so it is inert in any HTML or script context we escape. */
const URL_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]+$/

/**
 * The normalized link (`URL.href`) for a Google Maps link a spa can paste, else null: google.com|ae/maps…,
 * maps.google.com|ae (/, /?… or /maps…), maps.app.goo.gl/…, goo.gl/maps/…. http(s) only, no credentials/port.
 */
export function normalizeGoogleMapsUrl(value: string | null | undefined): string | null {
  if (!value || value.length > MAPS_URL_MAX || UNSAFE_RAW.test(value)) return null
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password || u.port) return null
  const host = u.hostname.toLowerCase()
  const path = u.pathname
  const ok =
    host === 'maps.app.goo.gl'
      ? path.length > 1
      : host === 'goo.gl'
        ? MAPS_PATH.test(path)
        : MAPS_HOSTS.has(host)
          ? path === '/' || MAPS_PATH.test(path)
          : GOOGLE_HOSTS.has(host) && MAPS_PATH.test(path)
  const href = u.href
  return ok && href.length <= MAPS_URL_MAX && URL_CHARS.test(href) ? href : null
}

/** True for a Google Maps link a spa can paste (see normalizeGoogleMapsUrl; store the normalized form). */
export const isGoogleMapsUrl = (value: string) => normalizeGoogleMapsUrl(value) !== null

/** Google Maps search URL for a free-text address. */
export const mapsSearchUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

/** Where a branch's address links: its exact pin when set (and valid), else a search for the address. */
export function branchMapsHref(
  branch: { address?: string | null; mapsUrl?: string | null } | null | undefined,
) {
  const pin = normalizeGoogleMapsUrl(branch?.mapsUrl)
  if (pin) return pin
  const address = branch?.address?.trim()
  return address ? mapsSearchUrl(address) : null
}

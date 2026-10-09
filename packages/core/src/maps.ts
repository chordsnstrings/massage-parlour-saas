// Google Maps links for spa addresses: a branch's exact pin (maps_url) when set, else an address search.

/** Longest stored Google Maps link (share links are short; full place URLs can be long). */
export const MAPS_URL_MAX = 2000

/**
 * True for a Google Maps link a spa can paste: google.<tld>/maps…, maps.google.<tld>…, maps.app.goo.gl/…,
 * goo.gl/maps/…. http(s) only, no credentials.
 */
export function isGoogleMapsUrl(value: string): boolean {
  if (!value || value.length > MAPS_URL_MAX) return false
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return false
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
  if (u.username || u.password || u.port) return false
  const host = u.hostname.toLowerCase()
  const path = u.pathname
  if (host === 'maps.app.goo.gl') return path.length > 1
  if (host === 'goo.gl') return /^\/maps(\/|$)/.test(path)
  // google.com, google.ae, google.co.uk … (optionally www.)
  const tld = '(?:[a-z]{2,3}|co\\.[a-z]{2}|com\\.[a-z]{2})'
  if (new RegExp(`^maps\\.google\\.${tld}$`).test(host)) return true
  if (new RegExp(`^(?:www\\.)?google\\.${tld}$`).test(host)) return /^\/maps(\/|$)/.test(path)
  return false
}

/** Google Maps search URL for a free-text address. */
export const mapsSearchUrl = (address: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

/** Where a branch's address links: its exact pin when set (and valid), else a search for the address. */
export function branchMapsHref(
  branch: { address?: string | null; mapsUrl?: string | null } | null | undefined,
) {
  if (branch?.mapsUrl && isGoogleMapsUrl(branch.mapsUrl)) return branch.mapsUrl
  const address = branch?.address?.trim()
  return address ? mapsSearchUrl(address) : null
}

// F15 site blocks (PLAN §11.4): video + map embeds. Pure; the CSP allows exactly these frame origins on spa sites
// (security-headers.ts SITE_EMBED_ORIGINS). Videos load nothing from YouTube/Vimeo until the visitor clicks play.
import { geoFromMapsUrl } from './seo'

/** Privacy-enhanced YouTube player (no cookies until play). */
export const YOUTUBE_EMBED_ORIGIN = 'https://www.youtube-nocookie.com'
export const VIMEO_EMBED_ORIGIN = 'https://player.vimeo.com'
/** Google Maps embed (`/maps?…&output=embed`, no API key). */
export const MAPS_EMBED_ORIGIN = 'https://www.google.com'

export type VideoSource =
  | { provider: 'youtube'; id: string; start?: number }
  | { provider: 'vimeo'; id: string; hash?: string }
  /** An uploaded video in the spa's media library (same origin only: the CSP's media-src is 'self'). */
  | { provider: 'file'; src: string }

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const VIMEO_ID = /^\d{1,12}$/
const VIMEO_HASH = /^[0-9a-f]{6,20}$/i
const FILE_PATH =
  /^\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/[\w.-]{1,120})?$/i
const YT_HOSTS = new Set(['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'music.youtube.com'])

/** "90", "90s", "1m30s", "1h2m3s" → seconds (null when not a time). */
function seconds(v: string | null): number | undefined {
  if (!v) return undefined
  if (/^\d{1,6}$/.test(v)) return Number(v) || undefined
  const m = v.match(/^(?:(\d{1,2})h)?(?:(\d{1,3})m)?(?:(\d{1,5})s)?$/)
  if (!m || !(m[1] || m[2] || m[3])) return undefined
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) || undefined
}

/**
 * A pasted YouTube / Vimeo link (watch, share, shorts, embed, player URLs) or an uploaded library video
 * (`/files/{id}`) → what the Video block plays; null for anything else (other hosts, scripts, data: URLs).
 */
export function parseVideoUrl(raw: string | null | undefined): VideoSource | null {
  const value = raw?.trim() ?? ''
  if (!value || value.length > 500) return null
  if (FILE_PATH.test(value)) return { provider: 'file', src: value }
  let u: URL
  try {
    u = new URL(value)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
  if (u.username || u.password) return null
  const host = u.hostname.toLowerCase().replace(/^(?:www|m)\./, '')
  const parts = u.pathname.split('/').filter(Boolean)
  if (YT_HOSTS.has(host)) {
    let id: string | undefined
    if (host === 'youtu.be') id = parts[0]
    else if (parts[0] === 'watch') id = u.searchParams.get('v') ?? undefined
    else if (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1]
    if (!id || !YT_ID.test(id)) return null
    const start = seconds(u.searchParams.get('t') ?? u.searchParams.get('start'))
    return start ? { provider: 'youtube', id, start } : { provider: 'youtube', id }
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const [first, second] = host === 'player.vimeo.com' && parts[0] === 'video' ? parts.slice(1) : parts
    if (!first || !VIMEO_ID.test(first)) return null
    const hash = u.searchParams.get('h') ?? second
    return hash && VIMEO_HASH.test(hash)
      ? { provider: 'vimeo', id: first, hash }
      : { provider: 'vimeo', id: first }
  }
  return null
}

/** Player URL loaded after the visitor clicks play (autoplays, no related videos from other channels). */
export function videoEmbedSrc(v: VideoSource): string | null {
  if (v.provider === 'youtube')
    return `${YOUTUBE_EMBED_ORIGIN}/embed/${v.id}?autoplay=1&rel=0&playsinline=1${v.start ? `&start=${v.start}` : ''}`
  if (v.provider === 'vimeo')
    return `${VIMEO_EMBED_ORIGIN}/video/${v.id}?autoplay=1&dnt=1${v.hash ? `&h=${v.hash}` : ''}`
  return null
}

/** YouTube's own still for a video (an image, no script) — the poster when the block has none. */
export const youtubePoster = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

/**
 * Google Maps embed for the branch: the exact pin's coordinates when the spa's Maps link carries them, else the
 * address (short share links like maps.app.goo.gl carry no coordinates, so the address is searched). null = nothing
 * to show.
 */
export function mapEmbedSrc(
  branch: { address?: string | null; mapsUrl?: string | null } | null | undefined,
  locale: 'en' | 'ar' = 'en',
): string | null {
  const geo = geoFromMapsUrl(branch?.mapsUrl)
  const q = geo ? `${geo.latitude},${geo.longitude}` : branch?.address?.trim()
  if (!q) return null
  return `${MAPS_EMBED_ORIGIN}/maps?q=${encodeURIComponent(q)}&z=15&hl=${locale}&output=embed`
}

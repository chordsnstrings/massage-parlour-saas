/** A library image as the media UI sees it (serialisable; no server imports so client code can use it). */
export type MediaItem = {
  id: string
  url: string
  width: number | null
  height: number | null
  bytes: number | null
  alt: { en?: string; ar?: string }
  source: 'upload' | 'ai' | string
  tags: string[]
  filename: string | null
  createdAt: string
}

export function toMediaItem(r: {
  id: string
  url: string
  width: number | null
  height: number | null
  bytes: number | null
  alt: { en?: string; ar?: string } | null
  source: string
  tags: string[]
  filename?: string | null
  createdAt: Date | string
}): MediaItem {
  return {
    id: r.id,
    url: r.url,
    width: r.width,
    height: r.height,
    bytes: r.bytes,
    alt: r.alt ?? {},
    source: r.source,
    tags: r.tags,
    filename: r.filename ?? null,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : r.createdAt.toISOString(),
  }
}

/** Our stored files (vs. a temporary remote AI link or a pasted URL). */
export const isStored = (url: string) => /^(https?:\/\/[^/]+)?\/files\/[0-9a-f-]{36}(?=[/?#]|$)/i.test(url)

/** Thumbnail rendition for stored files (rendered on demand by /files/{id}?w=…). */
export const sized = (url: string, w: 480 | 960) =>
  isStored(url) && !url.includes('?') ? `${url}?w=${w}` : url

export function formatBytes(n: number | null | undefined) {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif'
export const MAX_UPLOAD_MB = 20

/** Server-side check for an image URL posted by a form (ImageInput): a /files path or an https link. */
export const IMAGE_URL_PATTERN = /^(\/files\/[0-9a-f-]{36}(\/[\w.-]+)?|https:\/\/[^\s"'<>]+)$/i

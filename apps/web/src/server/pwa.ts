// Installable spa dashboard (docs/PLAN.md §18.6): every spa's CRM installs as its own app — manifest at
// {dashboard}/app.webmanifest, icons at {dashboard}/app-icon/{key}/{variant}, scope = the spa's dashboard path.
import { createHash } from 'node:crypto'
import { appInitials, pwaAppName, slugInitials } from '@spa/core'
import { platformDb, tenants } from '@spa/db'
import { eq } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { appPath } from '@/lib/paths'

/** Light brand theme (owner 2026-10-09): dark green bars, light page; icons without a logo are lime with dark ink. */
export const PWA_THEME = '#0f6b4b'
export const PWA_BACKGROUND = '#f6f6f9'
export const ICON_LIME = '#d9f26a'
export const ICON_INK = '#0b0b0f'
/** Bump when the icon design changes: every icon URL changes with it, so installed apps pick up the new look. */
export const ICON_VERSION = 1

export const ICON_VARIANTS = {
  '192': { size: 192, rounded: true, box: 0.72 },
  '512': { size: 512, rounded: true, box: 0.72 },
  // Maskable: full bleed (the launcher applies its own mask); the mark stays inside the 80 % safe-zone circle.
  'maskable-512': { size: 512, rounded: false, box: 0.56 },
  // iOS rounds the corners itself and turns transparent pixels black, so this one is full bleed too.
  'apple-180': { size: 180, rounded: false, box: 0.72 },
} as const
export type IconVariant = keyof typeof ICON_VARIANTS
export const isIconVariant = (v: string): v is IconVariant => Object.hasOwn(ICON_VARIANTS, v)

export type PwaTenant = { id: string; slug: string; name: string; logoFileId: string | null }

/** Initials the icon font can draw (Latin + digits); names in other scripts use the slug's letters instead. */
export function iconInitials(t: Pick<PwaTenant, 'name' | 'slug'>) {
  const fromName = appInitials(t.name)
  if (fromName && /^[\p{Script=Latin}\p{N}]+$/u.test(fromName)) return fromName
  return slugInitials(t.slug) || 'S'
}

/** Everything the manifest, the icon route and the layout's <head> need for one spa. */
export function pwaFor(t: PwaTenant) {
  const base = appPath(`/${t.slug}`)
  const initials = iconInitials(t)
  // The logo's file id is immutable content, so it keys the icons; without one the initials do.
  const key = createHash('sha256')
    .update(`${ICON_VERSION}|${t.logoFileId ?? `initials:${initials}`}`)
    .digest('base64url')
    .slice(0, 16)
  return {
    name: pwaAppName(t.name),
    base,
    key,
    initials,
    manifestUrl: `${base}/app.webmanifest`,
    icon: (variant: IconVariant) => `${base}/app-icon/${key}/${variant}`,
  }
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
// Manifest and icon requests come without cookies and can repeat a lot: a short cache keeps them off the database.
// Misses get their own cache, so made-up slugs can't push real spas out. Callers holding a newer icon key re-read with
// `fresh`, at most once per FRESH_GAP per slug (anyone can send a made-up key).
const FRESH_GAP = 10_000
const g = globalThis as unknown as {
  __spaPwaFound?: LRUCache<string, PwaTenant>
  __spaPwaMisses?: LRUCache<string, true>
  __spaPwaFresh?: LRUCache<string, true>
}
if (!g.__spaPwaFound) g.__spaPwaFound = new LRUCache({ max: 2000, ttl: 30_000 })
if (!g.__spaPwaMisses) g.__spaPwaMisses = new LRUCache({ max: 5000, ttl: 30_000 })
if (!g.__spaPwaFresh) g.__spaPwaFresh = new LRUCache({ max: 2000, ttl: FRESH_GAP })
const tenantCache = g.__spaPwaFound
const missCache = g.__spaPwaMisses
const freshReads = g.__spaPwaFresh

/** The spa behind a dashboard slug (platform lookup, like host routing); deleted spas have no app. */
export async function pwaTenant(slug: string, opts: { fresh?: boolean } = {}): Promise<PwaTenant | null> {
  const s = slug.toLowerCase()
  if (!SLUG.test(s)) return null
  const fresh = opts.fresh && !freshReads.has(s)
  if (!fresh) {
    const hit = tenantCache.get(s)
    if (hit) return hit
    if (missCache.has(s)) return null
  }
  const [row] = await platformDb()
    .select({
      id: tenants.id,
      slug: tenants.slug,
      name: tenants.name,
      logoFileId: tenants.logoFileId,
      deletedAt: tenants.deletedAt,
    })
    .from(tenants)
    .where(eq(tenants.slug, s))
    .limit(1)
  const found =
    row && !row.deletedAt ? { id: row.id, slug: row.slug, name: row.name, logoFileId: row.logoFileId } : null
  if (opts.fresh) freshReads.set(s, true)
  if (found) {
    tenantCache.set(s, found)
    missCache.delete(s)
  } else {
    tenantCache.delete(s)
    missCache.set(s, true)
  }
  return found
}

/** Web app manifest (https://www.w3.org/TR/appmanifest/) for one spa's dashboard. */
export function pwaManifest(t: PwaTenant) {
  const app = pwaFor(t)
  return {
    id: app.base,
    name: app.name,
    short_name: app.name,
    description: t.name,
    start_url: app.base,
    scope: app.base,
    display: 'standalone',
    theme_color: PWA_THEME,
    background_color: PWA_BACKGROUND,
    lang: 'en',
    dir: /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(app.name) ? 'auto' : 'ltr',
    categories: ['business', 'productivity'],
    prefer_related_applications: false,
    icons: [
      { src: app.icon('192'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: app.icon('512'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: app.icon('maskable-512'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}

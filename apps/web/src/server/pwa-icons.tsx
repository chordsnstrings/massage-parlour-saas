// App icons for a spa's installed dashboard (docs/PLAN.md §18.6), rendered on demand and kept in memory:
// the spa's logo centred on white, or its initials on lime. Logos go through sharp (SVG/PNG/JPG/WebP, any aspect);
// initials through next/og, whose bundled font turns text into shapes (the server image has no system fonts).
import { withTenant } from '@spa/db'
import { getFile, looksLikeSvg } from '@spa/services'
import { LRUCache } from 'lru-cache'
import { ImageResponse } from 'next/og'
import sharp from 'sharp'
import { ICON_INK, ICON_LIME, ICON_VARIANTS, type IconVariant, type PwaTenant, pwaFor } from './pwa'

type Spec = (typeof ICON_VARIANTS)[IconVariant]
const radius = (size: number) => Math.round(size * 0.22)

/** `fallback`: the spa has a logo but it couldn't be read or decoded this time, so this is the initials icon. */
export type AppIcon = { png: Buffer; fallback: boolean }
/** A fallback is kept this long only (storage hiccups heal; repeated requests still don't hit storage each time). */
const FALLBACK_TTL = 60_000

const g = globalThis as unknown as {
  __spaPwaAppIcons?: LRUCache<string, AppIcon>
  __spaPwaIconRenders?: Map<string, Promise<AppIcon>>
}
if (!g.__spaPwaAppIcons)
  g.__spaPwaAppIcons = new LRUCache<string, AppIcon>({
    maxSize: 16 * 1024 * 1024,
    sizeCalculation: (i) => i.png.length || 1,
  })
if (!g.__spaPwaIconRenders) g.__spaPwaIconRenders = new Map()
const icons = g.__spaPwaAppIcons
const inFlight = g.__spaPwaIconRenders

function tile(spec: Spec, fill: string) {
  const { size } = spec
  const rx = spec.rounded ? radius(size) : 0
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${rx}" ry="${rx}" fill="${fill}"/></svg>`,
  )
}

/** Logo centred on a white tile; uniform padding around the mark is trimmed first so it fills the box. */
export async function logoIcon(bytes: Buffer, spec: Spec) {
  const box = Math.round(spec.size * spec.box)
  const source = sharp(bytes, {
    failOn: 'none',
    limitInputPixels: 80_000_000,
    ...(looksLikeSvg(bytes) ? { density: 300 } : {}),
  })
  let mark: Buffer
  try {
    mark = await source.clone().trim({ threshold: 12 }).png().toBuffer()
  } catch {
    mark = await source.png().toBuffer() // a single-colour image has nothing to trim
  }
  const fitted = await sharp(mark)
    .resize(box, box, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer()
  return sharp(tile(spec, '#ffffff'))
    .composite([{ input: fitted, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** Initials in dark ink on a lime tile (spas without a logo). */
export async function initialsIcon(initials: string, spec: Spec) {
  const { size } = spec
  const fontSize = Math.round(size * spec.box * (initials.length > 1 ? 0.62 : 0.8))
  const res = new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: ICON_LIME,
        borderRadius: spec.rounded ? radius(size) : 0,
        color: ICON_INK,
        fontSize,
        lineHeight: 1,
        letterSpacing: -Math.round(fontSize * 0.04),
        // The bundled font is a regular weight: a stroke in the same ink makes it read as bold at icon sizes.
        WebkitTextStroke: `${Math.max(1, Math.round(fontSize * 0.035))}px ${ICON_INK}`,
        paddingBottom: Math.round(fontSize * 0.06),
      }}
    >
      {initials}
    </div>,
    { width: size, height: size },
  )
  return Buffer.from(await res.arrayBuffer())
}

/** `fallback` when a logo couldn't be read this time (e.g. object storage hiccup): the caller must not cache it. */
async function render(t: PwaTenant, variant: IconVariant): Promise<AppIcon> {
  const spec = ICON_VARIANTS[variant]
  let fallback = false
  if (t.logoFileId) {
    const fileId = t.logoFileId
    try {
      const file = await withTenant(t.id, (tx) => getFile(tx, fileId))
      if (file?.bytes.length) return { png: await logoIcon(file.bytes, spec), fallback }
    } catch {
      fallback = true // unreadable or undecodable logo → initials for now, like the sidebar
    }
  }
  return { png: await initialsIcon(pwaFor(t).initials, spec), fallback }
}

/** The PNG for one spa + variant, rendered once per icon key (concurrent requests share one render). */
export async function appIcon(t: PwaTenant, variant: IconVariant): Promise<AppIcon> {
  const cacheKey = `${t.id}:${pwaFor(t).key}:${variant}`
  const hit = icons.get(cacheKey)
  if (hit) return hit
  let pending = inFlight.get(cacheKey)
  if (!pending) {
    pending = render(t, variant)
      .then((icon) => {
        icons.set(cacheKey, icon, icon.fallback ? { ttl: FALLBACK_TTL } : {})
        return icon
      })
      .finally(() => inFlight.delete(cacheKey))
    inFlight.set(cacheKey, pending)
  }
  return pending
}

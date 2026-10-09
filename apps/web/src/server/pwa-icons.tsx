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

const g = globalThis as unknown as {
  __spaPwaIcons?: LRUCache<string, Buffer>
  __spaPwaRenders?: Map<string, Promise<Buffer>>
}
if (!g.__spaPwaIcons)
  g.__spaPwaIcons = new LRUCache<string, Buffer>({
    maxSize: 16 * 1024 * 1024,
    sizeCalculation: (b) => b.length || 1,
  })
if (!g.__spaPwaRenders) g.__spaPwaRenders = new Map()
const icons = g.__spaPwaIcons
const inFlight = g.__spaPwaRenders

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

/** `cache: false` when a logo couldn't be read this time (e.g. object storage hiccup): try again next request. */
async function render(t: PwaTenant, variant: IconVariant) {
  const spec = ICON_VARIANTS[variant]
  let cache = true
  if (t.logoFileId) {
    const fileId = t.logoFileId
    try {
      const file = await withTenant(t.id, (tx) => getFile(tx, fileId))
      if (file?.bytes.length) return { png: await logoIcon(file.bytes, spec), cache }
    } catch {
      cache = false // unreadable or undecodable logo → initials for now, like the sidebar
    }
  }
  return { png: await initialsIcon(pwaFor(t).initials, spec), cache }
}

/** The PNG for one spa + variant, rendered once per icon key (concurrent requests share one render). */
export async function appIcon(t: PwaTenant, variant: IconVariant) {
  const cacheKey = `${t.id}:${pwaFor(t).key}:${variant}`
  const hit = icons.get(cacheKey)
  if (hit) return hit
  let pending = inFlight.get(cacheKey)
  if (!pending) {
    pending = render(t, variant)
      .then(({ png, cache }) => {
        if (cache) icons.set(cacheKey, png)
        return png
      })
      .finally(() => inFlight.delete(cacheKey))
    inFlight.set(cacheKey, pending)
  }
  return pending
}

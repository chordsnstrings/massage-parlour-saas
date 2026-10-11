/**
 * Site-builder image values: a plain URL (every existing page) or `{ src, frame }` where `frame` carries the
 * focal point (x/y 0–100 %, physical — RTL never mirrors it), fit (`cover` crops, `contain` shows it all) and
 * zoom (1–2×), per device like the other style props (`{ base, md?, lg? }`). Pure and client-safe.
 */
export type ImageFit = 'cover' | 'contain'
export type ImageFrame = { x: number; y: number; fit: ImageFit; zoom: number }
export type ImageFrames = { base: ImageFrame; md?: ImageFrame; lg?: ImageFrame }
export type ImageValue = {
  src: string
  frame?: { base?: Partial<ImageFrame>; md?: Partial<ImageFrame>; lg?: Partial<ImageFrame> }
}
/** What an image prop may hold in page JSON. */
export type ImageProp = string | ImageValue | null | undefined

export const DEFAULT_FRAME: ImageFrame = { x: 50, y: 50, fit: 'cover', zoom: 1 }
export const ZOOM_MAX = 2

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : Number.NaN
  return Number.isFinite(n) ? Math.round(Math.min(hi, Math.max(lo, n)) * 100) / 100 : fallback
}

/** True for the object shape (`{ src: string, … }`). */
export const isImageValue = (v: unknown): v is ImageValue => isObj(v) && typeof v.src === 'string'

/** The URL of an image prop ('' when empty or malformed). */
export const imageSrc = (v: unknown): string => (typeof v === 'string' ? v : isImageValue(v) ? v.src : '')

/** One device's frame, clamped, filling gaps from `inherit`. */
export function normalizeFrame(v: unknown, inherit: ImageFrame = DEFAULT_FRAME): ImageFrame {
  const o = isObj(v) ? v : {}
  return {
    x: num(o.x, 0, 100, inherit.x),
    y: num(o.y, 0, 100, inherit.y),
    fit: o.fit === 'contain' || o.fit === 'cover' ? o.fit : inherit.fit,
    zoom: num(o.zoom, 1, ZOOM_MAX, inherit.zoom),
  }
}

/** Every image prop → `{ src, frames }` with complete, clamped frames (md inherits base, lg inherits md). */
export function normalizeImage(v: unknown): { src: string; frames: ImageFrames } {
  const src = imageSrc(v)
  const f = isImageValue(v) && isObj(v.frame) ? v.frame : {}
  const base = normalizeFrame(f.base)
  const frames: ImageFrames = { base }
  if (isObj(f.md)) frames.md = normalizeFrame(f.md, base)
  if (isObj(f.lg)) frames.lg = normalizeFrame(f.lg, frames.md ?? base)
  return { src, frames }
}

/** Effective frame per device: [base, md ≥768, lg ≥1024]. */
export function resolveFrames(v: unknown): [ImageFrame, ImageFrame, ImageFrame] {
  const { frames } = normalizeImage(v)
  const md = frames.md ?? frames.base
  return [frames.base, md, frames.lg ?? md]
}

const same = (a: ImageFrame, b: ImageFrame) =>
  a.x === b.x && a.y === b.y && a.fit === b.fit && a.zoom === b.zoom

/**
 * The value to store: a plain URL when every frame is the default (pages stay as they were), otherwise
 * `{ src, frame }` with overrides only where a device differs from what it would inherit.
 */
export function toImageProp(src: string, frames: ImageFrames): ImageProp {
  const base = normalizeFrame(frames.base)
  const md = frames.md ? normalizeFrame(frames.md, base) : undefined
  const lg = frames.lg ? normalizeFrame(frames.lg, md ?? base) : undefined
  const out: NonNullable<ImageValue['frame']> = {}
  if (!same(base, DEFAULT_FRAME)) out.base = base
  if (md && !same(md, base)) out.md = md
  if (lg && !same(lg, md ?? base)) out.lg = lg
  return Object.keys(out).length ? { src, frame: out } : src
}

/** Replaces the URL, keeping any framing. */
export const withImageSrc = (v: unknown, src: string): ImageProp =>
  isImageValue(v) && v.frame ? { ...v, src } : src

/** CSS custom properties read by `.sb-img` (site.css): fit, focal point, zoom for base / md / lg. */
export function imageFrameVars(v: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!isImageValue(v) || !v.frame) return out
  resolveFrames(v).forEach((f, i) => {
    const d = 'bml'[i]
    out[`--if-${d}`] = f.fit
    out[`--ip-${d}`] = `${f.x}% ${f.y}%`
    out[`--iz-${d}`] = String(f.zoom)
  })
  return out
}

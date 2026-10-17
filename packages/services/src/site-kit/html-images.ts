// R28 P5: picture adjustments (focal point, Fill / Fit, replace, align) carried onto a new version of an HTML design.
// Pure and client-safe: the version upload prefills its adjuster with it, the live rollout keeps a spa's own ones.
import { HTML_IMAGE_SRC_MAX, type HtmlImageAdjust, listHtmlDesignImages } from '@spa/core'

const order = (id: string) => Number(id.replace(/^\D+/, '')) || 0

/**
 * `images` re-pointed at the pictures of `html` by their `src`: an adjustment whose picture is still in the new file
 * (same src, first `HTML_IMAGE_SRC_MAX` characters) gets that picture's id there — the same id when it still matches,
 * else the k-th picture with that src for the k-th adjustment with it (in id order). Adjustments whose picture is
 * gone are dropped; at most one per new picture.
 */
export function repointHtmlImageAdjustments(images: HtmlImageAdjust[], html: string): HtmlImageAdjust[] {
  if (!images.length) return []
  const bySrc = new Map<string, string[]>()
  for (const img of listHtmlDesignImages(html)) {
    const src = img.src.slice(0, HTML_IMAGE_SRC_MAX)
    bySrc.set(src, [...(bySrc.get(src) ?? []), img.id])
  }
  const used = new Set<string>()
  const out: HtmlImageAdjust[] = []
  const rest: HtmlImageAdjust[] = []
  // Same id + same src first, so the positional pairing below only fills in the moved ones.
  for (const a of images) {
    if (bySrc.get(a.src)?.includes(a.id) && !used.has(a.id)) {
      used.add(a.id)
      out.push(a)
    } else rest.push(a)
  }
  const kinds = (id: string) => id.split('-')[0]
  for (const a of [...rest].sort((x, y) => order(x.id) - order(y.id))) {
    const id = bySrc.get(a.src)?.find((i) => !used.has(i) && kinds(i) === kinds(a.id))
    if (!id) continue
    used.add(id)
    out.push({ ...a, id })
  }
  return out
}

/** The new template's adjustments, plus the spa's `own` (re-pointed) ones for pictures the template sets none for. */
export function mergeHtmlImageAdjustments(
  template: HtmlImageAdjust[],
  own: HtmlImageAdjust[],
): HtmlImageAdjust[] {
  const set = new Set(template.map((a) => a.id))
  return [...template, ...own.filter((a) => !set.has(a.id))]
}

import { HTML_IMAGE_ID, HTML_IMAGE_URL, type HtmlImageAdjust, MAX_HTML_IMAGES } from '@spa/core'
import { z } from 'zod'

const ImageAdjust = z.object({
  id: z.string().regex(HTML_IMAGE_ID),
  src: z.string().max(300),
  fit: z.enum(['cover', 'contain']).optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  x: z.number().min(0).max(100).optional(),
  y: z.number().min(0).max(100).optional(),
  replace: z.string().regex(HTML_IMAGE_URL).optional(),
})

/** The adjuster's hidden `images` field (JSON); null when it isn't valid. Missing = no adjustments. */
export function parseImages(v: FormDataEntryValue | null): HtmlImageAdjust[] | null {
  if (v == null || v === '') return []
  if (typeof v !== 'string' || v.length > 200_000) return null
  try {
    const r = z.array(ImageAdjust).max(MAX_HTML_IMAGES).safeParse(JSON.parse(v))
    return r.success ? r.data : null
  } catch {
    return null
  }
}

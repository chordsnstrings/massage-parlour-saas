import type { ComponentConfig } from '@puckeditor/core'
import { type HtmlImageAdjust, htmlDesignDocument } from '@spa/core'
import { bookHref, mapHref, pageHref, phoneHref, whatsappHref } from '../links'
import type { SiteMeta } from '../types'

/** Block type of an uploaded HTML design (one per page; the page's root carries `htmlDesign: true`). */
export const HTML_DESIGN = 'HtmlDesign'

/** Live spa data an uploaded design can show: `{{spa_name}}`, `{{book_url}}`, … (HTML-escaped). */
export const HTML_DESIGN_PLACEHOLDERS = [
  'spa_name',
  'book_url',
  'whatsapp_url',
  'phone',
  'phone_url',
  'address',
  'map_url',
  'site_url',
] as const

export function htmlDesignValues(meta: SiteMeta): Record<(typeof HTML_DESIGN_PLACEHOLDERS)[number], string> {
  const branch = meta.data.branch
  const book = bookHref(meta)
  return {
    spa_name: meta.data.tenant.name,
    book_url: book,
    whatsapp_url: whatsappHref(meta) ?? book,
    phone: branch?.phone ?? '',
    phone_url: phoneHref(meta) ?? book,
    address: branch?.address ?? '',
    map_url: branch?.address ? mapHref(branch.address) : book,
    site_url: pageHref(meta, ''),
  }
}

export { htmlDesignDocument }

/** `images`: the super-admin's per-image adjustments (focal point, fill/fit, replacement), applied in the frame. */
type Props = { html: string; images?: HtmlImageAdjust[] }

/**
 * An uploaded HTML design shown exactly as built (its CSS, fonts, motion and scripts), full screen. It runs in a
 * sandboxed frame with an opaque origin, so its scripts can't reach the platform's pages, cookies or APIs.
 */
export const HtmlDesign: ComponentConfig<Props> = {
  label: 'HTML design',
  // Replaced by uploading a new file, never edited here.
  fields: {
    html: { type: 'textarea', visible: false },
    images: { type: 'custom', render: () => <></>, visible: false },
  },
  defaultProps: { html: '', images: [] },
  render: ({ html, images, puck }) => {
    const meta = puck.metadata as SiteMeta
    return (
      <iframe
        title={meta.data.tenant.name}
        srcDoc={htmlDesignDocument(html, htmlDesignValues(meta), Boolean(meta.editing), images ?? [])}
        sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
        className="site-html-design"
        style={{ display: 'block', width: '100%', height: '100dvh', border: 0 }}
      />
    )
  },
}

/** Largest uploaded design: page drafts are capped at 512 KB, and the file travels inside the page JSON. */
export const MAX_HTML_DESIGN_BYTES = 500 * 1024

/** A one-page template whose home page is the uploaded design (spas copy it like any template). */
export const htmlDesignPages = (key: string, html: string, images: HtmlImageAdjust[] = []) => [
  {
    slug: '',
    title: { en: 'Home', ar: 'الرئيسية' },
    data: {
      root: { props: { htmlDesign: true, title: { en: '{name}' }, description: { en: '' } } },
      content: [{ type: HTML_DESIGN, props: { id: `${key}-html-design`, html, images } }],
    },
  },
]

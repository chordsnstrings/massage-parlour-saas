// Live spa values of an uploaded HTML design (R17), shared by the HtmlDesign block (frames) and the direct design
// page (R24, app/site-html). No JSX: server routes import it.
import type { HtmlDesignLink, HtmlImageAdjust } from '@spa/core'
import { ui } from './i18n'
import { bookHref, mapHref, pageHref, phoneHref, whatsappHref } from './links'
import type { SiteMeta } from './types'

/** Block type of an uploaded HTML design (one per page; the page's root carries `htmlDesign: true`). */
export const HTML_DESIGN = 'HtmlDesign'

/**
 * Live spa data an uploaded design can show: `{{spa_name}}`, `{{book_url}}`, … (HTML-escaped). `{{map_url}}` is the
 * branch's exact Google Maps pin when set (else an address search); `{{address}}` in page text becomes a link to it.
 */
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
    map_url: mapHref(meta) ?? book,
    site_url: pageHref(meta, ''),
  }
}

/** Placeholders that render as links when used in page text (inside attributes they stay plain values). */
export const htmlDesignLinks = (meta: SiteMeta): Record<string, HtmlDesignLink> => ({
  address: { href: mapHref(meta), label: ui('openInMaps', meta.locale) },
})

/** A one-page template whose home page is the uploaded design (spas copy it like any template). */
export const htmlDesignPages = (
  key: string,
  html: string,
  images: HtmlImageAdjust[] = [],
  phoneFixes = false,
) => [
  {
    slug: '',
    title: { en: 'Home', ar: 'الرئيسية' },
    data: {
      root: { props: { htmlDesign: true, title: { en: '{name}' }, description: { en: '' } } },
      content: [{ type: HTML_DESIGN, props: { id: `${key}-html-design`, html, images, phoneFixes } }],
    },
  },
]

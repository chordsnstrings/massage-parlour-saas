import type { ComponentConfig } from '@puckeditor/core'
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

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

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

/**
 * The uploaded document as the frame's `srcdoc`: placeholders filled, plus a small click handler — in-page
 * `#anchors` scroll inside the design, other links open in the top window (outside sites in a new tab), and
 * every link is inert in the editor / previews.
 */
export function htmlDesignDocument(html: string, values: Record<string, string>, inert: boolean): string {
  const filled = html.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) =>
    key in values ? escapeHtml(values[key]!) : m,
  )
  const script = `<script>(()=>{const inert=${inert};document.addEventListener('click',(e)=>{const a=e.target instanceof Element&&e.target.closest('a[href]');if(!a)return;const h=a.getAttribute('href')||'';if(h.startsWith('#'))return;if(inert){e.preventDefault();return}if(!a.target){a.target=/^https?:/i.test(h)?'_blank':'_top';if(a.target==='_blank')a.rel='noopener'}},true)})()</script>`
  for (const tag of [/<head\b[^>]*>/i, /<html\b[^>]*>/i, /<!doctype[^>]*>/i]) {
    const m = tag.exec(filled)
    if (m) return filled.slice(0, m.index + m[0].length) + script + filled.slice(m.index + m[0].length)
  }
  return script + filled
}

type Props = { html: string }

/**
 * An uploaded HTML design shown exactly as built (its CSS, fonts, motion and scripts), full screen. It runs in a
 * sandboxed frame with an opaque origin, so its scripts can't reach the platform's pages, cookies or APIs.
 */
export const HtmlDesign: ComponentConfig<Props> = {
  label: 'HTML design',
  // Replaced by uploading a new file, never edited here.
  fields: { html: { type: 'textarea', visible: false } },
  defaultProps: { html: '' },
  render: ({ html, puck }) => {
    const meta = puck.metadata as SiteMeta
    return (
      <iframe
        title={meta.data.tenant.name}
        srcDoc={htmlDesignDocument(html, htmlDesignValues(meta), Boolean(meta.editing))}
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
export const htmlDesignPages = (key: string, html: string) => [
  {
    slug: '',
    title: { en: 'Home', ar: 'الرئيسية' },
    data: {
      root: { props: { htmlDesign: true, title: { en: '{name}' }, description: { en: '' } } },
      content: [{ type: HTML_DESIGN, props: { id: `${key}-html-design`, html } }],
    },
  },
]

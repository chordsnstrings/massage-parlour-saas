// Share, icon and hreflang head tags for an exact HTML design's live page (QA M11 / M2, Decision A owner-approved
// 2026-10-14; site-html route). Pure; no DB.
import { crmInlinePaths, crmValueAt } from './html-crm-inline'
import { attributesOf, htmlTextOf, isSharePhoto } from './html-design'

/** What an exact HTML design's live page is shared and bookmarked with (site-html route; absolute URLs). */
export type HtmlDesignShare = {
  /** The page title when the design has no `<title>` of its own (the route adds that one too). */
  title: string
  /** The page's search description when the design has no meta description. */
  description?: string
  /** Canonical address of this page (`?lang=ar` for the Arabic one). */
  url: string
  siteName: string
  locale: 'en' | 'ar'
  /** Link-preview picture; `large` = a photo (`summary_large_image` card), else the logo (`summary`). */
  image?: { url: string; large: boolean } | null
  /** The spa logo: `rel=icon` + `rel=apple-touch-icon`. */
  icon?: string | null
  /** hreflang → URL (en, ar, x-default) when the site has Arabic. */
  languages?: Record<string, string>
}

/** Names a design may use instead: either one counts as the design's own tag. */
const SHARE_ALIASES: Record<string, string[]> = {
  'og:image': ['og:image:url', 'og:image:secure_url'],
  'twitter:image': ['twitter:image:src'],
}
const attrText = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Elements the HTML parser keeps in `<head>`; any other start tag begins the body. */
const HEAD_ELEMENTS = new Set([
  'html',
  'head',
  'title',
  'meta',
  'link',
  'style',
  'script',
  'noscript',
  'base',
  'template',
])
// Comments and raw-text bodies (text there is never a tag: html-design's skip ranges + style/template/noscript/title).
const HEAD_TOKEN =
  /<!--[\s\S]*?(?:-->|$)|<(script|style|template|noscript|title)\b[\s\S]*?(?:<\/\1\s*>|$)|<(\/?)([a-z][\w-]*)/gi

/**
 * A design's head as browsers and link-preview crawlers read it: markup up to `</head>` or `<body>` (none: up to the
 * first start tag only a body holds), without comments and script / style / template / noscript / title bodies;
 * `title` = the first `<title>` text in it.
 */
function designHead(html: string): { markup: string; title: string } {
  const skipped: [number, number][] = []
  let end = -1
  let firstBodyTag = -1
  let title: { at: number; text: string } | null = null
  for (const m of html.matchAll(HEAD_TOKEN)) {
    const name = m[3]?.toLowerCase()
    if (name) {
      if (m[2] ? name === 'head' : name === 'body') {
        end = m.index
        break
      }
      if (!m[2] && firstBodyTag < 0 && !HEAD_ELEMENTS.has(name)) firstBodyTag = m.index
      continue
    }
    if (!title && m[1]?.toLowerCase() === 'title')
      title = { at: m.index, text: /^<title\b[^>]*>([\s\S]*?)(?:<\/title\s*>)?$/i.exec(m[0])?.[1] ?? '' }
    skipped.push([m.index, m.index + m[0].length])
  }
  if (end < 0) end = firstBodyTag < 0 ? html.length : firstBodyTag
  let markup = ''
  let last = 0
  for (const [a, b] of skipped) {
    if (a >= end) break
    markup += html.slice(last, a)
    last = b
  }
  return {
    markup: markup + html.slice(last, Math.max(last, end)),
    title: title && title.at < end ? title.text : '',
  }
}

/**
 * M11 / M2 (QA 2026-10-14; Decision A, an R24 invisible addition, owner-approved 2026-10-14): the head tags block sites
 * get from their page metadata, for an exact HTML design's live document — Open Graph (title, description, url, type,
 * locale, site_name, image), the Twitter card, icon + apple-touch-icon links and hreflang alternates. Read from the
 * design's head (`designHead`): the titles = its `<title>`, the descriptions = its meta description (else `share`'s).
 * Each tag the design already has is left out — og:* and twitter:* by property or name, an `icon` /
 * `apple-touch-icon` link, and any `hreflang` link (then none of ours). The design's own share tags win on both
 * sides: X and other twitter:* readers fall back to og:*, so a twitter:title / description / image is only added
 * where the design has no og:* counterpart; an og:* tag we add reuses the design's twitter:* value; and the card size
 * follows the picture that is shown (the design's own: large unless SVG / icon / inline).
 */
export function htmlDesignHeadTags(html: string, share: HtmlDesignShare): string {
  const { markup: head, title: ownTitle } = designHead(html)
  const own = new Map<string, string>()
  let icon = false
  let apple = false
  let languages = false
  for (const m of head.matchAll(/<(meta|link)\b/gi)) {
    const attrs = attributesOf(head, m.index + m[0].length)
    const value = (name: string) => {
      const a = attrs.find((x) => x.name === name)
      return a && a.start >= 0 ? htmlTextOf(head.slice(a.start, a.end)) : ''
    }
    if (m[1]!.toLowerCase() === 'meta') {
      for (const key of [value('property'), value('name')].map((k) => k.trim().toLowerCase()))
        if (key && !own.has(key)) own.set(key, oneLine(value('content')))
      continue
    }
    const rel = value('rel').toLowerCase().split(/\s+/)
    if (rel.includes('icon')) icon = true
    if (rel.includes('apple-touch-icon') || rel.includes('apple-touch-icon-precomposed')) apple = true
    if (attrs.some((a) => a.name === 'hreflang')) languages = true
  }
  const names = (key: string) => [key, ...(SHARE_ALIASES[key] ?? [])]
  const has = (key: string) => names(key).some((k) => own.has(k))
  const ownValue = (key: string) =>
    names(key)
      .map((k) => own.get(k) ?? '')
      .find(Boolean) ?? ''
  const absolute = (src: string) => {
    if (!src.trim()) return ''
    try {
      const url = new URL(src, share.url)
      return /^https?:$/.test(url.protocol) ? url.href : ''
    } catch {
      return ''
    }
  }
  const title = oneLine(htmlTextOf(ownTitle)) || share.title
  const text = ownValue('description') || share.description || ''
  const ownPicture = absolute(ownValue('twitter:image')) || absolute(ownValue('og:image'))
  const image = share.image?.url
  const large = ownPicture ? isSharePhoto(ownPicture) : share.image?.large
  const meta = (attr: 'property' | 'name', key: string, content: string | undefined) =>
    content && !has(key) ? `<meta ${attr}="${key}" content="${attrText(content)}">` : ''
  /** X reads og:* where twitter:* is missing: ours only where the design has neither. */
  const twitter = (key: 'title' | 'description' | 'image', content: string | undefined) =>
    has(`og:${key}`) ? '' : meta('name', `twitter:${key}`, content)
  let out =
    meta('property', 'og:title', ownValue('twitter:title') || title) +
    meta('property', 'og:description', ownValue('twitter:description') || text) +
    meta('property', 'og:url', share.url) +
    meta('property', 'og:type', 'website') +
    meta('property', 'og:locale', share.locale === 'ar' ? 'ar_AE' : 'en_AE') +
    meta('property', 'og:site_name', share.siteName) +
    meta('property', 'og:image', absolute(ownValue('twitter:image')) || image) +
    meta('name', 'twitter:card', large ? 'summary_large_image' : 'summary') +
    twitter('title', title) +
    twitter('description', text) +
    twitter('image', image)
  if (share.icon && !icon) out += `<link rel="icon" href="${attrText(share.icon)}">`
  if (share.icon && !apple) out += `<link rel="apple-touch-icon" href="${attrText(share.icon)}">`
  if (!languages)
    for (const [lang, href] of Object.entries(share.languages ?? {}))
      out += `<link rel="alternate" hreflang="${attrText(lang)}" href="${attrText(href)}">`
  return out
}

// A CRM_DATA path naming a logo or icon (`spa.logo_on_dark`): never a link-preview photo (as html-design's `<img>` marks).
const MARK_PATH = /(?:^|[^a-z])(?:logo|icon|favicon|sprite)s?(?![a-z])/i

/**
 * Decision A (owner 2026-10-14): a contract design's link-preview photo. Its pictures live in window.CRM_DATA, not in
 * markup, so the design's `contract.inline` paths (its first-screen pictures, declared order) are read from the
 * render's data (after the CRM merge and the spa's content): the first one that is a photo — logo / icon paths
 * skipped; an inlined value's original url (`inline_originals`, never its data: URI); SVG / .ico / data: skipped
 * (`isSharePhoto`). As written (relative or absolute); null = none.
 */
export function crmSharePicture(data: unknown): string | null {
  const originals = (data as { inline_originals?: unknown } | null)?.inline_originals
  for (const path of crmInlinePaths(data)) {
    if (MARK_PATH.test(path)) continue
    let src = crmValueAt(data, path)
    if (typeof src === 'string' && /^\s*data:/i.test(src))
      src =
        originals && typeof originals === 'object' && Object.hasOwn(originals, path)
          ? (originals as Record<string, unknown>)[path]
          : undefined
    if (typeof src === 'string' && src.trim() && isSharePhoto(src)) return src.trim()
  }
  return null
}

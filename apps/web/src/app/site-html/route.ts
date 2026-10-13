import {
  type HtmlDesignContent,
  htmlDesignDocOf,
  htmlDesignDocument,
  htmlPictureAdjustments,
} from '@spa/core'
import { crmFeedMeta } from '@/components/site/crm-feed'
import { buildMeta, localeOf } from '@/components/site/data'
import { designKey, designWithCrm } from '@/components/site/html-crm'
import { HTML_DESIGN, htmlDesignLinks, htmlDesignValues } from '@/components/site/html-design-values'
import { tr } from '@/components/site/i18n'
import { loadPublished, siteJsonLd } from '@/components/site/published'
import type { Bi } from '@/components/site/types'
import { PATH_ROUTING } from '@/lib/paths'
import { crmInlinePlan } from '@/server/crm-inline'
import {
  forgetHtmlDesignRoutes,
  HTML_ROUTE_FALLBACK,
  HTML_ROUTE_HEADER,
  htmlRouteKey,
  sitePageOf,
} from '@/server/html-design-route'
import { sitePageUrl, siteSeo } from '@/server/seo'
import { resolveSiteTenant } from '@/server/sites'

/**
 * R24: the live page of an exact HTML design, served as the design document itself (proxy.ts rewrites here when
 * server/html-design-route says so; its response headers = @spa/core htmlDesignPageHeaders: CSP sandbox without
 * allow-same-origin, so the design never runs with the platform's origin). The body is the design exactly as built;
 * only invisible additions: the compat shim (htmlDesignDocument top mode), the spa JSON-LD, a canonical link and a
 * <title> when the design has none, and the cookieless tracker. Anything else (the page changed meanwhile, not an
 * exact design any more) → 307 to the normal page (`__page=1`, which the proxy never rewrites here).
 */
const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Before the design's </head> (else before <body>, else at the end: never before its doctype). */
function beforeHeadEnd(html: string, extra: string) {
  let at = html.search(/<\/head\s*>/i)
  if (at < 0) at = html.search(/<body\b/i)
  return at < 0 ? html + extra : html.slice(0, at) + extra + html.slice(at)
}

const notFound = () => new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } })

async function render(req: Request, head: boolean) {
  const h = req.headers
  if (h.get(HTML_ROUTE_HEADER) !== htmlRouteKey()) return notFound()
  const p = sitePageOf(h.get('x-internal-path') ?? '')
  const original = h.get('x-original-path') ?? '/'
  const fallback = () => {
    forgetHtmlDesignRoutes()
    const u = new URL(original, 'http://x')
    u.searchParams.set(HTML_ROUTE_FALLBACK, '1')
    return new Response(null, {
      status: 307,
      headers: { location: `${u.pathname}${u.search}`, 'cache-control': 'no-store' },
    })
  }
  if (!p) return fallback()
  const tenant = await resolveSiteTenant(p.kind === 'slug' ? { slug: p.key } : { hostname: p.key })
  if (!tenant) return fallback()
  const loaded = await loadPublished(tenant, p.page)
  const data = loaded?.published.data as
    | {
        root?: { props?: { htmlDesign?: unknown; title?: Bi } }
        content?: { type: string; props: Record<string, unknown> }[]
      }
    | undefined
  const block = data?.content?.find((n) => n?.type === HTML_DESIGN)
  if (
    !loaded ||
    data?.root?.props?.htmlDesign !== true ||
    !block ||
    block.props.phoneFixes !== false ||
    typeof block.props.html !== 'string'
  )
    return fallback()

  const lang = new URL(original, 'http://x').searchParams.get('lang') ?? undefined
  const locale = localeOf(lang)
  const base = p.kind === 'slug' && PATH_ROUTING ? `/s/${tenant.slug}` : ''
  const meta = buildMeta({
    data: loaded.data,
    theme: loaded.published.site.theme,
    locale,
    base,
    slug: p.page,
  })
  // R26: a design with the CRM data contract: only its window.CRM_DATA JSON becomes the live CRM data (an
  // endpoint-only design fetches crm-data.json itself); its booking form posts to this host's crm-enquiry.
  const { crm } = await crmFeedMeta(tenant, data, {
    locale,
    live: true,
    base,
    slug: p.page,
    services: loaded.data.services,
  })
  // R28: the spa's website content (data values in the CRM splice; page texts + pictures in the render).
  const content = block.props.content as HtmlDesignContent | undefined
  const key = designKey(htmlDesignDocOf(block.props))
  // contract.inline (owner 2026-10-13 "no delay when I reload"): the first-screen pictures it asks for as data: URIs
  // in that JSON (this document reuses nothing from the browser cache on a reload).
  const opts = { inject: false, content, locale }
  const inline = await crmInlinePlan(tenant, block.props.html, key, crm, opts)
  let html = htmlDesignDocument(
    designWithCrm(block.props.html, key, crm, { ...opts, inline }),
    htmlDesignValues(meta),
    false,
    htmlPictureAdjustments(Array.isArray(block.props.images) ? block.props.images : [], content),
    htmlDesignLinks(meta),
    { top: true, texts: content?.texts, locale },
  )
  const seo = await siteSeo(tenant)
  const title = tr(data.root?.props?.title, { locale, data: loaded.data }) || tenant.name
  const canonical = sitePageUrl(seo.base, p.page, locale === 'ar' && seo.arabic ? 'ar' : undefined)
  const ld = await siteJsonLd(tenant, p.page, loaded, locale)
  const site = p.kind === 'slug' ? tenant.slug : p.key
  html = beforeHeadEnd(
    html,
    `<script type="application/ld+json">${ld}</script>` +
      (/<link\b[^>]*\brel\s*=\s*["']?canonical\b/i.test(html)
        ? ''
        : `<link rel="canonical" href="${esc(canonical)}">`) +
      (/<title\b/i.test(html) ? '' : `<title>${esc(title)}</title>`) +
      `<script src="/t.js" data-site="${esc(site)}" defer></script>`,
  )
  return new Response(head ? null : html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-cache',
      ...(seo.indexable ? {} : { 'x-robots-tag': 'noindex, nofollow' }),
    },
  })
}

export const GET = (req: Request) => render(req, false)
export const HEAD = (req: Request) => render(req, true)

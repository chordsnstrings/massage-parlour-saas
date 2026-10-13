// R26: the public JSON endpoints of the HTML design data contract on a spa's site (docs/design/html-crm-contract.md):
// `{site}/crm-data.json` (the contract, for designs that fetch it) and `{site}/crm-enquiry` (the design's booking form
// → a website enquiry in the CRM inbox). `{site}` = `{slug}.{platform root}`, the spa's own domain, or `/s/{slug}`
// under path routing; the proxy rewrites them here with the API headers (never redirected for POST / OPTIONS).
// Designs run sandboxed (opaque origin): their requests carry `Origin: null`.
import {
  clientIpFrom,
  contractLocaleData,
  type HtmlDesignContent,
  htmlDesignDocOf,
  ipRateLimitKey,
  mergeCrmContract,
  overlayHtmlContent,
} from '@spa/core'
import { platformDb, withTenant } from '@spa/db'
import {
  DESIGN_ENQUIRY_MAX_BYTES,
  DESIGN_ENQUIRY_TENANT_LIMITS,
  designEnquirySchema,
  htmlDesignSource,
  PAGE_SLUG,
  RESERVED_SLUGS,
  SITE_ENQUIRY_LIMITS,
  websiteServices,
  websiteStaff,
  withinRateLimits,
} from '@spa/services'
import { sql } from 'drizzle-orm'
import { LRUCache } from 'lru-cache'
import { acceptsBookings } from '@/components/booking/data'
import { crmContractFor, crmEnquiryEndpoint, siteUsesCrmContract } from '@/components/site/crm-feed'
import { localeOf } from '@/components/site/data'
import { designContract, designKey } from '@/components/site/html-crm'
import { PATH_ROUTING } from '@/lib/paths'
import { spaDocReader } from '@/server/html-design-files'
import { siteOriginFrom } from '@/server/origin'
import { withinIpLimit } from '@/server/rate-limit'
import { readText, TooLarge } from '@/server/read-form'
import { recordSiteEnquiry } from '@/server/site-enquiry'
import { resolveSiteTenant } from '@/server/sites'

export type SiteParams = { params: Promise<{ slug?: string; hostname?: string }> }

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-robots-tag': 'noindex',
}
const reply = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, 'access-control-allow-origin': '*', ...extra },
  })
const preflight = (methods: string) =>
  new Response(null, {
    status: 204,
    headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': methods,
      'access-control-allow-headers': 'content-type, accept',
      'access-control-max-age': '600',
      'cache-control': 'no-store',
    },
  })

/** The spa (from the route param the proxy derived from the Host) + the site's base path. */
async function siteOf(ctx: SiteParams) {
  const p = await ctx.params
  const key = p.slug
    ? { slug: decodeURIComponent(p.slug) }
    : { hostname: decodeURIComponent(p.hostname ?? '') }
  const tenant = await resolveSiteTenant(key)
  return { tenant, base: 'slug' in key && PATH_ROUTING ? `/s/${tenant?.slug ?? key.slug}` : '' }
}

// crm-data.json: public data only, 120 reads a minute per IP (in memory, like /api/collect).
const reads = new Map<string, { n: number; reset: number }>()
function tooManyReads(req: Request) {
  const ip = ipRateLimitKey(clientIpFrom(req.headers))
  const now = Date.now()
  const r = reads.get(ip)
  if (!r || r.reset < now) {
    if (reads.size > 50_000) reads.clear()
    reads.set(ip, { n: 1, reset: now + 60_000 })
    return false
  }
  return ++r.n > 120
}

// R28 P5: a live page's endpoint design defaults (`crm-defaults`) + its website content, by the live version id
// (published versions are never rewritten: no invalidation).
type LiveDesign = {
  base: Record<string, unknown> | null
  v2: boolean
  content: HtmlDesignContent | undefined
}
const g = globalThis as unknown as { __spaCrmPageDesigns?: LRUCache<string, LiveDesign> }
g.__spaCrmPageDesigns ??= new LRUCache<string, LiveDesign>({ max: 1000 })
const pageDesigns = g.__spaCrmPageDesigns

/** The live (newest published) HtmlDesign of a visible page: its `crm-defaults` and content; null = none. */
async function liveDesignContent(tenant: { id: string }, page: string): Promise<LiveDesign | null> {
  return withTenant(tenant.id, async (tx) => {
    const { rows } = await tx.execute<{ id: string; props: Record<string, unknown> | null }>(sql`
      select v.id, n.node->'props' as props
      from site_pages sp
      join sites s on s.id = sp.site_id and s.tenant_id = ${tenant.id}
      join lateral (
        select pv.id, pv.data from page_versions pv
        where pv.page_id = sp.id and pv.status = 'published'
        order by pv.created_at desc limit 1
      ) v on true
      join lateral (
        select e as node from jsonb_array_elements(
          case when jsonb_typeof(v.data->'content') = 'array' then v.data->'content' else '[]'::jsonb end
        ) e
        where e->>'type' = 'HtmlDesign' limit 1
      ) n on true
      where sp.tenant_id = ${tenant.id} and sp.visible and sp.slug = ${page}
      limit 1`)
    const row = rows[0]
    if (!row?.props) return null
    const key = `${tenant.id}:${row.id}`
    const hit = pageDesigns.get(key)
    if (hit) return hit
    const html = await htmlDesignSource(row.props, spaDocReader(tx, tenant.id))
    const found = html ? designContract(html, designKey(htmlDesignDocOf(row.props)))?.found : null
    const live: LiveDesign = {
      // Literal designs never fetch: their reply stays the CRM alone.
      base: found?.literal ? null : (found?.defaults?.data ?? null),
      v2: found?.version === 2,
      content: row.props.content as HtmlDesignContent | undefined,
    }
    pageDesigns.set(key, live)
    return live
  })
}

async function crmData(req: Request, ctx: SiteParams, head: boolean) {
  if (tooManyReads(req)) return reply(429, { ok: false, error: 'rate_limited' }, { 'retry-after': '60' })
  const { tenant, base } = await siteOf(ctx)
  if (!tenant) return reply(404, { ok: false, error: 'not_found' })
  const params = new URL(req.url).searchParams
  const locale = localeOf(params.get('lang') ?? undefined)
  const origin = siteOriginFrom(req.headers, base)
  // R28 P5: `?page=` (an endpoint design's `{{crm_data_url}}`): that live page's design defaults with its website
  // content, then the CRM. Unknown, hidden or invalid pages and literal designs get the CRM alone (still 200).
  const asked = params.has('page') ? (params.get('page') ?? '') : null
  const page = asked !== null && PAGE_SLUG.test(asked) && !RESERVED_SLUGS.has(asked) ? asked : null
  const design = page !== null ? await liveDesignContent(tenant, page) : null
  const crm = await crmContractFor(tenant, {
    locale,
    formEndpoint: origin ? crmEnquiryEndpoint(origin, design ? (page ?? '') : '', locale) : null,
  })
  const own = design?.base
    ? overlayHtmlContent(
        design.v2 && locale === 'ar' ? contractLocaleData(design.base, 'ar') : design.base,
        design.content,
        { locale, filesOrigin: origin ? new URL(origin).origin : '' },
      )
    : null
  // The CRM alone (no design to merge with): empty collections stay empty.
  const res = reply(200, mergeCrmContract(own, crm, { locale }))
  return head ? new Response(null, { status: 200, headers: res.headers }) : res
}

export const crmDataHandlers = {
  GET: (req: Request, ctx: SiteParams) => crmData(req, ctx, false),
  HEAD: (req: Request, ctx: SiteParams) => crmData(req, ctx, true),
  OPTIONS: () => preflight('GET, HEAD, OPTIONS'),
}

const HONEYPOTS = ['company', 'website', 'url', 'hp'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * `Origin: null` (the sandboxed design) or the site's own origin. Browsers always send Origin on a POST; none (a
 * plain script) or any other origin is refused.
 */
function allowedOrigin(req: Request) {
  const origin = req.headers.get('origin')
  if (origin === null) return false
  if (origin === 'null') return true
  try {
    return new URL(origin).host === (req.headers.get('host') ?? '').toLowerCase()
  } catch {
    return false
  }
}

async function crmEnquiry(req: Request, ctx: SiteParams) {
  // Only a site whose live HTML design uses the contract takes these (no Turnstile: the sandboxed design can't run
  // it); every other spa's inbox stays behind the EnquiryForm's bot check.
  const { tenant } = await siteOf(ctx)
  if (!tenant || !(await siteUsesCrmContract(tenant))) return reply(404, { ok: false, error: 'unavailable' })
  let raw: string
  try {
    raw = await readText(req, DESIGN_ENQUIRY_MAX_BYTES)
  } catch (e) {
    if (e instanceof TooLarge) return reply(413, { ok: false, error: 'too_large' })
    return reply(400, { ok: false, error: 'invalid' })
  }
  const type = (req.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
  if (type !== 'application/json') return reply(415, { ok: false, error: 'unsupported' })
  if (!allowedOrigin(req))
    return new Response(null, { status: 403, headers: { 'cache-control': 'no-store' } })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return reply(400, { ok: false, error: 'invalid' })
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    return reply(400, { ok: false, error: 'invalid' })
  // Bots fill hidden fields: the same answer as a success, nothing stored or counted.
  const b = body as Record<string, unknown>
  if (HONEYPOTS.some((k) => typeof b[k] === 'string' && (b[k] as string).trim()))
    return reply(200, { ok: true })
  const parsed = designEnquirySchema.safeParse(body)
  if (!parsed.success)
    return reply(400, {
      ok: false,
      error: 'invalid',
      fields: [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')))].filter(Boolean),
    })
  if (!acceptsBookings(tenant.status)) return reply(503, { ok: false, error: 'unavailable' })
  // Per IP (production, like the EnquiryForm) and per spa (always: one inbox against rotating IPs).
  const limited = () => reply(429, { ok: false, error: 'rate_limited' }, { 'retry-after': '3600' })
  if (!(await withinIpLimit('site-enquiry', SITE_ENQUIRY_LIMITS))) return limited()
  if (!(await withinRateLimits(platformDb(), 'site-enquiry-tenant', tenant.id, DESIGN_ENQUIRY_TENANT_LIMITS)))
    return limited()
  const q = new URL(req.url).searchParams
  const locale = localeOf(q.get('lang') ?? undefined)
  const page = q.get('page') ?? ''
  const d = parsed.data
  // Names from the CRM, never the client's: a website service / an opted-in staff member, else the typed text.
  const { service, person } = await withTenant(tenant.id, async (tx) => {
    const svc =
      d.service_id && UUID.test(d.service_id)
        ? (await websiteServices(tx, tenant.id)).find((s) => s.id === d.service_id)
        : undefined
    const who =
      d.staff_id && UUID.test(d.staff_id)
        ? (await websiteStaff(tx)).find((s) => s.id === d.staff_id)
        : undefined
    return { service: svc, person: who }
  })
  const serviceName = service
    ? (locale === 'ar' && service.name.ar?.trim()) || service.name.en
    : d.service_name || d.service_id || ''
  await recordSiteEnquiry(
    tenant,
    {
      name: d.name,
      phone: d.phone,
      message: d.notes,
      locale,
      page: /^$|^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page) ? page : '',
      booking: {
        service: serviceName.slice(0, 120),
        serviceId: service?.id ?? null,
        durationMin: d.duration_minutes,
        date: d.date,
        time: d.time,
        guests: d.guests,
        staff: person?.name ?? null,
        staffId: person?.id ?? null,
      },
    },
    clientIpFrom(req.headers),
  )
  return reply(201, { ok: true })
}

export const crmEnquiryHandlers = {
  POST: (req: Request, ctx: SiteParams) => crmEnquiry(req, ctx),
  OPTIONS: () => preflight('POST, OPTIONS'),
}

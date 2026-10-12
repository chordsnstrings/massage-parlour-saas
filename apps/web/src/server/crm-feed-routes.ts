// R26: the public JSON endpoints of the HTML design data contract on a spa's site (docs/design/html-crm-contract.md):
// `{site}/crm-data.json` (the contract, for designs that fetch it) and `{site}/crm-enquiry` (the design's booking form
// → a website enquiry in the CRM inbox). `{site}` = `{slug}.{platform root}`, the spa's own domain, or `/s/{slug}`
// under path routing; the proxy rewrites them here with the API headers (never redirected for POST / OPTIONS).
// Designs run sandboxed (opaque origin): their requests carry `Origin: null`.
import { clientIpFrom, ipRateLimitKey, mergeCrmContract } from '@spa/core'
import { platformDb, withTenant } from '@spa/db'
import {
  DESIGN_ENQUIRY_MAX_BYTES,
  DESIGN_ENQUIRY_TENANT_LIMITS,
  designEnquirySchema,
  SITE_ENQUIRY_LIMITS,
  websiteServices,
  websiteStaff,
  withinRateLimits,
} from '@spa/services'
import { acceptsBookings } from '@/components/booking/data'
import { crmContractFor, crmEnquiryEndpoint } from '@/components/site/crm-feed'
import { localeOf } from '@/components/site/data'
import { PATH_ROUTING } from '@/lib/paths'
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

async function crmData(req: Request, ctx: SiteParams, head: boolean) {
  if (tooManyReads(req)) return reply(429, { ok: false, error: 'rate_limited' }, { 'retry-after': '60' })
  const { tenant, base } = await siteOf(ctx)
  if (!tenant) return reply(404, { ok: false, error: 'not_found' })
  const locale = localeOf(new URL(req.url).searchParams.get('lang') ?? undefined)
  const origin = siteOriginFrom(req.headers, base)
  const crm = await crmContractFor(tenant, {
    locale,
    formEndpoint: origin ? crmEnquiryEndpoint(origin, '', locale) : null,
  })
  // The CRM alone (no design to merge with): empty collections stay empty.
  const res = reply(200, mergeCrmContract(null, crm))
  return head ? new Response(null, { status: 200, headers: res.headers }) : res
}

export const crmDataHandlers = {
  GET: (req: Request, ctx: SiteParams) => crmData(req, ctx, false),
  HEAD: (req: Request, ctx: SiteParams) => crmData(req, ctx, true),
  OPTIONS: () => preflight('GET, HEAD, OPTIONS'),
}

const HONEYPOTS = ['company', 'website', 'url', 'hp'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** `Origin: null` (the sandboxed design), the site's own origin, or none (not a browser); anything else is refused. */
function allowedOrigin(req: Request) {
  const origin = req.headers.get('origin')
  if (origin === null || origin === 'null') return true
  try {
    return new URL(origin).host === (req.headers.get('host') ?? '').toLowerCase()
  } catch {
    return false
  }
}

async function crmEnquiry(req: Request, ctx: SiteParams) {
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
  const { tenant } = await siteOf(ctx)
  if (!tenant) return reply(404, { ok: false, error: 'unavailable' })
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

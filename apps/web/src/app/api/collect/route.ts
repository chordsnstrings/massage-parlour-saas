import { createHmac } from 'node:crypto'
import { clientIpFrom, ipRateLimitKey, webEntrySource } from '@spa/core'
import { platformDb, webEvents } from '@spa/db'
import { z } from 'zod'
import { resolveSiteTenant } from '@/server/sites'

const TYPES = [
  'pageview',
  'block_view',
  'click',
  'wa_click',
  'ig_click',
  'booking_start',
  'booking_complete',
] as const
const Body = z.object({
  site: z.string().min(1).max(253),
  type: z.enum(TYPES),
  path: z.string().max(300),
  referrer: z.string().max(500).nullish(),
  utm: z.record(z.string(), z.string().max(60)).optional(),
  w: z.number().optional(),
  blockId: z.string().max(80).nullish(),
  blockType: z.string().max(60).nullish(),
  element: z.string().max(80).nullish(),
})

const hits = new Map<string, { n: number; reset: number }>()
const limited = (ip: string) => {
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || h.reset < now) {
    hits.set(ip, { n: 1, reset: now + 60_000 })
    if (hits.size > 50_000) hits.clear()
    return false
  }
  h.n++
  return h.n > 240
}

/** Public, cookieless analytics ingest. Sessions are a daily-salted hash — no IP or cookie is stored. */
export async function POST(req: Request) {
  const raw = await req.text()
  if (raw.length > 4096) return new Response(null, { status: 413 })
  const ip = clientIpFrom(req.headers) ?? '0.0.0.0'
  if (limited(ipRateLimitKey(ip))) return new Response(null, { status: 429 })
  let parsed: z.infer<typeof Body>
  try {
    parsed = Body.parse(JSON.parse(raw))
  } catch {
    return new Response(null, { status: 400 })
  }
  const tenant = await resolveSiteTenant(
    parsed.site.includes('.') ? { hostname: parsed.site } : { slug: parsed.site },
  )
  if (!tenant) return new Response(null, { status: 204 })
  const ua = req.headers.get('user-agent') ?? ''
  const day = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10)
  const salt = createHmac('sha256', process.env.BETTER_AUTH_SECRET ?? 'salt')
    .update(day)
    .digest('hex')
  const sessionHash = createHmac('sha256', salt).update(`${tenant.id}|${ip}|${ua}`).digest('hex').slice(0, 32)
  const device = /tablet|ipad/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : 'desktop'
  await platformDb()
    .insert(webEvents)
    .values({
      tenantId: tenant.id,
      sessionHash,
      type: parsed.type,
      // F15: a voucher check page's token stays out of analytics (`/voucher/{token}` → `/voucher`).
      path:
        parsed.path
          .replace(new RegExp(`^/s/${parsed.site.replace(/[^a-z0-9-]/g, '')}(?=/|$)`), '')
          .replace(/\/voucher\/[^/?#]+/, '/voucher') || '/',
      blockId: parsed.blockId ?? null,
      blockType: parsed.blockType ?? null,
      element: parsed.element ?? null,
      referrer: parsed.referrer?.slice(0, 300) ?? null,
      source: webEntrySource(parsed.utm, parsed.referrer),
      utm: parsed.utm ?? null,
      device,
      country: req.headers.get('cf-ipcountry') ?? null,
    })
    .catch((e) => console.error('collect failed', e))
  return new Response(null, { status: 204 })
}

import { clientIpFrom, ipRateLimitKey, parseCspReports } from '@spa/core'
import { platformDb } from '@spa/db'
import { cspSurfaceOf, recordCspViolations } from '@spa/services'

// F10: browsers POST Content-Security-Policy violations here (`report-uri` in every page's CSP, ?s=surface). Logged
// and counted per day (console → Server health "Content-Security-Policy"), so a policy that breaks production shows.
// Public and unauthenticated: per-IP limit, small bodies, only directive + blocked origin + path are kept.

const MAX_BODY = 16_000
const PER_MINUTE = 30
const hits = new Map<string, { n: number; reset: number }>()
const limited = (ip: string) => {
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || h.reset < now) {
    if (hits.size > 10_000) hits.clear()
    hits.set(ip, { n: 1, reset: now + 60_000 })
    return false
  }
  return ++h.n > PER_MINUTE
}

export async function POST(req: Request) {
  const ip = ipRateLimitKey(clientIpFrom(req.headers))
  if (limited(ip)) return new Response(null, { status: 429 })
  const raw = await req.text()
  if (raw.length > MAX_BODY) return new Response(null, { status: 413 })
  let body: unknown = null
  try {
    body = JSON.parse(raw)
  } catch {
    return new Response(null, { status: 400 })
  }
  const violations = parseCspReports(body)
  if (!violations.length) return new Response(null, { status: 204 })
  const surface = cspSurfaceOf(new URL(req.url).searchParams.get('s'))
  for (const v of violations)
    console.warn(`[csp] ${surface} ${v.directive} blocked ${v.blocked}${v.path ? ` on ${v.path}` : ''}`)
  try {
    await recordCspViolations(platformDb(), surface, violations)
  } catch (e) {
    console.error('[csp] could not record violation', e instanceof Error ? e.message : e)
  }
  return new Response(null, { status: 204 })
}

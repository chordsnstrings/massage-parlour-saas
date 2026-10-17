import { clientIpFrom, ipRateLimitKey, reportError } from '@spa/core'
import { z } from 'zod'

const Body = z.object({
  message: z.string().max(2000),
  stack: z.string().max(8000).optional(),
  digest: z.string().max(200).optional(),
  url: z.string().max(500).optional(),
})

const hits = new Map<string, { n: number; reset: number }>()
const limited = (ip: string) => {
  const now = Date.now()
  const h = hits.get(ip)
  if (!h || h.reset < now) {
    if (hits.size > 10_000) hits.clear()
    hits.set(ip, { n: 1, reset: now + 60_000 })
    return false
  }
  return ++h.n > 20
}

/** Browser error-boundary reports, forwarded server-side so the DSN and CSP stay simple. */
export async function POST(req: Request) {
  const raw = await req.text()
  if (raw.length > 12_000) return new Response(null, { status: 413 })
  if (limited(ipRateLimitKey(clientIpFrom(req.headers)))) return new Response(null, { status: 429 })
  const parsed = Body.safeParse(
    (() => {
      try {
        return JSON.parse(raw)
      } catch {
        return null
      }
    })(),
  )
  if (!parsed.success) return new Response(null, { status: 400 })
  const err = Object.assign(new Error(parsed.data.message), {
    stack: parsed.data.stack,
    digest: parsed.data.digest,
  })
  await reportError(process.env.SENTRY_DSN, err, {
    source: 'web-client',
    environment: process.env.NODE_ENV,
    release: process.env.APP_RELEASE,
    request: { url: parsed.data.url },
    tags: { userAgent: req.headers.get('user-agent')?.slice(0, 200) ?? undefined },
  })
  return new Response(null, { status: 204 })
}

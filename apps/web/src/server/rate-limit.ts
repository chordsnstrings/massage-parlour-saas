// Per-IP limits for public server actions that Better Auth's HTTP limiter never sees (it only covers /api/auth/*).
import { platformDb } from '@spa/db'
import { hitRateLimit } from '@spa/services'
import { headers } from 'next/headers'

/** The visitor's IP, read like Better Auth's `ipAddressHeaders` (packages/auth). */
export async function clientIp() {
  const h = await headers()
  return (
    h.get('cf-connecting-ip') ??
    h.get('do-connecting-ip') ??
    h.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}

/** Same switch as Better Auth's limiter: production only, `AUTH_RATE_LIMIT=off` for e2e on a production build. */
const enabled = () => process.env.NODE_ENV === 'production' && process.env.AUTH_RATE_LIMIT !== 'off'

/**
 * Counts one hit per window for the visitor's IP and returns false once any window is over its limit.
 * `windows`: [max hits, window in seconds] pairs, e.g. 5 an hour and 20 a day.
 */
export async function withinIpLimit(scope: string, windows: [max: number, seconds: number][]) {
  if (!enabled()) return true
  const ip = await clientIp()
  const db = platformDb()
  let ok = true
  for (const [max, seconds] of windows)
    if (!(await hitRateLimit(db, `${scope}:${seconds}:${ip}`, max, seconds)).allowed) ok = false
  return ok
}

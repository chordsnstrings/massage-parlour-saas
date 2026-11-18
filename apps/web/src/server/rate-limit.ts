// Per-IP limits for public server actions that Better Auth's HTTP limiter never sees (it only covers /api/auth/*).
import { clientIpFrom, ipRateLimitKey } from '@spa/core'
import { platformDb } from '@spa/db'
import { withinRateLimits } from '@spa/services'
import { headers } from 'next/headers'

/** The visitor's IP (null without one): the header Caddy sets, read only through @spa/core `clientIpFrom` (F26). */
export async function clientIp() {
  return clientIpFrom(await headers())
}

/** Same switch as Better Auth's limiter: production only, `AUTH_RATE_LIMIT=off` for e2e on a production build. */
const enabled = () => process.env.NODE_ENV === 'production' && process.env.AUTH_RATE_LIMIT !== 'off'

/**
 * Counts one hit per window for the visitor's IP (IPv6 by /64, `ipRateLimitKey`) and returns false once any window
 * is over its limit. `windows`: [max hits, window in seconds] pairs, e.g. 5 an hour and 20 a day.
 */
export async function withinIpLimit(
  scope: string,
  windows: readonly (readonly [max: number, seconds: number])[],
) {
  if (!enabled()) return true
  return withinRateLimits(platformDb(), scope, ipRateLimitKey(await clientIp()), windows)
}

// F26 (G6): the visitor's IP for rate limits, audit rows, Turnstile and analytics, from one trusted source.
// In production Caddy (deploy/droplet/Caddyfile) overwrites Cf-Connecting-Ip on every proxied request with the
// client IP it resolved: Cloudflare's header when the TCP peer is a Cloudflare edge address, else the peer itself
// (grey-cloud hosts, spa custom domains, anyone hitting the droplet directly). X-Forwarded-For's first entry is
// written by the client behind Cloudflare, and Do-Connecting-Ip / X-Real-Ip / True-Client-Ip are not ours, so the
// app reads nothing else: every caller goes through `clientIpFrom` (test/client-ip.test.ts enforces it).

/** The only request header the app takes the client IP from (Better Auth's `ipAddressHeaders` too). */
export const CLIENT_IP_HEADER = 'cf-connecting-ip'

const V4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/
const HEX = /^[0-9a-f]{1,4}$/

export const isIpv4 = (s: string) => V4.test(s)

/** The 8 groups of an IPv6 address (embedded IPv4 tail allowed, no zone id), or null when it isn't one. */
function ipv6Groups(input: string): number[] | null {
  if (input.length > 45 || !input.includes(':')) return null
  let s = input.toLowerCase()
  let tail: number[] = []
  if (s.includes('.')) {
    const at = s.lastIndexOf(':')
    const v4 = s.slice(at + 1)
    if (!isIpv4(v4)) return null
    const [a = 0, b = 0, c = 0, d = 0] = v4.split('.').map(Number)
    tail = [(a << 8) | b, (c << 8) | d]
    s = s.slice(0, at + 1)
    if (!s.endsWith('::')) s = s.slice(0, -1)
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const parts = (h: string) => (h === '' ? [] : h.split(':'))
  const left = parts(halves[0] ?? '')
  const right = halves.length === 2 ? parts(halves[1] ?? '') : []
  if (![...left, ...right].every((g) => HEX.test(g))) return null
  const n = left.length + right.length + tail.length
  if (halves.length === 1 ? n !== 8 : n > 7) return null
  const nums = (a: string[]) => a.map((g) => Number.parseInt(g, 16))
  return [...nums(left), ...Array<number>(8 - n).fill(0), ...nums(right), ...tail]
}

export const isIpv6 = (s: string) => ipv6Groups(s) !== null
export const isIp = (s: string) => isIpv4(s) || isIpv6(s)

type HeaderSource = { get(name: string): string | null } | null | undefined

/**
 * The visitor's IP from the request headers, or null when the header is missing or isn't a single IPv4/IPv6
 * address (dev / e2e servers run without Caddy). Never falls back to X-Forwarded-For or any other header.
 */
export function clientIpFrom(headers: HeaderSource): string | null {
  const raw = headers?.get(CLIENT_IP_HEADER)?.trim().toLowerCase()
  return raw && isIp(raw) ? raw : null
}

/**
 * Bucket key for per-IP limits: IPv4 (also IPv4-mapped IPv6) as is, other IPv6 by its /64, since one subscriber
 * usually holds a whole /64 and could rotate addresses inside it. Same rule as Better Auth's limiter
 * (`ipv6Subnet: 64`). No IP shares one 'unknown' bucket.
 */
export function ipRateLimitKey(ip: string | null | undefined): string {
  if (!ip) return 'unknown'
  if (isIpv4(ip)) return ip
  const g = ipv6Groups(ip)
  if (!g) return 'unknown'
  const [g6 = 0, g7 = 0] = g.slice(6)
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
    return `${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`
  return `${g
    .slice(0, 4)
    .map((x) => x.toString(16))
    .join(':')}::/64`
}

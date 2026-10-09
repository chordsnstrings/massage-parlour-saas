// Short-lived per-tenant bearer tokens for the first-party meta MCP server (HMAC-SHA256, 5 minutes).
import { createHmac, timingSafeEqual } from 'node:crypto'

export type McpTokenClaims = {
  /** Tenant id. */
  t: string
  /** Agent key (decides the tool allow-list). */
  a: string
  /** Acting staff user (audit), when a person started the run. */
  u?: string
  exp: number
}

export const MCP_TOKEN_TTL_MS = 5 * 60_000

function key(env: Record<string, string | undefined> = process.env) {
  const secret = env.META_MCP_SECRET?.trim() || env.BETTER_AUTH_SECRET?.trim()
  if (!secret) throw new Error('META_MCP_SECRET or BETTER_AUTH_SECRET must be set')
  // Domain-separated from the other BETTER_AUTH_SECRET HMACs (preview links, OAuth state).
  return createHmac('sha256', secret).update('spa:meta-mcp:v1').digest()
}

const sign = (data: string, env?: Record<string, string | undefined>) =>
  createHmac('sha256', key(env)).update(data).digest('base64url')

export function signMcpToken(
  c: { tenantId: string; agentKey: string; userId?: string; ttlMs?: number },
  o: { now?: number; env?: Record<string, string | undefined> } = {},
) {
  const ttl = Math.min(c.ttlMs ?? MCP_TOKEN_TTL_MS, MCP_TOKEN_TTL_MS)
  const claims: McpTokenClaims = {
    t: c.tenantId,
    a: c.agentKey,
    ...(c.userId ? { u: c.userId } : {}),
    exp: (o.now ?? Date.now()) + ttl,
  }
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `mcp1.${body}.${sign(body, o.env)}`
}

/** Claims of a valid, unexpired token; null otherwise. */
export function verifyMcpToken(
  token: string | null | undefined,
  o: { now?: number; env?: Record<string, string | undefined> } = {},
): McpTokenClaims | null {
  const [v, body, mac] = (token ?? '').split('.')
  if (v !== 'mcp1' || !body || !mac) return null
  const want = Buffer.from(sign(body, o.env))
  const got = Buffer.from(mac)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const c = JSON.parse(Buffer.from(body, 'base64url').toString()) as McpTokenClaims
    if (typeof c.t !== 'string' || typeof c.a !== 'string' || typeof c.exp !== 'number') return null
    if (c.exp <= (o.now ?? Date.now()) || c.exp > (o.now ?? Date.now()) + MCP_TOKEN_TTL_MS) return null
    return c
  } catch {
    return null
  }
}

export const bearerOf = (req: Request) => {
  const h = req.headers.get('authorization') ?? ''
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : null
}

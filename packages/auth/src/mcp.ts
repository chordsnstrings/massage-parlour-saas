// AI assistant MCP connector (Claude or ChatGPT; site editing over MCP, /api/mcp): OAuth resource, page locations and
// allowed callbacks shared by the auth config, the consent page, the MCP route and the console card.

/** The custom scope the assistant is granted (MCP site editing; drafts only). */
export const MCP_SCOPE = 'sites:edit'

const canonical = () => new URL(process.env.APP_URL ?? 'http://app.localhost:3000')

/**
 * The MCP server's canonical resource URL (RFC 8707/9728): access tokens are audience-bound to it. Always on the
 * canonical app host. Dev/e2e `*.localhost` app hosts use plain `localhost` (OAuth allows http only on loopback).
 */
export function mcpResourceUrl(): string {
  const url = canonical()
  if (url.protocol === 'http:' && url.hostname.endsWith('.localhost')) url.hostname = 'localhost'
  return `${url.origin}/api/mcp`
}

/** RFC 9728 metadata URL advertised in the 401 challenge (path-inserted form of the resource). */
export const mcpResourceMetadataUrl = () => {
  const r = new URL(mcpResourceUrl())
  return `${r.origin}/.well-known/oauth-protected-resource${r.pathname}`
}

/** Sign-in and consent pages on the app surface (path routing prefixes /app). */
export function mcpOAuthPages() {
  const base = process.env.NEXT_PUBLIC_ROUTING === 'path' ? '/app' : ''
  return { loginPage: `${base}/login`, consentPage: `${base}/oauth/consent` }
}

/**
 * Where an authorization code may be sent: the AI assistants' connector callbacks (Claude + ChatGPT). Registration
 * (/oauth2/register) and every authorize request are held to them, so a client registered by anyone can only ever
 * send codes (and authorize errors) back to Claude or ChatGPT. MCP_REDIRECT_URIS (comma-separated, exact URLs)
 * replaces all built-in callbacks, the ChatGPT per-connector pattern included.
 */
export const CLAUDE_MCP_CALLBACKS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
] as const

/** ChatGPT's stable connector callback (used because every authorize response carries `iss`, RFC 9207). */
export const CHATGPT_MCP_CALLBACK = 'https://chatgpt.com/connector_platform_oauth_redirect'

/**
 * ChatGPT's per-connector fallback callback `https://chatgpt.com/connector/oauth/{callback_id}`, matched on the raw
 * string: https, host exactly chatgpt.com, no userinfo / port / query / fragment, no percent-encoding or dot segments.
 */
const CHATGPT_CONNECTOR_CALLBACK = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/

const listedRedirectUris = () =>
  (process.env.MCP_REDIRECT_URIS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

/** The exact callbacks: MCP_REDIRECT_URIS when set, else Claude's + ChatGPT's stable one. */
export function mcpRedirectUris(): string[] {
  const listed = listedRedirectUris()
  return listed.length ? listed : [...CLAUDE_MCP_CALLBACKS, CHATGPT_MCP_CALLBACK]
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * True for an exact mcpRedirectUris() entry, a ChatGPT per-connector callback (unless MCP_REDIRECT_URIS is set) — and,
 * only while APP_URL is plain http (dev / e2e), for loopback http callbacks (e.g. the MCP Inspector).
 */
export function isAllowedMcpRedirectUri(uri: unknown): boolean {
  if (typeof uri !== 'string' || uri.length > 512) return false
  if (mcpRedirectUris().includes(uri)) return true
  if (!listedRedirectUris().length && CHATGPT_CONNECTOR_CALLBACK.test(uri)) return true
  if (canonical().protocol !== 'http:') return false
  try {
    const u = new URL(uri)
    return u.protocol === 'http:' && LOOPBACK.has(u.hostname) && !u.username && !u.password && !u.hash
  } catch {
    return false
  }
}

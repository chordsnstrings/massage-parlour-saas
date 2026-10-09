// Claude MCP connector (site editing over MCP, /api/mcp): OAuth resource + page locations shared by the auth
// config, the MCP route and the console card.

/** The custom scope Claude is granted (MCP site editing; drafts only). */
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
 * Where an authorization code may be sent: Claude's connector callbacks. MCP_REDIRECT_URIS (comma-separated, exact
 * URLs) replaces the list. Registration (/oauth2/register) and every authorize request are held to it, so a client
 * registered by anyone can only ever send codes (and authorize errors) back to Claude.
 */
export const CLAUDE_MCP_CALLBACKS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
] as const

export function mcpRedirectUris(): string[] {
  const listed = (process.env.MCP_REDIRECT_URIS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return listed.length ? listed : [...CLAUDE_MCP_CALLBACKS]
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * True for an exact mcpRedirectUris() entry — and, only while APP_URL is plain http (dev / e2e), for loopback http
 * callbacks (e.g. the MCP Inspector).
 */
export function isAllowedMcpRedirectUri(uri: unknown): boolean {
  if (typeof uri !== 'string') return false
  if (mcpRedirectUris().includes(uri)) return true
  if (canonical().protocol !== 'http:') return false
  try {
    const u = new URL(uri)
    return u.protocol === 'http:' && LOOPBACK.has(u.hostname) && !u.username && !u.password && !u.hash
  } catch {
    return false
  }
}

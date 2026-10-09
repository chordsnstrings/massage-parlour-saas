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

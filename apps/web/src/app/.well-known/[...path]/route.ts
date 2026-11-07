import { getAuth } from '@spa/auth'

// OAuth discovery for the Claude MCP connector (/api/mcp), served by Better Auth's MCP provider plugin:
// RFC 9728 protected-resource metadata (/.well-known/oauth-protected-resource[/api/mcp]) and RFC 8414 / OIDC
// authorization-server metadata (/.well-known/oauth-authorization-server[/api/auth], openid-configuration).
// Every other /.well-known path is a 404 (the proxy doesn't rewrite /.well-known/*).
export const dynamic = 'force-dynamic'

const OAUTH =
  /^\/\.well-known\/(?:oauth-protected-resource|oauth-authorization-server|openid-configuration)(?:\/|$)/

async function handle(req: Request) {
  if (!OAUTH.test(new URL(req.url).pathname)) return new Response('Not found', { status: 404 })
  return getAuth().handler(req)
}

export { handle as GET, handle as HEAD }

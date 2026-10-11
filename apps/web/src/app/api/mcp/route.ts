import { handleSiteMcpRequest } from '@spa/ai'
import { mcpResourceMetadataUrl, verifyMcpAccessToken } from '@spa/auth'
import type { ThemeTokens } from '@spa/db'
import { siteEditSchema } from '@/components/site/ai-schema'
import { normalizeTheme } from '@/components/site/theme'
import { canonicalUrls } from '@/server/origin'

// Claude custom connector: remote MCP (Streamable HTTP, stateless) for editing spa website DRAFTS. OAuth 2.1 via
// Better Auth's MCP provider (discovery under /.well-known, sign-in + consent on the app host); only
// SITE_AI_EDITOR_EMAILS super-admins with 2FA, re-checked on every call (packages/ai mcp/site-server.ts).
export const dynamic = 'force-dynamic'

async function handle(req: Request) {
  return handleSiteMcpRequest(req, {
    verifyToken: (token) => verifyMcpAccessToken(token),
    schema: siteEditSchema(),
    normalizeTheme: (t) => normalizeTheme(t) as unknown as ThemeTokens,
    resourceMetadataUrl: mcpResourceMetadataUrl(),
    appUrl: (path) => canonicalUrls().app(path),
    adminUrl: (path) => canonicalUrls().admin(path),
    previewSecret: process.env.BETTER_AUTH_SECRET,
  })
}

export { handle as DELETE, handle as GET, handle as POST }

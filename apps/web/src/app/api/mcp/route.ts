import { handleSiteMcpRequest, type McpTemplate } from '@spa/ai'
import { mcpResourceMetadataUrl, verifyMcpAccessToken } from '@spa/auth'
import type { ThemeTokens } from '@spa/db'
import { siteEditSchema } from '@/components/site/ai-schema'
import { DESIGN_TEMPLATE_KEYS } from '@/components/site/templates'
import { normalizeTheme } from '@/components/site/theme'
import { designFileUrl } from '@/server/html-design-files'
import { canonicalUrls } from '@/server/origin'
import { templateCatalog } from '@/server/site-templates'

// Claude custom connector: remote MCP (Streamable HTTP, stateless) for editing spa website DRAFTS. OAuth 2.1 via
// Better Auth's MCP provider (discovery under /.well-known, sign-in + consent on the app host); only
// SITE_AI_EDITOR_EMAILS super-admins with 2FA, re-checked on every call (packages/ai mcp/site-server.ts).
export const dynamic = 'force-dynamic'

/** R24: the console's template catalogue with each template's kind and console preview. */
async function templates(): Promise<McpTemplate[]> {
  return (await templateCatalog()).map((t) => {
    const html = t.pages.some(
      (p) => (p.data.root as { props?: { htmlDesign?: unknown } } | undefined)?.props?.htmlDesign === true,
    )
    const kind =
      t.source === 'studio'
        ? html
          ? 'html'
          : 'studio'
        : DESIGN_TEMPLATE_KEYS.has(t.key)
          ? 'design'
          : 'classic'
    return {
      ...t,
      kind,
      previewUrl: canonicalUrls().admin(`/templates/${t.source === 'studio' && t.id ? t.id : t.key}/preview`),
    }
  })
}

/** Playwright only (never in deploy env): the local fixture host exempt from add_image's SSRF rules. */
const e2eAllow = () =>
  (process.env.SITE_IMPORT_E2E_ALLOW ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

async function handle(req: Request) {
  return handleSiteMcpRequest(req, {
    verifyToken: (token) => verifyMcpAccessToken(token),
    schema: siteEditSchema(),
    normalizeTheme: (t) => normalizeTheme(t) as unknown as ThemeTokens,
    resourceMetadataUrl: mcpResourceMetadataUrl(),
    appUrl: (path) => canonicalUrls().app(path),
    adminUrl: (path) => canonicalUrls().admin(path),
    previewSecret: process.env.BETTER_AUTH_SECRET,
    templates,
    fileUrl: designFileUrl,
    imageFetch: { allow: e2eAllow() },
  })
}

export { handle as DELETE, handle as GET, handle as POST }

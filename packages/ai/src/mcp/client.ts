// MCP client side (R7): connects to the first-party meta server (in-process by default, or META_MCP_URL) and to an
// optional external Meta MCP server set by the super-admin, and turns their tools into OpenAI-compatible tool defs.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { platformDb, platformSettings, tenants } from '@spa/db'
import { appOrigin, decryptSecret } from '@spa/services'
import { eq } from 'drizzle-orm'
import type { ToolDef } from '../modelark'
import { handleMetaMcpRequest, type MetaServerOpts } from './meta-server'
import { signMcpToken } from './token'
import { AGENT_META_TOOLS, allowExternalTool, functionName, groupOn, isForbiddenTool } from './tools'

export type McpTool = { name: string; fnName: string; def: ToolDef }
export type McpToolSource = {
  label: string
  tools: McpTool[]
  call: (name: string, args: Record<string, unknown>) => Promise<string>
  close: () => Promise<void>
}

type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>

/** Connects to one Streamable HTTP MCP server and keeps the tools `allow` accepts (never a forbidden one). */
export async function connectMcpSource(o: {
  url: string
  label: string
  headers?: Record<string, string>
  fetch?: FetchLike
  prefix?: string
  allow?: (t: { name: string; description?: string; inputSchema?: unknown }) => boolean
}): Promise<McpToolSource> {
  const client = new Client({ name: 'spa-ai', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(o.url), {
    requestInit: { headers: o.headers },
    fetch: o.fetch,
  })
  await client.connect(transport)
  const listed = await client.listTools()
  const tools = listed.tools
    .filter((t) => !isForbiddenTool(t) && (o.allow ? o.allow(t) : true))
    .map(
      (t): McpTool => ({
        name: t.name,
        fnName: functionName(t.name, o.prefix),
        def: {
          type: 'function',
          function: {
            name: functionName(t.name, o.prefix),
            description: (t.description ?? t.name).slice(0, 1000),
            parameters: (t.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
          },
        },
      }),
    )
  const names = new Set(tools.map((t) => t.name))
  return {
    label: o.label,
    tools,
    async call(name, args) {
      // Belt and braces: a tool that was not listed (or got filtered) can't be called by name either.
      if (!names.has(name)) return JSON.stringify({ error: `tool ${name} is not available` })
      const res = await client.callTool({ name, arguments: args })
      const parts = (res.content as { type: string; text?: string }[] | undefined) ?? []
      const out = parts
        .filter((p) => p.type === 'text')
        .map((p) => p.text ?? '')
        .join('\n')
        .slice(0, 8000)
      return res.isError ? JSON.stringify({ error: out || 'tool failed' }) : out
    },
    close: () => client.close(),
  }
}

export const metaMcpUrl = (env: Record<string, string | undefined> = process.env) =>
  env.META_MCP_URL?.trim() || `${appOrigin(env)}/api/mcp/meta`

/** The external Meta MCP server config (super-admin AI settings), or null when off. */
export async function externalMetaMcpConfig(db = platformDb()) {
  const [row] = await db
    .select({
      enabled: platformSettings.metaMcpEnabled,
      url: platformSettings.metaMcpUrl,
      keyEnc: platformSettings.metaMcpKeyEnc,
      tools: platformSettings.metaMcpTools,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, 1))
  if (!row?.enabled || !row.url) return null
  let key: string | null = null
  try {
    key = row.keyEnc ? decryptSecret(row.keyEnc) : null
  } catch {
    key = null
  }
  return { url: row.url, key, tools: row.tools }
}

/**
 * The MCP tool sources for one agent run: the first-party meta server (signed 5-minute token; in-process unless
 * META_MCP_URL is set) plus the external server when configured and switched on for this spa.
 * Connection problems are logged and skipped — the agent then runs without those tools.
 */
export async function metaMcpSources(o: {
  tenantId: string
  agentKey: string
  userId?: string
  /** Overrides the transport (tests); default = in-process handler, or real fetch with META_MCP_URL. */
  fetch?: FetchLike
  server?: MetaServerOpts
  externalFetch?: FetchLike
  env?: Record<string, string | undefined>
}): Promise<McpToolSource[]> {
  const env = o.env ?? process.env
  const token = signMcpToken({ tenantId: o.tenantId, agentKey: o.agentKey, userId: o.userId }, { env })
  const inProcess: FetchLike = (url, init) => handleMetaMcpRequest(new Request(url, init), o.server)
  const sources: McpToolSource[] = []
  try {
    sources.push(
      await connectMcpSource({
        url: metaMcpUrl(env),
        label: 'meta',
        headers: { Authorization: `Bearer ${token}` },
        fetch: o.fetch ?? (env.META_MCP_URL ? undefined : inProcess),
      }),
    )
  } catch (e) {
    console.error('meta mcp connect failed', e instanceof Error ? e.message : e)
  }
  const platform = o.server?.platform ?? platformDb()
  const ext = (AGENT_META_TOOLS[o.agentKey] ?? []).includes('external')
    ? await externalMetaMcpConfig(platform)
    : null
  if (ext) {
    const [tenant] = await platform
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, o.tenantId))
    const groups = tenant?.settings.metaMcp?.groups
    if (!groupOn(groups, 'external')) return sources
    try {
      const source = await connectMcpSource({
        url: ext.url,
        label: 'external',
        prefix: 'ext',
        headers: ext.key ? { Authorization: `Bearer ${ext.key}` } : undefined,
        fetch: o.externalFetch,
        allow: (t) => allowExternalTool(t, { agentKey: o.agentKey, adminAllow: ext.tools, groups }),
      })
      if (source.tools.length) sources.push(source)
      else await source.close()
    } catch (e) {
      console.error('external meta mcp connect failed', e instanceof Error ? e.message : e)
    }
  }
  return sources
}

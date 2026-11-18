// R7 Meta MCP tool registry: names, groups, per-agent allow-lists and the WhatsApp no-send filter (pure).

export const META_TOOL_GROUPS = [
  'instagram_inbox',
  'instagram_posts',
  'facebook_page',
  'whatsapp',
  'external',
] as const
export type MetaToolGroup = (typeof META_TOOL_GROUPS)[number]

/** Groups that are on until the spa switches them off (external servers are opt-in). */
export const DEFAULT_GROUPS: Record<MetaToolGroup, boolean> = {
  instagram_inbox: true,
  instagram_posts: true,
  facebook_page: true,
  whatsapp: true,
  external: false,
}

type ToolSpec = {
  group: Exclude<MetaToolGroup, 'external'>
  /** Changes something (audited). */
  writes: boolean
  /** Needs a live Meta connection (Graph call), not just our own data. */
  needs?: 'instagram' | 'facebook'
  /** Only exposed when the spa allows autopilot (public replies go out without approval). */
  autopilotOnly?: boolean
}

/** First-party tools served by /api/mcp/meta. There is no WhatsApp send tool, by design (R7 decision). */
export const META_TOOLS = {
  'instagram.list_comments': { group: 'instagram_inbox', writes: false },
  'instagram.reply_comment': { group: 'instagram_inbox', writes: true },
  'instagram.list_dms': { group: 'instagram_inbox', writes: false },
  'instagram.draft_dm_reply': { group: 'instagram_inbox', writes: true },
  'instagram.create_post_draft': { group: 'instagram_posts', writes: true },
  'instagram.publish_approved_post': { group: 'instagram_posts', writes: true, needs: 'instagram' },
  'facebook_page.list_comments': { group: 'facebook_page', writes: false, needs: 'facebook' },
  'facebook_page.reply_comment': {
    group: 'facebook_page',
    writes: true,
    needs: 'facebook',
    autopilotOnly: true,
  },
  'facebook_page.create_post_draft': { group: 'facebook_page', writes: true, needs: 'facebook' },
  'facebook_page.publish_approved_post': { group: 'facebook_page', writes: true, needs: 'facebook' },
  'whatsapp.read_inbox_summary': { group: 'whatsapp', writes: false },
  'whatsapp.draft_message': { group: 'whatsapp', writes: true },
} as const satisfies Record<string, ToolSpec>
export type MetaToolName = keyof typeof META_TOOLS
export const META_TOOL_NAMES = Object.keys(META_TOOLS) as MetaToolName[]

/** `external` in a list = the agent may also use the super-admin's allow-listed external tools. */
type AgentAllow = (MetaToolName | 'external')[]

/** Per-agent allow-list: an agent only ever sees these tools, whatever the server offers. */
export const AGENT_META_TOOLS: Record<string, AgentAllow> = {
  dm_agent: ['instagram.list_dms'],
  comment_agent: [
    'instagram.list_comments',
    'instagram.reply_comment',
    'facebook_page.list_comments',
    'facebook_page.reply_comment',
  ],
  content_agent: [
    'instagram.list_comments',
    'instagram.create_post_draft',
    'facebook_page.create_post_draft',
  ],
  slot_filler: ['whatsapp.read_inbox_summary', 'whatsapp.draft_message'],
  meta_agent: [...META_TOOL_NAMES, 'external'],
}

const SEND_WORDS =
  /(send|deliver|reply|respond|post|publish|broadcast|dispatch|forward|push|notify|message_create|create_message)/
const WHATSAPP = /(whats\s*app|^wa[._-]|[._-]wa[._-]|wa_?business|wa_?cloud)/

/**
 * True when a tool could send a WhatsApp message — such tools are never exposed to a model (R7: WhatsApp stays
 * click-to-send). WhatsApp-named tools must be read/list/get/search/summary/draft tools; any tool whose
 * description or input schema mentions WhatsApp and whose name looks like sending is blocked too.
 */
export function isForbiddenTool(t: { name: string; description?: string; inputSchema?: unknown }) {
  const name = t.name.toLowerCase()
  if (WHATSAPP.test(name)) {
    const action = name.replace(/^.*?whats\s*app[._-]?|^wa[._-]/, '')
    if (SEND_WORDS.test(action)) return true
    return !/^(read|list|get|search|summary|draft)/.test(action)
  }
  const context = `${t.description ?? ''} ${JSON.stringify(t.inputSchema ?? {})}`.toLowerCase()
  return /whats\s*app/.test(context) && SEND_WORDS.test(name)
}

export type MetaToolContext = {
  agentKey: string
  groups?: Partial<Record<string, boolean>>
  autopilot?: boolean
  availability: { configured: boolean; instagram: unknown; facebookPage: unknown }
}

export const groupOn = (groups: Partial<Record<string, boolean>> | undefined, g: MetaToolGroup) =>
  groups?.[g] ?? DEFAULT_GROUPS[g]

/** The first-party tools this agent may use for this spa right now (allow-list ∩ spa toggles ∩ connections). */
export function exposedMetaTools(ctx: MetaToolContext): MetaToolName[] {
  const allow = new Set<string>(AGENT_META_TOOLS[ctx.agentKey] ?? [])
  return META_TOOL_NAMES.filter((name) => {
    const spec: ToolSpec = META_TOOLS[name]
    if (!allow.has(name) || !groupOn(ctx.groups, spec.group)) return false
    if (isForbiddenTool({ name })) return false
    if (spec.autopilotOnly && !ctx.autopilot) return false
    if (spec.needs === 'instagram') return ctx.availability.configured && Boolean(ctx.availability.instagram)
    if (spec.needs === 'facebook') return Boolean(ctx.availability.facebookPage)
    return true
  })
}

/** External tools an agent may use: agent allows `external`, spa switched the group on, name allow-listed, not forbidden. */
export function allowExternalTool(
  t: { name: string; description?: string; inputSchema?: unknown },
  o: { agentKey: string; adminAllow: string[]; groups?: Partial<Record<string, boolean>> },
) {
  if (!(AGENT_META_TOOLS[o.agentKey] ?? []).includes('external')) return false
  if (!groupOn(o.groups, 'external')) return false
  if (!o.adminAllow.includes(t.name)) return false
  return !isForbiddenTool(t)
}

/** OpenAI-compatible function names allow [a-zA-Z0-9_-] only (≤ 64): `instagram.list_comments` → `instagram__list_comments`. */
export const functionName = (mcpName: string, prefix?: string) =>
  `${prefix ? `${prefix}__` : ''}${mcpName.replace(/[^a-zA-Z0-9_-]/g, '__')}`.slice(0, 64)

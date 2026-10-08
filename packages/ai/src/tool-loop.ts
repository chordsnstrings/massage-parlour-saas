// Shared tool loop over runChat (OpenAI-compatible tool calls): local tools (e.g. the DM agent's booking tools) and MCP
// tool sources (R7). Every model call goes through runChat, so config lookup, budget and ai_usage metering apply per step.

import type { Db } from '@spa/db'
import { runChat } from './gateway'
import type { McpToolSource } from './mcp/client'
import type { ChatMessage, ModelArkClient, ToolDef } from './modelark'

export type LocalTool = { def: ToolDef; run: (args: Record<string, string>) => Promise<unknown> }
export type ToolCallLog = { name: string; source: string; ok: boolean }

export type ToolLoopResult = {
  content: string
  costUsd: number
  calls: ToolCallLog[]
  messages: ChatMessage[]
}

const safeJson = (s: string): Record<string, string> => {
  try {
    const v = JSON.parse(s)
    return v && typeof v === 'object' ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export async function runToolLoop(opts: {
  tenantId: string
  agentKey: string
  messages: ChatMessage[]
  localTools?: LocalTool[]
  sources?: McpToolSource[]
  maxSteps?: number
  temperature?: number
  maxTokens?: number
  client?: ModelArkClient
  db?: Db
}): Promise<ToolLoopResult> {
  const messages = [...opts.messages]
  const local = new Map((opts.localTools ?? []).map((t) => [t.def.function.name, t]))
  const remote = new Map<string, { source: McpToolSource; name: string }>()
  for (const source of opts.sources ?? [])
    for (const t of source.tools)
      if (!local.has(t.fnName) && !remote.has(t.fnName)) remote.set(t.fnName, { source, name: t.name })
  const tools: ToolDef[] = [
    ...[...local.values()].map((t) => t.def),
    ...(opts.sources ?? []).flatMap((s) =>
      s.tools.filter((t) => remote.get(t.fnName)?.source === s).map((t) => t.def),
    ),
  ]
  const result: ToolLoopResult = { content: '', costUsd: 0, calls: [], messages }
  for (let step = 0; step < (opts.maxSteps ?? 6); step++) {
    const res = await runChat({
      tenantId: opts.tenantId,
      agentKey: opts.agentKey,
      messages,
      tools: tools.length ? tools : undefined,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      client: opts.client,
      db: opts.db,
    })
    result.costUsd += res.costUsd
    const calls = res.message.tool_calls ?? []
    if (!calls.length) {
      result.content = (res.message.content ?? '').trim()
      break
    }
    messages.push(res.message)
    for (const call of calls) {
      const name = call.function.name
      const args = safeJson(call.function.arguments)
      let output: string
      let ok = true
      let source = 'local'
      try {
        const l = local.get(name)
        const r = remote.get(name)
        if (l) output = JSON.stringify(await l.run(args))
        else if (r) {
          source = r.source.label
          output = await r.source.call(r.name, args)
          ok = !output.startsWith('{"error"')
        } else {
          ok = false
          output = JSON.stringify({ error: `unknown tool ${name}` })
        }
      } catch (e) {
        ok = false
        console.error('tool call failed', name, e instanceof Error ? e.message : e)
        output = JSON.stringify({ error: 'Something went wrong' })
      }
      result.calls.push({ name, source, ok })
      messages.push({ role: 'tool', tool_call_id: call.id, content: output })
    }
  }
  return result
}

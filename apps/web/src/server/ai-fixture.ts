import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ModelArkClient } from '@spa/ai'

/**
 * E2E only: when `AI_E2E_FIXTURE_DIR` is set (Playwright config, never in deploy env), chat calls answer with the
 * canned reply in `<dir>/<tenant-slug>.json` instead of calling ModelArk. Everything else (config lookup,
 * budget, metering, output validation) still runs through the real gateway.
 */
export function fixtureClient(slug: string): ModelArkClient | undefined {
  const dir = process.env.AI_E2E_FIXTURE_DIR
  if (!dir) return undefined
  const file = path.join(dir, `${slug.replace(/[^a-z0-9-]/gi, '')}.json`)
  return {
    chat: async (req: { messages: { role: string; tool_calls?: unknown[] }[] }) => {
      const raw = await readFile(file, 'utf8')
      return {
        choices: [{ message: fixtureMessage(raw, req.messages), finish_reason: 'stop' }],
        usage: { prompt_tokens: 1200, completion_tokens: 300 },
      }
    },
    image: async () => {
      throw new Error('no image fixtures')
    },
  } as unknown as ModelArkClient
}

/**
 * A fixture `{"__steps": [assistantMessage, …]}` scripts a tool loop (R7 Meta MCP): step n answers the n-th model call
 * of the run (counted by the assistant tool-call turns already in the request). Anything else is the reply text.
 */
function fixtureMessage(raw: string, messages: { role: string; tool_calls?: unknown[] }[]) {
  try {
    const parsed = JSON.parse(raw) as { __steps?: unknown[] }
    if (Array.isArray(parsed.__steps) && parsed.__steps.length) {
      const done = messages.filter((m) => m.role === 'assistant' && m.tool_calls?.length).length
      return parsed.__steps[Math.min(done, parsed.__steps.length - 1)]
    }
  } catch {
    // plain text reply
  }
  return { role: 'assistant', content: raw }
}

export const aiFixturesOn = () => Boolean(process.env.AI_E2E_FIXTURE_DIR)

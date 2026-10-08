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
    chat: async () => ({
      choices: [
        { message: { role: 'assistant', content: await readFile(file, 'utf8') }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1200, completion_tokens: 300 },
    }),
    image: async () => {
      throw new Error('no image fixtures')
    },
  } as unknown as ModelArkClient
}

export const aiFixturesOn = () => Boolean(process.env.AI_E2E_FIXTURE_DIR)

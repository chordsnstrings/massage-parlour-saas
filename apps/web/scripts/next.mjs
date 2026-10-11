// Runs the Next.js CLI with the monorepo root .env loaded (existing env vars win).
// Production containers get env from the orchestrator, so the file is optional.
import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

const file = new URL('../../../.env', import.meta.url)
if (existsSync(file)) {
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}
await import('next/dist/bin/next')

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setEmailSettingsSource, setEmailTransport } from '@spa/core'
import { platformDb } from '@spa/db'
import { cachedEmailSettings } from '@spa/services'

// One cached source per process (globalThis: instrumentation and route bundles are separate module graphs).
const g = globalThis as { __spaEmailCache?: ReturnType<typeof cachedEmailSettings> }

/**
 * sendStaffEmail reads the console-saved Resend key / sender first (platform_settings), then env. Idempotent:
 * called from instrumentation at start and again by the console email actions.
 */
export function registerEmailSettings() {
  g.__spaEmailCache ??= cachedEmailSettings(() => platformDb())
  setEmailSettingsSource(g.__spaEmailCache)
  // E2E only (Playwright config, never in deploy env): messages land as JSON files instead of going to Resend.
  const dir = process.env.EMAIL_E2E_OUTBOX_DIR
  if (dir)
    setEmailTransport(async (m) => {
      await mkdir(dir, { recursive: true })
      const file = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
      const { apiKey, ...rest } = m
      await writeFile(file, JSON.stringify({ ...rest, keyLast4: apiKey.slice(-4) }))
    })
}

export function invalidateEmailSettings() {
  g.__spaEmailCache?.invalidate()
}

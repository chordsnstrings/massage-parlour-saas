// R29 Google + Meta app keys saved in the super-admin console (platform_settings, single row), like the Resend and
// Turnstile keys: secrets are write-only (never returned to the UI, logged or audited; last 4 only), sealed with the
// same helper. Each key resolves on its own: the console value, else its env variable. Every reader (web, worker,
// console health) goes through `integrationEnv()`; googleConfig / metaConfig stay pure and take the resolved record.
import { type Db, platformDb, platformSettings } from '@spa/db'
import { eq } from 'drizzle-orm'
import { openEmailKey, sealEmailKey } from './email-settings'

type Env = Record<string, string | undefined>

/** Shown in the console as entered. */
export const INTEGRATION_PLAIN_KEYS = [
  'GOOGLE_CLIENT_ID',
  'META_APP_ID',
  'META_FB_CONFIG_ID',
  'META_FB_APP_ID',
] as const
/** Write-only: sealed, only the last 4 characters are shown. */
export const INTEGRATION_SECRET_KEYS = [
  'GOOGLE_CLIENT_SECRET',
  'META_APP_SECRET',
  'META_WEBHOOK_VERIFY_TOKEN',
  'META_FB_APP_SECRET',
] as const
export const INTEGRATION_KEYS = [...INTEGRATION_PLAIN_KEYS, ...INTEGRATION_SECRET_KEYS] as const
export type IntegrationPlainKey = (typeof INTEGRATION_PLAIN_KEYS)[number]
export type IntegrationSecretKey = (typeof INTEGRATION_SECRET_KEYS)[number]
export type IntegrationKey = (typeof INTEGRATION_KEYS)[number]
/** Console-saved values (secrets decrypted); null = not set in the console. */
export type IntegrationKeyValues = Record<IntegrationKey, string | null>
export type IntegrationKeySource = 'console' | 'env' | null

const PLAIN = {
  GOOGLE_CLIENT_ID: 'googleClientId',
  META_APP_ID: 'metaAppId',
  META_FB_CONFIG_ID: 'metaFbConfigId',
  META_FB_APP_ID: 'metaFbAppId',
} as const
const SECRET = {
  GOOGLE_CLIENT_SECRET: ['googleClientSecretEnc', 'googleClientSecretLast4'],
  META_APP_SECRET: ['metaAppSecretEnc', 'metaAppSecretLast4'],
  META_WEBHOOK_VERIFY_TOKEN: ['metaWebhookVerifyTokenEnc', 'metaWebhookVerifyTokenLast4'],
  META_FB_APP_SECRET: ['metaFbAppSecretEnc', 'metaFbAppSecretLast4'],
} as const

const COLUMNS = {
  googleClientId: platformSettings.googleClientId,
  googleClientSecretEnc: platformSettings.googleClientSecretEnc,
  googleClientSecretLast4: platformSettings.googleClientSecretLast4,
  metaAppId: platformSettings.metaAppId,
  metaAppSecretEnc: platformSettings.metaAppSecretEnc,
  metaAppSecretLast4: platformSettings.metaAppSecretLast4,
  metaWebhookVerifyTokenEnc: platformSettings.metaWebhookVerifyTokenEnc,
  metaWebhookVerifyTokenLast4: platformSettings.metaWebhookVerifyTokenLast4,
  metaFbConfigId: platformSettings.metaFbConfigId,
  metaFbAppId: platformSettings.metaFbAppId,
  metaFbAppSecretEnc: platformSettings.metaFbAppSecretEnc,
  metaFbAppSecretLast4: platformSettings.metaFbAppSecretLast4,
}
type Row = { [K in keyof typeof COLUMNS]: string | null }

async function readRow(db: Db): Promise<Row | undefined> {
  const [r] = await db.select(COLUMNS).from(platformSettings).where(eq(platformSettings.id, 1))
  return r
}

export type IntegrationKeysStatus = {
  plain: Record<IntegrationPlainKey, string | null>
  secrets: Record<IntegrationSecretKey, { has: boolean; last4: string | null }>
}

/** What the console shows: plain values, and for secrets only whether one is stored + its last 4. */
export async function integrationKeysStatus(db: Db): Promise<IntegrationKeysStatus> {
  const r = await readRow(db)
  const plain = Object.fromEntries(INTEGRATION_PLAIN_KEYS.map((k) => [k, r?.[PLAIN[k]] ?? null]))
  const secrets = Object.fromEntries(
    INTEGRATION_SECRET_KEYS.map((k) => {
      const [enc, last4] = SECRET[k]
      return [k, { has: Boolean(r?.[enc]), last4: r?.[enc] ? (r[last4] ?? null) : null }]
    }),
  )
  return { plain, secrets } as IntegrationKeysStatus
}

/**
 * Per key: undefined = keep, null (or blank) = remove (env decides), string = replace. Returns the names of the keys
 * that were set or removed (for the audit log — never values).
 */
export async function saveIntegrationKeys(
  db: Db,
  input: Partial<Record<IntegrationKey, string | null>>,
  userId: string,
): Promise<{ set: IntegrationKey[]; removed: IntegrationKey[] }> {
  const before = await readRow(db)
  const set: Partial<typeof platformSettings.$inferInsert> = { updatedBy: userId }
  const changed = { set: [] as IntegrationKey[], removed: [] as IntegrationKey[] }
  for (const k of INTEGRATION_PLAIN_KEYS) {
    if (input[k] === undefined) continue
    const value = input[k]?.trim() || null
    if (value === (before?.[PLAIN[k]] ?? null)) continue
    set[PLAIN[k]] = value
    changed[value ? 'set' : 'removed'].push(k)
  }
  for (const k of INTEGRATION_SECRET_KEYS) {
    if (input[k] === undefined) continue
    const value = input[k]?.trim() || null
    const [enc, last4] = SECRET[k]
    if (!value && !before?.[enc]) continue
    set[enc] = value ? sealEmailKey(value) : null
    set[last4] = value ? value.slice(-4) : null
    changed[value ? 'set' : 'removed'].push(k)
  }
  await db.insert(platformSettings).values({ id: 1 }).onConflictDoNothing()
  await db.update(platformSettings).set(set).where(eq(platformSettings.id, 1))
  return changed
}

/** The console-saved values (secrets decrypted). An unreadable secret counts as unset (env fallback). */
export async function loadIntegrationKeys(db: Db): Promise<IntegrationKeyValues> {
  const r = await readRow(db)
  const out = Object.fromEntries(
    INTEGRATION_PLAIN_KEYS.map((k) => [k, r?.[PLAIN[k]] ?? null]),
  ) as IntegrationKeyValues
  for (const k of INTEGRATION_SECRET_KEYS) {
    const stored = r?.[SECRET[k][0]]
    out[k] = null
    if (!stored) continue
    try {
      out[k] = openEmailKey(stored)
    } catch {
      console.error(`[integrations] stored ${k} cannot be decrypted (encryption key changed?), using env`)
    }
  }
  return out
}

const value = (v: string | null | undefined) => v?.trim() || undefined

/** `env` with each key replaced by its console value when one is saved (an env-like record for the pure readers). */
export function resolveIntegrationEnv(
  saved: Partial<IntegrationKeyValues> | null,
  env: Env = process.env,
): Env {
  const out: Env = { ...env }
  for (const k of INTEGRATION_KEYS) {
    const v = value(saved?.[k])
    if (v) out[k] = v
  }
  return out
}

/** Where each key comes from: the console, the server env, or nowhere. */
export function integrationKeySources(
  saved: Partial<IntegrationKeyValues> | null,
  env: Env = process.env,
): Record<IntegrationKey, IntegrationKeySource> {
  return Object.fromEntries(
    INTEGRATION_KEYS.map((k) => [k, value(saved?.[k]) ? 'console' : value(env[k]) ? 'env' : null]),
  ) as Record<IntegrationKey, IntegrationKeySource>
}

/** Cached console values (30 s; `invalidate()` after a console save). */
export function cachedIntegrationKeys(db: () => Db, ttlMs = 30_000) {
  let cache: { at: number; value: Promise<IntegrationKeyValues> } | null = null
  const read = () => {
    if (!cache || Date.now() - cache.at > ttlMs) {
      const value = loadIntegrationKeys(db())
      cache = { at: Date.now(), value }
      value.catch(() => {
        cache = null
      })
    }
    return cache.value
  }
  return Object.assign(read, {
    invalidate: () => {
      cache = null
    },
  })
}

// One cached source per process (globalThis: the web app's route bundles are separate module graphs).
const g = globalThis as { __spaIntegrationKeys?: ReturnType<typeof cachedIntegrationKeys> }

/** The console-saved values for this process (web + worker; 30 s cache). */
export function currentIntegrationKeys(): Promise<IntegrationKeyValues> {
  g.__spaIntegrationKeys ??= cachedIntegrationKeys(() => platformDb())
  return g.__spaIntegrationKeys()
}

/**
 * THE resolver every Google / Meta reader uses: `env` with console keys over env variables, key by key. Without a
 * platform database (unit tests) or on a database hiccup it is env alone, so a page or job is never blocked.
 */
export async function integrationEnv(env: Env = process.env): Promise<Env> {
  if (!process.env.DATABASE_URL_PLATFORM) return resolveIntegrationEnv(null, env)
  try {
    return resolveIntegrationEnv(await currentIntegrationKeys(), env)
  } catch (e) {
    console.error('[integrations] console keys unreadable, using env', e instanceof Error ? e.message : e)
    return resolveIntegrationEnv(null, env)
  }
}

/** After a console save (the worker picks changes up within the 30 s cache). */
export function invalidateIntegrationEnv() {
  g.__spaIntegrationKeys?.invalidate()
}

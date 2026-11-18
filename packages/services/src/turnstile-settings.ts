// F9 bot check (Cloudflare Turnstile) keys saved in the super-admin console (platform_settings, single row), like the
// Resend key: the secret is write-only (never returned to the UI, logged or audited; `secretLast4` only), sealed with
// the same helper (AES-GCM when an encryption key exists, else stored as entered). Console values win over env.
import type { TurnstileSettings } from '@spa/core'
import { type Db, platformSettings } from '@spa/db'
import { eq } from 'drizzle-orm'
import { openEmailKey, sealEmailKey } from './email-settings'

export type TurnstileSettingsStatus = {
  siteKey: string | null
  hasSecret: boolean
  secretLast4: string | null
  /** null = not set in the console (env decides). */
  customDomains: boolean | null
}

export async function turnstileSettingsStatus(db: Db): Promise<TurnstileSettingsStatus> {
  const [r] = await db
    .select({
      siteKey: platformSettings.turnstileSiteKey,
      enc: platformSettings.turnstileSecretEnc,
      last4: platformSettings.turnstileSecretLast4,
      customDomains: platformSettings.turnstileCustomDomains,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, 1))
  return {
    siteKey: r?.siteKey ?? null,
    hasSecret: Boolean(r?.enc),
    secretLast4: r?.enc ? (r.last4 ?? null) : null,
    customDomains: r?.customDomains ?? null,
  }
}

/** `secretKey`: undefined = keep, null = remove, string = replace. `siteKey` null = remove (env decides). */
export async function saveTurnstileSettings(
  db: Db,
  input: { siteKey: string | null; secretKey?: string | null; customDomains: boolean | null },
  userId: string,
) {
  const set: Partial<typeof platformSettings.$inferInsert> = {
    turnstileSiteKey: input.siteKey,
    turnstileCustomDomains: input.customDomains,
    updatedBy: userId,
  }
  if (input.secretKey === null) Object.assign(set, { turnstileSecretEnc: null, turnstileSecretLast4: null })
  else if (input.secretKey)
    Object.assign(set, {
      turnstileSecretEnc: sealEmailKey(input.secretKey),
      turnstileSecretLast4: input.secretKey.slice(-4),
    })
  await db.insert(platformSettings).values({ id: 1 }).onConflictDoNothing()
  await db.update(platformSettings).set(set).where(eq(platformSettings.id, 1))
}

/** The console-saved values (secret decrypted). An unreadable secret counts as unset (env fallback). */
export async function loadTurnstileSettings(db: Db): Promise<TurnstileSettings> {
  const [r] = await db
    .select({
      siteKey: platformSettings.turnstileSiteKey,
      enc: platformSettings.turnstileSecretEnc,
      customDomains: platformSettings.turnstileCustomDomains,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, 1))
  let secretKey: string | null = null
  if (r?.enc) {
    try {
      secretKey = openEmailKey(r.enc)
    } catch {
      console.error('[turnstile] stored secret key cannot be decrypted (encryption key changed?), using env')
    }
  }
  return { siteKey: r?.siteKey ?? null, secretKey, customDomains: r?.customDomains ?? null }
}

/** Process-wide cached source (30 s; `invalidate()` after a console save). */
export function cachedTurnstileSettings(db: () => Db, ttlMs = 30_000) {
  let cache: { at: number; value: Promise<TurnstileSettings> } | null = null
  const read = () => {
    if (!cache || Date.now() - cache.at > ttlMs) {
      const value = loadTurnstileSettings(db())
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

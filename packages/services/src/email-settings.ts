// Staff email (Resend) settings saved in the super-admin console (platform_settings, single row). The key is never
// returned to the UI, logged or audited: callers get `hasKey` + the last 4 characters only.
import type { EmailSettings } from '@spa/core'
import { type Db, platformSettings } from '@spa/db'
import { eq } from 'drizzle-orm'
import { decryptSecret, encryptSecret } from './secrets'

const PLAIN = 'plain:'

/** AES-GCM when an encryption key is available (APP_ENCRYPTION_KEY, else derived from BETTER_AUTH_SECRET); plain otherwise (owner decision). */
export function sealEmailKey(key: string): string {
  try {
    return encryptSecret(key)
  } catch {
    return PLAIN + key
  }
}
export const openEmailKey = (stored: string) =>
  stored.startsWith(PLAIN) ? stored.slice(PLAIN.length) : decryptSecret(stored)

export type EmailSettingsStatus = { hasKey: boolean; keyLast4: string | null; from: string | null }

export async function emailSettingsStatus(db: Db): Promise<EmailSettingsStatus> {
  const [r] = await db
    .select({
      enc: platformSettings.resendApiKeyEnc,
      last4: platformSettings.resendApiKeyLast4,
      from: platformSettings.emailFrom,
    })
    .from(platformSettings)
    .where(eq(platformSettings.id, 1))
  return { hasKey: Boolean(r?.enc), keyLast4: r?.enc ? (r.last4 ?? null) : null, from: r?.from ?? null }
}

/** `apiKey`: undefined = keep, null = remove, string = replace. */
export async function saveEmailSettings(
  db: Db,
  input: { apiKey?: string | null; from: string | null },
  userId: string,
) {
  const set: Partial<typeof platformSettings.$inferInsert> = { emailFrom: input.from, updatedBy: userId }
  if (input.apiKey === null) Object.assign(set, { resendApiKeyEnc: null, resendApiKeyLast4: null })
  else if (input.apiKey)
    Object.assign(set, {
      resendApiKeyEnc: sealEmailKey(input.apiKey),
      resendApiKeyLast4: input.apiKey.slice(-4),
    })
  await db.insert(platformSettings).values({ id: 1 }).onConflictDoNothing()
  await db.update(platformSettings).set(set).where(eq(platformSettings.id, 1))
}

/** The console-saved values for sendStaffEmail (decrypted). An unreadable key counts as unset (env fallback). */
export async function loadEmailSettings(db: Db): Promise<EmailSettings> {
  const [r] = await db
    .select({ enc: platformSettings.resendApiKeyEnc, from: platformSettings.emailFrom })
    .from(platformSettings)
    .where(eq(platformSettings.id, 1))
  let apiKey: string | null = null
  if (r?.enc) {
    try {
      apiKey = openEmailKey(r.enc)
    } catch {
      console.error('[email] stored Resend key cannot be decrypted (encryption key changed?), using env')
    }
  }
  return { apiKey, from: r?.from ?? null }
}

/** Process-wide cached source for `setEmailSettingsSource` (30 s; `invalidate()` after a console save). */
export function cachedEmailSettings(db: () => Db, ttlMs = 30_000) {
  let cache: { at: number; value: Promise<EmailSettings> } | null = null
  const read = () => {
    if (!cache || Date.now() - cache.at > ttlMs) {
      const value = loadEmailSettings(db())
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

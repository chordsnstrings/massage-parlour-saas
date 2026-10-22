// Encryption for third-party tokens at rest (Instagram, Google). AES-256-GCM, key from APP_ENCRYPTION_KEY
// (32 bytes, base64) or derived from BETTER_AUTH_SECRET with HKDF when no dedicated key is set.
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const VERSION = 'v1'

function key(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (raw) {
    const k = Buffer.from(raw, 'base64')
    if (k.length !== 32) throw new Error('APP_ENCRYPTION_KEY must be 32 bytes, base64-encoded')
    return k
  }
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('Set APP_ENCRYPTION_KEY (or BETTER_AUTH_SECRET) to store integration tokens')
  return Buffer.from(hkdfSync('sha256', secret, 'spamanagement', 'integration-tokens', 32))
}

/** Encrypts a secret to `v1.<iv>.<tag>.<ciphertext>` (base64url parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.')
}

export function decryptSecret(sealed: string): string {
  const [version, iv, tag, data] = sealed.split('.')
  if (version !== VERSION || !iv || !tag || !data) throw new Error('Unrecognised secret format')
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

import { platformSettings } from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  cachedIntegrationKeys,
  googleConfig,
  integrationEnv,
  integrationKeySources,
  integrationKeysStatus,
  invalidateIntegrationEnv,
  loadIntegrationKeys,
  metaConfig,
  resolveIntegrationEnv,
  saveIntegrationKeys,
} from '../src'

const { platform } = testDbs()
const KEY = Buffer.alloc(32, 3).toString('base64')
const clearAll = {
  GOOGLE_CLIENT_ID: null,
  GOOGLE_CLIENT_SECRET: null,
  META_APP_ID: null,
  META_APP_SECRET: null,
  META_WEBHOOK_VERIFY_TOKEN: null,
  META_FB_CONFIG_ID: null,
}

describe('console Google + Meta keys (R29)', () => {
  beforeAll(() => resetTestDatabase())
  afterEach(async () => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    await saveIntegrationKeys(platform, clearAll, 'u1')
    invalidateIntegrationEnv()
  })

  it('secrets sealed + write-only (last 4), plain ids visible; undefined keeps, null removes, string replaces', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', KEY)
    const first = await saveIntegrationKeys(
      platform,
      {
        GOOGLE_CLIENT_ID: ' cid.apps.googleusercontent.com ',
        GOOGLE_CLIENT_SECRET: 'GOCSPX-secret-WXYZ',
        META_APP_ID: '1234567890',
        META_APP_SECRET: 'meta-secret-ABCD',
        META_WEBHOOK_VERIFY_TOKEN: 'verify me 9876',
      },
      'u1',
    )
    expect(first).toEqual({
      set: [
        'GOOGLE_CLIENT_ID',
        'META_APP_ID',
        'GOOGLE_CLIENT_SECRET',
        'META_APP_SECRET',
        'META_WEBHOOK_VERIFY_TOKEN',
      ],
      removed: [],
    })
    const [row] = await platform.select().from(platformSettings).where(eq(platformSettings.id, 1))
    expect(row?.googleClientId).toBe('cid.apps.googleusercontent.com')
    for (const enc of [row?.googleClientSecretEnc, row?.metaAppSecretEnc, row?.metaWebhookVerifyTokenEnc]) {
      expect(enc).toBeTruthy()
      expect(enc).not.toContain('secret')
      expect(enc).not.toContain('verify')
    }
    expect(await integrationKeysStatus(platform)).toEqual({
      plain: {
        GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
        META_APP_ID: '1234567890',
        META_FB_CONFIG_ID: null,
      },
      secrets: {
        GOOGLE_CLIENT_SECRET: { has: true, last4: 'WXYZ' },
        META_APP_SECRET: { has: true, last4: 'ABCD' },
        META_WEBHOOK_VERIFY_TOKEN: { has: true, last4: '9876' },
      },
    })
    expect(await loadIntegrationKeys(platform)).toEqual({
      GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'GOCSPX-secret-WXYZ',
      META_APP_ID: '1234567890',
      META_APP_SECRET: 'meta-secret-ABCD',
      META_WEBHOOK_VERIFY_TOKEN: 'verify me 9876',
      META_FB_CONFIG_ID: null,
    })

    // undefined = keep; the same plain value again is not a change; null removes; a string replaces.
    const second = await saveIntegrationKeys(
      platform,
      { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', META_APP_SECRET: null, META_FB_CONFIG_ID: '42' },
      'u1',
    )
    expect(second).toEqual({ set: ['META_FB_CONFIG_ID'], removed: ['META_APP_SECRET'] })
    const after = await loadIntegrationKeys(platform)
    expect(after).toMatchObject({
      GOOGLE_CLIENT_SECRET: 'GOCSPX-secret-WXYZ',
      META_APP_SECRET: null,
      META_WEBHOOK_VERIFY_TOKEN: 'verify me 9876',
      META_FB_CONFIG_ID: '42',
    })
    expect((await integrationKeysStatus(platform)).secrets.META_APP_SECRET).toEqual({
      has: false,
      last4: null,
    })
    // Removing what is not stored changes nothing.
    expect(await saveIntegrationKeys(platform, { META_APP_SECRET: null }, 'u1')).toEqual({
      set: [],
      removed: [],
    })
    await saveIntegrationKeys(platform, { GOOGLE_CLIENT_SECRET: 'GOCSPX-second-1111' }, 'u1')
    expect((await integrationKeysStatus(platform)).secrets.GOOGLE_CLIENT_SECRET.last4).toBe('1111')
  })

  it('each key resolves on its own: console over env, env when the console has none', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', KEY)
    await saveIntegrationKeys(
      platform,
      { GOOGLE_CLIENT_SECRET: 'console-secret', META_APP_ID: 'console-app' },
      'u1',
    )
    const saved = await loadIntegrationKeys(platform)
    const env = {
      APP_URL: 'https://app.example.test',
      GOOGLE_CLIENT_ID: 'env-id.apps.googleusercontent.com',
      GOOGLE_CLIENT_SECRET: 'env-secret',
      META_APP_ID: 'env-app',
      META_WEBHOOK_VERIFY_TOKEN: 'env-verify',
    }
    const resolved = resolveIntegrationEnv(saved, env)
    // Other variables pass through untouched (the record replaces process.env for the pure readers).
    expect(resolved.APP_URL).toBe('https://app.example.test')
    expect(googleConfig(resolved)).toEqual({
      clientId: 'env-id.apps.googleusercontent.com',
      clientSecret: 'console-secret',
    })
    // META_APP_SECRET missing everywhere → Meta stays off.
    expect(metaConfig(resolved)).toBeNull()
    expect(integrationKeySources(saved, env)).toEqual({
      GOOGLE_CLIENT_ID: 'env',
      GOOGLE_CLIENT_SECRET: 'console',
      META_APP_ID: 'console',
      META_APP_SECRET: null,
      META_WEBHOOK_VERIFY_TOKEN: 'env',
      META_FB_CONFIG_ID: null,
    })
    await saveIntegrationKeys(platform, { META_APP_SECRET: 'console-meta' }, 'u1')
    expect(metaConfig(resolveIntegrationEnv(await loadIntegrationKeys(platform), env))).toEqual({
      appId: 'console-app',
      appSecret: 'console-meta',
      verifyToken: 'env-verify',
    })
    // Nothing saved → env alone.
    expect(resolveIntegrationEnv(null, env)).toEqual(env)
  })

  it('an undecryptable secret counts as unset (env fallback); the cached source re-reads after invalidate', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', KEY)
    await saveIntegrationKeys(platform, { META_APP_SECRET: 'first-1111' }, 'u1')
    const source = cachedIntegrationKeys(() => platform)
    expect((await source()).META_APP_SECRET).toBe('first-1111')
    await saveIntegrationKeys(platform, { META_APP_SECRET: 'second-2222' }, 'u1')
    expect((await source()).META_APP_SECRET).toBe('first-1111')
    source.invalidate()
    expect((await source()).META_APP_SECRET).toBe('second-2222')

    vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const saved = await loadIntegrationKeys(platform)
    expect(saved.META_APP_SECRET).toBeNull()
    // The log names the key, never a value.
    expect(errors.mock.calls.flat().join(' ')).toContain('META_APP_SECRET')
    expect(errors.mock.calls.flat().join(' ')).not.toContain('second-2222')
    expect(resolveIntegrationEnv(saved, { META_APP_SECRET: 'env-secret' }).META_APP_SECRET).toBe('env-secret')
    // Status still says one is stored (the console asks to enter it again).
    expect((await integrationKeysStatus(platform)).secrets.META_APP_SECRET).toEqual({
      has: true,
      last4: '2222',
    })
  })

  it('integrationEnv(): the process-wide resolver (console over env, cached until invalidate)', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', KEY)
    // No platform database configured → env alone, no query.
    vi.stubEnv('DATABASE_URL_PLATFORM', '')
    expect(await integrationEnv({ GOOGLE_CLIENT_ID: 'env-id' })).toEqual({ GOOGLE_CLIENT_ID: 'env-id' })

    vi.stubEnv('DATABASE_URL_PLATFORM', testUrls.platform)
    invalidateIntegrationEnv()
    await saveIntegrationKeys(platform, { GOOGLE_CLIENT_ID: 'console-id' }, 'u1')
    const env = { GOOGLE_CLIENT_ID: 'env-id', GOOGLE_CLIENT_SECRET: 'env-secret' }
    expect(googleConfig(await integrationEnv(env))).toEqual({
      clientId: 'console-id',
      clientSecret: 'env-secret',
    })
    await saveIntegrationKeys(platform, { GOOGLE_CLIENT_ID: null }, 'u1')
    expect((await integrationEnv(env)).GOOGLE_CLIENT_ID).toBe('console-id') // cached (30 s)
    invalidateIntegrationEnv()
    expect((await integrationEnv(env)).GOOGLE_CLIENT_ID).toBe('env-id')
  })
})

import { platformSettings } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  cachedEmailSettings,
  emailSettingsStatus,
  loadEmailSettings,
  openEmailKey,
  saveEmailSettings,
  sealEmailKey,
} from '../src'

const { platform } = testDbs()

describe('console email settings', () => {
  beforeAll(() => resetTestDatabase())
  afterEach(() => vi.unstubAllEnvs())

  it('stores the key encrypted, exposes only the last 4, keeps it on blank and clears it', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'))
    await saveEmailSettings(platform, { apiKey: 're_secret_ABCD', from: 'Spa <a@spa.test>' }, 'u1')
    const [row] = await platform.select().from(platformSettings).where(eq(platformSettings.id, 1))
    expect(row?.resendApiKeyEnc).not.toContain('re_secret')
    expect(await emailSettingsStatus(platform)).toEqual({
      hasKey: true,
      keyLast4: 'ABCD',
      from: 'Spa <a@spa.test>',
    })
    expect(await loadEmailSettings(platform)).toEqual({ apiKey: 're_secret_ABCD', from: 'Spa <a@spa.test>' })

    await saveEmailSettings(platform, { from: null }, 'u1') // blank key = keep
    expect(await loadEmailSettings(platform)).toEqual({ apiKey: 're_secret_ABCD', from: null })

    await saveEmailSettings(platform, { apiKey: null, from: null }, 'u1')
    expect(await emailSettingsStatus(platform)).toMatchObject({ hasKey: false, keyLast4: null })
  })

  it('saves without any encryption key (plain, owner decision)', () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', '')
    vi.stubEnv('BETTER_AUTH_SECRET', '')
    const sealed = sealEmailKey('re_plain_1234')
    expect(sealed).toBe('plain:re_plain_1234')
    expect(openEmailKey(sealed)).toBe('re_plain_1234')
  })

  it('an undecryptable key falls back to unset (env takes over)', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'))
    await saveEmailSettings(platform, { apiKey: 're_secret_ABCD', from: null }, 'u1')
    vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await loadEmailSettings(platform)).apiKey).toBeNull()
  })

  it('the cached source re-reads after invalidate', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'))
    await saveEmailSettings(platform, { apiKey: 're_first_1111', from: null }, 'u1')
    const source = cachedEmailSettings(() => platform)
    expect((await source())?.apiKey).toBe('re_first_1111')
    await saveEmailSettings(platform, { apiKey: 're_second_2222', from: null }, 'u1')
    expect((await source())?.apiKey).toBe('re_first_1111')
    source.invalidate()
    expect((await source())?.apiKey).toBe('re_second_2222')
  })
})

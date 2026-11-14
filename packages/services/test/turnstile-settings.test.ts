import { resolveTurnstile } from '@spa/core'
import { cspViolations, platformSettings } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  CSP_ROWS_PER_DAY,
  cachedTurnstileSettings,
  cspViolationSummary,
  loadTurnstileSettings,
  recordCspViolations,
  saveTurnstileSettings,
  turnstileSettingsStatus,
} from '../src'

const { platform } = testDbs()

describe('console Turnstile settings (F9 owner request)', () => {
  beforeAll(() => resetTestDatabase())
  afterEach(() => vi.unstubAllEnvs())

  it('secret encrypted + write-only (last 4), site key visible, switch nullable; blank keeps, null clears', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'))
    await saveTurnstileSettings(
      platform,
      { siteKey: '0x4AAAsite', secretKey: '0x4AAAsecret-WXYZ', customDomains: true },
      'u1',
    )
    const [row] = await platform.select().from(platformSettings).where(eq(platformSettings.id, 1))
    expect(row?.turnstileSecretEnc).toBeTruthy()
    expect(row?.turnstileSecretEnc).not.toContain('secret')
    expect(await turnstileSettingsStatus(platform)).toEqual({
      siteKey: '0x4AAAsite',
      hasSecret: true,
      secretLast4: 'WXYZ',
      customDomains: true,
    })
    const saved = await loadTurnstileSettings(platform)
    expect(saved).toEqual({ siteKey: '0x4AAAsite', secretKey: '0x4AAAsecret-WXYZ', customDomains: true })
    // DB wins over env.
    expect(
      resolveTurnstile(saved, {
        TURNSTILE_SITE_KEY: 'env',
        TURNSTILE_SECRET_KEY: 'env',
        TURNSTILE_CUSTOM_DOMAINS: '',
      }).config,
    ).toEqual({ siteKey: '0x4AAAsite', secretKey: '0x4AAAsecret-WXYZ' })

    await saveTurnstileSettings(platform, { siteKey: '0x4AAAsite', customDomains: false }, 'u1') // blank = keep
    expect(await loadTurnstileSettings(platform)).toMatchObject({
      secretKey: '0x4AAAsecret-WXYZ',
      customDomains: false,
    })

    await saveTurnstileSettings(platform, { siteKey: null, secretKey: null, customDomains: null }, 'u1')
    expect(await turnstileSettingsStatus(platform)).toEqual({
      siteKey: null,
      hasSecret: false,
      secretLast4: null,
      customDomains: null,
    })
  })

  it('an undecryptable secret counts as unset; the cached source re-reads after invalidate', async () => {
    vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 3).toString('base64'))
    await saveTurnstileSettings(
      platform,
      { siteKey: 's1', secretKey: 'first-1111', customDomains: null },
      'u1',
    )
    const source = cachedTurnstileSettings(() => platform)
    expect((await source()).secretKey).toBe('first-1111')
    await saveTurnstileSettings(
      platform,
      { siteKey: 's1', secretKey: 'second-2222', customDomains: null },
      'u1',
    )
    expect((await source()).secretKey).toBe('first-1111')
    source.invalidate()
    expect((await source()).secretKey).toBe('second-2222')

    vi.stubEnv('APP_ENCRYPTION_KEY', Buffer.alloc(32, 9).toString('base64'))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect((await loadTurnstileSettings(platform)).secretKey).toBeNull()
    await saveTurnstileSettings(platform, { siteKey: null, secretKey: null, customDomains: null }, 'u1')
  })
})

describe('CSP violation counts (F10)', () => {
  beforeAll(async () => {
    await platform.delete(cspViolations)
  })

  it('counts per day + surface + directive + blocked source; summary sums the last 7 days', async () => {
    const now = new Date('2026-10-09T10:00:00Z')
    const inline = { directive: 'script-src-elem', blocked: 'inline', path: '/serenity' }
    await recordCspViolations(platform, 'site', [inline, inline], now)
    await recordCspViolations(
      platform,
      'admin',
      [{ directive: 'img-src', blocked: 'http://x.test', path: null }],
      now,
    )
    await recordCspViolations(platform, 'nonsense', [inline], now)
    // Eight days earlier: outside the window.
    await recordCspViolations(platform, 'site', [inline], new Date('2026-10-01T10:00:00Z'))
    const s = await cspViolationSummary(platform, 7, now)
    expect(s.total).toBe(4)
    expect(s.top[0]).toEqual({
      surface: 'site',
      directive: 'script-src-elem',
      blocked: 'inline',
      count: 2,
      lastPath: '/serenity',
    })
    expect(s.top.map((t) => t.surface).sort()).toEqual(['admin', 'site', 'unknown'])
  })

  it('folds new combinations into "other" once a day has many rows', async () => {
    const now = new Date('2026-10-20T10:00:00Z')
    const many = Array.from({ length: CSP_ROWS_PER_DAY }, (_, i) => ({
      directive: 'img-src',
      blocked: `https://h${i}.test`,
      path: null,
    }))
    await recordCspViolations(platform, 'site', many, now)
    await recordCspViolations(
      platform,
      'site',
      [{ directive: 'img-src', blocked: 'https://late.test', path: null }],
      now,
    )
    const rows = await platform.select().from(cspViolations).where(eq(cspViolations.day, '2026-10-20'))
    expect(rows).toHaveLength(CSP_ROWS_PER_DAY + 1)
    expect(rows.find((r) => r.blocked === 'other')?.count).toBe(1)
    expect(rows.some((r) => r.blocked === 'https://late.test')).toBe(false)
  })
})

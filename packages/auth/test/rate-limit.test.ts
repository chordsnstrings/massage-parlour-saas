// Brute-force guard (F14): Better Auth's per-IP rules in src/index.ts `rateLimit.customRules`. The e2e server runs
// with AUTH_RATE_LIMIT=off (it signs up dozens of owners from one IP), so the production limits are exercised here
// against the real handler: production mode, memory store, the test database (TEST_DB_NAME).
import { closeAllDbs } from '@spa/db'
import { resetTestDatabase, testUrls } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const ORIGIN = 'http://app.localhost:3000'
const env = process.env as Record<string, string | undefined>
const saved = { NODE_ENV: env.NODE_ENV, AUTH_RATE_LIMIT: env.AUTH_RATE_LIMIT }

let handler: (req: Request) => Promise<Response>
beforeAll(async () => {
  await resetTestDatabase()
  Object.assign(env, {
    NODE_ENV: 'production', // the limiter only runs in production (src/index.ts)
    AUTH_RATE_LIMIT: undefined,
    DATABASE_URL_PLATFORM: testUrls.platform,
    BETTER_AUTH_SECRET: 'rate-limit-test-secret-rate-limit-test',
    ROOT_DOMAIN: 'localhost:3000',
    APP_URL: ORIGIN,
    RESEND_API_KEY: '',
  })
  const { getAuth } = await import('../src')
  handler = getAuth().handler
})
afterAll(async () => {
  Object.assign(env, saved)
  await closeAllDbs()
})

const post = (path: string, body: unknown, ip: string) =>
  handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': ip },
      body: JSON.stringify(body),
    }),
  )

/** Status codes of `n` identical requests in a row. */
async function statuses(n: number, path: string, body: unknown, ip: string) {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push((await post(path, body, ip)).status)
  return out
}

describe('auth rate limits (per client IP)', () => {
  it('password reset requests: 5 per 10 minutes, then 429; another IP is unaffected', async () => {
    const body = { email: 'nobody@e2e.test', redirectTo: '/reset-password' }
    expect(await statuses(6, '/request-password-reset', body, '203.0.113.10')).toEqual([
      200, 200, 200, 200, 200, 429,
    ])
    expect((await post('/request-password-reset', body, '203.0.113.11')).status).toBe(200)
  })

  it('password sign-in: 8 per minute (not Better Auth’s 3 per 10 s default), then 429', async () => {
    const body = { email: 'nobody@e2e.test', password: 'wrong-password-123' }
    const got = await statuses(9, '/sign-in/email', body, '203.0.113.20')
    expect(got.slice(0, 8).every((s) => s === 401)).toBe(true)
    expect(got[8]).toBe(429)
  })

  it('2FA codes: 8 TOTP and 5 backup-code checks per minute, then 429', async () => {
    const totp = await statuses(9, '/two-factor/verify-totp', { code: '123456' }, '203.0.113.30')
    expect(totp.slice(0, 8).every((s) => s === 401)).toBe(true) // no sign-in challenge cookie
    expect(totp[8]).toBe(429)
    const backup = await statuses(
      6,
      '/two-factor/verify-backup-code',
      { code: 'AAAAA-BBBBB' },
      '203.0.113.31',
    )
    expect(backup.slice(0, 5).every((s) => s === 401)).toBe(true)
    expect(backup[5]).toBe(429)
  })
})

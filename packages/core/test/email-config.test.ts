import { afterEach, describe, expect, it, vi } from 'vitest'
import { backupBucketSource, configChecks, configFlags } from '../src/config-health'
import {
  DEFAULT_EMAIL_FROM,
  emailDomain,
  resolveEmailConfig,
  sendStaffEmail,
  setEmailSettingsSource,
  setEmailTransport,
} from '../src/email'

afterEach(() => {
  setEmailSettingsSource(undefined)
  setEmailTransport(null)
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('email settings precedence (console, then env, then default)', () => {
  const env = { RESEND_API_KEY: 're_env_1111', EMAIL_FROM: 'Env <a@env.test>' }

  it('uses the console values first', async () => {
    setEmailSettingsSource(async () => ({ apiKey: 're_db_2222', from: 'Db <a@db.test>' }))
    expect(await resolveEmailConfig(env)).toEqual({
      apiKey: 're_db_2222',
      keySource: 'console',
      from: 'Db <a@db.test>',
      fromSource: 'console',
    })
  })

  it('falls back to env per field, then to the default sender', async () => {
    setEmailSettingsSource(async () => ({ apiKey: '', from: null }))
    expect(await resolveEmailConfig(env)).toMatchObject({
      apiKey: 're_env_1111',
      keySource: 'env',
      fromSource: 'env',
    })
    setEmailSettingsSource(async () => ({ apiKey: 're_db_2222' }))
    expect(await resolveEmailConfig({})).toMatchObject({
      keySource: 'console',
      from: DEFAULT_EMAIL_FROM,
      fromSource: 'missing',
    })
    setEmailSettingsSource(undefined)
    expect(await resolveEmailConfig({})).toMatchObject({ apiKey: null, keySource: 'missing' })
  })

  it('a failing source falls back to env without throwing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setEmailSettingsSource(async () => {
      throw new Error('db down')
    })
    expect(await resolveEmailConfig(env)).toMatchObject({ apiKey: 're_env_1111', keySource: 'env' })
  })

  it('sendStaffEmail sends with the console key and sender', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_env_1111')
    setEmailSettingsSource(async () => ({ apiKey: 're_db_2222', from: 'Db <a@db.test>' }))
    const sent: unknown[] = []
    setEmailTransport(async (m) => {
      sent.push(m)
    })
    await sendStaffEmail({ to: 'x@y.test', subject: 's', text: 't' })
    expect(sent).toEqual([
      { to: 'x@y.test', subject: 's', text: 't', from: 'Db <a@db.test>', apiKey: 're_db_2222' },
    ])
  })

  it('posts to Resend with reply_to only when replyTo is set (contact enquiries)', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_env_1111')
    vi.stubEnv('EMAIL_FROM', '')
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await sendStaffEmail({ to: 'x@y.test', subject: 's', text: 't', replyTo: 'sender@spa.test' })
    await sendStaffEmail({ to: 'x@y.test', subject: 's', text: 't' })
    const bodies = fetchMock.mock.calls.map((c) =>
      JSON.parse((c as unknown as [string, RequestInit])[1].body as string),
    )
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.resend.com/emails')
    expect(bodies[0]).toEqual({
      from: DEFAULT_EMAIL_FROM,
      to: 'x@y.test',
      subject: 's',
      text: 't',
      reply_to: 'sender@spa.test',
    })
    expect(bodies[1]).not.toHaveProperty('reply_to')
  })

  it('still fails loudly in production when neither has a key', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('NODE_ENV', 'production')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    setEmailSettingsSource(async () => ({ apiKey: null }))
    await expect(sendStaffEmail({ to: 'x@y.test', subject: 's', text: 't' })).rejects.toThrow(
      /RESEND_API_KEY/,
    )
  })

  it('extracts the sender domain', () => {
    expect(emailDomain('Spa <no-reply@SpaManagement.co>')).toBe('spamanagement.co')
    expect(emailDomain('a@b.test')).toBe('b.test')
    expect(emailDomain('Spa <a@b.test>  ')).toBe('b.test')
    expect(emailDomain('a@b.test >')).toBeNull()
    expect(emailDomain('a@')).toBeNull()
    expect(emailDomain('no address')).toBeNull()
    // Linear: the old regex rescanned the tail from every "@" (quadratic on a long "@!" run).
    const t = Date.now()
    expect(emailDomain(`@${'@!'.repeat(100_000)} x>`)).toBeNull()
    expect(Date.now() - t).toBeLessThan(500)
  })
})

describe('config health (G9)', () => {
  it('reports presence only, never values', () => {
    const env = {
      R2_ENDPOINT: 'https://r2',
      R2_BUCKET: 'b',
      R2_ACCESS_KEY_ID: 'id',
      R2_SECRET_ACCESS_KEY: 'topsecret',
      APP_ENCRYPTION_KEY: btoa('x'.repeat(32)),
      SENTRY_DSN: 'https://dsn',
    }
    const checks = configChecks(env)
    expect(JSON.stringify(checks)).not.toContain('topsecret')
    const byKey = Object.fromEntries(checks.map((c) => [c.key, c]))
    expect(byKey.backups).toMatchObject({ ok: true, detail: 'R2' })
    expect(byKey.APP_ENCRYPTION_KEY?.ok).toBe(true)
    expect(byKey.ARK_API_KEY?.ok).toBe(false)
    const bad = configChecks({ APP_ENCRYPTION_KEY: 'short' }).find((c) => c.key === 'APP_ENCRYPTION_KEY')
    expect(bad?.detail).toBe('not 32 bytes base64')
    expect(configFlags(env)).toMatchObject({ backups: true, RESEND_API_KEY: false, SENTRY_DSN: true })
  })

  it('a partial R2 set counts as missing (no silent S3 fallback)', () => {
    const s3 = { S3_ENDPOINT: 'e', S3_BUCKET: 'b', S3_ACCESS_KEY_ID: 'i', S3_SECRET_ACCESS_KEY: 's' }
    expect(backupBucketSource({ ...s3, R2_BUCKET: 'b' })).toBeNull()
    expect(backupBucketSource(s3)).toBe('S3')
  })
})

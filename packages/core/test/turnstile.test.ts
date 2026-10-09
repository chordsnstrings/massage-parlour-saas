import { describe, expect, it, vi } from 'vitest'
import {
  attributionOf,
  BOOKING_ATTRIBUTIONS,
  bookingAttribution,
  configChecks,
  configFlags,
  TURNSTILE_VERIFY_URL,
  turnstileConfig,
  verifyTurnstileToken,
  webEntrySource,
} from '../src'

const reply = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

describe('verifyTurnstileToken (F9)', () => {
  it('posts secret, token and remote IP to siteverify and passes on success', async () => {
    const fetchImpl = reply({ success: true, action: 'booking', 'error-codes': [] })
    const v = await verifyTurnstileToken({
      secretKey: 'sec',
      token: 'tok',
      remoteIp: '203.0.113.9',
      action: 'booking',
      fetchImpl,
    })
    expect(v).toEqual({ ok: true, codes: [] })
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!
    expect(url).toBe(TURNSTILE_VERIFY_URL)
    expect(init.method).toBe('POST')
    expect(Object.fromEntries(init.body as URLSearchParams)).toEqual({
      secret: 'sec',
      response: 'tok',
      remoteip: '203.0.113.9',
    })
  })

  it('leaves out an unknown remote IP and accepts the test keys’ empty action', async () => {
    const fetchImpl = reply({ success: true, 'error-codes': [] })
    expect(
      (
        await verifyTurnstileToken({
          secretKey: 's',
          token: 't',
          remoteIp: 'unknown',
          action: 'apply',
          fetchImpl,
        })
      ).ok,
    ).toBe(true)
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1]
    expect((init.body as URLSearchParams).has('remoteip')).toBe(false)
  })

  it('fails closed: no token, rejected token, wrong action, HTTP error, network error', async () => {
    const never = vi.fn() as unknown as typeof fetch
    expect(await verifyTurnstileToken({ secretKey: 's', token: '', fetchImpl: never })).toEqual({
      ok: false,
      codes: ['missing-input-response'],
    })
    expect(
      (await verifyTurnstileToken({ secretKey: 's', token: 'x'.repeat(2049), fetchImpl: never })).ok,
    ).toBe(false)
    expect(await verifyTurnstileToken({ secretKey: 's', token: undefined, fetchImpl: never })).toMatchObject({
      ok: false,
    })
    expect(never).not.toHaveBeenCalled()

    const rejected = reply({ success: false, 'error-codes': ['invalid-input-response'] })
    expect(await verifyTurnstileToken({ secretKey: 's', token: 't', fetchImpl: rejected })).toEqual({
      ok: false,
      codes: ['invalid-input-response'],
    })
    const other = reply({ success: true, action: 'contact' })
    expect(
      (await verifyTurnstileToken({ secretKey: 's', token: 't', action: 'booking', fetchImpl: other })).ok,
    ).toBe(false)
    expect(
      (await verifyTurnstileToken({ secretKey: 's', token: 't', fetchImpl: reply({ success: true }, 500) }))
        .codes,
    ).toEqual(['http-500'])
    const down = vi.fn(async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    expect(await verifyTurnstileToken({ secretKey: 's', token: 't', fetchImpl: down })).toEqual({
      ok: false,
      codes: ['network-error'],
    })
  })
})

describe('Turnstile config (F9)', () => {
  it('is on only with both keys; the console flags it red, the worker heartbeat leaves it out', () => {
    expect(turnstileConfig({ TURNSTILE_SITE_KEY: 'a' })).toBeNull()
    expect(turnstileConfig({ TURNSTILE_SITE_KEY: ' a ', TURNSTILE_SECRET_KEY: 'b' })).toEqual({
      siteKey: 'a',
      secretKey: 'b',
    })
    const off = configChecks({}).find((c) => c.key === 'TURNSTILE')!
    expect(off).toMatchObject({ ok: false, required: true })
    expect(configChecks({ TURNSTILE_SECRET_KEY: 'b' }).find((c) => c.key === 'TURNSTILE')?.detail).toBe(
      'site key missing',
    )
    const on = configChecks({
      TURNSTILE_SITE_KEY: 'a',
      TURNSTILE_SECRET_KEY: 'b',
      TURNSTILE_CUSTOM_DOMAINS: 'on',
    })
    expect(on.find((c) => c.key === 'TURNSTILE')).toMatchObject({ ok: true, detail: 'incl. custom domains' })
    expect('TURNSTILE' in configFlags({})).toBe(false)
  })
})

describe('booking attribution (F13)', () => {
  it('maps ?src tags, utm_source and referrers to the attribution set', () => {
    expect(bookingAttribution({ utm: { src: 'ig' } })).toBe('instagram')
    expect(bookingAttribution({ utm: { src: 'GBP' } })).toBe('gbp')
    expect(bookingAttribution({ utm: { src: 'qr' } })).toBe('qr')
    expect(bookingAttribution({ utm: { src: 'widget' } })).toBe('widget')
    expect(bookingAttribution({ utm: { utm_source: 'facebook' } })).toBe('facebook')
    expect(bookingAttribution({ utm: { utm_source: 'newsletter' } })).toBe('campaign')
    expect(bookingAttribution({ referrer: 'https://l.instagram.com/?u=x' })).toBe('instagram')
    expect(bookingAttribution({ referrer: 'https://www.google.com/' })).toBe('google')
    expect(bookingAttribution({ referrer: 'https://www.dubai-guide.ae/spas' })).toBe('referral')
    expect(bookingAttribution({ referrer: 'not a url' })).toBe('direct')
    expect(bookingAttribution(null)).toBe('direct')
    // The tag wins over the referrer, like web_events.source.
    expect(webEntrySource({ src: 'qr' }, 'https://www.google.com/')).toBe('qr')
    expect(attributionOf('dubai-guide.ae')).toBe('referral')
    expect(BOOKING_ATTRIBUTIONS).toContain(attributionOf('anything'))
  })
})

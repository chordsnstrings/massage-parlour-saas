import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildEvent, parseDsn, reportError, stackFrames } from '../src'

afterEach(() => vi.unstubAllGlobals())

describe('error reporting', () => {
  it('parses DSNs (with and without a path prefix)', () => {
    expect(parseDsn('https://abc@o1.ingest.sentry.io/42')).toEqual({
      endpoint: 'https://o1.ingest.sentry.io/api/42/envelope/',
      publicKey: 'abc',
    })
    expect(parseDsn('https://k@errors.example.com/sentry/7')?.endpoint).toBe(
      'https://errors.example.com/sentry/api/7/envelope/',
    )
    expect(parseDsn('')).toBeNull()
    expect(parseDsn('not a url')).toBeNull()
  })

  it('builds an event with frames oldest-first and a scrubbed URL', () => {
    const err = new Error('boom')
    err.stack = 'Error: boom\n    at inner (/app/a.js:10:5)\n    at outer (/app/node_modules/x/b.js:2:1)'
    const ev = buildEvent(
      err,
      { source: 'web', request: { url: 'https://app.x.ae/cb?code=secret&state=1', method: 'GET' } },
      'id',
    )
    expect(ev.exception.values[0]!.stacktrace.frames.map((f) => f.function)).toEqual(['outer', 'inner'])
    expect(ev.exception.values[0]!.stacktrace.frames[0]!.in_app).toBe(false)
    expect(ev.request?.url).toBe('https://app.x.ae/cb')
    expect(stackFrames(undefined)).toEqual([])
  })

  it('posts an envelope when configured and never throws', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await reportError('https://abc@sentry.example.com/9', new Error('x'), { source: 'worker' })).toBe(
      true,
    )
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://sentry.example.com/api/9/envelope/')
    expect(String(init.body).split('\n')).toHaveLength(3)
    expect((init.headers as Record<string, string>)['x-sentry-auth']).toContain('sentry_key=abc')
    expect(await reportError(undefined, new Error('x'), { source: 'worker' })).toBe(false)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      }),
    )
    expect(await reportError('https://abc@sentry.example.com/9', new Error('x'), { source: 'worker' })).toBe(
      false,
    )
  })
})

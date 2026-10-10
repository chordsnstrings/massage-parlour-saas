import { describe, expect, it } from 'vitest'
import {
  checkSendingDomain,
  namecheapHost,
  ResendDomainError,
  resendDomains,
  setUpSendingDomain,
} from '../src/resend-domains'

const KEY = 're_test_UnitKey_9876'
const DOMAIN = 'spamanagement.co'
const records = [
  {
    record: 'SPF',
    name: 'send',
    type: 'MX',
    ttl: 'Auto',
    status: 'not_started',
    value: 'feedback-smtp.eu-west-1.amazonses.com',
    priority: 10,
  },
  {
    record: 'SPF',
    name: 'send',
    type: 'TXT',
    ttl: 'Auto',
    status: 'not_started',
    value: '"v=spf1 include:amazonses.com ~all"',
  },
  {
    record: 'DKIM',
    name: `resend._domainkey.${DOMAIN}`,
    type: 'txt',
    ttl: 'Auto',
    status: 'not_started',
    value: 'p=MIGf',
  },
]

type Call = { method: string; url: string; body?: unknown; auth: string | null }
/** Stub Resend: `routes` answers by "METHOD /path" (query ignored); every call is recorded. */
function stub(routes: Record<string, (body: unknown, url: URL) => [number, unknown] | 'throw'>) {
  const calls: Call[] = []
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url)
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({
      method: init.method ?? 'GET',
      url,
      body,
      auth: new Headers(init.headers).get('authorization'),
    })
    const route = routes[`${init.method} ${u.pathname}`]
    const out = route
      ? route(body, u)
      : ([404, { statusCode: 404, name: 'not_found', message: 'nope' }] as const)
    if (out === 'throw') throw new Error(`connect ECONNREFUSED (key ${KEY})`)
    return new Response(JSON.stringify(out[1]), { status: out[0] })
  }
  return { calls, client: resendDomains(KEY, { fetch, baseUrl: 'https://resend.test' }) }
}
const failWith = (status: number, body: unknown) => stub({ 'GET /domains': () => [status, body] })
async function errorOf(p: Promise<unknown>) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  )
  expect(e).toBeInstanceOf(ResendDomainError)
  expect(String((e as Error).message)).not.toContain(KEY)
  expect(String((e as Error).message)).not.toContain('UnitKey')
  return e as ResendDomainError
}

describe('setUpSendingDomain (R18)', () => {
  it('creates a missing domain in eu-west-1, then reads it back with Namecheap hosts', async () => {
    const { calls, client } = stub({
      'GET /domains': () => [
        200,
        { object: 'list', has_more: false, data: [{ id: 'd-other', name: 'other.test' }] },
      ],
      'POST /domains': (b) => [
        200,
        { id: 'd-new', name: (b as { name: string }).name, status: 'not_started' },
      ],
      'GET /domains/d-new': () => [
        200,
        { id: 'd-new', name: DOMAIN, status: 'not_started', region: 'eu-west-1', records },
      ],
    })
    const r = await setUpSendingDomain(client, DOMAIN)
    expect(r.created).toBe(true)
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      'GET /domains',
      'POST /domains',
      'GET /domains/d-new',
    ])
    expect(calls[1]?.body).toEqual({ name: DOMAIN, region: 'eu-west-1' })
    expect(calls.every((c) => c.auth === `Bearer ${KEY}`)).toBe(true)
    expect(r.domain).toMatchObject({ name: DOMAIN, status: 'not_started', region: 'eu-west-1' })
    expect(r.domain.records).toEqual([
      {
        purpose: 'SPF',
        type: 'MX',
        host: 'send',
        value: 'feedback-smtp.eu-west-1.amazonses.com',
        priority: 10,
        status: 'not_started',
      },
      {
        purpose: 'SPF',
        type: 'TXT',
        host: 'send',
        value: '"v=spf1 include:amazonses.com ~all"',
        priority: null,
        status: 'not_started',
      },
      {
        purpose: 'DKIM',
        type: 'TXT',
        host: 'resend._domainkey',
        value: 'p=MIGf',
        priority: null,
        status: 'not_started',
      },
    ])
  })

  it('reuses an existing domain (any page, any case) and never creates or changes its region', async () => {
    const { calls, client } = stub({
      'GET /domains': (_b, u) =>
        u.searchParams.get('after') === 'd-1'
          ? [200, { has_more: false, data: [{ id: 'd-2', name: 'SpaManagement.co', status: 'verified' }] }]
          : [200, { has_more: true, data: [{ id: 'd-1', name: 'a.test' }] }],
      'GET /domains/d-2': () => [
        200,
        { id: 'd-2', name: DOMAIN, status: 'verified', region: 'us-east-1', records },
      ],
    })
    const r = await setUpSendingDomain(client, DOMAIN)
    expect(r).toMatchObject({ created: false, domain: { status: 'verified', region: 'us-east-1' } })
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
    expect(new URL(calls[0]?.url ?? '').searchParams.get('limit')).toBe('100')
  })
})

describe('checkSendingDomain (R18)', () => {
  it('asks Resend to verify, then reads status + records', async () => {
    const { calls, client } = stub({
      'GET /domains': () => [
        200,
        { has_more: false, data: [{ id: 'd-1', name: DOMAIN, status: 'not_started' }] },
      ],
      'POST /domains/d-1/verify': () => [200, { object: 'domain', id: 'd-1' }],
      'GET /domains/d-1': () => [200, { id: 'd-1', name: DOMAIN, status: 'pending', records }],
    })
    expect((await checkSendingDomain(client, DOMAIN)).status).toBe('pending')
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toContain('POST /domains/d-1/verify')
  })

  it('only reads an already verified domain, and never adds a missing one', async () => {
    const verified = stub({
      'GET /domains': () => [
        200,
        { has_more: false, data: [{ id: 'd-1', name: DOMAIN, status: 'verified' }] },
      ],
      'GET /domains/d-1': () => [200, { id: 'd-1', name: DOMAIN, status: 'verified', records }],
    })
    expect((await checkSendingDomain(verified.client, DOMAIN)).status).toBe('verified')
    expect(verified.calls.some((c) => c.method === 'POST')).toBe(false)
    const missing = stub({ 'GET /domains': () => [200, { has_more: false, data: [] }] })
    expect((await errorOf(checkSendingDomain(missing.client, DOMAIN))).code).toBe('not_set_up')
    expect(missing.calls.some((c) => c.method === 'POST')).toBe(false)
  })
})

describe('Resend errors → plain messages without the key', () => {
  it.each([
    [
      401,
      {
        statusCode: 401,
        name: 'restricted_api_key',
        message: 'This API key is restricted to only send emails',
      },
      'restricted_key',
    ],
    [
      403,
      { statusCode: 403, name: 'invalid_permission', message: 'Access token is missing required scopes' },
      'restricted_key',
    ],
    [403, { statusCode: 403, name: 'restricted_api_key', message: 'API key is not active' }, 'invalid_key'],
    [400, { statusCode: 400, name: 'invalid_api_key', message: 'API key is invalid' }, 'invalid_key'],
    [401, { statusCode: 401, name: 'missing_api_key', message: 'Missing API key' }, 'invalid_key'],
    [429, { statusCode: 429, name: 'rate_limit_exceeded', message: 'Too many requests' }, 'rate_limited'],
    [
      403,
      {
        statusCode: 403,
        name: 'validation_error',
        message: 'The `spamanagement.co` domain has been registered already.',
      },
      'domain_taken',
    ],
    [
      503,
      { statusCode: 503, name: 'service_unavailable', message: 'API is temporarily unavailable' },
      'unreachable',
    ],
    [502, '<html>bad gateway</html>', 'unreachable'],
  ])('%i %j → %s', async (status, body, code) => {
    const e = await errorOf(setUpSendingDomain(failWith(status, body).client, DOMAIN))
    expect(e.code).toBe(code)
  })

  it('the restricted-key message asks for a one-off full-access key', async () => {
    const e = await errorOf(
      setUpSendingDomain(
        failWith(401, {
          name: 'restricted_api_key',
          message: 'This API key is restricted to only send emails',
        }).client,
        DOMAIN,
      ),
    )
    expect(e.message).toMatch(/full-access key/)
  })

  it('network failure → unreachable, without the thrown text (which held the key)', async () => {
    const e = await errorOf(setUpSendingDomain(stub({ 'GET /domains': () => 'throw' }).client, DOMAIN))
    expect(e.code).toBe('unreachable')
  })

  it('other refusals keep Resend’s message, scrubbed of any key', async () => {
    const e = await errorOf(
      setUpSendingDomain(
        failWith(422, { name: 'invalid_parameter', message: `Bad name for ${KEY} and re_otherKey123` })
          .client,
        DOMAIN,
      ),
    )
    expect(e.code).toBe('failed')
    expect(e.message).toBe('Resend refused the request (422 invalid_parameter): Bad name for … and re_…')
  })
})

describe('namecheapHost', () => {
  it.each([
    ['send', 'send'],
    ['resend._domainkey', 'resend._domainkey'],
    [`resend._domainkey.${DOMAIN}`, 'resend._domainkey'],
    [`send.${DOMAIN}.`, 'send'],
    [DOMAIN, '@'],
    ['', '@'],
    ['send.other.co', 'send.other.co'],
  ])('%s → %s', (name, host) => {
    expect(namecheapHost(name, DOMAIN)).toBe(host)
  })
})

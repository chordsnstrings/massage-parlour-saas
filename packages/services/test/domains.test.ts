import { closeAllDbs, domains, tenants } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addDomain,
  apexOf,
  type CfConfig,
  cfCreateHostname,
  checkDomain,
  cloudflareConfig,
  cnameTarget,
  type DnsLookup,
  type DomainDeps,
  type DomainRow,
  dnsRecordsFor,
  evaluateDomain,
  forceDomainStatus,
  isDomainCheckDue,
  normaliseHostname,
  removeDomain,
  setPrimaryDomain,
  tenantDomainRun,
} from '../src'

const ROOT = 'spamanagement.ae'
const TARGET = 'customers.spamanagement.ae'
const env = { ROOT_DOMAIN: ROOT, CF_CNAME_TARGET: TARGET, APP_URL: 'https://app.spamanagement.ae' }
const TOKEN = 'spamanagement-verify=abc123'

// ---------------------------------------------------------------------------
// Fakes: DNS answers by name and a recording Cloudflare API.
// ---------------------------------------------------------------------------

const dnsError = (code: string) => Object.assign(new Error(code), { code })
type Answers = {
  txt?: Record<string, string[][] | string>
  cname?: Record<string, string[] | string>
  a?: Record<string, string[] | string>
}
function fakeDns(answers: Answers): DnsLookup {
  const pick = <T>(table: Record<string, T | string> | undefined, name: string): Promise<T> => {
    const v = table?.[name]
    if (v === undefined) return Promise.reject(dnsError('ENOTFOUND'))
    if (typeof v === 'string') return Promise.reject(dnsError(v))
    return Promise.resolve(v)
  }
  return {
    txt: (n) => pick(answers.txt, n),
    cname: (n) => pick(answers.cname, n),
    a: (n) => pick(answers.a, n),
  }
}

type Call = { method: string; url: string; auth: string | null; body: unknown }
function fakeCloudflare(handler: (c: Call) => { status?: number; json: unknown }) {
  const calls: Call[] = []
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      url,
      auth: new Headers(init?.headers).get('authorization'),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    }
    calls.push(call)
    const { status = 200, json } = handler(call)
    return new Response(JSON.stringify(json), { status })
  }) as typeof fetch
  const cfg = cloudflareConfig({ CF_API_TOKEN: 'secret-token', CF_ZONE_ID: 'zone1' }, fetchImpl)!
  return { cfg, calls }
}
const cfHost = (status: string, ssl: string, extra: Record<string, unknown> = {}) => ({
  success: true,
  errors: [],
  result: { id: 'cf-1', hostname: 'www.serenity.ae', status, ssl: { status: ssl }, ...extra },
})

const now = new Date('2026-10-06T08:00:00Z')
const deps = (dns: DnsLookup, cf: CfConfig | null = null, at = now): DomainDeps => ({
  dns,
  cf,
  env,
  now: () => at,
})
const row = (over: Partial<DomainRow> = {}): DomainRow => ({
  id: '00000000-0000-4000-8000-000000000001',
  tenantId: '00000000-0000-4000-8000-000000000002',
  hostname: 'www.serenity.ae',
  kind: 'custom',
  status: 'pending',
  isPrimary: false,
  cfHostnameId: null,
  verificationToken: TOKEN,
  sslStatus: null,
  lastError: null,
  checkedAt: null,
  verifiedAt: null,
  createdAt: new Date(now.getTime() - 3600_000),
  ...over,
})
const txtOk = { '_spamanagement.www.serenity.ae': [[TOKEN]] }
const cnameOk = { 'www.serenity.ae': [`${TARGET}.`] }

describe('normaliseHostname', () => {
  it.each([
    ['www.Serenity.ae', 'www.serenity.ae'],
    ['  https://WWW.serenity.ae/booking?x=1 ', 'www.serenity.ae'],
    ['http://user@www.serenity.ae:8443/', 'www.serenity.ae'],
    ['www.serenity.ae.', 'www.serenity.ae'],
    ['münchen-spa.de', 'xn--mnchen-spa-9db.de'],
    ['مثال.امارات', 'xn--mgbh0fb.xn--mgbaam7a8h'],
    ['spa.co.ae', 'spa.co.ae'],
  ])('%s → %s', (input, expected) => {
    expect(normaliseHostname(input, ROOT)).toBe(expected)
  })

  it.each([
    ['', /Enter your domain/],
    ['1.2.3.4', /IP address/],
    ['http://1.2.3.4:8080/x', /IP address/],
    ['[::1]:3000', /IP address/],
    ['::1', /IP address/],
    ['0x7f.1', /IP address/],
    ['localhost', /public internet/],
    ['spa.localhost', /public internet/],
    ['printer.local', /public internet/],
    ['serenity', /full domain/],
    ['spamanagement.ae', /already included/],
    ['pilot.spamanagement.ae', /already included/],
    ['https://www.SpaManagement.ae/', /already included/],
    ['bad_label.ae', /valid domain/],
    ['-dash.ae', /valid domain/],
    ['a..ae', /valid domain/],
    ['spa.123', /valid domain/],
    [`${'a'.repeat(64)}.ae`, /valid domain/],
    [`${'abcdefghi.'.repeat(26)}ae`, /too long/],
    ['*.serenity.ae', /valid domain/],
  ])('rejects %s', (input, error) => {
    expect(() => normaliseHostname(input, ROOT)).toThrow(error)
  })

  it('ignores a dev port on the root domain', () => {
    expect(() => normaliseHostname('pilot.localhost', 'localhost:3000')).toThrow()
    // Every platform domain counts, not just the canonical one.
    expect(() => normaliseHostname('pilot.old-platform.ae', [ROOT, 'old-platform.ae'])).toThrow(
      'old-platform.ae',
    )
    expect(normaliseHostname('www.serenity.ae', 'localhost:3000')).toBe('www.serenity.ae')
  })

  it('drops trailing dots in linear time', () => {
    expect(normaliseHostname('www.serenity.ae...', ROOT)).toBe('www.serenity.ae')
    expect(cnameTarget({ CF_CNAME_TARGET: ' Edge.Example.com.:443 ' })).toBe('edge.example.com')
    const t = Date.now()
    expect(() => normaliseHostname(`a${'.'.repeat(200_000)}a`, ROOT)).toThrow()
    expect(cnameTarget({ CF_CNAME_TARGET: `a${'.'.repeat(200_000)}a` })).toHaveLength(200_002)
    expect(Date.now() - t).toBeLessThan(500)
  })
})

describe('DNS records', () => {
  it('builds the TXT + CNAME pair with zone-relative names', () => {
    expect(apexOf('www.serenity.co.ae')).toBe('serenity.co.ae')
    expect(dnsRecordsFor({ hostname: 'www.serenity.ae', verificationToken: TOKEN }, env)).toEqual([
      { type: 'TXT', name: '_spamanagement.www.serenity.ae', host: '_spamanagement.www', value: TOKEN },
      { type: 'CNAME', name: 'www.serenity.ae', host: 'www', value: TARGET },
    ])
    const apex = dnsRecordsFor({ hostname: 'serenity.ae', verificationToken: TOKEN }, env)
    expect(apex.map((r) => r.host)).toEqual(['_spamanagement', '@'])
  })

  it('falls back to the app host when Cloudflare is not configured', () => {
    const [, cname] = dnsRecordsFor(
      { hostname: 'www.serenity.ae', verificationToken: TOKEN },
      { APP_URL: 'http://app.localhost:3000' },
    )
    expect(cname!.value).toBe('app.localhost')
  })
})

describe('evaluateDomain state machine', () => {
  it('stays pending until the TXT record shows up', async () => {
    const p = await evaluateDomain(row(), deps(fakeDns({})))
    expect(p.status).toBe('pending')
    expect(p.lastError).toMatch(/couldn't find the TXT record _spamanagement\.www\.serenity\.ae/)
    expect(p.checkedAt).toEqual(now)
  })

  it('keeps pending (no failure) on DNS timeouts and reports a wrong TXT value', async () => {
    const timeout = await evaluateDomain(
      row(),
      deps(fakeDns({ txt: { '_spamanagement.www.serenity.ae': 'ETIMEOUT' } })),
    )
    expect(timeout).toMatchObject({ status: 'pending', lastError: expect.stringMatching(/ETIMEOUT/) })
    const wrong = await evaluateDomain(
      row(),
      deps(fakeDns({ txt: { '_spamanagement.www.serenity.ae': [['google-site-verification=x']] } })),
    )
    expect(wrong.lastError).toMatch(/doesn't contain your verification code/)
  })

  it('moves to verifying when ownership is proven but the CNAME is missing or wrong', async () => {
    const missing = await evaluateDomain(row(), deps(fakeDns({ txt: txtOk })))
    expect(missing).toMatchObject({ status: 'verifying', lastError: expect.stringMatching(/CNAME record/) })
    const wrong = await evaluateDomain(
      row(),
      deps(fakeDns({ txt: txtOk, cname: { 'www.serenity.ae': ['old-host.wix.com'] } })),
    )
    expect(wrong.lastError).toMatch(/points at old-host\.wix\.com instead of customers\.spamanagement\.ae/)
  })

  it('activates without Cloudflare once TXT + CNAME are right (chunked TXT values join)', async () => {
    const p = await evaluateDomain(
      row(),
      deps(
        fakeDns({
          txt: { '_spamanagement.www.serenity.ae': [['spamanagement-', 'verify=abc123']] },
          cname: cnameOk,
        }),
      ),
    )
    expect(p).toMatchObject({ status: 'active', lastError: null, verifiedAt: now, sslStatus: null })
  })

  it('accepts flattened apex records that resolve to the target addresses', async () => {
    const p = await evaluateDomain(
      row({ hostname: 'serenity.ae' }),
      deps(
        fakeDns({
          txt: { '_spamanagement.serenity.ae': [[TOKEN]] },
          cname: { 'serenity.ae': 'ENODATA' },
          a: { 'serenity.ae': ['104.16.1.1'], [TARGET]: ['104.16.1.1', '104.16.2.2'] },
        }),
      ),
    )
    expect(p.status).toBe('active')
  })

  it('creates the Cloudflare hostname and waits for the certificate', async () => {
    const { cfg, calls } = fakeCloudflare(() => ({ json: cfHost('pending', 'pending_validation') }))
    const p = await evaluateDomain(row(), deps(fakeDns({ txt: txtOk, cname: cnameOk }), cfg))
    expect(p).toMatchObject({ status: 'verifying', cfHostnameId: 'cf-1', sslStatus: 'pending_validation' })
    expect(p.lastError).toMatch(/Cloudflare is still setting up/)
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.cloudflare.com/client/v4/zones/zone1/custom_hostnames',
      auth: 'Bearer secret-token',
      body: {
        hostname: 'www.serenity.ae',
        ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
      },
    })
  })

  it('refreshes an existing Cloudflare hostname and activates when hostname + SSL are active', async () => {
    const { cfg, calls } = fakeCloudflare(() => ({ json: cfHost('active', 'active') }))
    const p = await evaluateDomain(
      row({ status: 'verifying', cfHostnameId: 'cf-1' }),
      deps(fakeDns({ txt: txtOk, cname: cnameOk }), cfg),
    )
    expect(p).toMatchObject({ status: 'active', sslStatus: 'active', lastError: null })
    expect(calls.map((c) => `${c.method} ${c.url.split('/zones/zone1')[1]}`)).toEqual([
      'GET /custom_hostnames/cf-1',
    ])
  })

  it('fails when Cloudflare blocks the hostname, and never leaks the token in errors', async () => {
    const { cfg } = fakeCloudflare(() => ({
      json: cfHost('blocked', 'pending_validation', { verification_errors: ['custom hostname is blocked'] }),
    }))
    const p = await evaluateDomain(row(), deps(fakeDns({ txt: txtOk, cname: cnameOk }), cfg))
    expect(p.status).toBe('failed')
    expect(p.lastError).toMatch(/custom hostname is blocked/)

    const down = fakeCloudflare(() => ({
      status: 403,
      json: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] },
    }))
    const q = await evaluateDomain(row(), deps(fakeDns({ txt: txtOk, cname: cnameOk }), down.cfg))
    expect(q).toMatchObject({ status: 'verifying', lastError: 'Cloudflare: Authentication error' })
    expect(JSON.stringify(q)).not.toContain('secret-token')
  })

  it('reuses an existing hostname when Cloudflare reports a duplicate', async () => {
    const { cfg, calls } = fakeCloudflare((c) =>
      c.method === 'POST'
        ? {
            status: 409,
            json: { success: false, errors: [{ code: 1406, message: 'Duplicate custom hostname found.' }] },
          }
        : { json: { success: true, errors: [], result: [cfHost('active', 'active').result] } },
    )
    const h = await cfCreateHostname(cfg, 'www.serenity.ae')
    expect(h).toMatchObject({ id: 'cf-1', active: true })
    expect(calls[1]!.url).toContain('custom_hostnames?hostname=www.serenity.ae')
  })

  it('takes an active domain down only on definitive DNS answers', async () => {
    const active = row({ status: 'active', verifiedAt: now })
    const gone = await evaluateDomain(active, deps(fakeDns({})))
    expect(gone).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/no longer served/) })
    const flaky = await evaluateDomain(active, deps(fakeDns({ cname: { 'www.serenity.ae': 'ESERVFAIL' } })))
    expect(flaky).toMatchObject({ status: 'active', lastError: expect.stringMatching(/ESERVFAIL/) })
    // Ownership isn't re-checked once active: no TXT needed.
    const fine = await evaluateDomain(active, deps(fakeDns({ cname: cnameOk })))
    expect(fine).toMatchObject({ status: 'active', lastError: null })
  })

  it('automatic checks give up after 7 days; manual checks keep trying', async () => {
    const old = row({ createdAt: new Date(now.getTime() - 8 * 86_400_000) })
    const auto = await evaluateDomain(old, deps(fakeDns({})), { automatic: true })
    expect(auto).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/stopped checking/) })
    const manual = await evaluateDomain(old, deps(fakeDns({})))
    expect(manual.status).toBe('pending')
  })

  it('a domain that connected before keeps its proof and is never given up on', async () => {
    const reconnecting = row({
      status: 'verifying',
      verifiedAt: new Date(now.getTime() - 30 * 86_400_000),
      createdAt: new Date(now.getTime() - 60 * 86_400_000),
    })
    // No TXT any more (owners clean up), CNAME not back yet: keeps verifying instead of failing after 7 days.
    const waiting = await evaluateDomain(reconnecting, deps(fakeDns({})), { automatic: true })
    expect(waiting).toMatchObject({ status: 'verifying', lastError: expect.stringMatching(/CNAME record/) })
    const back = await evaluateDomain(
      { ...reconnecting, status: 'failed' },
      deps(fakeDns({ cname: cnameOk })),
    )
    expect(back).toMatchObject({ status: 'active', lastError: null })
  })

  it('trusts an active Cloudflare hostname when the records sit behind the owner’s Cloudflare proxy', async () => {
    const { cfg } = fakeCloudflare(() => ({ json: cfHost('active', 'active') }))
    const proxied = fakeDns({
      txt: txtOk,
      cname: { 'www.serenity.ae': 'ENODATA' },
      a: { 'www.serenity.ae': ['172.67.1.1'], [TARGET]: ['104.16.1.1'] },
    })
    const p = await evaluateDomain(row({ cfHostnameId: 'cf-1' }), deps(proxied, cfg))
    expect(p).toMatchObject({ status: 'active', lastError: null })
    const kept = await evaluateDomain(
      row({ status: 'active', verifiedAt: now, cfHostnameId: 'cf-1' }),
      deps(proxied, cfg),
      { automatic: true },
    )
    expect(kept.status).toBe('active')
  })

  it('manual checks restart a Cloudflare hostname that gave up; automatic ones only report it', async () => {
    const timedOut = cfHost('pending', 'validation_timed_out')
    const patched = cfHost('pending', 'pending_validation')
    const handler = (c: { method: string }) => ({ json: c.method === 'PATCH' ? patched : timedOut })
    const dns = fakeDns({ txt: txtOk, cname: cnameOk })
    const auto = fakeCloudflare(handler)
    const a = await evaluateDomain(row({ cfHostnameId: 'cf-1' }), deps(dns, auto.cfg), { automatic: true })
    expect(a).toMatchObject({ status: 'failed', lastError: expect.stringMatching(/validation_timed_out/) })
    expect(auto.calls.map((c) => c.method)).toEqual(['GET'])

    const manual = fakeCloudflare(handler)
    const m = await evaluateDomain(row({ status: 'failed', cfHostnameId: 'cf-1' }), deps(dns, manual.cfg))
    expect(m).toMatchObject({ status: 'verifying', sslStatus: 'pending_validation' })
    expect(manual.calls.map((c) => c.method)).toEqual(['GET', 'PATCH'])
    expect(manual.calls[1]!.body).toEqual({
      ssl: { method: 'http', type: 'dv', settings: { min_tls_version: '1.2' } },
    })

    // A moved hostname is recreated; a blocked one is left for Cloudflare support.
    const moved = fakeCloudflare((c) => ({
      json:
        c.method === 'GET' ? cfHost('moved', 'active') : c.method === 'POST' ? patched : { success: true },
    }))
    await evaluateDomain(row({ status: 'failed', cfHostnameId: 'cf-1' }), deps(dns, moved.cfg))
    expect(moved.calls.map((c) => c.method)).toEqual(['GET', 'DELETE', 'POST'])
    const blocked = fakeCloudflare(() => ({ json: cfHost('blocked', 'active') }))
    const b = await evaluateDomain(row({ status: 'failed', cfHostnameId: 'cf-1' }), deps(dns, blocked.cfg))
    expect(b.status).toBe('failed')
    expect(blocked.calls.map((c) => c.method)).toEqual(['GET'])
  })
})

describe('isDomainCheckDue', () => {
  const at = (ms: number) => new Date(now.getTime() - ms)
  const MIN = 60_000
  it('checks new domains every 10 minutes, hourly after a day, active daily, failed never', () => {
    expect(isDomainCheckDue({ status: 'pending', createdAt: at(MIN), checkedAt: null }, now)).toBe(true)
    expect(
      isDomainCheckDue({ status: 'pending', createdAt: at(60 * MIN), checkedAt: at(5 * MIN) }, now),
    ).toBe(false)
    expect(
      isDomainCheckDue({ status: 'verifying', createdAt: at(60 * MIN), checkedAt: at(10 * MIN) }, now),
    ).toBe(true)
    const old = at(2 * 86_400_000)
    expect(isDomainCheckDue({ status: 'pending', createdAt: old, checkedAt: at(20 * MIN) }, now)).toBe(false)
    expect(isDomainCheckDue({ status: 'pending', createdAt: old, checkedAt: at(60 * MIN) }, now)).toBe(true)
    expect(isDomainCheckDue({ status: 'active', createdAt: old, checkedAt: at(3 * 3600_000) }, now)).toBe(
      false,
    )
    expect(isDomainCheckDue({ status: 'active', createdAt: old, checkedAt: at(24 * 3600_000) }, now)).toBe(
      true,
    )
    expect(isDomainCheckDue({ status: 'failed', createdAt: old, checkedAt: null }, now)).toBe(false)
  })
})

describe('domain lifecycle (database, RLS)', () => {
  const { platform, app } = testDbs()
  const ids = {} as Record<'a' | 'b', string>
  const runA = () => tenantDomainRun(ids.a, app)
  const runB = () => tenantDomainRun(ids.b, app)

  beforeAll(async () => {
    await resetTestDatabase()
    const [a] = await platform.insert(tenants).values({ slug: 'dom-a', name: 'A' }).returning()
    const [b] = await platform.insert(tenants).values({ slug: 'dom-b', name: 'B' }).returning()
    ids.a = a!.id
    ids.b = b!.id
  })
  afterAll(closeAllDbs)

  it('adds one custom domain per spa with a token, unique across spas', async () => {
    const d = await addDomain(runA(), ids.a, 'https://WWW.Serenity.ae/', env)
    expect(d).toMatchObject({
      hostname: 'www.serenity.ae',
      kind: 'custom',
      status: 'pending',
      isPrimary: false,
    })
    expect(d.verificationToken).toMatch(/^spamanagement-verify=[0-9a-f]{24}$/)
    await expect(addDomain(runA(), ids.a, 'www.serenity.ae', env)).rejects.toThrow(/already added/)
    await expect(addDomain(runA(), ids.a, 'www.other.ae', env)).rejects.toThrow(/one custom domain/)
    await expect(addDomain(runB(), ids.b, 'www.serenity.ae', env, { platform })).rejects.toThrow(
      /another spa/,
    )
    await expect(addDomain(runB(), ids.b, 'b.spamanagement.ae', env)).rejects.toThrow(/already included/)
  })

  it('checks, activates as primary, switches primary, and is invisible to other spas', async () => {
    const [d] = await platform.select().from(domains).where(eq(domains.tenantId, ids.a))
    const pending = await checkDomain(runA(), d!.id, { deps: deps(fakeDns({})) })
    expect(pending.status).toBe('pending')
    await expect(checkDomain(runB(), d!.id, { deps: deps(fakeDns({})) })).rejects.toThrow(/not found/)

    const dns = fakeDns({
      txt: { '_spamanagement.www.serenity.ae': [[d!.verificationToken!]] },
      cname: cnameOk,
    })
    const active = await checkDomain(runA(), d!.id, { deps: deps(dns) })
    expect(active).toMatchObject({ status: 'active', isPrimary: true, lastError: null })

    await setPrimaryDomain(runA(), ids.a, null)
    const [afterUnset] = await platform.select().from(domains).where(eq(domains.id, d!.id))
    expect(afterUnset!.isPrimary).toBe(false)
    // A later re-check doesn't override the owner's choice.
    expect((await checkDomain(runA(), d!.id, { deps: deps(dns) })).isPrimary).toBe(false)
    await setPrimaryDomain(runA(), ids.a, d!.id)
    await expect(setPrimaryDomain(runB(), ids.b, d!.id)).rejects.toThrow(/not found/)
  })

  it('support can force-deactivate and force-activate (platform role)', async () => {
    const [d] = await platform.select().from(domains).where(eq(domains.tenantId, ids.a))
    const run = <T>(fn: (db: typeof platform) => Promise<T>) => fn(platform)
    const off = await forceDomainStatus(run, d!.id, 'deactivate', {
      deps: deps(fakeDns({})),
      reason: 'Abuse report',
    })
    expect(off).toMatchObject({ status: 'failed', lastError: 'Abuse report' })
    await expect(setPrimaryDomain(runA(), ids.a, d!.id)).rejects.toThrow(/connected domain/)
    const on = await forceDomainStatus(run, d!.id, 'activate', { deps: deps(fakeDns({})) })
    expect(on).toMatchObject({ status: 'active', lastError: null })
  })

  it('removes the domain and its Cloudflare hostname', async () => {
    const [d] = await platform.select().from(domains).where(eq(domains.tenantId, ids.a))
    await platform.update(domains).set({ cfHostnameId: 'cf-1' }).where(eq(domains.id, d!.id))
    const failing = fakeCloudflare(() => ({
      status: 500,
      json: { success: false, errors: [{ message: 'boom' }] },
    }))
    await expect(removeDomain(runA(), d!.id, { cf: failing.cfg })).rejects.toThrow(/Couldn't remove/)
    const { cfg, calls } = fakeCloudflare(() => ({
      json: { success: true, errors: [], result: { id: 'cf-1' } },
    }))
    await removeDomain(runA(), d!.id, { cf: cfg })
    expect(calls).toMatchObject([{ method: 'DELETE', url: expect.stringMatching(/custom_hostnames\/cf-1$/) }])
    expect(await platform.select().from(domains).where(eq(domains.tenantId, ids.a))).toHaveLength(0)
    // The hostname is free again for another spa.
    expect((await addDomain(runB(), ids.b, 'www.serenity.ae', env)).tenantId).toBe(ids.b)
  })

  it('refuses manual checks in quick succession', async () => {
    const [d] = await platform.select().from(domains).where(eq(domains.tenantId, ids.b))
    const clock = deps(fakeDns({}), null, new Date())
    await checkDomain(runB(), d!.id, { deps: clock, cooldownMs: 30_000 })
    await expect(checkDomain(runB(), d!.id, { deps: clock, cooldownMs: 30_000 })).rejects.toThrow(
      /Checked a moment ago — try again in \d+ seconds/,
    )
    // The worker and support aren't throttled.
    expect((await checkDomain(runB(), d!.id, { deps: clock })).status).toBe('pending')
  })

  it('serialises adds per spa so the one-domain limit holds under concurrent submits', async () => {
    const [c] = await platform.insert(tenants).values({ slug: 'dom-c', name: 'C' }).returning()
    const runC = tenantDomainRun(c!.id, app)
    const results = await Promise.allSettled([
      addDomain(runC, c!.id, 'www.one.ae', env),
      addDomain(runC, c!.id, 'www.two.ae', env),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await platform.select().from(domains).where(eq(domains.tenantId, c!.id))).toHaveLength(1)
  })

  it('releases a claim that never connected within 7 days, or one left by a cancelled spa', async () => {
    const [d] = await platform.insert(tenants).values({ slug: 'dom-d', name: 'D' }).returning()
    const runD = tenantDomainRun(d!.id, app)
    const released: string[] = []
    const opts = {
      platform,
      deps: { cf: null, now: () => new Date() },
      onRelease: async (claim: { hostname: string }) => {
        released.push(claim.hostname)
      },
    }
    // B's claim on www.serenity.ae is fresh: still taken.
    await expect(addDomain(runD, d!.id, 'www.serenity.ae', env, opts)).rejects.toThrow(/another spa/)
    // Eight days old and never connected: D takes it over (and must prove the TXT record itself).
    await platform
      .update(domains)
      .set({ createdAt: new Date(Date.now() - 8 * 86_400_000) })
      .where(eq(domains.tenantId, ids.b))
    const took = await addDomain(runD, d!.id, 'www.serenity.ae', env, opts)
    expect(took).toMatchObject({ tenantId: d!.id, status: 'pending' })
    expect(released).toEqual(['www.serenity.ae'])
    expect(await platform.select().from(domains).where(eq(domains.tenantId, ids.b))).toHaveLength(0)

    // A connected domain is never released, unless its spa is cancelled.
    await platform
      .update(domains)
      .set({ status: 'active', verifiedAt: new Date(0), createdAt: new Date(0) })
      .where(eq(domains.id, took.id))
    await expect(addDomain(runB(), ids.b, 'www.serenity.ae', env, opts)).rejects.toThrow(/another spa/)
    await platform.update(tenants).set({ status: 'cancelled' }).where(eq(tenants.id, d!.id))
    expect((await addDomain(runB(), ids.b, 'www.serenity.ae', env, opts)).tenantId).toBe(ids.b)
  })
})

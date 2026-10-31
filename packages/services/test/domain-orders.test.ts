import {
  branches,
  closeAllDbs,
  domainOrders,
  domains,
  members,
  platformSettings,
  roles,
  type Tx,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  aedFromUsd,
  approveDomainOrder,
  cancelDomainOrder,
  DEFAULT_DOMAIN_MARKUP_USD,
  DomainError,
  type DomainRun,
  domainCandidates,
  domainMarkupUsd,
  domainPrice,
  listDomainOrders,
  namecheapConfig,
  rejectDomainOrder,
  requestDomain,
  searchDomains,
  splitName,
  tenantDomainRun,
} from '../src'

const cfg = namecheapConfig({
  NAMECHEAP_API_USER: 'spa',
  NAMECHEAP_API_KEY: 'k',
  NAMECHEAP_CLIENT_IP: '1.2.3.4',
})!
const env = { ROOT_DOMAIN: 'spamanagement.ae', CF_CNAME_TARGET: 'customers.spamanagement.ae' }
const ok = (inner: string) =>
  `<?xml version="1.0"?><ApiResponse Status="OK"><CommandResponse>${inner}</CommandResponse></ApiResponse>`

/** Fake Namecheap: everything is available except taken.com; .com costs USD 11.28. */
function fakeNamecheap() {
  const calls: { command: string; params: URLSearchParams }[] = []
  const f = vi.fn(async (_url: string, init?: RequestInit) => {
    const params = new URLSearchParams(String(init?.body ?? ''))
    const command = params.get('Command') ?? ''
    calls.push({ command, params })
    if (command === 'namecheap.domains.check') {
      const list = (params.get('DomainList') ?? '').split(',')
      return new Response(
        ok(
          list
            .map(
              (d) =>
                `<DomainCheckResult Domain="${d}" Available="${d.startsWith('taken.') ? 'false' : 'true'}" IsPremiumName="false" PremiumRegistrationPrice="0"/>`,
            )
            .join(''),
        ),
      )
    }
    if (command === 'namecheap.users.getPricing') {
      const tld = (params.get('ProductName') ?? '').toLowerCase()
      const price = tld === 'com' ? '11.28' : tld === 'spa' ? '' : '20.00'
      return new Response(
        ok(price ? `<Price Duration="1" DurationType="YEAR" Price="${price}" YourPrice="${price}"/>` : ''),
      )
    }
    if (command === 'namecheap.domains.create')
      return new Response(
        ok(
          `<DomainCreateResult Domain="${params.get('DomainName')}" Registered="true" ChargedAmount="11.28" DomainID="9001" OrderID="77" TransactionID="88"/>`,
        ),
      )
    if (command === 'namecheap.domains.dns.setHosts')
      return new Response(ok('<DomainDNSSetHostsResult Domain="x" IsSuccess="true"/>'))
    return new Response(ok(''))
  })
  return { fetch: f as unknown as typeof fetch, calls }
}

describe('domain order helpers', () => {
  it('builds candidates from a name or a domain', () => {
    expect(domainCandidates('Serenity Spa!')[0]).toBe('serenityspa.com')
    expect(domainCandidates('https://www.serenity.net/x')).toEqual(
      expect.arrayContaining(['serenity.net', 'serenity.com']),
    )
    expect(domainCandidates('serenity.net')[0]).toBe('serenity.net')
    expect(domainCandidates('  ')).toEqual([])
    expect(() => domainCandidates('!!!')).toThrow(DomainError)
  })

  it('splits names and converts prices to whole dirhams', () => {
    expect(splitName('Aisha Al Mansoori')).toEqual({ firstName: 'Aisha', lastName: 'Al Mansoori' })
    expect(splitName('Madonna')).toEqual({ firstName: 'Madonna', lastName: 'Madonna' })
    expect(aedFromUsd(11.28)).toBe(42)
  })

  it('adds the markup once per order, not per year', () => {
    expect(domainPrice(11.28, 1, 10)).toEqual({ usd: 21.28, aed: 79 })
    expect(domainPrice(11.28, 2, 10)).toEqual({ usd: 32.56, aed: 120 })
    expect(domainPrice(11.28, 1, 0)).toEqual({ usd: 11.28, aed: 42 })
  })

  it('searches with live prices and flags unpriced TLDs', async () => {
    const nc = fakeNamecheap()
    const { configured, offers } = await searchDomains('serenity', { cfg, fetch: nc.fetch, markupUsd: 10 })
    expect(configured).toBe(true)
    expect(offers.find((o) => o.domain === 'serenity.com')).toMatchObject({
      available: true,
      // Registrar USD 11.28 + USD 10 markup = 21.28 → AED 79 (rounded up).
      priceUsd: 21.28,
      priceAed: 79,
    })
    expect(offers.find((o) => o.domain === 'serenity.spa')).toMatchObject({
      available: false,
      note: 'Price unavailable',
    })
    expect(await searchDomains('x', { cfg: null })).toEqual({ configured: false, offers: [] })
  })
})

describe('domain orders (db)', () => {
  const { platform, app } = testDbs()
  const ids = {} as { a: string; b: string; owner: string; admin: string }

  beforeAll(async () => {
    await resetTestDatabase()
    const [a] = await platform
      .insert(tenants)
      .values({ slug: 'buy-a', name: 'Serenity', legalName: 'Serenity Spa LLC' })
      .returning()
    const [b] = await platform.insert(tenants).values({ slug: 'buy-b', name: 'Other' }).returning()
    ids.a = a!.id
    ids.b = b!.id
    const now = new Date()
    await platform.insert(user).values([
      {
        id: 'u-owner',
        name: 'Aisha Al Mansoori',
        email: 'aisha@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'u-admin',
        name: 'Ops',
        email: 'ops@example.com',
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    ])
    ids.owner = 'u-owner'
    ids.admin = 'u-admin'
    const [role] = await platform
      .insert(roles)
      .values({ tenantId: ids.a, key: 'owner', name: 'Owner' })
      .returning()
    await platform.insert(members).values({ tenantId: ids.a, userId: ids.owner, roleId: role!.id })
    await platform.insert(branches).values({
      tenantId: ids.a,
      name: 'Main',
      isDefault: true,
      address: 'JLT Cluster D',
      phone: '+971 50 123 4567',
    })
  })
  afterAll(closeAllDbs)

  const asA = <T>(fn: (tx: Tx) => Promise<T>) => withTenant(ids.a, fn, app)
  const runA: DomainRun = (fn) => tenantDomainRun(ids.a, app)(fn)
  const runB: DomainRun = (fn) => tenantDomainRun(ids.b, app)(fn)

  it('reads the markup from platform settings (default USD 10)', async () => {
    expect(await domainMarkupUsd(platform)).toBe(DEFAULT_DOMAIN_MARKUP_USD)
    await platform.insert(platformSettings).values({ id: 1, domainMarkupUsd: '4.50' })
    expect(await domainMarkupUsd(platform)).toBe(4.5)
    const nc = fakeNamecheap()
    const { offers } = await searchDomains('serenity', { cfg, fetch: nc.fetch, db: platform })
    expect(offers.find((o) => o.domain === 'serenity.com')).toMatchObject({ priceUsd: 15.78, priceAed: 58 })
    await platform.delete(platformSettings)
  })

  it('requests, blocks duplicates across spas, cancels and rejects', async () => {
    const nc = fakeNamecheap()
    const order = await requestDomain(
      runA,
      { tenantId: ids.a, domain: 'SerenitySpa.com', userId: ids.owner },
      { cfg, fetch: nc.fetch, db: platform },
    )
    expect(order).toMatchObject({
      domain: 'serenityspa.com',
      status: 'requested',
      priceUsd: '21.28',
      priceAed: '79.00',
      markupUsd: '10.00',
      years: 1,
    })
    await expect(
      requestDomain(
        runB,
        { tenantId: ids.b, domain: 'serenityspa.com', userId: ids.owner },
        { cfg, fetch: nc.fetch, db: platform },
      ),
    ).rejects.toThrow(/already requested/)
    await expect(
      requestDomain(
        runA,
        { tenantId: ids.a, domain: 'taken.com', userId: ids.owner },
        { cfg, fetch: nc.fetch, db: platform },
      ),
    ).rejects.toThrow(/not available/)
    await expect(
      requestDomain(runA, { tenantId: ids.a, domain: 'x.com', userId: ids.owner }, { cfg: null }),
    ).rejects.toThrow(DomainError)

    // spa B can't see spa A's orders (RLS)
    expect(await withTenant(ids.b, (tx) => tx.select().from(domainOrders), app)).toHaveLength(0)

    const other = await requestDomain(
      runA,
      { tenantId: ids.a, domain: 'serenity.net', userId: ids.owner },
      { cfg, fetch: nc.fetch, db: platform },
    )
    expect((await asA((tx) => cancelDomainOrder(tx, other.id))).status).toBe('cancelled')
    await expect(asA((tx) => cancelDomainOrder(tx, other.id))).rejects.toThrow(DomainError)

    const third = await requestDomain(
      runA,
      { tenantId: ids.a, domain: 'serenity.co', userId: ids.owner },
      { cfg, fetch: nc.fetch, db: platform },
    )
    expect(await rejectDomainOrder(third.id, ids.admin, 'Pick a .com', platform)).toMatchObject({
      status: 'rejected',
      note: 'Pick a .com',
    })
    await expect(rejectDomainOrder(third.id, ids.admin, 'again', platform)).rejects.toThrow(DomainError)

    const queue = await listDomainOrders(50, platform)
    expect(queue[0]).toMatchObject({ spa: 'Serenity', order: { status: 'requested' } })
  })

  it('approval registers, connects www and points DNS at the platform', async () => {
    const nc = fakeNamecheap()
    const [order] = await platform
      .select()
      .from(domainOrders)
      .where(eq(domainOrders.domain, 'serenityspa.com'))
    const done = await approveDomainOrder(order!.id, ids.admin, {
      cfg,
      fetch: nc.fetch,
      db: platform,
      app,
      env,
    })
    expect(done).toMatchObject({
      status: 'purchased',
      chargedUsd: '11.28',
      registrarOrderId: '77',
      registrarDomainId: '9001',
      error: null,
    })

    const create = nc.calls.find((c) => c.command === 'namecheap.domains.create')!.params
    expect(create.get('RegistrantOrganizationName')).toBe('Serenity Spa LLC')
    expect(create.get('RegistrantFirstName')).toBe('Aisha')
    expect(create.get('RegistrantPhone')).toBe('+971.501234567')
    const hosts = nc.calls.find((c) => c.command === 'namecheap.domains.dns.setHosts')!.params
    expect(hosts.get('HostName1')).toBe('www')
    expect(hosts.get('Address1')).toBe('customers.spamanagement.ae.')

    const [dom] = await platform.select().from(domains).where(eq(domains.id, done.domainId!))
    expect(dom).toMatchObject({ tenantId: ids.a, hostname: 'www.serenityspa.com' })
    expect(hosts.get('Address3')).toBe(dom!.verificationToken)

    // second approval is a no-op error, never a second purchase
    await expect(
      approveDomainOrder(order!.id, ids.admin, { cfg, fetch: nc.fetch, db: platform, app, env }),
    ).rejects.toThrow(/no longer waiting/)
    expect(nc.calls.filter((c) => c.command === 'namecheap.domains.create')).toHaveLength(1)
  })

  it('a registrar failure marks the order failed and can be retried', async () => {
    const nc = fakeNamecheap()
    const order = await requestDomain(
      runB,
      { tenantId: ids.b, domain: 'otherspa.com', userId: ids.owner },
      { cfg, fetch: nc.fetch, db: platform },
    )
    // spa B has no owner member → contacts fail before any registrar call
    await expect(
      approveDomainOrder(order.id, ids.admin, { cfg, fetch: nc.fetch, db: platform, app, env }),
    ).rejects.toThrow(/no active owner/)
    const [row] = await platform.select().from(domainOrders).where(eq(domainOrders.id, order.id))
    expect(row).toMatchObject({ status: 'failed', error: expect.stringMatching(/no active owner/) })
    expect(nc.calls.some((c) => c.command === 'namecheap.domains.create')).toBe(false)
  })
})

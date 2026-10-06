import { closeAllDbs, domains, tenants } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import type { DnsLookup, DomainDeps } from '@spa/services'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { verifyCustomDomains } from '../src/jobs/domains'

const TARGET = 'customers.spamanagement.ae'
const now = new Date('2026-10-06T08:00:00Z')
const ago = (ms: number) => new Date(now.getTime() - ms)
const HOUR = 3600_000
const { platform, app } = testDbs()

/** Every hostname has the right TXT (any token) and CNAME, so a due pending domain activates. */
const dns: DnsLookup = {
  txt: async (name) => {
    const [row] = await platform
      .select({ token: domains.verificationToken })
      .from(domains)
      .where(eq(domains.hostname, name.replace(/^_spamanagement\./, '')))
    return [[row?.token ?? '']]
  },
  cname: async () => [TARGET],
  a: async () => Promise.reject(Object.assign(new Error('ENODATA'), { code: 'ENODATA' })),
}
const deps: DomainDeps = { dns, cf: null, now: () => now, env: { CF_CNAME_TARGET: TARGET } }

describe('verifyCustomDomains (worker job)', () => {
  beforeAll(async () => {
    await resetTestDatabase()
    const [live] = await platform.insert(tenants).values({ slug: 'job-live', name: 'Live' }).returning()
    const [gone] = await platform
      .insert(tenants)
      .values({ slug: 'job-gone', name: 'Gone', status: 'cancelled' })
      .returning()
    const custom = { kind: 'custom' as const, verificationToken: 'spamanagement-verify=job' }
    await platform.insert(domains).values([
      // Due: new and never checked.
      { ...custom, tenantId: live!.id, hostname: 'www.due.ae', createdAt: ago(HOUR) },
      // Not due: active and checked an hour ago (active domains are re-checked daily).
      {
        ...custom,
        tenantId: live!.id,
        hostname: 'www.fresh.ae',
        status: 'active',
        verifiedAt: ago(2 * HOUR),
        checkedAt: ago(HOUR),
        createdAt: ago(3 * HOUR),
      },
      // Not due: failed domains wait for a manual check.
      { ...custom, tenantId: live!.id, hostname: 'www.failed.ae', status: 'failed', createdAt: ago(HOUR) },
      // Skipped: the spa is cancelled.
      { ...custom, tenantId: gone!.id, hostname: 'www.cancelled.ae', createdAt: ago(HOUR) },
    ])
  }, 60_000)
  afterAll(closeAllDbs)

  it('stops starting checks once the time budget is spent', async () => {
    expect(await verifyCustomDomains({ now, deps, platform, app, budgetMs: -1 })).toEqual({
      due: 1,
      checked: 0,
      changed: 0,
    })
  })

  it('checks only due domains of live spas inside withTenant and logs status changes', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    expect(await verifyCustomDomains({ now, deps, platform, app })).toEqual({
      due: 1,
      checked: 1,
      changed: 1,
    })
    const rows = await platform.select().from(domains)
    const status = Object.fromEntries(rows.map((r) => [r.hostname, r.status]))
    expect(status).toEqual({
      'www.due.ae': 'active',
      'www.fresh.ae': 'active',
      'www.failed.ae': 'failed',
      'www.cancelled.ae': 'pending',
    })
    expect(rows.find((r) => r.hostname === 'www.cancelled.ae')!.checkedAt).toBeNull()
    const logged = info.mock.calls.map(([line]) => JSON.parse(String(line)))
    expect(logged).toContainEqual(
      expect.objectContaining({
        msg: 'domain status changed',
        hostname: 'www.due.ae',
        from: 'pending',
        to: 'active',
      }),
    )
    info.mockRestore()
  })
})

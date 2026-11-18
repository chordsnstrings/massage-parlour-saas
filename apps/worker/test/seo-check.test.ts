// R30: the weekly search check — which spas it runs for, and one spa's error never stops the sweep.
import { aiAgentSettings, closeAllDbs, seoChecks, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs, testUrls } from '@spa/db/testing'
import { ensureSite, listPages, publishPage, runSeoCheck } from '@spa/services'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { weeklySeoChecks } from '../src/jobs/seo'

const failing = new Set<string>()
vi.mock('@spa/services', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@spa/services')>()
  return {
    ...mod,
    runSeoCheck: vi.fn((tx: Parameters<typeof mod.runSeoCheck>[0], tenantId: string, opts) => {
      if (failing.has(tenantId)) throw new Error('boom')
      return mod.runSeoCheck(tx, tenantId, opts)
    }),
  }
})

const { owner, app } = testDbs()

/** A spa with a site; `published` publishes its home page, `seo` sets the AI studio's SEO switch. */
async function seedSpa(
  slug: string,
  opts: { published?: boolean; seo?: boolean; status?: 'active' | 'suspended'; tier?: 'standard' } = {},
) {
  const [t] = await owner
    .insert(tenants)
    .values({ slug, name: slug, status: opts.status ?? 'active', featureTier: opts.tier ?? null })
    .returning()
  const id = t!.id
  await withTenant(
    id,
    async (tx) => {
      await ensureSite(tx, id, {
        key: 'zen',
        name: 'Zen',
        theme: {},
        pages: [
          {
            slug: '',
            title: { en: 'Home' },
            data: { root: { props: { title: { en: 'Home' } } }, content: [] },
          },
        ],
      })
      if (opts.published !== false)
        await publishPage(tx, { tenantId: id, pageId: (await listPages(tx, id))[0]!.id })
    },
    app,
  )
  if (opts.seo !== false)
    await owner.insert(aiAgentSettings).values({ tenantId: id, agentKey: 'seo_agent', enabled: true })
  return id
}

describe('weekly seo check (worker job)', () => {
  const ids = {} as Record<string, string>
  beforeAll(async () => {
    process.env.DATABASE_URL_PLATFORM = testUrls.platform
    process.env.DATABASE_URL_APP = testUrls.app
    await resetTestDatabase()
    ids.on = await seedSpa('seo-on')
    ids.broken = await seedSpa('seo-broken')
    ids.off = await seedSpa('seo-off', { seo: false })
    ids.standard = await seedSpa('seo-standard', { tier: 'standard' })
    ids.suspended = await seedSpa('seo-suspended', { status: 'suspended' })
    ids.unpublished = await seedSpa('seo-unpublished', { published: false })
    failing.add(ids.broken)
  }, 60_000)
  afterAll(closeAllDbs)

  it('checks only live spas with a published site, the SEO switch on and the ai feature; errors are skipped', async () => {
    expect(await weeklySeoChecks(new Date('2026-10-19T02:00:00Z'))).toBe(1)
    const rows = await owner.select().from(seoChecks)
    expect(rows.map((r) => [r.tenantId, r.trigger])).toEqual([[ids.on, 'weekly']])
    expect(rows[0]!.checkedAt.toISOString()).toBe('2026-10-19T02:00:00.000Z')
    // Home has no description: one high finding.
    expect(rows[0]!.counts).toEqual({ high: 1, medium: 0 })
    expect(
      vi
        .mocked(runSeoCheck)
        .mock.calls.map((c) => c[1])
        .sort(),
    ).toEqual([ids.on, ids.broken].sort())
  })
})

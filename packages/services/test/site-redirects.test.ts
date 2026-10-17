// R33: a spa's own redirects — save rules (upsert, page wins, loops, chains, limit), RLS, and the proxy's lookup.
import { closeAllDbs, domains, sitePosts, siteRedirects, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  deleteAllSiteRedirects,
  deleteSiteRedirects,
  ensureSite,
  listPages,
  listSiteRedirects,
  MAX_SITE_REDIRECTS,
  publishPage,
  type SiteRedirectInput,
  saveSiteRedirects,
  siteRedirectRules,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)
const save = (rows: SiteRedirectInput[], tenant = ids.tenant!, dryRun = false) =>
  tx((db) => saveSiteRedirects(db, tenant, rows, { source: 'import', dryRun }), tenant)
const rules = async (tenant = ids.tenant!) =>
  Object.fromEntries(
    (await tx((db) => listSiteRedirects(db, tenant), tenant)).map((r) => [
      r.fromQuery ? `${r.fromPath}?${r.fromQuery}` : r.fromPath,
      r.toPath,
    ]),
  )
const page = (title: string) => ({
  root: { props: { title: { en: title } } },
  content: [{ type: 'Heading', props: { id: 'h', text: { en: title } } }],
})

beforeAll(async () => {
  await resetTestDatabase()
  const [a, b] = await platform
    .insert(tenants)
    .values([
      { slug: 'redirect-spa', name: 'Redirect Spa' },
      { slug: 'redirect-other', name: 'Other Spa' },
    ])
    .returning()
  ids.tenant = a!.id
  ids.other = b!.id
  await tx(async (db) => {
    await ensureSite(db, ids.tenant!, {
      key: 'r',
      name: 'R',
      theme: {},
      pages: [
        { slug: '', title: { en: 'Home' }, data: page('Home') },
        { slug: 'services', title: { en: 'Services' }, data: page('Services') },
        { slug: 'about', title: { en: 'About' }, data: page('About') },
      ],
    })
    for (const p of await listPages(db, ids.tenant!)) ids[p.slug || 'home'] = p.id
    // Home + services live; about stays a draft for now.
    for (const p of ['home', 'services']) await publishPage(db, { tenantId: ids.tenant!, pageId: ids[p]! })
  })
  await platform
    .insert(sitePosts)
    .values({ tenantId: ids.tenant!, slug: 'hello', status: 'published', title: { en: 'Hello' } })
})
afterAll(() => closeAllDbs())

describe('site redirects (R33)', () => {
  it('adds and upserts on the old address; normalises; skips with reasons', async () => {
    const r = await save([
      { from: '/old-services', to: '/services' },
      { from: '/', query: 'p=12', to: '/services', line: 2 },
      { from: '/services', to: '/' }, // a live page
      { from: '/blog/hello', to: '/' }, // a published post
      { from: '/x', to: '/X' }, // to itself
      { from: '/book', to: '/' }, // the site's own route
      { from: '/y', to: '//evil.com' },
    ])
    expect(r).toMatchObject({ added: 2, updated: 0, flattened: 0 })
    expect(r.skipped.map((s) => s.from)).toEqual(['/services', '/blog/hello', '/x', '/book', '/y'])
    expect(r.skipped[0]!.reason).toMatch(/live page/)
    expect(r.saved.every((s) => s.id)).toBe(true)
    expect(await rules()).toEqual({ '/old-services': '/services', '/?p=12': '/services' })
    const again = await save([
      { from: '/old-services', to: '/' },
      { from: '/', query: 'p=12', to: '/services' },
    ])
    expect(again).toMatchObject({ added: 0, updated: 1, unchanged: 1 })
    expect((await rules())['/old-services']).toBe('/')
  })

  it('dry run reports without writing', async () => {
    const r = await save([{ from: '/dry', to: '/services' }], ids.tenant, true)
    expect(r).toMatchObject({ added: 1 })
    expect(r.saved[0]!.id).toBeUndefined()
    expect(await rules()).not.toHaveProperty('/dry')
  })

  it('flattens chains both ways and refuses loops', async () => {
    // A new A → B where B → C exists is stored as A → C.
    await save([{ from: '/b', to: '/services' }])
    const a = await save([{ from: '/a', to: '/b?x=1' }])
    expect(a).toMatchObject({ added: 1, flattened: 1 })
    expect((await rules())['/a']).toBe('/services?x=1')
    // A new C → D moves X → C rows to X → D.
    await save([{ from: '/c', to: '/old-c' }])
    const d = await save([{ from: '/old-c', to: '/services' }])
    expect(d.flattened).toBe(1)
    expect((await rules())['/c']).toBe('/services')
    // Closing a loop is refused (B → A while A → B's end … → B).
    await save([{ from: '/l1', to: '/l2' }])
    const loop = await save([{ from: '/l2', to: '/l1' }])
    expect(loop.skipped[0]!.reason).toMatch(/loop/)
    expect(await rules()).not.toHaveProperty('/l2')
  })

  it('RLS: each spa sees and writes only its own (the same old address twice is fine)', async () => {
    await save([{ from: '/old-services', to: '/elsewhere' }], ids.other)
    expect(await rules(ids.other)).toEqual({ '/old-services': '/elsewhere' })
    expect((await rules())['/old-services']).toBe('/')
    const mine = (await tx((db) => listSiteRedirects(db, ids.tenant!))).map((r) => r.id)
    // Deleting the other spa's rows from this spa's transaction touches nothing.
    expect(await tx((db) => deleteSiteRedirects(db, mine), ids.other)).toEqual([])
    expect(await tx((db) => db.select().from(siteRedirects), ids.other)).toHaveLength(1)
  })

  it('the proxy lookup: by slug and active custom domain; pending → none, cancelled → none', async () => {
    const bySlug = await siteRedirectRules(platform, { slug: 'Redirect-Spa' })
    expect(bySlug.find((r) => r.from === '/old-services')).toEqual({
      from: '/old-services',
      query: '',
      to: '/',
    })
    await platform
      .insert(domains)
      .values({ tenantId: ids.tenant!, hostname: 'redirectspa.test', kind: 'custom', status: 'pending' })
    expect(await siteRedirectRules(platform, { hostname: 'redirectspa.test' })).toEqual([])
    await platform.update(domains).set({ status: 'active' }).where(eq(domains.hostname, 'redirectspa.test'))
    expect(await siteRedirectRules(platform, { hostname: 'RedirectSpa.test' })).toHaveLength(bySlug.length)
    await platform.update(tenants).set({ status: 'cancelled' }).where(eq(tenants.id, ids.tenant!))
    expect(await siteRedirectRules(platform, { slug: 'redirect-spa' })).toEqual([])
    expect(await siteRedirectRules(platform, { hostname: 'redirectspa.test' })).toEqual([])
    await platform.update(tenants).set({ status: 'active' }).where(eq(tenants.id, ids.tenant!))
  })

  it('a page published later at the old address wins (lookup + console status); query rules still apply', async () => {
    await save([
      { from: '/about', to: '/services' },
      { from: '/about', query: 'old=1', to: '/services' },
    ])
    const has = async (from: string, query = '') =>
      (await siteRedirectRules(platform, { slug: 'redirect-spa' })).some(
        (r) => r.from === from && r.query === query,
      )
    expect(await has('/about')).toBe(true)
    await tx((db) => publishPage(db, { tenantId: ids.tenant!, pageId: ids.about! }))
    expect(await has('/about')).toBe(false)
    expect(await has('/about', 'old=1')).toBe(true)
    const view = await tx((db) => listSiteRedirects(db, ids.tenant!))
    expect(view.find((r) => r.fromPath === '/about' && !r.fromQuery)).toMatchObject({ inactive: true })
    expect(view.find((r) => r.fromPath === '/c')).toMatchObject({ inactive: false, targetMissing: false })
    // Saving a source a live page uses is refused now.
    expect((await save([{ from: '/about', to: '/' }])).skipped).toHaveLength(1)
  })

  it('a target that is no live page is flagged; deletes; the per-spa limit', async () => {
    await save([{ from: '/gone', to: '/no-such-page' }])
    const view = await tx((db) => listSiteRedirects(db, ids.tenant!))
    expect(view.find((r) => r.fromPath === '/gone')).toMatchObject({ targetMissing: true })
    expect(view.find((r) => r.fromPath === '/b')).toMatchObject({ targetMissing: false })
    const gone = view.find((r) => r.fromPath === '/gone')!
    expect(await tx((db) => deleteSiteRedirects(db, [gone.id]))).toHaveLength(1)
    expect(await rules()).not.toHaveProperty('/gone')

    expect(await tx((db) => deleteAllSiteRedirects(db, ids.tenant!))).toBeGreaterThan(0)
    expect(await rules()).toEqual({})
    const many = Array.from({ length: MAX_SITE_REDIRECTS + 2 }, (_, i) => ({
      from: `/p${i}`,
      to: '/services',
    }))
    const full = await save(many)
    expect(full.added).toBe(MAX_SITE_REDIRECTS)
    expect(full.skipped).toHaveLength(2)
    expect(full.skipped[0]!.reason).toMatch(/most redirects/)
    // Updating an existing one still works at the limit.
    expect(await save([{ from: '/p0', to: '/' }])).toMatchObject({ updated: 1, skipped: [] })
    expect(await rules(ids.other)).toEqual({ '/old-services': '/elsewhere' })
  })
})

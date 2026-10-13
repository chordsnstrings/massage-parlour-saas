// R30: the weekly search check — live pages only (block + HTML design), stored per site (latest 8), RLS.
import { closeAllDbs, seoChecks, sites, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ensureSite,
  latestSeoCheck,
  listPages,
  publishPage,
  runSeoCheck,
  SEO_CHECKS_KEPT,
  saveDraft,
  setPageVisible,
  storeSpaHtmlDoc,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)

const DESC = 'Thai, Swedish and hot stone massage in Dubai Marina, open daily until midnight.'
const HTML = `<!doctype html><html><head><title>{{spa_name}} · Offers</title></head><body><img src="a.jpg"><img src="b.jpg" alt="Stones"></body></html>`
const blockPage = (title: string, description: string) => ({
  root: { props: { title: { en: title, ar: '' }, description: { en: description } } },
  content: [{ type: 'Heading', props: { id: 'h1', text: { en: title } } }],
})

beforeAll(async () => {
  await resetTestDatabase()
  const [a, b] = await platform
    .insert(tenants)
    .values([
      { slug: 'seo-spa', name: 'Seo Spa' },
      { slug: 'seo-other', name: 'Other Spa' },
    ])
    .returning()
  ids.tenant = a!.id
  ids.other = b!.id
  await tx(async (db) => {
    const doc = await storeSpaHtmlDoc(db, { tenantId: ids.tenant!, html: HTML })
    await ensureSite(db, ids.tenant!, {
      key: 'seo',
      name: 'Seo',
      theme: {},
      pages: [
        // Home: no search description.
        { slug: '', title: { en: 'Home' }, data: blockPage('Massage in Dubai Marina · {name}', '') },
        { slug: 'services', title: { en: 'Services' }, data: blockPage('Treatments and prices', DESC) },
        {
          slug: 'offers',
          title: { en: 'Offers' },
          data: {
            root: { props: { htmlDesign: true, title: { en: '{name}' }, description: { en: '' } } },
            content: [
              { type: 'HtmlDesign', props: { id: 'd-1', html: '', doc, images: [], phoneFixes: false } },
            ],
          },
        },
        { slug: 'draft-only', title: { en: 'Draft' }, data: blockPage('', '') },
      ],
    })
    const pages = await listPages(db, ids.tenant!)
    for (const p of pages) ids[p.slug || 'home'] = p.id
  })
})
afterAll(() => closeAllDbs())

describe('seo check service (R30)', () => {
  it('nothing published yet: nothing checked or stored', async () => {
    expect(await tx((db) => runSeoCheck(db, ids.tenant!, { trigger: 'manual' }))).toBeNull()
    expect(await tx((db) => runSeoCheck(db, ids.other!, { trigger: 'manual' }), ids.other)).toBeNull()
  })

  it('checks the LIVE pages (block + HTML design), not drafts or unpublished pages, and stores the result', async () => {
    await tx(async (db) => {
      for (const slug of ['home', 'services', 'offers'])
        await publishPage(db, { tenantId: ids.tenant!, pageId: ids[slug]! })
      // A later draft with a description is not live yet.
      await saveDraft(db, { tenantId: ids.tenant!, pageId: ids.home!, data: blockPage('Home', DESC) })
    })
    const row = await tx((db) => runSeoCheck(db, ids.tenant!, { trigger: 'manual' }))
    expect(row).toMatchObject({ tenantId: ids.tenant, trigger: 'manual', counts: { high: 2, medium: 1 } })
    expect(row!.findings.map((f) => `${f.path} ${f.code} ${f.severity}`)).toEqual([
      '/ description_missing high',
      // The design has no meta description; its title is "Seo Spa · Offers" ({{spa_name}} filled).
      '/offers description_missing high',
      '/offers image_alt_missing medium',
    ])
    const site = await tx(async (db) => (await db.select().from(sites))[0]!)
    expect((await tx((db) => latestSeoCheck(db, site.id)))!.id).toBe(row!.id)
  })

  it('Arabic pages, hidden pages and a suspended spa (sitemap.xml lists nothing)', async () => {
    await platform
      .update(sites)
      .set({ locales: ['en', 'ar'] })
      .where(eq(sites.tenantId, ids.tenant!))
    await tx(async (db) => {
      await publishPage(db, {
        tenantId: ids.tenant!,
        pageId: ids.services!,
        data: {
          root: {
            props: { title: { en: 'Treatments and prices', ar: 'ع'.repeat(70) }, description: { en: DESC } },
          },
          content: [],
        },
      })
      await setPageVisible(db, ids.tenant!, ids.offers!, false)
    })
    const ar = await tx((db) => runSeoCheck(db, ids.tenant!, { trigger: 'weekly' }))
    expect(ar!.findings.map((f) => `${f.path} ${f.locale} ${f.code}`)).toEqual([
      '/ en description_missing',
      '/services ar title_long',
    ])
    await platform.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, ids.tenant!))
    const suspended = await tx((db) => runSeoCheck(db, ids.tenant!, { trigger: 'manual' }))
    expect(suspended!.findings.filter((f) => f.code === 'not_in_sitemap').map((f) => f.path)).toEqual([
      '/',
      '/services',
    ])
    await platform.update(tenants).set({ status: 'active' }).where(eq(tenants.id, ids.tenant!))
  })

  it(`keeps the latest ${SEO_CHECKS_KEPT} checks per site`, async () => {
    const start = Date.parse('2030-01-07T02:00:00Z')
    for (let i = 0; i < 10; i++)
      await tx((db) =>
        runSeoCheck(db, ids.tenant!, { trigger: 'weekly', now: new Date(start + i * 7 * 86_400_000) }),
      )
    const rows = await tx((db) => db.select().from(seoChecks))
    expect(rows).toHaveLength(SEO_CHECKS_KEPT)
    const oldest = Math.min(...rows.map((r) => r.checkedAt.getTime()))
    expect(oldest).toBe(start + 2 * 7 * 86_400_000)
    const site = await tx(async (db) => (await db.select().from(sites))[0]!)
    expect((await tx((db) => latestSeoCheck(db, site.id)))!.checkedAt.getTime()).toBe(
      start + 9 * 7 * 86_400_000,
    )
  })

  it('another spa can neither read nor write the checks (RLS)', async () => {
    const site = await tx(async (db) => (await db.select().from(sites))[0]!)
    expect(await tx((db) => db.select().from(seoChecks), ids.other)).toEqual([])
    expect(await tx((db) => latestSeoCheck(db, site.id), ids.other)).toBeNull()
    await expect(
      tx(
        (db) => db.insert(seoChecks).values({ tenantId: ids.tenant!, siteId: site.id, trigger: 'manual' }),
        ids.other,
      ),
    ).rejects.toThrow()
  })
})

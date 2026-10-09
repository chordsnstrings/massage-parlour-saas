import { closeAllDbs, pageVersions, sitePages, sites, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DomainError,
  ensureSite,
  getEditablePage,
  getPublishedPage,
  listPages,
  listPublishedPages,
  listVersions,
  publishAll,
  publishPage,
  type SiteTemplate,
  saveDraft,
  setPageVisible,
  switchTemplate,
  updateTheme,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)

const page = (headline: string) => ({
  root: { props: { title: { en: headline } } },
  content: [{ type: 'Heading', props: { id: 'h1', text: { en: headline } } }],
})
const template = (key: string, headline: string): SiteTemplate => ({
  key,
  name: key,
  theme: { accent: key === 'zen' ? '#8a7560' : '#3d5a80' },
  pages: [
    { slug: '', title: { en: 'Home', ar: 'الرئيسية' }, data: page(headline) },
    { slug: 'services', title: { en: 'Services' }, data: page(`${headline} services`) },
    { slug: 'contact', title: { en: 'Contact' }, data: page(`${headline} contact`) },
  ],
})
const zen = template('zen', 'Slow down')
const nordic = template('nordic', 'Calm and clear')

beforeAll(async () => {
  await resetTestDatabase()
  const [a, b] = await platform
    .insert(tenants)
    .values([
      { slug: 'calm', name: 'Calm Spa' },
      { slug: 'other', name: 'Other Spa' },
    ])
    .returning()
  ids.tenant = a!.id
  ids.other = b!.id
})
afterAll(() => closeAllDbs())

describe('sites service', () => {
  it('creates the site and starter pages once', async () => {
    const first = await tx((db) => ensureSite(db, ids.tenant!, zen))
    expect(first.created).toBe(true)
    expect(first.site.templateKey).toBe('zen')
    const again = await tx((db) => ensureSite(db, ids.tenant!, nordic))
    expect(again.created).toBe(false)
    expect(again.site.id).toBe(first.site.id)
    const pages = await tx((db) => listPages(db, ids.tenant!))
    expect(pages.map((p) => p.slug)).toEqual(['', 'services', 'contact'])
    expect(pages.every((p) => p.hasDraft && !p.publishedAt)).toBe(true)
    ids.home = pages[0]!.id
    ids.contact = pages[2]!.id
  })

  it('serves nothing publicly until a page is published', async () => {
    expect(await tx((db) => getPublishedPage(db, ids.tenant!, ''))).toBeNull()
    await tx((db) => publishPage(db, { tenantId: ids.tenant!, pageId: ids.home! }))
    const live = await tx((db) => getPublishedPage(db, ids.tenant!, ''))
    expect(live?.data).toEqual(page('Slow down'))
    expect(await tx((db) => getPublishedPage(db, ids.tenant!, 'services'))).toBeNull()
    expect((await tx((db) => listPublishedPages(db, ids.tenant!))).map((p) => p.slug)).toEqual([''])
  })

  it('keeps the live version while a new draft is edited, then publishes it', async () => {
    await tx((db) => saveDraft(db, { tenantId: ids.tenant!, pageId: ids.home!, data: page('Draft 1') }))
    await tx((db) => saveDraft(db, { tenantId: ids.tenant!, pageId: ids.home!, data: page('Draft 2') }))
    const editing = await tx((db) => getEditablePage(db, ids.tenant!, ids.home!))
    expect(editing?.data).toEqual(page('Draft 2'))
    expect((await tx((db) => getPublishedPage(db, ids.tenant!, '')))?.data).toEqual(page('Slow down'))
    // Drafts update in place: one published + one draft.
    expect((await tx((db) => listVersions(db, ids.tenant!, ids.home!))).map((v) => v.status)).toEqual([
      'draft',
      'published',
    ])
    await tx((db) => publishPage(db, { tenantId: ids.tenant!, pageId: ids.home!, data: page('Live 2') }))
    expect((await tx((db) => getPublishedPage(db, ids.tenant!, '')))?.data).toEqual(page('Live 2'))
    const versions = await tx((db) => listVersions(db, ids.tenant!, ids.home!))
    expect(versions.map((v) => v.status)).toEqual(['published', 'published'])
    const pages = await tx((db) => listPages(db, ids.tenant!))
    expect(pages[0]!.hasDraft).toBe(false)
  })

  it('switching template swaps theme and keeps content unless asked', async () => {
    const site = await tx((db) => switchTemplate(db, ids.tenant!, nordic))
    expect(site.templateKey).toBe('nordic')
    expect(site.theme).toEqual(nordic.theme)
    expect((await tx((db) => getEditablePage(db, ids.tenant!, ids.home!)))?.data).toEqual(page('Live 2'))

    await tx((db) => switchTemplate(db, ids.tenant!, nordic, { replaceContent: true }))
    expect((await tx((db) => getEditablePage(db, ids.tenant!, ids.home!)))?.data).toEqual(
      page('Calm and clear'),
    )
    // Replacing content only drafts; the live page is unchanged.
    expect((await tx((db) => getPublishedPage(db, ids.tenant!, '')))?.data).toEqual(page('Live 2'))
  })

  it('publishes every pending draft at once and updates theme tokens', async () => {
    expect(await tx((db) => publishAll(db, ids.tenant!))).toEqual({ pages: 3, theme: false })
    expect((await tx((db) => getPublishedPage(db, ids.tenant!, '')))?.data).toEqual(page('Calm and clear'))
    expect(await tx((db) => publishAll(db, ids.tenant!))).toEqual({ pages: 0, theme: false })
    const site = await tx((db) => updateTheme(db, ids.tenant!, { accent: '#112233' }))
    expect(site.theme).toEqual({ accent: '#112233' })
    await expect(tx((db) => updateTheme(db, ids.other!, {}), ids.other)).rejects.toBeInstanceOf(DomainError)
  })

  it('hidden pages are not served; the home page cannot be hidden', async () => {
    await tx((db) => publishPage(db, { tenantId: ids.tenant!, pageId: ids.contact! }))
    expect(await tx((db) => getPublishedPage(db, ids.tenant!, 'contact'))).not.toBeNull()
    await tx((db) => setPageVisible(db, ids.tenant!, ids.contact!, false))
    expect(await tx((db) => getPublishedPage(db, ids.tenant!, 'contact'))).toBeNull()
    await expect(tx((db) => setPageVisible(db, ids.tenant!, ids.home!, false))).rejects.toBeInstanceOf(
      DomainError,
    )
  })

  it('is isolated per tenant (RLS)', async () => {
    expect(await tx((db) => getPublishedPage(db, ids.tenant!, ''), ids.other)).toBeNull()
    expect(await tx((db) => getEditablePage(db, ids.tenant!, ids.home!), ids.other)).toBeNull()
    await expect(
      tx((db) => saveDraft(db, { tenantId: ids.other!, pageId: ids.home!, data: page('x') }), ids.other),
    ).rejects.toBeInstanceOf(DomainError)
    const rows = await withTenant(ids.other!, (db) => db.select().from(sites), app)
    expect(rows).toHaveLength(0)
    const counts = await platform.select().from(pageVersions).where(eq(pageVersions.tenantId, ids.other!))
    expect(counts).toHaveLength(0)
    expect(await platform.select().from(sitePages).where(eq(sitePages.tenantId, ids.other!))).toHaveLength(0)
  })
})

import { closeAllDbs, domains, sitePages, sites, tenants, user, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createChangeRequest,
  ensureSite,
  listChangeRequests,
  listPages,
  openChangeRequestCount,
  publishPage,
  resolveChangeRequest,
  type SiteTemplate,
  saveDraft,
  setStudioStatus,
  websiteOverview,
  websiteProgress,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)
const status = async () =>
  (await platform.select().from(sites).where(eq(sites.tenantId, ids.tenant!)))[0]?.studioStatus

const template: SiteTemplate = {
  key: 'zen',
  name: 'Zen',
  theme: {},
  pages: [{ slug: '', title: { en: 'Home' }, data: { root: { props: {} }, content: [] } }],
}

beforeAll(async () => {
  await resetTestDatabase()
  const now = new Date()
  await platform.insert(user).values({
    id: 'u-spa',
    name: 'Owner',
    email: 'o@example.com',
    emailVerified: true,
    createdAt: now,
    updatedAt: now,
  })
  const [a, b] = await platform
    .insert(tenants)
    .values([
      { slug: 'calm', name: 'Calm Spa' },
      { slug: 'other', name: 'Other Spa' },
    ])
    .returning()
  ids.tenant = a!.id
  ids.other = b!.id
  await tx((db) => ensureSite(db, ids.tenant!, template))
})
afterAll(() => closeAllDbs())

describe('website studio', () => {
  it('websiteProgress: status + next step from the site data (R23)', () => {
    const f = { hasSite: true, livePages: 0, editedPages: 0, changedPages: 0, themeDraft: false }
    expect(websiteProgress({ ...f, hasSite: false })).toEqual({
      status: 'none',
      unpublished: false,
      next: 'choose_template',
    })
    expect(websiteProgress({ ...f, changedPages: 3 })).toEqual({
      status: 'template',
      unpublished: false,
      next: 'continue_editing',
    })
    expect(websiteProgress({ ...f, editedPages: 1, changedPages: 3 })).toEqual({
      status: 'draft',
      unpublished: false,
      next: 'publish',
    })
    expect(websiteProgress({ ...f, livePages: 2, editedPages: 2 })).toEqual({
      status: 'live',
      unpublished: false,
      next: 'open_site',
    })
    // A pending rename or a draft page counts as a changed page; a draft theme alone too.
    expect(websiteProgress({ ...f, livePages: 2, changedPages: 1 })).toMatchObject({
      status: 'live',
      unpublished: true,
      next: 'publish',
    })
    expect(websiteProgress({ ...f, livePages: 2, themeDraft: true })).toMatchObject({
      unpublished: true,
      next: 'publish',
    })
  })

  it('records change requests; one made during review sends the site back to the studio', async () => {
    await tx((db) => setStudioStatus(db, ids.tenant!, 'review'))
    const [home] = await tx((db) => listPages(db, ids.tenant!))
    const id = await tx((db) =>
      createChangeRequest(db, ids.tenant!, {
        body: '  Use our new logo  ',
        pageId: home!.id,
        userId: 'u-spa',
      }),
    )
    expect(await status()).toBe('building')
    await expect(
      tx((db) => createChangeRequest(db, ids.tenant!, { body: 'x', userId: 'u-spa' })),
    ).rejects.toThrow('Tell us')
    const [row] = await tx((db) => listChangeRequests(db, ids.tenant!))
    expect(row).toMatchObject({ id, body: 'Use our new logo', status: 'open', pageTitle: { en: 'Home' } })
    // Other tenants never see it.
    expect(await tx((db) => listChangeRequests(db, ids.other!), ids.other)).toHaveLength(0)

    await tx((db) =>
      resolveChangeRequest(db, ids.tenant!, id, { status: 'done', response: 'Done', userId: 'u-spa' }),
    )
    await expect(
      tx((db) => resolveChangeRequest(db, ids.tenant!, id, { status: 'declined', userId: 'u-spa' })),
    ).rejects.toThrow('already closed')
    expect((await websiteOverview(platform)).find((r) => r.slug === 'calm')).toMatchObject({
      hasSite: true,
      openRequests: 0,
    })
  })

  it('websiteOverview: none → template → draft → live → unpublished changes (R23)', async () => {
    const row = async (tenantId = ids.fresh!) => (await websiteOverview(platform, { tenantId }))[0]
    const [fresh, gone] = await platform
      .insert(tenants)
      .values([
        { slug: 'fresh', name: 'Fresh Spa' },
        { slug: 'gone', name: 'Gone Spa', deletedAt: new Date() },
      ])
      .returning()
    ids.fresh = fresh!.id
    expect(await row()).toMatchObject({ status: 'none', next: 'choose_template', homePageId: null })

    await tx((db) => ensureSite(db, ids.fresh!, template), ids.fresh)
    const [home] = await tx((db) => listPages(db, ids.fresh!), ids.fresh)
    expect(await row()).toMatchObject({ status: 'template', next: 'continue_editing', homePageId: home!.id })

    const data = { root: { props: { title: 'Hi' } }, content: [] }
    await tx(
      (db) => saveDraft(db, { tenantId: ids.fresh!, pageId: home!.id, data, userId: 'u-spa' }),
      ids.fresh,
    )
    expect(await row()).toMatchObject({ status: 'draft', next: 'publish', livePages: 0 })

    await tx((db) => publishPage(db, { tenantId: ids.fresh!, pageId: home!.id, userId: 'u-spa' }), ids.fresh)
    expect(await row()).toMatchObject({ status: 'live', unpublished: false, next: 'open_site', livePages: 1 })

    await tx(
      (db) => saveDraft(db, { tenantId: ids.fresh!, pageId: home!.id, data, userId: 'u-spa' }),
      ids.fresh,
    )
    expect(await row()).toMatchObject({ status: 'live', unpublished: true, next: 'publish', changedPages: 1 })

    // A rename waiting for the next publish counts too (after publishing the draft).
    await tx((db) => publishPage(db, { tenantId: ids.fresh!, pageId: home!.id, userId: 'u-spa' }), ids.fresh)
    expect(await row()).toMatchObject({ unpublished: false })
    await platform
      .update(sitePages)
      .set({ pending: { title: { en: 'Start' } } })
      .where(eq(sitePages.id, home!.id))
    expect(await row()).toMatchObject({ unpublished: true, changedPages: 1 })

    // Primary custom domain, open requests (badge), deleted spas left out, tenant filter.
    await platform.insert(domains).values({
      tenantId: ids.fresh!,
      hostname: 'www.fresh-spa.test',
      kind: 'custom',
      status: 'active',
      isPrimary: true,
    })
    const before = await openChangeRequestCount(platform)
    await tx(
      (db) => createChangeRequest(db, ids.fresh!, { body: 'New photos please', userId: 'u-spa' }),
      ids.fresh,
    )
    expect(await row()).toMatchObject({ primaryHost: 'www.fresh-spa.test', openRequests: 1 })
    expect(await openChangeRequestCount(platform)).toBe(before + 1)
    const all = await websiteOverview(platform)
    expect(all.map((r) => r.slug)).not.toContain('gone')
    expect(all.find((r) => r.slug === 'other')).toMatchObject({ status: 'none', primaryHost: null })
    expect(await websiteOverview(platform, { tenantId: gone!.id })).toEqual([])
  })
})

import { closeAllDbs, sites, tenants, user, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createChangeRequest,
  ensureSite,
  listChangeRequests,
  listPages,
  resolveChangeRequest,
  type SiteTemplate,
  setStudioStatus,
  studioOverview,
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
  it('runs building → review → approved, all moved by the studio', async () => {
    expect(await status()).toBe('building')
    await expect(tx((db) => setStudioStatus(db, ids.tenant!, 'building'))).rejects.toThrow()
    await tx((db) => setStudioStatus(db, ids.tenant!, 'review'))
    await tx((db) => setStudioStatus(db, ids.tenant!, 'approved'))
    expect(await status()).toBe('approved')
    await tx((db) => setStudioStatus(db, ids.tenant!, 'building'))
    await expect(tx((db) => setStudioStatus(db, ids.other!, 'review'), ids.other)).rejects.toThrow(
      'no website',
    )
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
    expect((await studioOverview(platform)).find((r) => r.slug === 'calm')).toMatchObject({
      hasSite: true,
      studioStatus: 'building',
      openRequests: 0,
    })
  })
})

import { closeAllDbs, sites, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DomainError, ensureSite, getSiteProfiles, type SiteTemplate, setSiteProfiles } from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)

const zen: SiteTemplate = {
  key: 'zen',
  name: 'Zen',
  theme: {},
  pages: [{ slug: '', title: { en: 'Home' }, data: { root: { props: {} }, content: [] } }],
}

beforeAll(async () => {
  await resetTestDatabase()
  const [a, b] = await platform
    .insert(tenants)
    .values([
      { slug: 'links', name: 'Links Spa' },
      { slug: 'bare', name: 'Bare Spa' },
    ])
    .returning()
  ids.tenant = a!.id
  ids.bare = b!.id
  await tx((db) => ensureSite(db, ids.tenant!, zen))
})
afterAll(() => closeAllDbs())

const invalid = (urls: string[]) =>
  tx((db) => setSiteProfiles(db, ids.tenant!, urls)).then(
    () => null,
    (e: unknown) => (e instanceof DomainError ? e.message : String(e)),
  )

describe('R33 site profile links', () => {
  it('trims, drops blanks, keeps each link once in order and keeps the other seo keys', async () => {
    await platform
      .update(sites)
      .set({ seo: { title: 'Kept' } })
      .where(eq(sites.tenantId, ids.tenant!))
    const site = await tx((db) =>
      setSiteProfiles(db, ids.tenant!, [
        '  https://g.page/r/Links-Spa/review ',
        '',
        'https://www.instagram.com/linksspa/',
        'https://WWW.Instagram.com/linksspa/',
        'https://www.tiktok.com/@linksspa',
      ]),
    )
    expect(site.seo).toEqual({
      title: 'Kept',
      profiles: [
        'https://g.page/r/Links-Spa/review',
        'https://www.instagram.com/linksspa/',
        'https://www.tiktok.com/@linksspa',
      ],
    })
    expect(await tx((db) => getSiteProfiles(db, ids.tenant!))).toEqual(site.seo.profiles)
  })

  it('refuses anything but a full https link to a named host, and more than 10', async () => {
    expect(await invalid(['https://ok.ae', 'http://www.facebook.com/linksspa'])).toBe(
      'Line 2 is not a full https:// link: http://www.facebook.com/linksspa',
    )
    for (const bad of [
      'instagram.com/linksspa',
      'javascript:alert(1)',
      'https://user:pw@www.instagram.com/x',
      'https://localhost/x',
      'https://10.0.0.1/x',
      'https://[::1]/x',
      `https://example.com/${'a'.repeat(500)}`,
    ])
      expect(await invalid([bad])).toMatch(/^Line 1 is not a full https:\/\/ link/)
    const eleven = Array.from({ length: 11 }, (_, i) => `https://spa${i}.ae/`)
    expect(await invalid(eleven)).toBe('Up to 10 profile links (11 given)')
    expect(await invalid([...eleven.slice(0, 10), eleven[0]!])).toBeNull()
    // Nothing invalid was saved.
    expect(await tx((db) => getSiteProfiles(db, ids.tenant!))).toHaveLength(10)
  })

  it('an empty list removes them; a spa without a site gets not_found; reads re-check stored values', async () => {
    const site = await tx((db) => setSiteProfiles(db, ids.tenant!, ['', '  ']))
    expect(site.seo).toEqual({ title: 'Kept' })
    await expect(
      tx((db) => setSiteProfiles(db, ids.bare!, ['https://x.ae']), ids.bare!),
    ).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(await tx((db) => getSiteProfiles(db, ids.bare!), ids.bare!)).toEqual([])
    await platform
      .update(sites)
      .set({ seo: { profiles: ['http://old.ae', 'https://fine.ae', 7 as unknown as string] } })
      .where(eq(sites.tenantId, ids.tenant!))
    expect(await tx((db) => getSiteProfiles(db, ids.tenant!))).toEqual(['https://fine.ae/'])
  })
})

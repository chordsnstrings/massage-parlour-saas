import { closeAllDbs, sitePageLocks, sitePages, tenants, user, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  acquirePageLock,
  assertPagesUnlocked,
  ensureSite,
  getPageLock,
  getSiteForEdit,
  PAGE_LOCK_TTL_MS,
  PageLockedError,
  releasePageLock,
  restoreSiteEdit,
  runSiteEdit,
  type SiteEditSchema,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)

const schema: SiteEditSchema = {
  blocks: {
    Heading: { label: 'Heading', props: { text: { kind: 'bi' } }, defaults: { text: { en: 'Heading' } } },
  },
  root: { title: { kind: 'bi' } },
  theme: { accent: { kind: 'color' } },
  presets: [],
}
const home = {
  root: { props: { title: { en: 'Home' } } },
  content: [{ type: 'Heading', props: { id: 'h1', text: { en: 'Slow down' } } }],
}
const at = (ms: number) => new Date(Date.UTC(2026, 9, 9, 8, 0, 0) + ms)
const lock = (userId: string, holderName: string, o: { takeOver?: boolean; now?: Date } = {}) =>
  tx((db) => acquirePageLock(db, { tenantId: ids.tenant!, pageId: ids.home!, userId, holderName, ...o }))

beforeAll(async () => {
  await resetTestDatabase()
  const [t] = await platform.insert(tenants).values({ slug: 'locks', name: 'Lock Spa' }).returning()
  ids.tenant = t!.id
  for (const [id, name] of [
    ['u-ahmed', 'Ahmed'],
    ['u-sara', 'Sara'],
  ])
    await platform.insert(user).values({ id, name, email: `${id}@e2e.test`, emailVerified: true })
  await tx((db) =>
    ensureSite(db, ids.tenant!, {
      key: 'zen',
      name: 'Zen',
      theme: {},
      pages: [
        { slug: '', title: { en: 'Home' }, data: home },
        { slug: 'about', title: { en: 'About' }, data: home },
      ],
    }),
  )
  const pages = await tx((db) => db.select().from(sitePages))
  ids.home = pages.find((p) => p.slug === '')!.id
  ids.about = pages.find((p) => p.slug === 'about')!.id
})
afterAll(() => closeAllDbs())

describe('page editing lock (F29)', () => {
  it('acquire, heartbeat, refuse others, expire, take over, release', async () => {
    const first = await lock('u-ahmed', 'Ahmed', { now: at(0) })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    expect(first.tookOverFrom).toBeNull()
    expect(first.lock.expiresAt.getTime()).toBe(at(PAGE_LOCK_TTL_MS).getTime())

    // Heartbeat: same holder renews, keeps when it first took the page.
    const beat = await lock('u-ahmed', 'Ahmed', { now: at(30_000) })
    expect(beat.ok && beat.lock.expiresAt.getTime()).toBe(at(30_000 + PAGE_LOCK_TTL_MS).getTime())
    expect(beat.ok && beat.lock.acquiredAt.getTime()).toBe(at(0).getTime())

    // Someone else is refused while it is live and told who holds it.
    const other = await lock('u-sara', 'Sara', { now: at(60_000) })
    expect(other.ok).toBe(false)
    expect(other.lock.holderName).toBe('Ahmed')
    expect((await tx((db) => getPageLock(db, ids.tenant!, ids.home!, at(60_000))))?.userId).toBe('u-ahmed')

    // No heartbeat for 2 minutes → free: the next editor gets it without a take-over.
    const late = at(30_000 + PAGE_LOCK_TTL_MS + 1)
    expect(await tx((db) => getPageLock(db, ids.tenant!, ids.home!, late))).toBeNull()
    const sara = await lock('u-sara', 'Sara', { now: late })
    expect(sara.ok && sara.tookOverFrom).toBeNull()

    // Take over from a live lock: replaces it and names who held it (callers audit that).
    const back = await lock('u-ahmed', 'Ahmed', { now: at(PAGE_LOCK_TTL_MS + 40_000), takeOver: true })
    expect(back.ok).toBe(true)
    expect(back.ok && back.tookOverFrom).toEqual({ userId: 'u-sara', holderName: 'Sara' })
    expect(back.ok && back.lock.acquiredAt.getTime()).toBe(at(PAGE_LOCK_TTL_MS + 40_000).getTime())

    // Sara's heartbeat now reports the loss; her release is a no-op, Ahmed's frees the page.
    const lost = await lock('u-sara', 'Sara', { now: at(PAGE_LOCK_TTL_MS + 50_000) })
    expect(lost.ok).toBe(false)
    expect(
      await tx((db) => releasePageLock(db, { tenantId: ids.tenant!, pageId: ids.home!, userId: 'u-sara' })),
    ).toBe(false)
    expect(
      await tx((db) => releasePageLock(db, { tenantId: ids.tenant!, pageId: ids.home!, userId: 'u-ahmed' })),
    ).toBe(true)
    expect(await tx((db) => db.select().from(sitePageLocks))).toHaveLength(0)
  })

  it('two editors racing for a free page: only one wins', async () => {
    const [a, b] = await Promise.all([lock('u-ahmed', 'Ahmed'), lock('u-sara', 'Sara')])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    await tx((db) => db.delete(sitePageLocks))
  })

  it('a lock row is tenant-scoped (RLS) and refuses unknown pages', async () => {
    await lock('u-ahmed', 'Ahmed')
    const [other] = await platform.insert(tenants).values({ slug: 'locks-b', name: 'B' }).returning()
    expect(await tx((db) => db.select().from(sitePageLocks), other!.id)).toHaveLength(0)
    await expect(
      tx(
        (db) =>
          acquirePageLock(db, {
            tenantId: other!.id,
            pageId: ids.home!,
            userId: 'u-sara',
            holderName: 'Sara',
          }),
        other!.id,
      ),
    ).rejects.toThrow('Page not found')
  })

  it('Ask AI / MCP ops refuse a page locked by someone else, allow the holder and other pages', async () => {
    // Ahmed holds home (previous test). Sara (e.g. via Claude MCP) is refused, dry run included, with a clear reason.
    const op = (page: string) => ({ op: 'update', page, id: 'h1', props: { text: { en: 'Changed' } } })
    for (const dryRun of [true, false]) {
      const r = await tx((db) =>
        runSiteEdit(db, { tenantId: ids.tenant!, userId: 'u-sara', ops: [op('home')], dryRun }, { schema }),
      )
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.errors[0]).toMatch(/^Home: Ahmed is editing this page in the Studio editor/)
    }
    // A caller without a user (no editor of its own) is refused too.
    const anon = await tx((db) =>
      runSiteEdit(db, { tenantId: ids.tenant!, ops: [op('home')], dryRun: true }, { schema }),
    )
    expect(anon.ok).toBe(false)
    // Renames of a locked page are refused as well.
    const rename = await tx((db) =>
      runSiteEdit(
        db,
        {
          tenantId: ids.tenant!,
          userId: 'u-sara',
          ops: [{ op: 'rename_page', page: 'home', title: { en: 'Start' } }],
          dryRun: true,
        },
        { schema },
      ),
    )
    expect(rename.ok).toBe(false)
    // The holder's own Ask AI edit and other pages / the theme go through.
    const mine = await tx((db) =>
      runSiteEdit(
        db,
        { tenantId: ids.tenant!, userId: 'u-ahmed', ops: [op('home')], dryRun: false },
        { schema },
      ),
    )
    expect(mine.ok).toBe(true)
    const about = await tx((db) =>
      runSiteEdit(
        db,
        {
          tenantId: ids.tenant!,
          userId: 'u-sara',
          ops: [op('about'), { op: 'theme', tokens: { accent: '#224466' } }],
          dryRun: false,
        },
        { schema },
      ),
    )
    expect(about.ok).toBe(true)
    // Undo of an AI edit respects the lock too.
    await expect(
      tx((db) =>
        restoreSiteEdit(db, {
          tenantId: ids.tenant!,
          userId: 'u-sara',
          pages: [{ id: ids.home!, data: home }],
          theme: null,
        }),
      ),
    ).rejects.toBeInstanceOf(PageLockedError)
    await expect(
      tx((db) => assertPagesUnlocked(db, { tenantId: ids.tenant!, pageIds: [ids.home!], userId: 'u-sara' })),
    ).rejects.toThrow(/Ahmed is editing/)
    await tx((db) =>
      assertPagesUnlocked(db, { tenantId: ids.tenant!, pageIds: [ids.home!], userId: 'u-ahmed' }),
    )
    // get_site (MCP) tells Claude who is editing which page.
    const view = await tx((db) => getSiteForEdit(db, ids.tenant!))
    expect(view?.pages.find((p) => p.slug === '')?.editing?.by).toBe('Ahmed')
    expect(view?.pages.find((p) => p.slug === 'about')?.editing).toBeNull()
  })
})

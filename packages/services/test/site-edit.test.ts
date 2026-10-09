import {
  closeAllDbs,
  pageVersions,
  platformAdmins,
  siteAiEditorStatus,
  sitePages,
  sites,
  tenants,
  user,
  withTenant,
} from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  blockCatalogue,
  ensureSite,
  getEditablePage,
  getPublishedPage,
  getSiteForEdit,
  publishPage,
  restoreSiteEdit,
  runSiteEdit,
  type SiteEditSchema,
  siteEditAuditData,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)

const schema: SiteEditSchema = {
  blocks: {
    Heading: { label: 'Heading', props: { text: { kind: 'bi' } }, defaults: { text: { en: 'Heading' } } },
    FAQ: {
      label: 'FAQ',
      props: { title: { kind: 'bi' }, items: { kind: 'array', max: 3, item: { q: { kind: 'bi' } } } },
      defaults: { title: { en: 'Questions' }, items: [] },
    },
  },
  root: { title: { kind: 'bi' } },
  theme: { accent: { kind: 'color' } },
  presets: [],
}
const deps = { schema }
const home = {
  root: { props: { title: { en: 'Home' } } },
  content: [{ type: 'Heading', props: { id: 'h1', text: { en: 'Slow down' } } }],
}
const html = {
  root: { props: { htmlDesign: true, title: { en: '{name}' } } },
  content: [{ type: 'HtmlDesign', props: { id: 'd1', html: '<html><body>old</body></html>', images: [] } }],
}

beforeAll(async () => {
  await resetTestDatabase()
  const [a, b] = await platform
    .insert(tenants)
    .values([
      { slug: 'edit', name: 'Edit Spa' },
      { slug: 'edit-other', name: 'Other Spa' },
    ])
    .returning()
  ids.tenant = a!.id
  ids.other = b!.id
  for (const [t, key] of [
    [ids.tenant, 'a'],
    [ids.other, 'b'],
  ] as const)
    await tx(
      (db) =>
        ensureSite(db, t, {
          key: 'zen',
          name: 'Zen',
          theme: { accent: '#111111' },
          pages: [
            { slug: '', title: { en: 'Home' }, data: home },
            { slug: `design-${key}`, title: { en: 'Design' }, data: html },
          ],
        }),
      t,
    )
  const pages = await tx((db) => db.select().from(sitePages))
  ids.home = pages.find((p) => p.slug === '')!.id
  ids.design = pages.find((p) => p.slug === 'design-a')!.id
  const otherPages = await tx((db) => db.select().from(sitePages), ids.other)
  ids.otherHome = otherPages.find((p) => p.slug === '')!.id
  // Live home page, so drafts can be told apart from what visitors see.
  await tx((db) => publishPage(db, { tenantId: ids.tenant!, pageId: ids.home! }))
})
afterAll(() => closeAllDbs())

const draftOf = async (pageId: string) =>
  JSON.stringify((await tx((db) => getEditablePage(db, ids.tenant!, pageId)))!.data)

describe('site edit ops layer', () => {
  it('rejects ops that do not fit the block schema, all-or-nothing', async () => {
    const r = await tx((db) =>
      runSiteEdit(
        db,
        {
          tenantId: ids.tenant!,
          dryRun: false,
          ops: [
            { op: 'update', page: 'home', id: 'h1', props: { text: { en: 'Fine' } } },
            { op: 'add', page: 'home', type: 'Marquee' },
            { op: 'update', page: 'home', id: 'h1', props: { colour: 'red' } },
            { op: 'nope' },
          ],
        },
        deps,
      ),
    )
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors.join('\n')).toMatch(/Change 4/)
    // The shape error stops the batch before any page is touched.
    expect(await draftOf(ids.home!)).toContain('Slow down')
    const r2 = await tx((db) =>
      runSiteEdit(
        db,
        {
          tenantId: ids.tenant!,
          dryRun: false,
          ops: [
            { op: 'update', page: 'home', id: 'h1', props: { text: { en: 'Fine' } } },
            { op: 'add', page: 'home', type: 'Marquee' },
            { op: 'update', page: 'home', id: 'h1', props: { colour: 'red' } },
          ],
        },
        deps,
      ),
    )
    expect(r2.ok ? [] : r2.errors).toEqual([
      'Change 2: unknown block "Marquee"',
      'Change 3: Heading has no prop "colour"',
    ])
    expect(await draftOf(ids.home!)).toContain('Slow down')
  })

  it('dry run returns the resulting draft and writes nothing', async () => {
    const r = await tx((db) =>
      runSiteEdit(
        db,
        {
          tenantId: ids.tenant!,
          dryRun: true,
          ops: [
            { op: 'add', page: 'home', type: 'FAQ', index: 0, props: { title: { en: 'Good to know' } } },
            { op: 'theme', tokens: { accent: '#C9A227' } },
          ],
        },
        deps,
      ),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.dryRun).toBe(true)
    expect(r.pages[0]!.data.content.map((n) => n.type)).toEqual(['FAQ', 'Heading'])
    expect(r.theme).toMatchObject({ accent: '#c9a227' })
    expect(r.summary[0]).toMatch(/^Home: Added FAQ at position 1/)
    expect(await draftOf(ids.home!)).not.toContain('Good to know')
    const [site] = await tx((db) => db.select().from(sites).where(eq(sites.tenantId, ids.tenant!)))
    expect(site!.themeDraft).toBeNull()
  })

  it('applies to drafts only: live page and live theme stay until publish', async () => {
    const r = await tx((db) =>
      runSiteEdit(
        db,
        {
          tenantId: ids.tenant!,
          userId: undefined,
          dryRun: false,
          ops: [
            { op: 'update', page: ids.home!, id: 'h1', props: { text: { en: 'Golden calm' } } },
            { op: 'theme', tokens: { accent: '#c9a227' } },
            { op: 'rename_page', page: 'home', title: { en: 'Welcome' } },
            { op: 'add_page', slug: 'offers', title: { en: 'Offers' }, copy_from: 'home' },
          ],
        },
        deps,
      ),
    )
    expect(r.ok ? r.summary.length : r.errors).toBe(4)
    if (!r.ok) return
    expect(await draftOf(ids.home!)).toContain('Golden calm')
    const live = await tx((db) => getPublishedPage(db, ids.tenant!, ''))
    expect(JSON.stringify(live!.data)).toContain('Slow down')
    expect(live!.site.theme).toMatchObject({ accent: '#111111' })
    expect(live!.site.themeDraft).toMatchObject({ accent: '#c9a227' })
    expect(live!.page.title.en).toBe('Home')
    expect(live!.page.pending?.title?.en).toBe('Welcome')
    expect(r.renamed[0]!.pending).toBe(true)
    // The new page exists as a draft only (not public).
    expect(await tx((db) => getPublishedPage(db, ids.tenant!, 'offers'))).toBeNull()
    const view = await tx((db) => getSiteForEdit(db, ids.tenant!))
    expect(view!.themeIsDraft).toBe(true)
    expect(view!.pages.map((p) => p.slug)).toContain('offers')
    // Publishing makes the draft theme and the pending rename live.
    await tx((db) => publishPage(db, { tenantId: ids.tenant!, pageId: ids.home! }))
    const after = await tx((db) => getPublishedPage(db, ids.tenant!, ''))
    expect(after!.site.theme).toMatchObject({ accent: '#c9a227' })
    expect(after!.site.themeDraft).toBeNull()
    expect(after!.page.title.en).toBe('Welcome')
    expect(after!.page.pending).toBeNull()
    // Undo restores the previous drafts.
    await tx((db) =>
      restoreSiteEdit(db, { tenantId: ids.tenant!, pages: r.previous.pages, theme: r.previous.theme }),
    )
    expect(await draftOf(ids.home!)).toContain('Slow down')
  })

  it('replaces an uploaded HTML design and refuses block ops on it', async () => {
    const bad = await tx((db) =>
      runSiteEdit(
        db,
        { tenantId: ids.tenant!, dryRun: false, ops: [{ op: 'add', page: 'design-a', type: 'Heading' }] },
        deps,
      ),
    )
    expect(bad.ok ? [] : bad.errors[0]).toMatch(/HTML design/)
    const notHtml = await tx((db) =>
      runSiteEdit(
        db,
        {
          tenantId: ids.tenant!,
          dryRun: false,
          ops: [{ op: 'html_design', page: 'home', html: '<div>x</div>' }],
        },
        deps,
      ),
    )
    expect(notHtml.ok ? [] : notHtml.errors[0]).toMatch(/not an uploaded HTML design/)
    const r = await tx((db) =>
      runSiteEdit(
        db,
        {
          tenantId: ids.tenant!,
          dryRun: false,
          ops: [{ op: 'html_design', page: 'design-a', html: '<html><head></head><body>new</body></html>' }],
        },
        deps,
      ),
    )
    expect(r.ok).toBe(true)
    const draft = await draftOf(ids.design!)
    expect(draft).toContain('new</body>')
    expect(draft).toContain('viewport') // fixHtmlDesign ran (same transform as the upload)
  })

  it('stays inside the tenant: another spa’s page id is not found', async () => {
    const r = await tx((db) =>
      runSiteEdit(
        db,
        {
          tenantId: ids.tenant!,
          dryRun: true,
          ops: [{ op: 'update', page: ids.otherHome!, id: 'h1', props: { text: { en: 'Hijack' } } }],
        },
        deps,
      ),
    )
    expect(r.ok ? [] : r.errors[0]).toMatch(/no page/)
    // RLS: even the other tenant's id under this tenant's transaction reads nothing.
    const rows = await tx((db) =>
      db.select().from(pageVersions).where(eq(pageVersions.pageId, ids.otherHome!)),
    )
    expect(rows).toHaveLength(0)
  })

  it('catalogue and audit payload', () => {
    const c = blockCatalogue(schema)
    expect(c.blocks.map((b) => b.type)).toEqual(['Heading', 'FAQ'])
    expect(
      siteEditAuditData({ via: 'mcp', ops: [{ op: 'update' }], summary: ['Home: Updated Heading'] }),
    ).toEqual({
      via: 'via Claude (MCP)',
      ops: ['update'],
      summary: ['Home: Updated Heading'],
    })
  })
})

describe('SITE_AI_EDITOR_EMAILS allow-list', () => {
  it('allows only a listed, verified super-admin with 2FA', async () => {
    const mk = async (email: string, o: { admin: boolean; twoFactor: boolean; verified?: boolean }) => {
      const id = `u-${email}`
      await platform.insert(user).values({
        id,
        name: email,
        email,
        emailVerified: o.verified ?? true,
        twoFactorEnabled: o.twoFactor,
      })
      if (o.admin) await platform.insert(platformAdmins).values({ userId: id })
      return id
    }
    const owner = await mk('owner@ai.test', { admin: true, twoFactor: true })
    const other = await mk('other-admin@ai.test', { admin: true, twoFactor: true })
    const no2fa = await mk('no2fa@ai.test', { admin: true, twoFactor: false })
    const plain = await mk('plain@ai.test', { admin: false, twoFactor: true })
    const unverified = await mk('unverified@ai.test', { admin: true, twoFactor: true, verified: false })
    const list = ['owner@ai.test', 'no2fa@ai.test', 'plain@ai.test', 'unverified@ai.test']
    expect(await siteAiEditorStatus(platform, owner, list)).toBe('ok')
    expect(await siteAiEditorStatus(platform, other, list)).toBe('not_listed')
    expect(await siteAiEditorStatus(platform, no2fa, list)).toBe('needs2fa')
    expect(await siteAiEditorStatus(platform, plain, list)).toBe('not_admin')
    expect(await siteAiEditorStatus(platform, unverified, list)).toBe('not_listed')
    // Case-insensitive via the env parser; empty list = nobody.
    process.env.SITE_AI_EDITOR_EMAILS = ' OWNER@ai.test '
    expect(await siteAiEditorStatus(platform, owner)).toBe('ok')
    process.env.SITE_AI_EDITOR_EMAILS = ''
    expect(await siteAiEditorStatus(platform, owner)).toBe('not_listed')
  })
})

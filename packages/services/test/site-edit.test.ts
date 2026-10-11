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
  acquirePageLock,
  addPage,
  assertEditStamp,
  blockCatalogue,
  DomainError,
  EDITED_ELSEWHERE,
  editStamp,
  ensureSite,
  getEditablePage,
  getHtmlDesign,
  getPublishedPage,
  getSite,
  getSiteForEdit,
  listPages,
  listVersions,
  prepareHtmlDesign,
  publishAll,
  publishPage,
  restoreSiteEdit,
  runSiteEdit,
  type SiteEditSchema,
  saveDraft,
  siteEditAuditData,
  tenantHtmlAssetSink,
  updateDraftTheme,
  updateTheme,
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
    // R24: stored exactly as sent (no fixHtmlDesign), "Phone fixes" off unless asked.
    expect(draft).not.toContain('viewport')
    expect(draft).toContain('"phoneFixes":false')
  })

  describe('R24 HTML designs: convert, embedded files, patches', () => {
    const fileUrl = (id: string, name: string) => `https://app.test/files/${id}/${name}`
    const png = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.alloc(2000, 7)]).toString('base64')}`
    const run = (ops: unknown[], o: { dryRun?: boolean; userId?: string } = {}) =>
      tx((db) =>
        runSiteEdit(
          db,
          { tenantId: ids.tenant!, userId: o.userId, dryRun: Boolean(o.dryRun), ops },
          {
            ...deps,
            prepareHtml: (h, p) =>
              prepareHtmlDesign({
                html: h,
                images: p.images,
                sink: tenantHtmlAssetSink(db, ids.tenant!),
                fileUrl,
                dryRun: p.dryRun,
              }),
          },
        ),
      )
    const doc = (body: string) => `<!doctype html><html><head></head><body>${body}</body></html>`

    it('turns a block page into an HTML design page only with convert; the old draft stays in history', async () => {
      const page = await tx((db) =>
        addPage(db, { tenantId: ids.tenant!, slug: 'convert-me', title: { en: 'Convert' }, data: home }),
      )
      const refused = await run([{ op: 'html_design', page: 'convert-me', html: doc('<h1>New</h1>') }])
      expect(refused.ok ? '' : refused.errors[0]).toMatch(/has 1 block; pass convert: true/)
      const dry = await run(
        [{ op: 'html_design', page: 'convert-me', html: doc('<h1>New</h1>'), convert: true }],
        {
          dryRun: true,
        },
      )
      expect(dry.ok).toBe(true)
      expect(await draftOf(page.id)).toContain('Slow down')
      const r = await run([
        { op: 'html_design', page: 'convert-me', html: doc(`<h1>New</h1><img src="${png}">`), convert: true },
      ])
      expect(r.ok && r.html[0]).toMatchObject({ page: 'convert-me', moved: 1, phoneFixes: false })
      const data = JSON.parse(await draftOf(page.id))
      expect(data.root.props).toEqual({ title: { en: 'Home' }, htmlDesign: true })
      expect(data.content).toHaveLength(1)
      expect(data.content[0]).toMatchObject({
        type: 'HtmlDesign',
        props: { id: 'convert-me-html-design', phoneFixes: false },
      })
      expect(data.content[0].props.html).toMatch(
        /<img crossorigin="anonymous" src="https:\/\/app\.test\/files\/[0-9a-f-]{36}\/[0-9a-f]{16}\.png">/,
      )
      const versions = await tx((db) => listVersions(db, ids.tenant!, page.id))
      expect(versions.map((v) => v.label).find(Boolean)).toMatch(/^Before AI assistant HTML design /)
      const view = await tx((db) => getHtmlDesign(db, ids.tenant!, 'convert-me'))
      expect(view).toMatchObject({ phoneFixes: false, images: 0, editing: null })
      expect(view!.html).not.toContain('data:image/png')
      await expect(tx((db) => getHtmlDesign(db, ids.tenant!, 'home'))).rejects.toThrow(
        /not an HTML design page/,
      )
    })

    it('patches with exact, unique finds; all-or-nothing; dry runs save nothing; phone_fixes kept unless given', async () => {
      const before = await draftOf(ids.design!)
      const zero = await run([
        { op: 'html_patch', page: 'design-a', edits: [{ find: 'nowhere', replace: 'x' }] },
      ])
      expect(zero.ok ? '' : zero.errors[0]).toMatch(/Edit 1: `find` matches 0 times/)
      const twice = await run([
        { op: 'html_patch', page: 'design-a', edits: [{ find: 'new</body>', replace: 'a b a</body>' }] },
        { op: 'html_patch', page: 'design-a', edits: [{ find: 'a', replace: 'z' }] },
      ])
      expect(twice.ok ? '' : twice.errors[0]).toMatch(
        /Change 2: Edit 1: `find` matches \d+ times — include more/,
      )
      expect(await draftOf(ids.design!)).toBe(before)
      const dry = await run(
        [{ op: 'html_patch', page: 'design-a', edits: [{ find: 'new</body>', replace: 'patched</body>' }] }],
        {
          dryRun: true,
        },
      )
      expect(dry.ok).toBe(true)
      expect(await draftOf(ids.design!)).toBe(before)
      const ok = await run([
        {
          op: 'html_patch',
          page: 'design-a',
          edits: [{ find: 'new</body>', replace: 'patched</body>' }],
          phone_fixes: true,
        },
      ])
      expect(ok.ok && ok.html[0]?.at).toEqual([expect.any(Number)])
      expect(await draftOf(ids.design!)).toContain('patched</body>')
      expect(await draftOf(ids.design!)).toContain('"phoneFixes":true')
      await run([{ op: 'html_patch', page: 'design-a', edits: [{ find: 'patched', replace: 'again' }] }])
      expect(await draftOf(ids.design!)).toContain('"phoneFixes":true')
    })

    it('respects editor locks held by someone else', async () => {
      await platform.insert(user).values({ id: 'u-lock-holder', name: 'Lina', email: 'lina@lock.test' })
      await tx((db) =>
        acquirePageLock(db, {
          tenantId: ids.tenant!,
          pageId: ids.design!,
          userId: 'u-lock-holder',
          holderName: 'Lina',
        }),
      )
      const r = await run([{ op: 'html_patch', page: 'design-a', edits: [{ find: 'again', replace: 'x' }] }])
      expect(r.ok ? '' : r.errors[0]).toMatch(/Lina/)
      expect(await draftOf(ids.design!)).toContain('again')
    })

    it('refuses a design that stays too big after moving its files out', async () => {
      const r = await run([
        { op: 'html_design', page: 'convert-me', html: doc(`<script>${'x'.repeat(520 * 1024)}</script>`) },
      ])
      expect(r.ok ? '' : r.errors[0]).toMatch(/still|The design is \d+ KB \(scripts/)
    })
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
      via: 'via AI assistant (MCP)',
      ops: ['update'],
      summary: ['Home: Updated Heading'],
    })
  })
})

/** A fresh spa with a live home page and a live /services page (each test gets its own). */
async function liveSpa(slug: string) {
  const [t] = await platform.insert(tenants).values({ slug, name: slug }).returning()
  const tenant = t!.id
  await tx(
    (db) =>
      ensureSite(db, tenant, {
        key: 'zen',
        name: 'Zen',
        theme: { accent: '#111111' },
        pages: [
          { slug: '', title: { en: 'Home' }, data: home },
          { slug: 'services', title: { en: 'Services' }, data: home },
        ],
      }),
    tenant,
  )
  await tx((db) => publishAll(db, tenant), tenant)
  const pages = await tx((db) => listPages(db, tenant), tenant)
  return {
    tenant,
    home: pages.find((p) => p.slug === '')!.id,
    services: pages.find((p) => p.slug === 'services')!.id,
    run: (ops: unknown[], dryRun = false) =>
      tx((db) => runSiteEdit(db, { tenantId: tenant, ops, dryRun }, deps), tenant),
    draft: async (pageId: string) =>
      JSON.stringify((await tx((db) => getEditablePage(db, tenant, pageId), tenant))!.data),
    site: async () => (await tx((db) => getSite(db, tenant), tenant))!,
    pages: () => tx((db) => listPages(db, tenant), tenant),
    in: <T>(fn: Parameters<typeof withTenant<T>>[1]) => tx(fn, tenant),
  }
}
const heading = (text: string) => ({
  op: 'add',
  page: 'home',
  type: 'Heading',
  props: { text: { en: text } },
})

describe('site edit drafts: concurrency, undo, renames, publish', () => {
  it('serialises concurrent edits of one spa: both parallel tool calls land', async () => {
    const spa = await liveSpa('edit-race')
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let firstSaved!: () => void
    const saved = new Promise<void>((r) => {
      firstSaved = r
    })
    // A saves and holds its transaction open; B starts meanwhile. Without the per-spa lock B would read the draft
    // A hasn't committed yet and its save would silently drop A's block (last write wins).
    const a = spa.in(async (db) => {
      const r = await runSiteEdit(
        db,
        { tenantId: spa.tenant, ops: [heading('First block')], dryRun: false },
        deps,
      )
      firstSaved()
      await gate
      return r
    })
    await saved
    const b = spa.run([heading('Second block')])
    await new Promise((r) => setTimeout(r, 300))
    release()
    expect((await a).ok).toBe(true)
    expect((await b).ok).toBe(true)
    const draft = await spa.draft(spa.home)
    expect(draft).toContain('First block')
    expect(draft).toContain('Second block')
  })

  it('edit stamps refuse a stale editor (page draft, and draft theme / rename for a publish)', async () => {
    const spa = await liveSpa('edit-stamp')
    const loaded = (await spa.in((db) => editStamp(db, spa.tenant, spa.home)))!
    expect(loaded).toMatchObject({ themeDraft: false, pendingRename: false })
    await spa.in((db) => assertEditStamp(db, spa.tenant, spa.home, loaded, { site: true }))
    // Claude (MCP) changes the theme draft: a page save still fits, a publish does not.
    await spa.run([{ op: 'theme', tokens: { accent: '#c9a227' } }])
    await spa.in((db) => assertEditStamp(db, spa.tenant, spa.home, loaded))
    await expect(
      spa.in((db) => assertEditStamp(db, spa.tenant, spa.home, loaded, { site: true })),
    ).rejects.toThrow(EDITED_ELSEWHERE)
    expect((await spa.in((db) => editStamp(db, spa.tenant, spa.home)))!.themeDraft).toBe(true)
    // …and then the page draft: every check fails.
    await spa.run([heading('From Claude')])
    await expect(spa.in((db) => assertEditStamp(db, spa.tenant, spa.home, loaded))).rejects.toBeInstanceOf(
      DomainError,
    )
    // No stamp = no check (callers without an editor view).
    await spa.in((db) => assertEditStamp(db, spa.tenant, spa.home, undefined, { site: true }))
  })

  it('undo puts back the exact earlier state: no draft theme and no page draft when there were none', async () => {
    const spa = await liveSpa('edit-undo')
    const r = await spa.run([
      { op: 'update', page: 'home', id: 'h1', props: { text: { en: 'Golden calm' } } },
      { op: 'theme', tokens: { accent: '#c9a227' } },
    ])
    if (!r.ok) throw new Error(r.errors.join())
    expect(r.previous.theme).toMatchObject({ draft: null, shown: { accent: '#111111' } })
    expect(r.previous.pages[0]!.addedVersionId).toEqual(expect.any(String))
    expect((await spa.pages()).find((p) => p.id === spa.home)!.hasDraft).toBe(true)
    // Meanwhile the Theme panel puts a blue accent live (and into the draft).
    await spa.in(async (db) => {
      await updateTheme(db, spa.tenant, { accent: '#2244aa' })
      await updateDraftTheme(db, spa.tenant, { accent: '#2244aa' })
    })
    await spa.in((db) =>
      restoreSiteEdit(db, { tenantId: spa.tenant, pages: r.previous.pages, theme: r.previous.theme }),
    )
    expect((await spa.site()).themeDraft).toBeNull()
    expect((await spa.pages()).find((p) => p.id === spa.home)!.hasDraft).toBe(false)
    expect(await spa.draft(spa.home)).toContain('Slow down')
    // A later publish keeps the live Theme panel change (no stale snapshot to promote).
    await spa.in((db) => publishPage(db, { tenantId: spa.tenant, pageId: spa.home }))
    expect((await spa.site()).theme).toMatchObject({ accent: '#2244aa' })
  })

  it('undo of an edit over an existing draft theme restores that draft', async () => {
    const spa = await liveSpa('edit-undo-draft')
    await spa.run([{ op: 'theme', tokens: { accent: '#aa0000' } }])
    const r = await spa.run([{ op: 'theme', tokens: { accent: '#00aa00' } }])
    if (!r.ok) throw new Error(r.errors.join())
    expect(r.previous.theme?.draft).toMatchObject({ accent: '#aa0000' })
    await spa.in((db) => restoreSiteEdit(db, { tenantId: spa.tenant, pages: [], theme: r.previous.theme }))
    expect((await spa.site()).themeDraft).toMatchObject({ accent: '#aa0000' })
  })

  it('dry run validates renames like the save does', async () => {
    const spa = await liveSpa('edit-rename-dry')
    const errorsOf = async (ops: unknown[]) => {
      const r = await spa.run(ops, true)
      return r.ok ? [] : r.errors
    }
    expect(await errorsOf([{ op: 'rename_page', page: 'services', slug: '' }])).toEqual([
      expect.stringMatching(/Change 1: Use lowercase letters/),
    ])
    expect(await errorsOf([{ op: 'rename_page', page: 'services', slug: 'Bad Slug' }])).toEqual([
      expect.stringMatching(/lowercase letters, numbers and dashes/),
    ])
    expect(await errorsOf([{ op: 'rename_page', page: 'home', slug: 'start' }])).toEqual([
      expect.stringMatching(/home page address can’t change/),
    ])
    expect(await errorsOf([{ op: 'rename_page', page: 'home', slug: 'book' }])).toEqual([
      expect.stringMatching(/home page address/),
    ])
    expect(await errorsOf([{ op: 'rename_page', page: 'services', slug: 'book' }])).toEqual([
      expect.stringMatching(/Another page already uses that address/),
    ])
    // Inside one batch: a new page and a rename can't both take /team.
    expect(
      await errorsOf([
        { op: 'add_page', slug: 'team', title: { en: 'Team' } },
        { op: 'rename_page', page: 'services', slug: 'team' },
      ]),
    ).toEqual([expect.stringMatching(/Change 2: Another page already uses that address/)])
    const ok = await spa.run([{ op: 'rename_page', page: 'services', slug: 'treatments' }], true)
    expect(ok.ok && ok.renamed).toEqual([{ id: spa.services, slug: 'treatments', pending: true }])
  })

  it('a pending rename reserves its address; publish re-checks it instead of failing on the constraint', async () => {
    const spa = await liveSpa('edit-rename-slug')
    expect((await spa.run([{ op: 'rename_page', page: 'services', slug: 'treatments' }])).ok).toBe(true)
    expect((await spa.pages()).find((p) => p.id === spa.services)!.pending).toEqual({ slug: 'treatments' })
    const added = await spa.run([{ op: 'add_page', slug: 'treatments', title: { en: 'Treatments' } }])
    expect(added.ok ? [] : added.errors).toEqual([expect.stringMatching(/a page already uses \/treatments/)])
    const studio = await spa.in((db) =>
      addPage(db, { tenantId: spa.tenant, slug: 'treatments', title: { en: 'Treatments' }, data: home }),
    )
    expect(studio.slug).toBe('treatments-2')
    // A page that took the address some other way (older data): publishing explains instead of a raw 23505.
    const site = await spa.site()
    await spa.in((db) =>
      db
        .insert(sitePages)
        .values({ tenantId: spa.tenant, siteId: site.id, slug: 'treatments', title: { en: 'X' } }),
    )
    await expect(
      spa.in((db) => publishPage(db, { tenantId: spa.tenant, pageId: spa.services })),
    ).rejects.toThrow(
      'Another page now uses /treatments — rename this page to a free address before publishing',
    )
    await expect(spa.in((db) => publishAll(db, spa.tenant))).rejects.toBeInstanceOf(DomainError)
  })

  it('Publish site also publishes a theme-only or rename-only edit', async () => {
    const spa = await liveSpa('edit-publish-all')
    await spa.run([{ op: 'theme', tokens: { accent: '#c9a227' } }])
    expect((await spa.pages()).some((p) => p.hasDraft)).toBe(false)
    expect(await spa.in((db) => publishAll(db, spa.tenant))).toEqual({ pages: 0, theme: true })
    expect(await spa.site()).toMatchObject({ theme: { accent: '#c9a227' }, themeDraft: null })
    await spa.run([{ op: 'rename_page', page: 'services', slug: 'treatments', title: { en: 'Treatments' } }])
    expect(await spa.in((db) => publishAll(db, spa.tenant))).toEqual({ pages: 1, theme: false })
    const services = (await spa.pages()).find((p) => p.id === spa.services)!
    expect(services).toMatchObject({ slug: 'treatments', title: { en: 'Treatments' }, pending: null })
    expect(await spa.in((db) => publishAll(db, spa.tenant))).toEqual({ pages: 0, theme: false })
    // A page draft saved by hand still counts as before.
    await spa.in((db) => saveDraft(db, { tenantId: spa.tenant, pageId: spa.home, data: home }))
    expect(await spa.in((db) => publishAll(db, spa.tenant))).toEqual({ pages: 1, theme: false })
  })
})

describe('SITE_AI_EDITOR_EMAILS allow-list', () => {
  it('a named list: listed + verified super-admin with 2FA; `*`: any super-admin with 2FA', async () => {
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
    const squatter = await mk('squatter@ai.test', { admin: false, twoFactor: false, verified: false })
    const list = ['owner@ai.test', 'no2fa@ai.test', 'plain@ai.test', 'unverified@ai.test', 'squatter@ai.test']
    expect(await siteAiEditorStatus(platform, owner, list)).toBe('ok')
    expect(await siteAiEditorStatus(platform, other, list)).toBe('not_listed')
    expect(await siteAiEditorStatus(platform, no2fa, list)).toBe('needs2fa')
    expect(await siteAiEditorStatus(platform, plain, list)).toBe('not_admin')
    expect(await siteAiEditorStatus(platform, unverified, list)).toBe('unverified')
    // A listed address signed up by someone else (unverified, not a super-admin) learns nothing about the list.
    expect(await siteAiEditorStatus(platform, squatter, list)).toBe('not_listed')
    // Case-insensitive via the env parser; empty list = nobody.
    process.env.SITE_AI_EDITOR_EMAILS = ' OWNER@ai.test '
    expect(await siteAiEditorStatus(platform, owner)).toBe('ok')
    process.env.SITE_AI_EDITOR_EMAILS = ''
    expect(await siteAiEditorStatus(platform, owner)).toBe('not_listed')
    // `*` = every super-admin, like the console: the super-admin row and 2FA still required, the email check isn't.
    process.env.SITE_AI_EDITOR_EMAILS = '*'
    expect(await siteAiEditorStatus(platform, other)).toBe('ok')
    expect(await siteAiEditorStatus(platform, no2fa)).toBe('needs2fa')
    expect(await siteAiEditorStatus(platform, plain)).toBe('not_admin')
    expect(await siteAiEditorStatus(platform, unverified)).toBe('ok')
    expect(await siteAiEditorStatus(platform, squatter)).toBe('not_admin')
    expect(await siteAiEditorStatus(platform, 'no-such-user')).toBe('not_listed')
    // `*` next to addresses still means everyone.
    process.env.SITE_AI_EDITOR_EMAILS = 'owner@ai.test, *'
    expect(await siteAiEditorStatus(platform, other)).toBe('ok')
    process.env.SITE_AI_EDITOR_EMAILS = ''
  })
})

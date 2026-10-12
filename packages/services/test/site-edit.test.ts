import {
  closeAllDbs,
  pageVersions,
  platformAdmins,
  siteAiEditorStatus,
  sitePages,
  sites,
  storedFiles,
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
  htmlDesignContentErrors,
  listPages,
  listVersions,
  publishAll,
  publishPage,
  restoreSiteEdit,
  runSiteEdit,
  type SiteEditSchema,
  saveDraft,
  siteEditAuditData,
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
/** R24: the stored design of an HTML design page (its own file since the review fix). */
const designOf = async (pageRef: string) => (await tx((db) => getHtmlDesign(db, ids.tenant!, pageRef)))!.html

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
    // R24: stored exactly as sent (no fixHtmlDesign) in the spa's own file; "Phone fixes" off unless asked.
    expect(await designOf('design-a')).toBe('<html><head></head><body>new</body></html>')
    expect(draft).not.toContain('new</body>')
    expect(draft).toContain('"html":""')
    expect(draft).toContain('"phoneFixes":false')
  })

  describe('R24 HTML designs: convert, exact files, patches', () => {
    const png = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.alloc(2000, 7)]).toString('base64')}`
    const run = (ops: unknown[], o: { dryRun?: boolean; userId?: string } = {}) =>
      tx((db) =>
        runSiteEdit(db, { tenantId: ids.tenant!, userId: o.userId, dryRun: Boolean(o.dryRun), ops }, deps),
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
      const sent = doc(
        `<h1>New</h1><img src="${png}"><iframe src="https://www.youtube.com/embed/x"></iframe>`,
      )
      const r = await run([{ op: 'html_design', page: 'convert-me', html: sent, convert: true }])
      expect(r.ok && r.html[0]).toMatchObject({
        page: 'convert-me',
        chars: sent.length,
        phoneFixes: false,
        embeds: ['www.youtube.com'],
      })
      const data = JSON.parse(await draftOf(page.id))
      expect(data.root.props).toEqual({ title: { en: 'Home' }, htmlDesign: true })
      expect(data.content).toHaveLength(1)
      expect(data.content[0]).toMatchObject({
        type: 'HtmlDesign',
        props: { id: 'convert-me-html-design', phoneFixes: false },
      })
      // Byte for byte: nothing moved out or rewritten, the page JSON only references the spa's file.
      expect(data.content[0].props.html).toBe('')
      expect(data.content[0].props.doc).toMatchObject({ chars: sent.length, bytes: sent.length })
      expect(await designOf('convert-me')).toBe(sent)
      const versions = await tx((db) => listVersions(db, ids.tenant!, page.id))
      expect(versions.map((v) => v.label).find(Boolean)).toMatch(/^Before AI assistant HTML design /)
      const view = await tx((db) => getHtmlDesign(db, ids.tenant!, 'convert-me'))
      expect(view).toMatchObject({ phoneFixes: false, images: 0, editing: null, html: sent })
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
      expect(await designOf('design-a')).toContain('patched</body>')
      expect(await draftOf(ids.design!)).toContain('"phoneFixes":true')
      await run([{ op: 'html_patch', page: 'design-a', edits: [{ find: 'patched', replace: 'again' }] }])
      expect(await draftOf(ids.design!)).toContain('"phoneFixes":true')
      expect(await designOf('design-a')).toContain('again</body>')
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
      expect(await designOf('design-a')).toContain('again')
    })

    it('keeps a 4.5 MB design (big inline script + styles, Arabic) exactly; refuses one over 5 MB', async () => {
      const big = doc(
        `<style>${'.a{content:"x"}\n'.repeat(60_000)}</style><p>${'سبا '.repeat(300_000)}</p><script>${'var a="\\n";'.repeat(150_000)}</script>`,
      )
      expect(Buffer.byteLength(big)).toBeGreaterThan(4.4 * 1024 * 1024)
      const r = await run([{ op: 'html_design', page: 'convert-me', html: big }])
      expect(r.ok).toBe(true)
      expect(await designOf('convert-me')).toBe(big)
      // Characters ≠ bytes: Arabic letters are 2 bytes each in UTF-8.
      const over = doc('س'.repeat(2.7 * 1024 * 1024))
      expect(over.length).toBeLessThan(5 * 1024 * 1024)
      const refused = await run([{ op: 'html_design', page: 'convert-me', html: over }])
      expect(refused.ok ? '' : refused.errors[0]).toMatch(/the limit is 5 MB/)
    })

    it('R28: html_content sets website content over the design data; the file never changes', async () => {
      const literal = {
        spa: { name: 'Design Spa', experience_image: 'data:image/png;base64,AA' },
        journey: [{ id: 'welcome', title: 'Old title', image: 'data:image/png;base64,AA', cta: true }],
        booking: { label: 'Book', url: null },
      }
      const sent = doc(`<h1>x</h1><script>window.CRM_DATA = ${JSON.stringify(literal)};</script>`)
      await tx((db) =>
        addPage(db, { tenantId: ids.tenant!, slug: 'content-me', title: { en: 'Content' }, data: home }),
      )
      expect((await run([{ op: 'html_design', page: 'content-me', html: sent, convert: true }])).ok).toBe(
        true,
      )
      const [mine, theirs, hidden] = await platform
        .insert(storedFiles)
        .values([
          { tenantId: ids.tenant!, contentType: 'image/webp', size: 1, isPublic: true },
          { tenantId: ids.other!, contentType: 'image/webp', size: 1, isPublic: true },
          { tenantId: ids.tenant!, contentType: 'image/webp', size: 1, isPublic: false },
        ])
        .returning()
      const set = (values: Record<string, unknown>, o: { dryRun?: boolean } = {}) =>
        run([{ op: 'html_content', page: 'content-me', set: values }], o)
      const refused = await set({
        'spa.name': { t: { en: 'Other' } },
        'journey[welcome].cta': { t: { en: 'x' } },
      })
      expect(refused.ok ? [] : refused.errors).toEqual([
        'Change 1: spa.name: not an editable part of this design · journey[welcome].cta: expects a bool value',
      ])
      for (const f of [theirs!, hidden!])
        expect(
          ((await set({ 'journey[welcome].image': { img: `/files/${f.id}` } })) as { errors: string[] })
            .errors[0],
        ).toMatch(/is not one of this spa's pictures/)
      const before = await draftOf((await tx((db) => getHtmlDesign(db, ids.tenant!, 'content-me')))!.page.id)
      expect((await set({ 'booking.label': { t: { en: 'Dry' } } }, { dryRun: true })).ok).toBe(true)
      const pageId = (await tx((db) => getHtmlDesign(db, ids.tenant!, 'content-me')))!.page.id
      expect(await draftOf(pageId)).toBe(before)
      const ok = await set({
        'journey[welcome].title': { t: { en: 'Relax in Dubai', ar: null } },
        'journey[welcome].image': { img: `/files/${mine!.id}` },
        'journey[welcome].cta': { on: false },
      })
      expect(ok.ok && ok.summary).toEqual([
        'Website content of Content: 3 values set (the design file is unchanged)',
      ])
      const view = await tx((db) => getHtmlDesign(db, ids.tenant!, 'content-me'))
      expect(view!.html).toBe(sent)
      // Stored as a list (Puck's editor flattens block props on "."): never path-keyed objects.
      expect(view!.content).toEqual({
        v: 1,
        values: [
          { path: 'journey[welcome].title', value: { t: { en: 'Relax in Dubai' } } },
          { path: 'journey[welcome].image', value: { img: `/files/${mine!.id}` } },
          { path: 'journey[welcome].cta', value: { on: false } },
        ],
      })
      await run([{ op: 'html_content', page: 'content-me', reset: ['journey[welcome].cta'] }])
      expect((await tx((db) => getHtmlDesign(db, ids.tenant!, 'content-me')))!.content!.values).toHaveLength(
        2,
      )
      await run([{ op: 'html_content', page: 'content-me', reset: 'all' }])
      expect((await tx((db) => getHtmlDesign(db, ids.tenant!, 'content-me')))!.content).toBeNull()
      // A design without window.CRM_DATA: its words live in the file.
      const plain = await run([{ op: 'html_content', page: 'design-a', set: {} }])
      expect(plain.ok ? '' : plain.errors[0]).toMatch(/has no window.CRM_DATA/)
    })

    it('R28 P4: html_content sets page texts and pictures with server-filled src guards; unknown / bound ids and another spa’s files refused; works on a design without window.CRM_DATA (set refused there); file byte-identical', async () => {
      const sent = doc(
        `<h1 id="spa">Loading</h1><h2>Design heading</h2><img alt="Design picture" src="https://example.com/design.jpg"><script>document.getElementById('spa').textContent = 'x'</script>`,
      )
      await tx((db) =>
        addPage(db, { tenantId: ids.tenant!, slug: 'texts-me', title: { en: 'Texts' }, data: home }),
      )
      expect((await run([{ op: 'html_design', page: 'texts-me', html: sent, convert: true }])).ok).toBe(true)
      const [mine, theirs] = await platform
        .insert(storedFiles)
        .values([
          { tenantId: ids.tenant!, contentType: 'image/webp', size: 1, isPublic: true },
          { tenantId: ids.other!, contentType: 'image/webp', size: 1, isPublic: true },
        ])
        .returning()
      const refused = async (op: Record<string, unknown>) => {
        const r = await run([{ op: 'html_content', page: 'texts-me', ...op }])
        return r.ok ? '' : r.errors[0]
      }
      expect(await refused({ set: { 'booking.label': { t: { en: 'x' } } } })).toMatch(
        /has no window.CRM_DATA: change its page texts and pictures with texts \/ pictures, or the file with html_patch/,
      )
      expect(await refused({ texts: [{ id: 'txt-9', t: { en: 'x' } }] })).toMatch(
        /no page text "txt-9" in this design — get_html_content lists them/,
      )
      expect(await refused({ texts: [{ id: 'txt-0', t: { en: 'x' } }] })).toMatch(
        /txt-0 is filled by the design's script — change it in the design file with html_patch/,
      )
      expect(await refused({ texts: [{ id: 'txt-1', t: { en: ' ' } }] })).toMatch(
        /text txt-1: an English or Arabic text/,
      )
      expect(await refused({ texts: [{ id: 'txt-1', t: { ar: ' ' } }] })).toMatch(
        /text txt-1: an English or Arabic text/,
      )
      expect(await refused({ pictures: [{ id: 'img-3', img: `/files/${mine!.id}` }] })).toMatch(
        /no picture "img-3" in this design/,
      )
      expect(await refused({ pictures: [{ id: 'img-0', img: 'data:image/png;base64,AA' }] })).toMatch(
        /picture img-0: a picture from the media library/,
      )
      expect(await refused({ pictures: [{ id: 'img-0', img: `/files/${theirs!.id}` }] })).toMatch(
        /is not one of this spa's pictures/,
      )
      const ok = await run([
        {
          op: 'html_content',
          page: 'texts-me',
          // A client's src is never taken: the server fills the guard from the design.
          texts: [
            { id: 'txt-1', src: 'forged', t: { en: 'Our rituals', ar: null } },
            { id: 'attr-0', t: { en: 'Lounge', ar: 'صالة' } },
          ],
          pictures: [{ id: 'img-0', img: `/files/${mine!.id}` }],
        },
      ])
      expect(ok.ok && ok.summary).toEqual([
        'Website content of Texts: 2 page texts, 1 picture (the design file is unchanged)',
      ])
      const view = await tx((db) => getHtmlDesign(db, ids.tenant!, 'texts-me'))
      expect(view!.html).toBe(sent)
      expect(view!.content).toEqual({
        v: 1,
        texts: [
          { id: 'txt-1', src: 'Design heading', t: { en: 'Our rituals' } },
          { id: 'attr-0', src: 'Design picture', t: { en: 'Lounge', ar: 'صالة' } },
        ],
        pictures: [{ id: 'img-0', src: 'https://example.com/design.jpg', img: `/files/${mine!.id}` }],
      })
      // Arabic only: no en keeps the stored English; '' drops it (the design's English stays on the page).
      expect(
        (
          await run([
            {
              op: 'html_content',
              page: 'texts-me',
              texts: [
                { id: 'txt-1', t: { ar: 'طقوسنا' } },
                { id: 'attr-0', t: { en: '', ar: 'صالة' } },
              ],
            },
          ])
        ).ok,
      ).toBe(true)
      expect((await tx((db) => getHtmlDesign(db, ids.tenant!, 'texts-me')))!.content!.texts).toEqual([
        { id: 'txt-1', src: 'Design heading', t: { en: 'Our rituals', ar: 'طقوسنا' } },
        { id: 'attr-0', src: 'Design picture', t: { ar: 'صالة' } },
      ])
    })

    it('R28 P4: a values edit keeps stored texts and pictures; reset text:<id> / picture:<id>; ‘all’ clears every part (content removed)', async () => {
      const sent = doc(
        `<h1>Welcome</h1><img src="https://example.com/a.jpg"><script>window.CRM_DATA = ${JSON.stringify({ booking: { label: 'Book', url: null } })};</script>`,
      )
      await tx((db) =>
        addPage(db, { tenantId: ids.tenant!, slug: 'mixed-me', title: { en: 'Mixed' }, data: home }),
      )
      expect((await run([{ op: 'html_design', page: 'mixed-me', html: sent, convert: true }])).ok).toBe(true)
      const content = async () => (await tx((db) => getHtmlDesign(db, ids.tenant!, 'mixed-me')))!.content
      const pageParts = [
        {
          op: 'html_content',
          page: 'mixed-me',
          texts: [{ id: 'txt-0', t: { en: 'Hello' } }],
          pictures: [{ id: 'img-0', img: 'https://cdn.example/b.jpg' }],
        },
      ]
      expect((await run(pageParts)).ok).toBe(true)
      const values = await run([
        { op: 'html_content', page: 'mixed-me', set: { 'booking.label': { t: { en: 'Reserve' } } } },
      ])
      expect(values.ok && values.summary).toEqual([
        'Website content of Mixed: 1 value set (the design file is unchanged)',
      ])
      const text = { id: 'txt-0', src: 'Welcome', t: { en: 'Hello' } }
      const picture = { id: 'img-0', src: 'https://example.com/a.jpg', img: 'https://cdn.example/b.jpg' }
      const value = { path: 'booking.label', value: { t: { en: 'Reserve' } } }
      expect(await content()).toEqual({ v: 1, values: [value], texts: [text], pictures: [picture] })
      const reset = await run([
        { op: 'html_content', page: 'mixed-me', reset: ['text:txt-0', 'picture:img-0'] },
      ])
      expect(reset.ok && reset.summary).toEqual([
        "Website content of Mixed: 2 back to the design's (the design file is unchanged)",
      ])
      expect(await content()).toEqual({ v: 1, values: [value] })
      expect((await run(pageParts)).ok).toBe(true)
      const all = await run([{ op: 'html_content', page: 'mixed-me', reset: 'all' }])
      expect(all.ok && all.summary).toEqual([
        "Website content of Mixed: 0 values set, 3 back to the design's (the design file is unchanged)",
      ])
      expect(await content()).toBeNull()
      expect(await designOf('mixed-me')).toBe(sent)
    })

    it('R28 P4: an English value copied from a cut-short listing ("…") is refused; Arabic only and a short teaser pass', async () => {
      const long = `${'Our rituals bring calm to the city. '.repeat(12)}Book today.`
      const sent = doc(
        `<p>${long}</p><script>window.CRM_DATA = ${JSON.stringify({ about: { body: long } })};</script>`,
      )
      await tx((db) =>
        addPage(db, { tenantId: ids.tenant!, slug: 'cut-me', title: { en: 'Cut' }, data: home }),
      )
      expect((await run([{ op: 'html_design', page: 'cut-me', html: sent, convert: true }])).ok).toBe(true)
      const op = (o: Record<string, unknown>) => run([{ op: 'html_content', page: 'cut-me', ...o }])
      const errorOf = async (o: Record<string, unknown>) => {
        const r = await op(o)
        return r.ok ? '' : r.errors[0]
      }
      for (const clip of [160, 400].filter((n) => n < long.length)) {
        const cut = `${long.slice(0, clip)}…`
        expect(await errorOf({ texts: [{ id: 'txt-0', t: { en: cut, ar: 'طقوسنا' } }] })).toMatch(
          /txt-0: the English is the design's text cut short \(it ends with "…"\) — to add Arabic send only ar/,
        )
        expect(await errorOf({ set: { 'about.body': { t: { en: cut, ar: 'طقوسنا' } } } })).toMatch(
          /about\.body: the English is the design's text cut short .* send the whole English text/,
        )
      }
      expect((await op({ texts: [{ id: 'txt-0', t: { ar: 'طقوسنا' } }] })).ok).toBe(true)
      expect((await op({ texts: [{ id: 'txt-0', t: { en: 'Our rituals…' } }] })).ok).toBe(true)
      expect((await op({ set: { 'about.body': { t: { en: long, ar: 'طقوسنا' } } } })).ok).toBe(true)
    })

    it('R28 P4: htmlDesignContentErrors: shape problems, private and other tenants’ /files refused; stale entries and own deleted files allowed', async () => {
      const [mine, theirs, hidden] = await platform
        .insert(storedFiles)
        .values([
          { tenantId: ids.tenant!, contentType: 'image/webp', size: 1, isPublic: true },
          { tenantId: ids.other!, contentType: 'image/webp', size: 1, isPublic: true },
          { tenantId: ids.tenant!, contentType: 'image/webp', size: 1, isPublic: false },
        ])
        .returning()
      const check = (content: unknown) =>
        tx((db) =>
          htmlDesignContentErrors(
            db,
            ids.tenant!,
            {
              root: { props: {} },
              content: [
                { type: 'Heading', props: { id: 'h', content: { v: 9 } } },
                { type: 'HtmlDesign', props: { id: 'd', html: '', content } },
              ],
            },
            { platform },
          ),
        )
      expect(await check(undefined)).toEqual([])
      expect(
        await check({
          v: 1,
          values: [{ path: 'journey[gone].title', value: { t: { en: 'x' } } }],
          texts: [{ id: 'txt-99', src: 'stale', t: { en: 'x' } }],
          pictures: [{ id: 'img-9', src: 'stale', img: `/files/${mine!.id}` }],
        }),
      ).toEqual([])
      expect(await check({ v: 2 })).toEqual(['content: unknown format'])
      expect(await check({ v: 1, texts: [{ id: 'nope', src: '', t: { en: 'x' } }] })).toEqual([
        'text nope: not a page text of a design',
      ])
      expect(
        await check({ v: 1, pictures: [{ id: 'img-0', src: '', img: `/files/${theirs!.id}` }] }),
      ).toEqual([`/files/${theirs!.id} is not one of this spa's pictures`])
      expect(
        await check({ v: 1, pictures: [{ id: 'img-0', src: '', img: `/files/${hidden!.id}` }] }),
      ).toEqual([`/files/${hidden!.id} is not one of this spa's pictures`])
      // A file of this spa deleted since (no row anywhere): the draft still saves (the site just misses it).
      const gone = `/files/${crypto.randomUUID()}`
      expect(await check({ v: 1, values: [{ path: 'a', value: { img: gone } }] })).toEqual([])
      // Not a uuid: refused without a query (a uuid cast would fail the transaction).
      const odd = `/files/${'-'.repeat(36)}`
      expect(await check({ v: 1, values: [{ path: 'a', value: { img: odd } }] })).toEqual([
        `${odd} is not one of this spa's pictures`,
      ])
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

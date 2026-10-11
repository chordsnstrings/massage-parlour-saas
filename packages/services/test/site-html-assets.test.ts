import { closeAllDbs, savedSections, siteTemplateFiles, storedFiles, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DomainError,
  getEditablePage,
  HTML_DESIGN_DOC_KEEP_MS,
  HTML_DESIGN_DOC_PURPOSE,
  htmlDesignDocFor,
  htmlDesignSource,
  inlineHtmlDesignDocs,
  listPages,
  localiseHtmlDesignAssets,
  materializeTemplatePageData,
  pruneUnusedHtmlDesignDocs,
  putFile,
  putTemplateFile,
  resolveHtmlDesignDocs,
  spaDesignsIntoTemplate,
  spaHtmlDocReader,
  storeSpaHtmlDoc,
  storeTemplateHtmlDoc,
  switchTemplate,
  templateDesignsIntoFiles,
  templateHtmlDocReader,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)
const fileUrl = (id: string, name: string) => `https://app.test/files/${id}/${name}`

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const png = (fill: number, size = 2000) => Buffer.concat([PNG, Buffer.alloc(size, fill)])
const uri = (type: string, b: Buffer) => `data:${type};base64,${b.toString('base64')}`

/** A ~4.6 MB design: embedded images, quotes, newlines, Arabic, a big inline script and styles (all kept as is). */
const bigDesign = () => {
  const img = uri('image/png', png(9, 900 * 1024))
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>${'.a{color:"red"}\n'.repeat(20_000)}</style></head><body><h1>مرحبا "بكم"</h1>${`<img src="${img}">`.repeat(3)}<p>${'سبا هادئ '.repeat(40_000)}</p><script>${'var q="x\\n";\n'.repeat(20_000)}</script></body></html>`
}

beforeAll(async () => {
  await resetTestDatabase()
  const [a, b] = await platform
    .insert(tenants)
    .values([
      { slug: 'assets', name: 'Assets Spa' },
      { slug: 'assets-other', name: 'Other Spa' },
    ])
    .returning()
  ids.tenant = a!.id
  ids.other = b!.id
})
afterAll(() => closeAllDbs())

const page = (props: Record<string, unknown>) => ({
  root: { props: { htmlDesign: true } },
  content: [{ type: 'HtmlDesign', props: { id: 'x', images: [], ...props } }],
})

describe('design documents (R24 review: stored byte for byte)', () => {
  it('a spa design is its own private file, deduplicated by content, read back exactly', async () => {
    const html = bigDesign()
    expect(Buffer.byteLength(html)).toBeGreaterThan(4 * 1024 * 1024)
    const [a, b] = await tx(async (db) => [
      await storeSpaHtmlDoc(db, { tenantId: ids.tenant!, html }),
      await storeSpaHtmlDoc(db, { tenantId: ids.tenant!, html }),
    ])
    expect(a).toEqual(b)
    expect(a).toEqual({ ...htmlDesignDocFor(html), file: a!.file })
    const [row] = await platform.select().from(storedFiles).where(eq(storedFiles.id, a!.file))
    expect(row).toMatchObject({
      tenantId: ids.tenant,
      isPublic: false,
      purpose: HTML_DESIGN_DOC_PURPOSE,
      size: Buffer.byteLength(html),
    })
    expect(await tx((db) => spaHtmlDocReader(db, ids.tenant!)(a!))).toBe(html)
    // Another spa can't read it (RLS + tenant check), not even with the id.
    expect(await tx((db) => spaHtmlDocReader(db, ids.other!)(a!), ids.other!)).toBeNull()
  })
  it('a template design is a content-addressed template file', async () => {
    const html = '<!doctype html><p>Template "one"</p>'
    const a = await storeTemplateHtmlDoc(platform, { html })
    const b = await storeTemplateHtmlDoc(platform, { html })
    expect(a.file).toBe(b.file)
    const [row] = await platform.select().from(siteTemplateFiles).where(eq(siteTemplateFiles.id, a.file))
    expect(row?.contentType).toMatch(/^text\/html/)
    expect(await templateHtmlDocReader(platform)(a)).toBe(html)
    // An image template file is not a design.
    const img = await putTemplateFile(platform, {
      bytes: png(5),
      contentType: 'image/png',
      sha256: 'c'.repeat(64),
    })
    expect(await templateHtmlDocReader(platform)({ ...a, file: img.id })).toBeNull()
  })
  it('resolves references for rendering, inlines them for an export; legacy inline html stays', async () => {
    const html = '<!doctype html><p>Resolved</p>'
    const doc = await storeTemplateHtmlDoc(platform, { html })
    const data = page({ html: '', doc })
    const read = templateHtmlDocReader(platform)
    const shown = await resolveHtmlDesignDocs(data, read)
    expect(shown.content[0]!.props).toMatchObject({ html, doc })
    expect(data.content[0]!.props.html).toBe('')
    const exported = await inlineHtmlDesignDocs(data, read)
    expect(exported.content[0]!.props).toEqual({ id: 'x', images: [], html })
    const legacy = page({ html: '<p>old</p>' })
    expect(await resolveHtmlDesignDocs(legacy, read)).toEqual(legacy)
    // Missing file: nothing shown (never someone else's design).
    const gone = await resolveHtmlDesignDocs(
      page({ html: '', doc: { ...doc, file: crypto.randomUUID() } }),
      read,
    )
    expect(gone.content[0]!.props.html).toBe('')
  })
})

describe('design document limits and clean-up (R24 review)', () => {
  const newSpa = async (slug: string) =>
    (await platform.insert(tenants).values({ slug, name: slug }).returning())[0]!.id
  it('new documents of a spa count against a daily byte budget (deduplicated ones are free)', async () => {
    const spa = await newSpa('assets-budget')
    const html = (n: number) => `<!doctype html><p>${String(n).repeat(1000)}</p>`
    const store = (n: number, now = new Date()) =>
      withTenant(
        spa,
        (db) => storeSpaHtmlDoc(db, { tenantId: spa, html: html(n), dailyLimit: 2500, now }),
        app,
      )
    const first = await store(1)
    await store(2)
    const over = await store(3).catch((e: unknown) => e)
    expect(over).toBeInstanceOf(DomainError)
    expect((over as DomainError).i18n).toEqual({
      key: 'errors.domain.htmlDesignDailyLimit',
      params: { limit: '0' },
    })
    expect((over as Error).message).toMatch(/daily limit of 0 MB for new HTML designs — try again tomorrow$/)
    // The same design again is no new file.
    expect((await store(1)).file).toBe(first.file)
    // The next Dubai business day starts at 05:00.
    expect((await store(3, new Date(Date.now() + 86_400_000))).file).toBeTruthy()
  })
  it('a malformed reference reads as an empty design, never a query error', async () => {
    const bad = { file: "nope' or 1=1", sha256: 'a'.repeat(64), bytes: 1, chars: 1 }
    expect(await tx((db) => spaHtmlDocReader(db, ids.tenant!)(bad))).toBeNull()
    expect(await templateHtmlDocReader(platform)(bad)).toBeNull()
    const shown = await tx((db) =>
      resolveHtmlDesignDocs(page({ html: '', doc: bad }), spaHtmlDocReader(db, ids.tenant!)),
    )
    expect(shown.content[0]!.props.html).toBe('')
    expect(
      await tx((db) => htmlDesignSource({ html: '', doc: bad }, spaHtmlDocReader(db, ids.tenant!))),
    ).toBe('')
  })
  it('deletes documents nothing references once they are older than the keep period', async () => {
    const spa = await newSpa('assets-prune')
    const docs = await withTenant(
      spa,
      async (db) => {
        const [used, gone, recent, saved] = await Promise.all(
          ['used', 'gone', 'recent', 'saved'].map((k) =>
            storeSpaHtmlDoc(db, { tenantId: spa, html: `<!doctype html><p>${k}</p>` }),
          ),
        )
        const template = {
          key: 'prune-x',
          name: 'Prune X',
          theme: {},
          pages: [
            { slug: '', title: { en: 'Home' }, data: page({ html: '', doc: used, phoneFixes: false }) },
          ],
        }
        await switchTemplate(db, spa, template, { replaceContent: true })
        await db
          .insert(savedSections)
          .values({ tenantId: spa, name: 'S', data: page({ html: '', doc: saved }) })
        return { used: used!, gone: gone!, recent: recent!, saved: saved! }
      },
      app,
    )
    const old = new Date(Date.now() - HTML_DESIGN_DOC_KEEP_MS - 60_000)
    await platform
      .update(storedFiles)
      .set({ createdAt: old })
      .where(inArray(storedFiles.id, [docs.used.file, docs.gone.file, docs.saved.file]))
    expect(await withTenant(spa, (db) => pruneUnusedHtmlDesignDocs(db, spa), app)).toBe(1)
    const left = await platform
      .select({ id: storedFiles.id })
      .from(storedFiles)
      .where(eq(storedFiles.tenantId, spa))
    expect(left.map((r) => r.id).sort()).toEqual([docs.used.file, docs.recent.file, docs.saved.file].sort())
  })
  it('an imported template file stores its inline designs as template files (checked like an upload)', async () => {
    const html = '<!doctype html><p>Imported</p>'
    const data = await templateDesignsIntoFiles(page({ html, phoneFixes: false }), { db: platform })
    const props = data.content[0]!.props as { html: string; doc: { file: string }; bakedFixes?: boolean }
    expect(props.html).toBe('')
    expect(props.bakedFixes).toBeUndefined()
    expect(await templateHtmlDocReader(platform)(props.doc as never)).toBe(html)
    // A design from before R24 (no switch: fixes baked in) still reads as one.
    const legacy = await templateDesignsIntoFiles(page({ html }), { db: platform })
    expect(legacy.content[0]!.props).toMatchObject({ html: '', bakedFixes: true })
    await expect(
      templateDesignsIntoFiles(page({ html: 'x'.repeat(5 * 1024 * 1024 + 1) }), { db: platform }),
    ).rejects.toThrow(/the limit is 5 MB/)
    await expect(templateDesignsIntoFiles(page({ html: '' }), { db: platform })).rejects.toThrow(
      /no design text/,
    )
  })
})

describe('localiseHtmlDesignAssets', () => {
  it('copies template files and other spas’ public files, keeps its own, never copies private ones', async () => {
    const tpl = await putTemplateFile(platform, {
      bytes: png(31),
      contentType: 'image/png',
      sha256: 'a'.repeat(64),
    })
    const [pub, priv] = await withTenant(
      ids.other!,
      async (db) => [
        await putFile(db, { tenantId: ids.other!, bytes: png(32), contentType: 'image/png', isPublic: true }),
        await putFile(db, {
          tenantId: ids.other!,
          bytes: png(33),
          contentType: 'image/png',
          isPublic: false,
        }),
      ],
      app,
    )
    const own = await tx((db) =>
      putFile(db, { tenantId: ids.tenant!, bytes: png(34), contentType: 'image/png', isPublic: true }),
    )
    const html = `<img src="${fileUrl(tpl.id, 'a.png')}"><div style="background:url(/files/${pub!.id}?w=480)"></div><img src="/files/${priv!.id}"><img src="/files/${own.id}"><img src="https://cdn.test/x.jpg">`
    const r = await tx((db) =>
      localiseHtmlDesignAssets(db, {
        tenantId: ids.tenant!,
        html,
        images: [{ id: 'img-2', src: `/files/${own.id}`, replace: `/files/${pub!.id}` }],
        fileUrl,
        platform,
      }),
    )
    expect(r.copied).toBe(2)
    expect(r.html).not.toContain(tpl.id)
    expect(r.html).not.toContain(pub!.id)
    expect(r.html).toContain(`/files/${priv!.id}`)
    expect(r.html).toContain(`/files/${own.id}`)
    expect(r.html).toContain('https://cdn.test/x.jpg')
    expect(r.html).toMatch(/\.png\?w=480\)/)
    expect(r.html).not.toContain('crossorigin')
    expect(r.images[0]!.replace).toMatch(/^https:\/\/app\.test\/files\//)
    const mine = await tx((db) => db.select({ id: storedFiles.id }).from(storedFiles))
    for (const id of r.html.match(/files\/([0-9a-f-]{36})/g)!.map((m) => m.slice(6)))
      if (id !== priv!.id) expect(mine.map((m) => m.id)).toContain(id)
  })

  it('applying a template copies its design into the spa byte for byte (+ the files it uses); saving it back too', async () => {
    const tplImg = await putTemplateFile(platform, {
      bytes: png(41),
      contentType: 'image/png',
      sha256: 'b'.repeat(64),
    })
    const html = `${bigDesign()}<img src="${fileUrl(tplImg.id, 'b.png')}">`
    const doc = await storeTemplateHtmlDoc(platform, { html })
    const template = {
      key: 'html-x',
      name: 'HTML X',
      theme: {},
      pages: [{ slug: '', title: { en: 'Home' }, data: page({ html: '', doc, phoneFixes: false }) }],
    }
    const draft = await tx(async (db) => {
      await switchTemplate(db, ids.tenant!, template, {
        replaceContent: true,
        prepare: async (data) =>
          (await materializeTemplatePageData(db, { tenantId: ids.tenant!, data, fileUrl, platform })).data,
      })
      const home = (await listPages(db, ids.tenant!)).find((p) => p.slug === '')!
      return (await getEditablePage(db, ids.tenant!, home.id))!.data as ReturnType<typeof page>
    })
    const props = draft.content[0]!.props as { html: string; doc: { file: string }; phoneFixes: boolean }
    expect(props.html).toBe('')
    expect(props.phoneFixes).toBe(false)
    expect(props.doc.file).not.toBe(doc.file)
    const spaHtml = await tx((db) => spaHtmlDocReader(db, ids.tenant!)(props.doc as typeof doc))
    // Only the template file's URL changed (now the spa's own copy); every other byte is the template's.
    const m = /https:\/\/app\.test\/files\/([0-9a-f-]{36})\/[0-9a-f]{16}\.png/.exec(spaHtml!)!
    expect(spaHtml).toBe(html.replace(fileUrl(tplImg.id, 'b.png'), m[0]))
    const copied = m[1]!
    const [row] = await platform.select().from(storedFiles).where(eq(storedFiles.id, copied))
    expect(row?.tenantId).toBe(ids.tenant)
    // Save the spa's page as a template page again: a template file, not a reference to the spa.
    const back = await tx((db) =>
      spaDesignsIntoTemplate(draft, { read: spaHtmlDocReader(db, ids.tenant!), db: platform }),
    )
    const backDoc = back.content[0]!.props.doc as typeof doc
    expect(await templateHtmlDocReader(platform)(backDoc)).toBe(spaHtml)
  })
})

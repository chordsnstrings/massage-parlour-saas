import { closeAllDbs, siteTemplateFiles, storedFiles, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  DomainError,
  dataUriBytes,
  getEditablePage,
  HTML_DESIGN_FILE_PURPOSE,
  htmlDesignSizeProblem,
  listPages,
  localiseHtmlDesignAssets,
  MAX_HTML_ASSETS,
  materializeTemplatePageData,
  planHtmlDesignAssets,
  prepareHtmlDesign,
  putFile,
  putTemplateFile,
  sniffFontType,
  switchTemplate,
  templateHtmlAssetSink,
  tenantHtmlAssetSink,
} from '../src'

const { platform, app } = testDbs()
const ids = {} as Record<string, string>
const tx = <T>(fn: Parameters<typeof withTenant<T>>[1], tenant = ids.tenant!) => withTenant(tenant, fn, app)
const fileUrl = (id: string, name: string) => `https://app.test/files/${id}/${name}`

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])
const png = (fill: number, size = 2000) => Buffer.concat([PNG, Buffer.alloc(size, fill)])
const woff2 = (fill = 1) => Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(3000, fill)])
const uri = (type: string, b: Buffer) => `data:${type};base64,${b.toString('base64')}`

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

describe('sniffers + decoding', () => {
  it('sniffs web fonts by magic bytes', () => {
    expect(sniffFontType(woff2())).toBe('font/woff2')
    expect(sniffFontType(Buffer.concat([Buffer.from('wOFF'), Buffer.alloc(20)]))).toBe('font/woff')
    expect(sniffFontType(Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(20)]))).toBe('font/ttf')
    expect(sniffFontType(Buffer.concat([Buffer.from('OTTO'), Buffer.alloc(20)]))).toBe('font/otf')
    expect(sniffFontType(Buffer.from('<svg xmlns="x"></svg>'))).toBeNull()
  })
  it('decodes forgiving base64 (whitespace) and percent-encoded payloads; refuses broken base64', () => {
    expect(dataUriBytes({ mime: 'x', base64: true, payload: 'aGVs\n bG8=' })?.toString()).toBe('hello')
    expect(dataUriBytes({ mime: 'x', base64: true, payload: 'aGVsbG8%3D' })?.toString()).toBe('hello')
    expect(dataUriBytes({ mime: 'x', base64: false, payload: 'a%20b%FF' })).toEqual(
      Buffer.from([97, 32, 98, 255]),
    )
    expect(dataUriBytes({ mime: 'x', base64: true, payload: 'aGVsbG8*' })).toBeNull()
    expect(dataUriBytes({ mime: 'x', base64: true, payload: 'a' })).toBeNull()
  })
})

describe('planHtmlDesignAssets', () => {
  it('moves allowed images/fonts/videos of the declared family, once per payload; the rest stays inline', () => {
    const img = uri('image/png', png(1))
    const html = `<img src="${img}"><img srcset="${img} 2x"><style>@font-face{src:url(${uri('font/woff2', woff2())})}
.a{background:url("${uri('application/octet-stream', woff2(2))}")}</style>
<img src="${uri('image/png', woff2(3))}"><img src="${uri('image/png', png(4, 100))}"><img src="data:image/svg+xml;base64,${Buffer.alloc(2000, 60).toString('base64')}">
<img src="${uri('application/octet-stream', png(5))}"><img src="data:image/png;base64,@@@@">`
    const plan = planHtmlDesignAssets(html)
    expect(plan.assets.map((a) => [a.contentType, a.refs.length])).toEqual([
      ['image/png', 2],
      ['font/woff2', 1],
      ['font/woff2', 1],
    ])
    expect(plan.assets[0]!.name).toMatch(/^[0-9a-f]{16}\.png$/)
    // png declared but font bytes, tiny, svg, octet-stream outside CSS, malformed
    expect(plan.leftover.count).toBe(5)
    expect(plan.leftover.types.sort()).toEqual(['application/octet-stream', 'image/png', 'image/svg+xml'])
  })
})

describe('prepareHtmlDesign', () => {
  it('rewrites to absolute file URLs, adds crossorigin, remaps adjustments; a dry run stores nothing', async () => {
    const img = uri('image/png', png(9))
    const html = `<html><body><img src="${img}" alt="x"></body></html>`
    let stored = 0
    const sink = async () => {
      stored++
      return '11111111-2222-4333-8444-555555555555'
    }
    const dry = await prepareHtmlDesign({
      html,
      images: [{ id: 'img-0', src: img.slice(0, 300), x: 10 }],
      sink,
      fileUrl,
      dryRun: true,
    })
    expect(stored).toBe(0)
    expect(dry.moved.count).toBe(1)
    const real = await prepareHtmlDesign({
      html,
      images: [{ id: 'img-0', src: img.slice(0, 300), x: 10 }],
      sink,
      fileUrl,
    })
    expect(stored).toBe(1)
    expect(real.html.length).toBe(dry.html.length)
    expect(real.html).toMatch(
      /<img crossorigin="anonymous" src="https:\/\/app\.test\/files\/11111111-2222-4333-8444-555555555555\/[0-9a-f]{16}\.png" alt="x">/,
    )
    expect(real.images[0]!.src).toMatch(/^https:\/\/app\.test\/files\/11111111/)
  })
  it('says what is still too big and stores nothing', async () => {
    const html = `<html><head><script>${'x'.repeat(600 * 1024)}</script></head><body><img src="${uri('image/png', png(3))}"></body></html>`
    let stored = 0
    const err = await prepareHtmlDesign({
      html,
      sink: async () => {
        stored++
        return 'x'
      },
      fileUrl,
    }).catch((e) => e)
    expect(err).toBeInstanceOf(DomainError)
    expect(err.message).toMatch(
      /^After moving 1 embedded image, font or video file \(\d+ KB\) out, the design is still 6\d\d KB \(scripts 60\d KB, markup 1 KB\); the limit is about 500 KB\./,
    )
    expect(stored).toBe(0)
    expect(htmlDesignSizeProblem('<p>small</p>')).toBeNull()
  })
  it(`refuses more than ${MAX_HTML_ASSETS} files`, async () => {
    const html = Array.from(
      { length: MAX_HTML_ASSETS + 1 },
      (_, i) => `<img src="${uri('image/png', png(i % 250, 1100 + i))}">`,
    ).join('')
    await expect(prepareHtmlDesign({ html, sink: async () => 'x', fileUrl, dryRun: true })).rejects.toThrow(
      /at most 300 can be moved out/,
    )
  })
})

describe('stores', () => {
  it('template files are deduplicated by content', async () => {
    const plan = planHtmlDesignAssets(`<img src="${uri('image/png', png(21))}">`)
    const sink = templateHtmlAssetSink(platform)
    const a = await sink(plan.assets[0]!)
    const b = await sink(plan.assets[0]!)
    expect(a).toBe(b)
    const rows = await platform.select().from(siteTemplateFiles).where(eq(siteTemplateFiles.id, a))
    expect(rows[0]).toMatchObject({ contentType: 'image/png', size: png(21).length, storage: 'db' })
  })
  it('spa files are public, purpose html_design, deduplicated', async () => {
    const plan = planHtmlDesignAssets(`<img src="${uri('image/png', png(22))}">`)
    const [a, b] = await tx(async (db) => {
      const sink = tenantHtmlAssetSink(db, ids.tenant!)
      return [await sink(plan.assets[0]!), await sink(plan.assets[0]!)]
    })
    expect(a).toBe(b)
    const [row] = await platform.select().from(storedFiles).where(eq(storedFiles.id, a!))
    expect(row).toMatchObject({ isPublic: true, purpose: HTML_DESIGN_FILE_PURPOSE, tenantId: ids.tenant })
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

  it('switchTemplate({ prepare }) writes the spa’s own file URLs', async () => {
    const tpl = await putTemplateFile(platform, {
      bytes: png(41),
      contentType: 'image/png',
      sha256: 'b'.repeat(64),
    })
    const template = {
      key: 'html-x',
      name: 'HTML X',
      theme: {},
      pages: [
        {
          slug: '',
          title: { en: 'Home' },
          data: {
            root: { props: { htmlDesign: true } },
            content: [
              {
                type: 'HtmlDesign',
                props: { id: 'x', html: `<img src="${fileUrl(tpl.id, 'b.png')}">`, images: [] },
              },
            ],
          },
        },
      ],
    }
    const draft = await tx(async (db) => {
      await switchTemplate(db, ids.tenant!, template, {
        replaceContent: true,
        prepare: async (data) =>
          (await materializeTemplatePageData(db, { tenantId: ids.tenant!, data, fileUrl, platform })).data,
      })
      const home = (await listPages(db, ids.tenant!)).find((p) => p.slug === '')!
      return JSON.stringify((await getEditablePage(db, ids.tenant!, home.id))!.data)
    })
    expect(draft).not.toContain(tpl.id)
    const id = draft.match(/files\/([0-9a-f-]{36})\//)![1]!
    const [row] = await platform.select().from(storedFiles).where(eq(storedFiles.id, id))
    expect(row?.tenantId).toBe(ids.tenant)
  })
})

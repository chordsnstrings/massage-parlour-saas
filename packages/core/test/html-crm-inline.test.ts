import { describe, expect, it, vi } from 'vitest'
import { htmlContentSlots, overlayHtmlContent } from '../src/html-content'
import {
  buildCrmContract,
  crmJsonMemo,
  crmScriptJson,
  htmlCrmContractOf,
  mergeCrmContract,
  spliceCrmData,
} from '../src/html-crm'
import {
  applyCrmInline,
  applyCrmInlineFonts,
  CRM_INLINE_LIMITS,
  type CrmInlineFontSource,
  type CrmInlineSource,
  createCrmInlineLoader,
  crmInlineFontSource,
  crmInlineFontsKey,
  crmInlineFontUrls,
  crmInlineKey,
  crmInlinePaths,
  crmInlineSource,
  crmValueAt,
  isWoff2,
  planCrmInline,
  planCrmInlineFonts,
  rasterDataUri,
  sniffRasterType,
  woff2DataUri,
} from '../src/html-crm-inline'

// biome-ignore lint/suspicious/noExplicitAny: the tests read the merged JSON freely
type Json = any

const LOGO = '6f9c2b1e-1a2b-4c3d-8e4f-0123456789ab'
const OTHER = '0f9c2b1e-1a2b-4c3d-8e4f-0123456789ff'
const webp = (size: number) => {
  const b = new Uint8Array(Math.max(size, 16))
  b.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  )
  b.set(
    [...'WEBP'].map((c) => c.charCodeAt(0)),
    8,
  )
  return b
}
const ourHost = (host: string) => host === 'spamanagement.co' || host.endsWith('.spamanagement.co')

describe('crmInlinePaths / crmValueAt', () => {
  const data = {
    contract: {
      version: 2,
      inline: [
        'spa.logo_on_dark',
        'journey[welcome].image',
        'journey[1].image',
        'bad path',
        7,
        'spa.logo_on_dark',
      ],
    },
    spa: { logo_on_dark: '/files/x' },
    journey: [
      { id: 'welcome', image: '/designs/be-relax/a.webp' },
      { id: 'moroccan', image: '/designs/be-relax/b.webp' },
    ],
  }
  it('reads valid, distinct paths in order (at most 16)', () => {
    expect(crmInlinePaths(data)).toEqual(['spa.logo_on_dark', 'journey[welcome].image', 'journey[1].image'])
    expect(crmInlinePaths({})).toEqual([])
    expect(crmInlinePaths({ contract: { inline: 'spa.logo' } })).toEqual([])
    const many = Array.from({ length: 30 }, (_, i) => `a${i}`)
    expect(crmInlinePaths({ contract: { inline: many } })).toHaveLength(CRM_INLINE_LIMITS.paths)
  })
  it('resolves item ids and indexes', () => {
    expect(crmValueAt(data, 'journey[welcome].image')).toBe('/designs/be-relax/a.webp')
    expect(crmValueAt(data, 'journey[1].image')).toBe('/designs/be-relax/b.webp')
    expect(crmValueAt(data, 'journey[9].image')).toBeUndefined()
    expect(crmValueAt(data, 'spa.nope')).toBeUndefined()
    expect(crmValueAt(data, 'spa..x')).toBeUndefined()
  })
})

describe('crmInlineSource', () => {
  it('takes only the platform files on our hosts', () => {
    expect(crmInlineSource(`/files/${LOGO}`, ourHost)).toEqual({ kind: 'file', id: LOGO })
    expect(crmInlineSource(`/files/${LOGO.toUpperCase()}/logo.webp`, ourHost)).toEqual({
      kind: 'file',
      id: LOGO,
    })
    expect(crmInlineSource(`https://be-relax.spamanagement.co/files/${LOGO}`, ourHost)).toEqual({
      kind: 'file',
      id: LOGO,
    })
    expect(
      crmInlineSource('https://spamanagement.co/designs/be-relax/4d56333a0e00bb38.webp', ourHost),
    ).toEqual({
      kind: 'design',
      design: 'be-relax',
      name: '4d56333a0e00bb38.webp',
    })
    expect(crmInlineSource('/designs/be-relax/a.jpeg', ourHost)).toMatchObject({ kind: 'design' })
  })
  it('leaves everything else as it is (no SSRF: unknown hosts are never read)', () => {
    for (const url of [
      `https://evil.example/files/${LOGO}`,
      `https://spamanagement.co.evil.example/files/${LOGO}`,
      `//spamanagement.co/files/${LOGO}`,
      `https://user@spamanagement.co/files/${LOGO}`,
      `https://spamanagement.co/files/${LOGO}?w=480`,
      `https://spamanagement.co/files/${LOGO}#x`,
      'https://spamanagement.co/designs/be-relax/logo.svg',
      'https://spamanagement.co/designs/be-relax/a.woff2',
      '/designs/be-relax/../secret.webp',
      '/designs/be-relax/%2e%2e.webp',
      'http://169.254.169.254/files/x',
      'data:image/png;base64,AAAA',
      'javascript:alert(1)',
      '/files/not-a-uuid',
      ' /files/x',
      42,
      null,
    ])
      expect(crmInlineSource(url, ourHost)).toBeNull()
  })
})

describe('sniffRasterType', () => {
  const bytes = (...parts: (string | number[])[]) => {
    const out: number[] = []
    for (const p of parts) out.push(...(typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p))
    while (out.length < 16) out.push(0)
    return new Uint8Array(out)
  }
  it('knows the raster types by their magic numbers, never SVG', () => {
    expect(sniffRasterType(bytes([0x89], 'PNG\r\n\x1a\n'))).toBe('image/png')
    expect(sniffRasterType(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffRasterType(bytes('GIF89a'))).toBe('image/gif')
    expect(sniffRasterType(webp(20))).toBe('image/webp')
    expect(sniffRasterType(bytes([0, 0, 0, 0x1c], 'ftypavif'))).toBe('image/avif')
    expect(sniffRasterType(bytes([0, 0, 0, 0x1c], 'ftypmif1', [0, 0, 0, 0], 'miafavif'))).toBe('image/avif')
    expect(sniffRasterType(bytes([0, 0, 0, 0x18], 'ftypisom'))).toBeNull()
    expect(sniffRasterType(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(sniffRasterType(bytes('<?xml version="1.0"?><svg/>'))).toBeNull()
    expect(sniffRasterType(new Uint8Array([0xff, 0xd8]))).toBeNull()
  })
  it('encodes a data: URI', () => {
    const pic = rasterDataUri(webp(16))!
    expect(pic.size).toBe(16)
    expect(pic.uri).toBe(`data:image/webp;base64,${Buffer.from(webp(16)).toString('base64')}`)
  })
})

describe('planCrmInline + applyCrmInline', () => {
  const data = () => ({
    contract: {
      version: 2,
      inline: ['spa.logo_on_dark', 'spa.logo_on_light', 'journey[welcome].image', 'hero'],
    },
    spa: { logo_on_dark: `/files/${LOGO}`, logo_on_light: `https://evil.example/files/${LOGO}` },
    journey: [
      { id: 'welcome', image: 'https://spamanagement.co/designs/be-relax/a.webp' },
      { id: 'moroccan', image: 'https://spamanagement.co/designs/be-relax/b.webp' },
    ],
    hero: `/files/${OTHER}`,
  })
  const loader = (sizes: Record<string, number>) =>
    vi.fn(async (src: CrmInlineSource) => {
      const k = src.kind === 'file' ? src.id : src.name
      return k in sizes ? rasterDataUri(webp(sizes[k]!)) : null
    })

  it('inlines only declared paths with platform pictures, within the caps', async () => {
    const load = loader({ [LOGO]: 30_000, 'a.webp': 60_000, 'b.webp': 1000, [OTHER]: 200_000 })
    const d = data()
    const plan = (await planCrmInline(d, { ourHost, load }))!
    expect(Object.keys(plan)).toEqual(['spa.logo_on_dark', 'journey[welcome].image'])
    // The unknown host was never read; the too-big file was skipped.
    expect(load).toHaveBeenCalledTimes(3)
    const out: Json = applyCrmInline(d, plan)
    expect(out.spa.logo_on_dark).toMatch(/^data:image\/webp;base64,/)
    expect(out.spa.logo_on_light).toBe(`https://evil.example/files/${LOGO}`)
    expect(out.journey[0].image).toMatch(/^data:image\/webp;base64,/)
    expect(out.journey[1]).toBe(d.journey[1]) // untouched subtrees keep their identity
    expect(out.hero).toBe(`/files/${OTHER}`)
    expect(out.inline_originals).toEqual({
      'spa.logo_on_dark': `/files/${LOGO}`,
      'journey[welcome].image': 'https://spamanagement.co/designs/be-relax/a.webp',
    })
    expect(d).toEqual(data()) // never mutated
  })

  it('keeps the running total ≤ 240 KB (per occurrence), skipping what would pass it', async () => {
    const d = {
      contract: { inline: ['a', 'b', 'c', 'd'] },
      a: `/files/${LOGO}`,
      b: `/files/${LOGO}`,
      c: `/files/${LOGO}`,
      d: '/designs/x/small.png',
    }
    // 3 × 80 KB = exactly 240 KB: the small fourth would pass the total.
    const plan = (await planCrmInline(d, { ourHost, load: loader({ [LOGO]: 80 * 1024, 'small.png': 100 }) }))!
    expect(Object.keys(plan)).toEqual(['a', 'b', 'c'])
    const big = (await planCrmInline(d, { ourHost, load: loader({ [LOGO]: 81 * 1024 + 1 }) })) ?? {}
    expect(Object.keys(big)).toEqual([])
    const plan2 = (await planCrmInline(
      { ...d, contract: { inline: ['a', 'b', 'c', 'd'] }, c: '/designs/x/c.webp' },
      { ourHost, load: loader({ [LOGO]: 100 * 1024 - 1, 'c.webp': 50 * 1024, 'small.png': 100 }) },
    ))!
    // ~100 KB is over the per-file cap (a, b skipped); c + d fit.
    expect(Object.keys(plan2)).toEqual(['c', 'd'])
  })

  it('a failed read or no declared paths → null; a value that changed meanwhile stays', async () => {
    const failing = vi.fn(async () => {
      throw new Error('db down')
    })
    expect(await planCrmInline(data(), { ourHost, load: failing })).toBeNull()
    expect(
      await planCrmInline({ spa: { logo_on_dark: `/files/${LOGO}` } }, { ourHost, load: failing }),
    ).toBeNull()
    const d = data()
    const plan = { 'spa.logo_on_dark': { url: `/files/${OTHER}`, data: 'data:image/webp;base64,AA' } }
    expect(applyCrmInline(d, plan)).toBe(d)
    expect(applyCrmInline(d, null)).toBe(d)
    expect(applyCrmInline(d, { 'spa.logo_on_dark': { url: `/files/${LOGO}`, data: 'javascript:x' } })).toBe(d)
    expect(crmInlineKey(null)).toBe('')
    expect(crmInlineKey(plan)).toContain(`spa.logo_on_dark=/files/${OTHER}`)
  })

  it('never waits past its deadline: a late read stays a link this render', async () => {
    const d = data()
    let late: (v: { uri: string; size: number } | null) => void = () => {}
    const load = vi.fn((src: CrmInlineSource) =>
      src.kind === 'file'
        ? new Promise<{ uri: string; size: number } | null>((r) => {
            late = r
          })
        : Promise.resolve(rasterDataUri(webp(1000))),
    )
    const t0 = Date.now()
    const plan = (await planCrmInline(d, { ourHost, load, deadlineMs: 30 }))!
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(Object.keys(plan)).toEqual(['journey[welcome].image'])
    late(rasterDataUri(webp(1000))) // finishing later changes nothing already planned
    expect(Object.keys(plan)).toEqual(['journey[welcome].image'])
  })
})

describe('createCrmInlineLoader', () => {
  const setup = (over: { maxBytes?: number } = {}) => {
    let t = 0
    const readFiles = vi.fn(
      async (scope: string, ids: string[], _max: number) =>
        new Map(ids.map((id) => [id, scope === 'spa-a' && id === LOGO ? webp(1000) : null])),
    )
    const readDesign = vi.fn(async (_d: string, name: string, _max: number) =>
      name === 'svg.png'
        ? new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
        : name === 'big.webp'
          ? webp(CRM_INLINE_LIMITS.fileBytes + 1)
          : webp(2000),
    )
    const l = createCrmInlineLoader({
      readFiles,
      readDesign,
      missTtlMs: 1000,
      errorTtlMs: 500,
      now: () => t,
      ...over,
    })
    return { l, readFiles, readDesign, tick: (ms: number) => (t += ms) }
  }
  const file = { kind: 'file', id: LOGO } as const

  it('reads once, shares concurrent loads, and scopes files to the spa that asks', async () => {
    const { l, readFiles } = setup()
    const [a, b] = await Promise.all([l.load('spa-a', file), l.load('spa-a', file)])
    expect(a?.uri).toMatch(/^data:image\/webp;base64,/)
    expect(b).toBe(a)
    expect(await l.load('spa-a', file)).toBe(a)
    expect(readFiles).toHaveBeenCalledTimes(1)
    // Another spa never gets spa A's cached bytes.
    expect(await l.load('spa-b', file)).toBeNull()
    expect(readFiles).toHaveBeenCalledTimes(2)
    expect(readFiles.mock.calls[1]).toEqual(['spa-b', [LOGO], CRM_INLINE_LIMITS.fileBytes])
  })

  it("reads one spa's file loads of a tick together; a pending download per id is awaited", async () => {
    const { l, readFiles } = setup()
    readFiles.mockImplementationOnce(async (_s, ids) => new Map([[ids[0]!, Promise.resolve(webp(1000))]]))
    const [a, b, c] = await Promise.all([
      l.load('spa-a', file),
      l.load('spa-a', { kind: 'file', id: OTHER }),
      l.load('spa-b', file),
    ])
    expect(a?.size).toBe(1000)
    expect(b).toBeNull()
    expect(c).toBeNull()
    expect(readFiles.mock.calls).toEqual([
      ['spa-a', [LOGO, OTHER], CRM_INLINE_LIMITS.fileBytes],
      ['spa-b', [LOGO], CRM_INLINE_LIMITS.fileBytes],
    ])
  })

  it('remembers a miss for its ttl only, a read error for the shorter one; never SVG or too-big bytes', async () => {
    const { l, readFiles, readDesign, tick } = setup()
    expect(await l.load('spa-b', file)).toBeNull()
    expect(await l.load('spa-b', file)).toBeNull()
    expect(readFiles).toHaveBeenCalledTimes(1)
    tick(1001)
    await l.load('spa-b', file)
    expect(readFiles).toHaveBeenCalledTimes(2)
    expect(await l.load('x', { kind: 'design', design: 'd', name: 'svg.png' })).toBeNull()
    expect(await l.load('x', { kind: 'design', design: 'd', name: 'big.webp' })).toBeNull()
    readDesign.mockRejectedValueOnce(new Error('EIO'))
    const ok = { kind: 'design', design: 'd', name: 'ok.webp' } as const
    expect(await l.load('x', ok)).toBeNull()
    // Storage down: not retried on every request…
    expect(await l.load('x', ok)).toBeNull()
    expect(readDesign).toHaveBeenCalledTimes(3)
    // …but after errorTtl.
    tick(501)
    expect((await l.load('x', ok))?.size).toBe(2000)
    // A failing batch read (or one id's download) is an error too.
    readFiles.mockRejectedValueOnce(new Error('db down'))
    expect(await l.load('spa-a', file)).toBeNull()
    expect(await l.load('spa-a', file)).toBeNull()
    tick(501)
    readFiles.mockImplementationOnce(
      async (_s, ids) => new Map([[ids[0]!, Promise.reject(new Error('bucket timeout'))]]),
    )
    expect(await l.load('spa-a', file)).toBeNull()
    tick(501)
    expect((await l.load('spa-a', file))?.size).toBe(1000)
  })

  it('stays within its size, evicting the least recently used', async () => {
    const one = rasterDataUri(webp(2000))!.uri.length
    const { l, readDesign } = setup({ maxBytes: one * 2 + 10 })
    const d = (name: string) => ({ kind: 'design', design: 'd', name }) as const
    await l.load('x', d('1.webp'))
    await l.load('x', d('2.webp'))
    await l.load('x', d('1.webp')) // 1 is now the most recent
    await l.load('x', d('3.webp')) // evicts 2
    expect(l.size()).toBeLessThanOrEqual(one * 2 + 10)
    expect(l.entries()).toBe(2)
    expect(readDesign).toHaveBeenCalledTimes(3)
    await l.load('x', d('1.webp'))
    expect(readDesign).toHaveBeenCalledTimes(3)
    await l.load('x', d('2.webp'))
    expect(readDesign).toHaveBeenCalledTimes(4)
  })
})

describe('a contract design with contract.inline, rendered', () => {
  const design = {
    contract: {
      version: 2,
      locales: ['en', 'ar'],
      inline: ['spa.logo_on_dark', 'spa.logo_on_light', 'journey[welcome].image'],
    },
    spa: {
      name: 'Your Spa',
      short_name: 'Your Spa',
      logo_on_dark: '',
      logo_on_light: '',
      experience_image: 'https://spamanagement.co/designs/be-relax/ca6a5cf5c5e2b26d.webp',
    },
    journey: [
      {
        id: 'welcome',
        image: 'https://spamanagement.co/designs/be-relax/998d1a1a386836e2.webp',
        title: 'Welcome',
      },
      {
        id: 'moroccan',
        image: 'https://spamanagement.co/designs/be-relax/2667430c3cb6689c.webp',
        title: 'Bath',
      },
    ],
    services: [],
    staff: [],
  }
  const html = `<!doctype html><html><head><script>window.CRM_DATA = ${JSON.stringify(design)};</script></head><body><img id="logo"><script>render()</script></body></html>`

  it('gets data: URIs for those keys only; every other byte stays as built', async () => {
    const found = htmlCrmContractOf(html)!
    const crm = buildCrmContract(
      {
        spa: { name: 'Be Relax', logoUrl: `https://be-relax.spamanagement.co/files/${LOGO}` },
        branches: [],
        services: [],
        staff: [],
        formEndpoint: null,
        filesOrigin: 'https://be-relax.spamanagement.co',
      },
      { locale: 'en' },
    )
    // The spa's own picture for dark backgrounds (website content) + the 1600w welcome still.
    const content = {
      v: 1,
      values: [
        { path: 'spa.logo_on_dark', value: { img: `/files/${OTHER}` } },
        {
          path: 'journey[welcome].image',
          value: { img: 'https://spamanagement.co/designs/be-relax/4d56333a0e00bb38.webp' },
        },
      ],
    }
    const own = overlayHtmlContent(found.literal!.data, content as Json, { locale: 'en' })
    const data = mergeCrmContract(own, crm, { locale: 'en' })
    const load = vi.fn(async (src: CrmInlineSource) =>
      rasterDataUri(webp(src.kind === 'file' ? (src.id === LOGO ? 23_000 : 26_000) : 58_118)),
    )
    const plan = await planCrmInline(data, { ourHost, load })
    // The design's serialisation memo never holds a spa's inline pictures.
    const memo = crmJsonMemo()
    const transient = new Set(Object.values(plan!).map((x) => x.data))
    const json = crmScriptJson(applyCrmInline(data, plan), memo, { transient })
    expect(json).toBe(crmScriptJson(applyCrmInline(data, plan)))
    expect(memo.strings.size).toBe(0)
    const out = spliceCrmData(html, found, json, { inject: false })
    const literal = htmlCrmContractOf(out)!.literal!
    expect(out.slice(0, found.literal!.start)).toBe(html.slice(0, found.literal!.start))
    expect(out.slice(literal.end)).toBe(html.slice(found.literal!.end))
    const got: Json = literal.data
    expect(got.spa.logo_on_dark).toMatch(/^data:image\/webp;base64,/)
    expect(got.spa.logo_on_light).toMatch(/^data:image\/webp;base64,/)
    expect(got.journey[0].image).toMatch(/^data:image\/webp;base64,/)
    expect(got.journey[1].image).toBe('https://spamanagement.co/designs/be-relax/2667430c3cb6689c.webp')
    expect(got.spa.experience_image).toBe('https://spamanagement.co/designs/be-relax/ca6a5cf5c5e2b26d.webp')
    expect(got.inline_originals).toEqual({
      'spa.logo_on_dark': `/files/${OTHER}`,
      'spa.logo_on_light': `https://be-relax.spamanagement.co/files/${LOGO}`,
      'journey[welcome].image': 'https://spamanagement.co/designs/be-relax/4d56333a0e00bb38.webp',
    })
    const datas = [...out.matchAll(/data:image\//g)]
    expect(datas).toHaveLength(3)
  })
})

describe('contract.inline_fonts (Decision B, owner 2026-10-14)', () => {
  const woff2 = (size: number) => {
    const b = new Uint8Array(Math.max(size, 48))
    b.set(
      [...'wOF2'].map((c) => c.charCodeAt(0)),
      0,
    )
    return b
  }
  const AR = [
    '/designs/be-relax/16734a5adb27b0f3.woff2',
    'https://spamanagement.co/designs/be-relax/3427efdf7896718d.woff2',
    'https://be-relax.spamanagement.co/designs/be-relax/6010e7fd0dce5d52.woff2',
  ]
  const data = (inline_fonts: unknown = { ar: AR }) => ({
    contract: { version: 2, locales: ['en', 'ar'], inline_fonts },
    spa: { name: 'Your Spa' },
  })
  const fontLoader = (sizes: Record<string, number>) =>
    vi.fn(async (src: CrmInlineFontSource) =>
      src.name in sizes ? woff2DataUri(woff2(sizes[src.name]!)) : null,
    )

  it("reads only the render locale's list: distinct strings, at most 16, in order", () => {
    expect(crmInlineFontUrls(data(), 'ar')).toEqual(AR)
    expect(crmInlineFontUrls(data(), 'en')).toEqual([])
    expect(crmInlineFontUrls(data({ en: [AR[0]] }), 'ar')).toEqual([])
    expect(
      crmInlineFontUrls(data({ ar: [AR[0], 7, null, AR[0], `/${'x'.repeat(2000)}`, AR[1]] }), 'ar'),
    ).toEqual([AR[0], AR[1]])
    const many = Array.from({ length: 20 }, (_, i) => `/designs/be-relax/f${i}.woff2`)
    expect(crmInlineFontUrls(data({ ar: many }), 'ar')).toEqual(many.slice(0, 16))
    for (const bad of [null, 'x', ['/a.woff2'], { ar: '/a.woff2' }, { ar: { 0: '/a.woff2' } }])
      expect(crmInlineFontUrls(data(bad), 'ar')).toEqual([])
    expect(crmInlineFontUrls({ contract: { version: 2 } }, 'ar')).toEqual([])
    // Only the contract declares fonts (a top-level key is the reserved output, never a declaration).
    expect(crmInlineFontUrls({ inline_fonts: { ar: AR } }, 'ar')).toEqual([])
    expect(crmInlineFontUrls(null, 'ar')).toEqual([])
    // An own key only (prototype names are never locales).
    expect(crmInlineFontUrls(data({}), 'constructor')).toEqual([])
  })

  it('names only static design woff2 files on our hosts (the same rules as contract.inline)', () => {
    expect(crmInlineFontSource(AR[0], ourHost)).toEqual({
      kind: 'design',
      design: 'be-relax',
      name: '16734a5adb27b0f3.woff2',
    })
    expect(crmInlineFontSource(AR[1], ourHost)).toMatchObject({ name: '3427efdf7896718d.woff2' })
    expect(crmInlineFontSource(AR[2], ourHost)).toMatchObject({ name: '6010e7fd0dce5d52.woff2' })
    for (const url of [
      'https://evil.example/designs/be-relax/16734a5adb27b0f3.woff2',
      'https://spamanagement.co.evil.example/designs/be-relax/a.woff2',
      '//spamanagement.co/designs/be-relax/a.woff2',
      'https://user@spamanagement.co/designs/be-relax/a.woff2',
      '/designs/be-relax/a.woff2?v=2',
      '/designs/be-relax/a.woff2#x',
      '/designs/be-relax/a.woff',
      '/designs/be-relax/a.ttf',
      '/designs/be-relax/a.webp',
      '/designs/be-relax/../a.woff2',
      '/designs/be-relax/%2e%2e.woff2',
      '/designs/Be-Relax/a.woff2',
      '/files/6f9c2b1e-1a2b-4c3d-8e4f-0123456789ab/a.woff2',
      'https://fonts.gstatic.com/s/notonaskharabic/v1/a.woff2',
      'data:font/woff2;base64,d09GMg==',
      42,
      null,
    ])
      expect(crmInlineFontSource(url, ourHost)).toBeNull()
    // A font url never reads as a picture.
    expect(crmInlineSource(AR[0], ourHost)).toBeNull()
  })

  it('sniffs the WOFF2 signature: nothing else becomes a font', () => {
    expect(isWoff2(woff2(100))).toBe(true)
    expect(woff2DataUri(woff2(100))?.uri).toMatch(/^data:font\/woff2;base64,d09GMg/)
    expect(woff2DataUri(woff2(100))?.size).toBe(100)
    const woff1 = woff2(100)
    woff1.set([...'wOFF'].map((c) => c.charCodeAt(0)))
    for (const b of [
      woff1,
      webp(1000),
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(64)),
      new Uint8Array([0x77, 0x4f, 0x46, 0x32]),
      new Uint8Array(100),
    ]) {
      expect(isWoff2(b)).toBe(false)
      expect(woff2DataUri(b)).toBeNull()
    }
  })

  it("plans the locale's fonts within the caps (each ≤ 150 KB, all ≤ 400 KB), keyed exactly as declared", async () => {
    const load = fontLoader({
      '16734a5adb27b0f3.woff2': 150 * 1024,
      '3427efdf7896718d.woff2': 150 * 1024,
      '6010e7fd0dce5d52.woff2': 120 * 1024,
    })
    const fonts = (await planCrmInlineFonts(data(), 'ar', { ourHost, load }))!
    // 150 + 150 + 120 > 400: the third is skipped (the total counts per declared url, in order).
    expect(Object.keys(fonts)).toEqual([AR[0], AR[1]])
    expect(fonts[AR[0]!]).toMatch(/^data:font\/woff2;base64,/)
    expect(await planCrmInlineFonts(data(), 'en', { ourHost, load })).toBeNull()
    const big = fontLoader({ '16734a5adb27b0f3.woff2': 150 * 1024 + 1, '3427efdf7896718d.woff2': 1000 })
    expect(Object.keys((await planCrmInlineFonts(data(), 'ar', { ourHost, load: big }))!)).toEqual([AR[1]])
    // Unknown hosts and other file types are never read at all.
    const read = fontLoader({ 'a.woff2': 1000 })
    const odd = data({
      ar: ['https://evil.example/designs/x/a.woff2', '/designs/x/a.webp', '/designs/x/a.woff2'],
    })
    expect(await planCrmInlineFonts(odd, 'ar', { ourHost, load: read })).toEqual({
      '/designs/x/a.woff2': expect.stringMatching(/^data:font\/woff2;base64,/),
    })
    expect(read).toHaveBeenCalledTimes(1)
    // A loader answering with anything but a woff2 data URI never makes it into the plan.
    const wrong = vi.fn(async () => rasterDataUri(webp(1000)))
    expect(await planCrmInlineFonts(data(), 'ar', { ourHost, load: wrong })).toBeNull()
    const failing = vi.fn(async () => {
      throw new Error('disk')
    })
    expect(await planCrmInlineFonts(data(), 'ar', { ourHost, load: failing })).toBeNull()
  })

  it('never waits past its deadline: a late font stays a link this render', async () => {
    const load = vi.fn((src: CrmInlineFontSource) =>
      src.name.startsWith('1673')
        ? new Promise<{ uri: string; size: number } | null>(() => {})
        : Promise.resolve(woff2DataUri(woff2(1000))),
    )
    const t0 = Date.now()
    const fonts = (await planCrmInlineFonts(data(), 'ar', { ourHost, load, deadlineMs: 30 }))!
    expect(Date.now() - t0).toBeLessThan(1000)
    expect(Object.keys(fonts)).toEqual([AR[1], AR[2]])
  })

  it('sets the reserved inline_fonts key last (copy-on-write), never a content slot or overlay', () => {
    const d: Record<string, unknown> = { ...data(), inline_fonts: { old: 'x' }, tail: 1 }
    const uri = woff2DataUri(woff2(100))!.uri
    const out: Json = applyCrmInlineFonts(d, { [AR[0]!]: uri, [AR[1]!]: 'data:image/webp;base64,AAAA' })
    expect(Object.keys(out).at(-1)).toBe('inline_fonts')
    expect(out.inline_fonts).toEqual({ [AR[0]!]: uri })
    expect(d.inline_fonts).toEqual({ old: 'x' })
    expect(applyCrmInlineFonts(d, null)).toBe(d)
    expect(applyCrmInlineFonts(d, {})).toBe(d)
    expect(applyCrmInlineFonts(d, { [AR[0]!]: 'javascript:x' })).toBe(d)
    expect(crmInlineFontsKey(null)).toBe('')
    expect(crmInlineFontsKey({ [AR[0]!]: uri })).toBe(`${AR[0]}#${uri.length}`)
    // Reserved: never listed in Website content, never overlaid (console, connector).
    const withFonts = { ...data(), inline_fonts: { [AR[0]!]: uri }, title: 'Hi' }
    expect(htmlContentSlots(withFonts).some((s) => s.path.startsWith('inline_fonts'))).toBe(false)
    const content = { v: 1, values: [{ path: 'inline_fonts', value: { t: { en: 'x' } } }] }
    expect(overlayHtmlContent(withFonts, content as Json, { locale: 'en' })).toBe(withFonts)
  })

  it('the loader reads fonts once, woff2 only, ≤ 150 KB, in the same size-bounded cache as the pictures', async () => {
    const readDesign = vi.fn(async (_d: string, name: string, _max: number) =>
      name === 'big.woff2'
        ? woff2(CRM_INLINE_LIMITS.fontBytes + 1)
        : name === 'fake.woff2'
          ? webp(1000)
          : woff2(100_000),
    )
    const l = createCrmInlineLoader({ readFiles: vi.fn(async () => new Map()), readDesign })
    const src = { kind: 'design', design: 'be-relax', name: 'a.woff2' } as const
    const [a, b] = await Promise.all([l.loadFont(src), l.loadFont(src)])
    expect(a?.uri).toMatch(/^data:font\/woff2;base64,/)
    expect(b).toBe(a)
    expect(await l.loadFont(src)).toBe(a)
    expect(readDesign).toHaveBeenCalledTimes(1)
    expect(readDesign.mock.calls[0]).toEqual(['be-relax', 'a.woff2', CRM_INLINE_LIMITS.fontBytes])
    expect(l.size()).toBe(a!.uri.length)
    expect(await l.loadFont({ ...src, name: 'big.woff2' })).toBeNull()
    expect(await l.loadFont({ ...src, name: 'fake.woff2' })).toBeNull()
    // The picture loader never answers from a font's cache entry (and never takes a font as a picture).
    expect(await l.load('spa-a', src)).toBeNull()
  })

  it('a rendered design gets inline_fonts in CRM_DATA only; every other byte stays as built', () => {
    const d = data()
    const html = `<!doctype html><html><head><style>@font-face{font-family:A;src:url(${AR[0]}) format("woff2")}</style><script>window.CRM_DATA = ${JSON.stringify(d)};</script></head><body></body></html>`
    const found = htmlCrmContractOf(html)!
    const uri = woff2DataUri(woff2(2000))!.uri
    const json = crmScriptJson(applyCrmInlineFonts(found.literal!.data, { [AR[0]!]: uri }))
    const out = spliceCrmData(html, found, json, { inject: false })
    const literal = htmlCrmContractOf(out)!.literal!
    expect(out.slice(0, found.literal!.start)).toBe(html.slice(0, found.literal!.start))
    expect(out.slice(literal.end)).toBe(html.slice(found.literal!.end))
    expect((literal.data as Json).inline_fonts).toEqual({ [AR[0]!]: uri })
    expect((literal.data as Json).contract).toEqual(d.contract)
  })
})

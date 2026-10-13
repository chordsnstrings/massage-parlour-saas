import { describe, expect, it, vi } from 'vitest'
import { overlayHtmlContent } from '../src/html-content'
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
  CRM_INLINE_LIMITS,
  type CrmInlineSource,
  createCrmInlineLoader,
  crmInlineKey,
  crmInlinePaths,
  crmInlineSource,
  crmValueAt,
  planCrmInline,
  rasterDataUri,
  sniffRasterType,
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
})

describe('createCrmInlineLoader', () => {
  const setup = (over: { maxBytes?: number } = {}) => {
    let t = 0
    const readFile = vi.fn(async (scope: string, id: string, _max: number) =>
      scope === 'spa-a' && id === LOGO ? webp(1000) : null,
    )
    const readDesign = vi.fn(async (_d: string, name: string, _max: number) =>
      name === 'svg.png'
        ? new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')
        : name === 'big.webp'
          ? webp(CRM_INLINE_LIMITS.fileBytes + 1)
          : webp(2000),
    )
    const l = createCrmInlineLoader({ readFile, readDesign, missTtlMs: 1000, now: () => t, ...over })
    return { l, readFile, readDesign, tick: (ms: number) => (t += ms) }
  }
  const file = { kind: 'file', id: LOGO } as const

  it('reads once, shares concurrent loads, and scopes files to the spa that asks', async () => {
    const { l, readFile } = setup()
    const [a, b] = await Promise.all([l.load('spa-a', file), l.load('spa-a', file)])
    expect(a?.uri).toMatch(/^data:image\/webp;base64,/)
    expect(b).toBe(a)
    expect(await l.load('spa-a', file)).toBe(a)
    expect(readFile).toHaveBeenCalledTimes(1)
    // Another spa never gets spa A's cached bytes.
    expect(await l.load('spa-b', file)).toBeNull()
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(readFile.mock.calls[1]).toEqual(['spa-b', LOGO, CRM_INLINE_LIMITS.fileBytes])
  })

  it('remembers a miss for its ttl only; never SVG or too-big bytes; read errors are not remembered', async () => {
    const { l, readFile, readDesign, tick } = setup()
    expect(await l.load('spa-b', file)).toBeNull()
    expect(await l.load('spa-b', file)).toBeNull()
    expect(readFile).toHaveBeenCalledTimes(1)
    tick(1001)
    await l.load('spa-b', file)
    expect(readFile).toHaveBeenCalledTimes(2)
    expect(await l.load('x', { kind: 'design', design: 'd', name: 'svg.png' })).toBeNull()
    expect(await l.load('x', { kind: 'design', design: 'd', name: 'big.webp' })).toBeNull()
    readDesign.mockRejectedValueOnce(new Error('EIO'))
    expect(await l.load('x', { kind: 'design', design: 'd', name: 'ok.webp' })).toBeNull()
    expect((await l.load('x', { kind: 'design', design: 'd', name: 'ok.webp' }))?.size).toBe(2000)
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

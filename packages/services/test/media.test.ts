import { closeAllDbs, mediaAssets, pageVersions, sitePages, sites, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  absoluteFileUrl,
  assetUsage,
  createAsset,
  deleteAsset,
  fetchRemoteImage,
  fileIdFromUrl,
  getFile,
  isPrivateAddress,
  listAssets,
  listTags,
  persistRemoteAsset,
  processImage,
  pruneExpiredAiLinks,
  sniffImageType,
  updateAlt,
} from '../src'

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#7a9a83' } })
    .png()
    .toBuffer()

describe('magic-byte sniffing', () => {
  it('recognises the image formats we accept', async () => {
    const base = sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } })
    expect(sniffImageType(await base.clone().jpeg().toBuffer())).toBe('image/jpeg')
    expect(sniffImageType(await base.clone().png().toBuffer())).toBe('image/png')
    expect(sniffImageType(await base.clone().webp().toBuffer())).toBe('image/webp')
    expect(sniffImageType(await base.clone().gif().toBuffer())).toBe('image/gif')
    expect(sniffImageType(await base.clone().avif().toBuffer())).toBe('image/avif')
  })

  it('rejects SVG, HTML, HEIC and junk whatever the extension says', () => {
    const text = (s: string) => Buffer.from(s)
    expect(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull()
    expect(sniffImageType(text('<?xml version="1.0"?><svg></svg>'))).toBeNull()
    expect(sniffImageType(text('<!doctype html><html><body>hi</body></html>'))).toBeNull()
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      text('ftypheic'),
      Buffer.alloc(4),
      text('mif1heic'),
    ])
    expect(sniffImageType(heic)).toBeNull()
    expect(sniffImageType(Buffer.from([0xff, 0xd8]))).toBeNull()
    expect(sniffImageType(Buffer.alloc(64))).toBeNull()
  })
})

describe('processImage', () => {
  it('fits large images within 2400 px and re-encodes as WebP', async () => {
    const out = await processImage(await png(3600, 1800))
    expect(out.contentType).toBe('image/webp')
    expect(out.sourceType).toBe('image/png')
    expect([out.width, out.height]).toEqual([2400, 1200])
    const meta = await sharp(out.bytes).metadata()
    expect(meta.format).toBe('webp')
    expect([meta.width, meta.height]).toEqual([2400, 1200])
  })

  it('never upscales small images', async () => {
    const out = await processImage(await png(640, 480))
    expect([out.width, out.height]).toEqual([640, 480])
  })

  it('applies EXIF rotation and strips metadata', async () => {
    const rotated = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#333' } })
      .jpeg()
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'Spa', Artist: 'GPS test' } } })
      .toBuffer()
    expect((await sharp(rotated).metadata()).orientation).toBe(6)
    const out = await processImage(rotated)
    expect([out.width, out.height]).toEqual([100, 200])
    const meta = await sharp(out.bytes).metadata()
    expect(meta.exif).toBeUndefined()
    expect(meta.orientation).toBeUndefined()
  })

  it('refuses SVG and non-images with a clear message', async () => {
    await expect(processImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).rejects.toThrow(
      /SVG/,
    )
    await expect(processImage(Buffer.from('hello, I am a text file pretending'))).rejects.toThrow(
      /isn’t an image/,
    )
    await expect(processImage(Buffer.alloc(0))).rejects.toThrow(/empty/)
  })

  it('reports damaged images instead of crashing', async () => {
    const good = await png(64, 64)
    await expect(processImage(good.subarray(0, 40))).rejects.toThrow(/couldn’t read/i)
  })
})

describe('SSRF guard', () => {
  it('classifies private, loopback, link-local and reserved addresses', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.10',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fd00::1',
      'fe80::1%eth0',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '64:ff9b::a00:1',
      '2002:c0a8:0101::1',
      'ff02::1',
      'not-an-ip',
    ])
      expect(isPrivateAddress(ip), ip).toBe(true)
    for (const ip of ['8.8.8.8', '104.16.1.1', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8'])
      expect(isPrivateAddress(ip), ip).toBe(false)
  })

  const imageResponse = async (init: { type?: string; length?: number } = {}) => {
    const body = await png(32, 32)
    return new Response(new Uint8Array(body), {
      headers: {
        'content-type': init.type ?? 'image/png',
        ...(init.length ? { 'content-length': String(init.length) } : {}),
      },
    })
  }
  const publicLookup = async () => ['93.184.216.34']

  it('downloads a public https image', async () => {
    const fetchMock = vi.fn(async () => imageResponse())
    const out = await fetchRemoteImage('https://cdn.example.com/a.png', {
      fetch: fetchMock,
      lookup: publicLookup,
    })
    expect(out.contentType).toBe('image/png')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit]
    expect(init.redirect).toBe('manual')
  })

  it('refuses http, odd ports, credentials and private hosts before fetching', async () => {
    const fetchMock = vi.fn(async () => imageResponse())
    const opts = { fetch: fetchMock, lookup: publicLookup }
    await expect(fetchRemoteImage('http://cdn.example.com/a.png', opts)).rejects.toThrow(/https/)
    await expect(fetchRemoteImage('https://cdn.example.com:8443/a.png', opts)).rejects.toThrow(/port/)
    await expect(fetchRemoteImage('https://u:p@cdn.example.com/a.png', opts)).rejects.toThrow(/credentials/)
    await expect(fetchRemoteImage('https://127.0.0.1/a.png', opts)).rejects.toThrow(/private/)
    await expect(fetchRemoteImage('https://2130706433/a.png', opts)).rejects.toThrow(/private/)
    await expect(fetchRemoteImage('https://[::1]/a.png', opts)).rejects.toThrow(/private/)
    await expect(
      fetchRemoteImage('https://internal.example.com/a.png', {
        fetch: fetchMock,
        lookup: async () => ['93.184.216.34', '10.0.0.7'],
      }),
    ).rejects.toThrow(/private/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('re-checks every redirect hop', async () => {
    const lookup = async (h: string) => (h === 'metadata.internal' ? ['169.254.169.254'] : ['93.184.216.34'])
    const redirectTo = (location: string) => new Response(null, { status: 302, headers: { location } })
    const toPrivate = vi.fn(async () => redirectTo('https://metadata.internal/latest'))
    await expect(fetchRemoteImage('https://cdn.example.com/a', { fetch: toPrivate, lookup })).rejects.toThrow(
      /private/,
    )
    expect(toPrivate).toHaveBeenCalledTimes(1)
    const toHttp = vi.fn(async () => redirectTo('http://cdn.example.com/a.png'))
    await expect(fetchRemoteImage('https://cdn.example.com/a', { fetch: toHttp, lookup })).rejects.toThrow(
      /https/,
    )
    const loop = vi.fn(async () => redirectTo('/again'))
    await expect(fetchRemoteImage('https://cdn.example.com/a', { fetch: loop, lookup })).rejects.toThrow(
      /redirects/,
    )
    expect(loop).toHaveBeenCalledTimes(4)
    let hop = 0
    const ok = vi.fn(async () =>
      hop++ === 0 ? redirectTo('https://img.example.net/b.png') : imageResponse(),
    )
    await expect(fetchRemoteImage('https://cdn.example.com/a', { fetch: ok, lookup })).resolves.toMatchObject(
      {
        contentType: 'image/png',
      },
    )
  })

  it('checks content type, size and magic bytes', async () => {
    const opts = (res: () => Promise<Response>) => ({ fetch: vi.fn(res), lookup: publicLookup })
    await expect(
      fetchRemoteImage(
        'https://x.example/a',
        opts(async () => new Response('<html>', { headers: { 'content-type': 'text/html' } })),
      ),
    ).rejects.toThrow(/doesn’t point to an image/)
    await expect(
      fetchRemoteImage(
        'https://x.example/a',
        opts(async () => imageResponse({ type: 'image/svg+xml' })),
      ),
    ).rejects.toThrow(/doesn’t point to an image/)
    // Generic binary labels are accepted only when the bytes really are an image.
    await expect(
      fetchRemoteImage(
        'https://x.example/a',
        opts(async () => imageResponse({ type: 'application/octet-stream' })),
      ),
    ).resolves.toMatchObject({ contentType: 'image/png' })
    await expect(
      fetchRemoteImage(
        'https://x.example/a',
        opts(async () => new Response('<html>', { headers: { 'content-type': 'application/octet-stream' } })),
      ),
    ).rejects.toThrow(/isn’t an image/)
    await expect(
      fetchRemoteImage(
        'https://x.example/a',
        opts(async () => imageResponse({ length: 50 * 1024 * 1024 })),
      ),
    ).rejects.toThrow(/too large/)
    await expect(
      fetchRemoteImage('https://x.example/a', { ...opts(async () => imageResponse()), maxBytes: 20 }),
    ).rejects.toThrow(/too large/)
    await expect(
      fetchRemoteImage(
        'https://x.example/a',
        opts(async () => new Response('GIF-ish but not', { headers: { 'content-type': 'image/gif' } })),
      ),
    ).rejects.toThrow(/isn’t an image/)
    await expect(
      fetchRemoteImage(
        'https://x.example/a',
        opts(async () => new Response('nope', { status: 404 })),
      ),
    ).rejects.toThrow(/404/)
  })

  it('gives up after the timeout', async () => {
    const hang = vi.fn(
      (_u: URL, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
        }),
    )
    await expect(
      fetchRemoteImage('https://slow.example/a.png', {
        fetch: hang as typeof fetch,
        lookup: publicLookup,
        timeoutMs: 50,
      }),
    ).rejects.toThrow(/timed out/)
  })
})

describe('url helpers', () => {
  it('extracts file ids and absolutises paths', () => {
    const id = '0b6f0f8e-3c1a-4c2e-9a77-1d2f3e4a5b6c'
    expect(fileIdFromUrl(`/files/${id}`)).toBe(id)
    expect(fileIdFromUrl(`https://spa.example/files/${id}/photo.webp?w=480`)).toBe(id)
    expect(fileIdFromUrl('https://ark.example/img.png')).toBeNull()
    expect(absoluteFileUrl(`/files/${id}`, 'https://serenity.spamanagement.ae/')).toBe(
      `https://serenity.spamanagement.ae/files/${id}`,
    )
    expect(absoluteFileUrl('https://cdn.example/a.png', 'https://x')).toBe('https://cdn.example/a.png')
  })
})

describe('library (database)', () => {
  const { platform, app } = testDbs()
  const ids = {} as Record<string, string>

  beforeAll(async () => {
    await resetTestDatabase()
    const [a] = await platform.insert(tenants).values({ slug: 'media-a', name: 'A' }).returning()
    const [b] = await platform.insert(tenants).values({ slug: 'media-b', name: 'B' }).returning()
    ids.a = a!.id
    ids.b = b!.id
  })
  afterAll(closeAllDbs)

  it('creates, lists, filters, edits and deletes assets with RLS isolation', async () => {
    const image = await processImage(await png(1200, 800))
    const asset = await withTenant(
      ids.a!,
      (tx) =>
        createAsset(tx, {
          tenantId: ids.a!,
          image,
          filename: 'Treatment Room.JPG',
          tags: ['Rooms', 'rooms', ' interior '],
        }),
      app,
    )
    expect(asset.url).toBe(`/files/${asset.fileId}`)
    expect(asset.filename).toBe('Treatment Room.webp')
    expect(asset.tags).toEqual(['rooms', 'interior'])
    expect([asset.width, asset.height, asset.bytes]).toEqual([1200, 800, image.bytes.length])

    const file = await platform.transaction((tx) => getFile(tx, asset.fileId!))
    expect(file?.isPublic).toBe(true)
    expect(file?.contentType).toBe('image/webp')

    await withTenant(
      ids.a!,
      (tx) => createAsset(tx, { tenantId: ids.a!, image, source: 'ai', alt: { en: 'Warm stones' } }),
      app,
    )
    await withTenant(
      ids.a!,
      async (tx) => {
        expect(await listAssets(tx)).toHaveLength(2)
        expect(await listAssets(tx, { source: 'ai' })).toHaveLength(1)
        expect(await listAssets(tx, { tag: 'rooms' })).toHaveLength(1)
        expect((await listAssets(tx, { q: 'treatment' }))[0]?.id).toBe(asset.id)
        expect((await listAssets(tx, { q: 'stones' }))[0]?.source).toBe('ai')
        expect(await listAssets(tx, { q: '100%' })).toHaveLength(0)
        expect(await listTags(tx)).toEqual(['interior', 'rooms'])
        const updated = await updateAlt(tx, asset.id, { en: '  Quiet room ', ar: 'غرفة هادئة' })
        expect(updated.alt).toEqual({ en: 'Quiet room', ar: 'غرفة هادئة' })
      },
      app,
    )
    // Tenant B sees nothing and can't touch A's rows.
    await withTenant(
      ids.b!,
      async (tx) => {
        expect(await listAssets(tx)).toHaveLength(0)
        expect(await deleteAsset(tx, asset.id)).toBeNull()
        await expect(updateAlt(tx, asset.id, { en: 'x' })).rejects.toThrow(/not found/)
      },
      app,
    )

    // Usage: only the latest draft/published version of each page counts.
    await withTenant(
      ids.a!,
      async (tx) => {
        const [site] = await tx.insert(sites).values({ tenantId: ids.a! }).returning()
        const [home, about] = await tx
          .insert(sitePages)
          .values([
            { tenantId: ids.a!, siteId: site!.id, slug: '', title: { en: 'Home' } },
            { tenantId: ids.a!, siteId: site!.id, slug: 'about', title: { en: 'About' } },
          ])
          .returning()
        const uses = { content: [{ type: 'Image', props: { src: `${asset.url}?w=480` } }] }
        await tx.insert(pageVersions).values([
          { tenantId: ids.a!, pageId: home!.id, data: uses, status: 'published' },
          {
            tenantId: ids.a!,
            pageId: about!.id,
            data: uses,
            status: 'draft',
            createdAt: new Date(Date.now() - 60_000),
          },
          { tenantId: ids.a!, pageId: about!.id, data: { content: [] }, status: 'draft' },
        ])
        const used = await assetUsage(tx, asset.url)
        expect(used.map((p) => p.title.en)).toEqual(['Home'])
      },
      app,
    )

    const removed = await withTenant(ids.a!, (tx) => deleteAsset(tx, asset.id), app)
    expect(removed?.id).toBe(asset.id)
    expect(await platform.transaction((tx) => getFile(tx, asset.fileId!))).toBeNull()
  })

  it('moves an AI row from its temporary URL onto a stored file', async () => {
    const temp = 'https://ark-cdn.example/seedream/abc.png?expires=7d'
    await withTenant(
      ids.b!,
      (tx) =>
        // mirrors what the content agent inserts before persistence
        tx.insert(mediaAssets).values({ tenantId: ids.b!, url: temp, source: 'ai', alt: { en: 'Oils' } }),
      app,
    )
    const image = await processImage(await png(1024, 1024))
    const row = await withTenant(
      ids.b!,
      (tx) => persistRemoteAsset(tx, { tenantId: ids.b!, remoteUrl: temp, image }),
      app,
    )
    expect(row.url).toMatch(/^\/files\/[0-9a-f-]{36}$/)
    expect(row.alt).toEqual({ en: 'Oils' })
    expect(row.tags).toContain('ai')
    const all = await withTenant(ids.b!, (tx) => listAssets(tx), app)
    expect(all).toHaveLength(1)
    expect(all[0]?.url).toBe(row.url)
  })

  it('prunes AI rows whose temporary link expired, keeping saved and recent ones', async () => {
    const old = new Date(Date.now() - 8 * 24 * 3600_000)
    await withTenant(
      ids.b!,
      (tx) =>
        tx.insert(mediaAssets).values([
          { tenantId: ids.b!, url: 'https://ark-cdn.example/old.png', source: 'ai', createdAt: old },
          { tenantId: ids.b!, url: 'https://ark-cdn.example/new.png', source: 'ai' },
        ]),
      app,
    )
    expect(await withTenant(ids.b!, (tx) => pruneExpiredAiLinks(tx), app)).toBe(1)
    const urls = (await withTenant(ids.b!, (tx) => listAssets(tx), app)).map((r) => r.url)
    expect(urls).toContain('https://ark-cdn.example/new.png')
    expect(urls).not.toContain('https://ark-cdn.example/old.png')
    expect(urls.some((u) => u.startsWith('/files/'))).toBe(true)
  })
})

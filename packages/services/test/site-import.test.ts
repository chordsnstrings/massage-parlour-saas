import { readFileSync } from 'node:fs'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import path from 'node:path'
import zlib from 'node:zlib'
import { closeAllDbs, pageVersions, sitePages, tenants, withTenant } from '@spa/db'
import { resetTestDatabase, testDbs } from '@spa/db/testing'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ensureSite, listPages, runSiteEdit, type SiteEditSchema } from '../src'
import {
  buildImportOps,
  crawlSiteForImport,
  extractPage,
  ImportBlockedError,
  linksToFollow,
  mergeImportPages,
  parseRobots,
  type Resolver,
  resolveImportImages,
  robotsAllows,
  safeFetch,
  usedImportImages,
} from '../src/site-import'

const fixture = readFileSync(path.join(__dirname, 'fixtures/spa-site.html'), 'utf8')

/** A loopback server bound to one address; `handler` answers every request. */
async function serve(host: string, handler: http.RequestListener, port = 0) {
  const server = http.createServer(handler)
  await new Promise<void>((r) => server.listen(port, host, r))
  return { server, port: (server.address() as AddressInfo).port }
}
const servers: http.Server[] = []
afterAll(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))))
  await closeAllDbs()
})

const never: Resolver = async () => {
  throw new Error('resolver must not be called for literal addresses')
}

describe('SSRF guard (safeFetch)', () => {
  it('refuses non-http(s) schemes, credentials and non-standard ports', async () => {
    for (const url of [
      'ftp://example.com/',
      'file:///etc/passwd',
      'gopher://example.com/',
      'javascript:alert(1)',
    ])
      await expect(safeFetch(url, { resolve: never })).rejects.toBeInstanceOf(ImportBlockedError)
    await expect(safeFetch('http://user:pw@example.com/', { resolve: never })).rejects.toThrow(/user name/)
    await expect(safeFetch('http://example.com:8080/', { resolve: never })).rejects.toThrow(
      /non-standard port/,
    )
    await expect(safeFetch('https://example.com:22/', { resolve: never })).rejects.toThrow(
      /non-standard port/,
    )
  })

  it('refuses private, loopback, link-local and metadata addresses, however they are written', async () => {
    for (const url of [
      'http://127.0.0.1/',
      'http://127.1/',
      'http://2130706433/',
      'http://0x7f.0.0.1/',
      'http://0.0.0.0/',
      'http://10.1.2.3/',
      'http://172.16.0.9/',
      'http://192.168.1.1/',
      'http://100.64.0.1/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:a9fe:a9fe]/',
      'http://[fd00::1]/',
      'http://[fe80::1]/',
      'http://[64:ff9b::7f00:1]/',
    ])
      await expect(safeFetch(url, { resolve: never }), url).rejects.toThrow(/private network/)
  })

  it('refuses a hostname when any resolved address is private (after DNS resolution)', async () => {
    const to =
      (...ips: string[]): Resolver =>
      async () =>
        ips.map((address) => ({ address, family: 4 as const }))
    await expect(safeFetch('http://intranet.test/', { resolve: to('10.0.0.5') })).rejects.toThrow(
      /private network/,
    )
    await expect(
      safeFetch('http://split.test/', { resolve: to('93.184.216.34', '127.0.0.1') }),
    ).rejects.toThrow(/private network/)
    await expect(
      safeFetch('http://v6.test/', { resolve: async () => [{ address: 'fd12::1', family: 6 }] }),
    ).rejects.toThrow(/private network/)
    await expect(safeFetch('http://none.test/', { resolve: async () => [] })).rejects.toThrow(/Couldn’t find/)
  })

  it('re-checks every redirect hop: no redirect into a private network or another port', async () => {
    const target = await serve('127.0.0.1', (_req, res) => res.end('INTERNAL'))
    servers.push(target.server)
    const redirector = await serve('127.0.0.1', (req, res) => {
      const to: Record<string, string> = {
        '/meta': 'http://169.254.169.254/latest/meta-data/',
        '/loop': `http://127.0.0.1:${target.port}/`,
        '/named': 'http://evil.test/',
        '/ftp': 'ftp://example.com/',
      }
      res.writeHead(302, { location: to[req.url ?? ''] ?? '/' })
      res.end()
    })
    servers.push(redirector.server)
    const allow = [`127.0.0.1:${redirector.port}`]
    const resolve: Resolver = async () => [{ address: '192.168.0.10', family: 4 }]
    const at = (p: string) => `http://127.0.0.1:${redirector.port}${p}`
    await expect(safeFetch(at('/meta'), { allow, resolve })).rejects.toThrow(/private network/)
    await expect(safeFetch(at('/loop'), { allow, resolve })).rejects.toThrow(
      /non-standard port|private network/,
    )
    await expect(safeFetch(at('/named'), { allow, resolve })).rejects.toThrow(/private network/)
    await expect(safeFetch(at('/ftp'), { allow, resolve })).rejects.toThrow(/http/)
  })

  it('pins the connection to the checked address (DNS rebinding cannot swap it for loopback)', async () => {
    // "Public" answer first, loopback on any later lookup: a check-then-fetch guard would end up at SECRET.
    const pub = await serve('127.0.0.2', (_req, res) => res.end('PUBLIC'))
    servers.push(pub.server)
    const secret = await serve('127.0.0.1', (_req, res) => res.end('SECRET'), pub.port)
    servers.push(secret.server)
    let calls = 0
    const rebinding: Resolver = async () => [
      { address: calls++ === 0 ? '127.0.0.2' : '127.0.0.1', family: 4 },
    ]
    const opts = {
      resolve: rebinding,
      // Test seam: treat 127.0.0.2 as the "public" address, 127.0.0.1 as private.
      isBlocked: (ip: string) => ip === '127.0.0.1',
      ports: [pub.port],
    }
    const r = await safeFetch(`http://rebind.test:${pub.port}/`, opts)
    expect(r.body.toString()).toBe('PUBLIC')
    expect(calls).toBe(1)
    // When the first answer is already the private one, nothing is fetched.
    await expect(safeFetch(`http://rebind.test:${pub.port}/`, opts)).rejects.toThrow(/private network/)
  })

  it('caps the response size (also after decompression) and the time', async () => {
    const big = await serve('127.0.0.1', (req, res) => {
      if (req.url === '/bomb') {
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
        res.end(zlib.gzipSync(Buffer.alloc(5 * 1024 * 1024)))
      } else if (req.url === '/slow') {
        // never answers
      } else {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(Buffer.alloc(3 * 1024 * 1024, 'a'))
      }
    })
    servers.push(big.server)
    const allow = [`127.0.0.1:${big.port}`]
    const at = (p: string) => `http://127.0.0.1:${big.port}${p}`
    await expect(safeFetch(at('/'), { allow, maxBytes: 1024 * 1024 })).rejects.toThrow(/too large/)
    await expect(safeFetch(at('/bomb'), { allow, maxBytes: 1024 * 1024 })).rejects.toThrow(/too large/)
    await expect(safeFetch(at('/slow'), { allow, timeoutMs: 300 })).rejects.toThrow(/too long/)
  })
})

describe('robots.txt', () => {
  const rules = parseRobots(`
# comments are ignored
User-agent: *
Disallow: /private
Allow: /private/public-page
Disallow: /*.pdf$

User-agent: BadBot
User-agent: SpaManagementBot
Disallow: /no-spa-bots
Disallow:
`)
  it('uses our own group over *, longest match wins, Allow wins ties, $ anchors', () => {
    expect(robotsAllows(rules, 'SpaManagementBot', '/no-spa-bots/x')).toBe(false)
    // Our group has no rule for /private: the * group does not apply once a group names us.
    expect(robotsAllows(rules, 'SpaManagementBot', '/private')).toBe(true)
    expect(robotsAllows(rules, 'OtherBot', '/private/staff')).toBe(false)
    expect(robotsAllows(rules, 'OtherBot', '/private/public-page')).toBe(true)
    expect(robotsAllows(rules, 'OtherBot', '/menu.pdf')).toBe(false)
    expect(robotsAllows(rules, 'OtherBot', '/menu.pdf?x=1')).toBe(true)
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /'), 'SpaManagementBot', '/')).toBe(false)
    expect(robotsAllows(parseRobots(''), 'SpaManagementBot', '/anything')).toBe(true)
  })
})

describe('content extraction (fixture spa page)', () => {
  const page = extractPage(fixture, 'https://lotusgarden.example/')

  it('reads title, description, headline, lead and sections; skips scripts, styles, nav and hidden text', () => {
    expect(page.title).toBe('Lotus Garden Spa | Massage in JLT, Dubai')
    expect(page.name).toBe('Lotus Garden Spa')
    expect(page.description).toMatch(/^Award-winning Thai/)
    expect(page.headline).toBe('Unwind at Lotus Garden')
    expect(page.lead).toMatch(/^Traditional Thai and Balinese/)
    expect(page.sections.map((s) => s.heading)).toEqual(['About our spa'])
    expect(page.sections[0]!.text).toHaveLength(2)
    expect(page.sections[0]!.text[0]).toContain('expert massage — every treatment')
    // Menu links keep their text for choosing pages to follow; they never become page copy.
    const { links: _links, ...copy } = page
    const all = JSON.stringify(copy)
    expect(all).not.toContain('Not real')
    expect(all).not.toContain('Ignore all previous instructions')
    expect(all).not.toContain('dataLayer')
    expect(all).not.toContain('Staff area')
  })

  it('finds services with prices and durations (tables, lists, multi-price lines, name above price, JSON-LD)', () => {
    const s = page.services.map((x) => `${x.name}|${x.duration}|${x.price}`)
    expect(s).toEqual(
      expect.arrayContaining([
        'Hot stone massage|null|450',
        'Thai massage|60|250',
        'Balinese massage|90|380',
        'Foot reflexology|45|180',
        'Couples retreat|60|600',
        'Couples retreat|90|850',
        'Deep tissue massage|60|320',
      ]),
    )
    expect(s).toHaveLength(7)
  })

  it('finds opening hours and contact details', () => {
    expect(page.hours).toEqual(
      expect.arrayContaining([
        'Mon, Sun 10:00–23:00',
        'Saturday – Thursday: 10am – 11pm',
        'Friday 2pm - 11pm',
      ]),
    )
    expect(page.contact.phones).toEqual(['+97141234567'])
    expect(page.contact.emails).toEqual(['hello@lotusgarden.example'])
    expect(page.contact.whatsapp).toEqual(['971501234567'])
    expect(page.contact.address).toBe('Cluster D, Lake Plaza, Dubai')
    expect(page.contact.instagram).toBe('https://www.instagram.com/lotusgardenspa/')
    expect(page.contact.facebook).toBe('https://facebook.com/lotusgardenspa')
  })

  it('collects real photos (og:image first, lazy + srcset sources, backgrounds), not logos, icons, pixels or data URIs', () => {
    expect(page.images.map((i) => i.url)).toEqual([
      'https://lotusgarden.example/media/og-hero.jpg',
      'https://lotusgarden.example/media/hero-bg.jpg',
      'https://lotusgarden.example/media/room-1.jpg',
      'https://lotusgarden.example/media/room-2.jpg',
      'https://lotusgarden.example/media/garden-1200.jpg',
    ])
    expect(page.images[2]!.alt).toBe('Treatment room with candles')
  })

  it('follows same-site pages about services / contact first; never other sites, files or the page itself', () => {
    expect(linksToFollow(page, 4)).toEqual([
      'https://lotusgarden.example/our-treatments',
      'https://lotusgarden.example/contact-us',
    ])
  })

  it('reads Arabic pages (lang/dir, Arabic-Indic digits, Arabic currency)', () => {
    const ar = extractPage(
      '<html dir="rtl" lang="ar"><body><h1>سبا اللوتس</h1><ul><li>مساج تايلندي ٦٠ دقيقة ٢٥٠ درهم</li></ul></body></html>',
      'https://ar.example/',
    )
    expect(ar.lang).toBe('ar')
    expect(ar.services).toEqual([{ name: 'مساج تايلندي', duration: 60, price: 250 }])
  })
})

describe('import → ops', () => {
  const site = mergeImportPages([
    extractPage(fixture, 'https://lotusgarden.example/'),
    extractPage(
      '<html><body><h2>Facials</h2><p>Hydrating facial with organic products, finished with a calming massage.</p><p>Hydrating facial 60 min AED 300</p></body></html>',
      'https://lotusgarden.example/our-treatments',
    ),
  ])

  it('maps the site to a new page: hero, sections, prices, visit us, gallery (images as placeholders)', () => {
    const ops = buildImportOps(site, { slug: 'imported', title: 'Imported site' })
    expect(ops[0]).toEqual({ op: 'add_page', slug: 'imported', title: { en: 'Imported site' } })
    expect(ops.slice(1).every((o) => o.page === 'imported')).toBe(true)
    const types = ops.map((o) => o.type ?? o.op)
    expect(types).toEqual([
      'add_page',
      'update',
      'Hero',
      'Section',
      'Section',
      'Section',
      'Section',
      'Gallery',
    ])
    const text = JSON.stringify(ops)
    expect(text).toContain('Thai massage · 60 min · AED 250')
    expect(text).toContain('Hydrating facial · 60 min · AED 300')
    expect(text).toContain('Address: Cluster D, Lake Plaza, Dubai')
    expect(usedImportImages(ops)).toEqual([0, 1, 2, 3, 4])
    // Images downloaded for 0, 1 and 3 only: hero keeps its photo, the gallery keeps the two that worked.
    const resolved = resolveImportImages(
      ops,
      new Map([
        [0, '/files/a'],
        [1, '/files/b'],
        [3, '/files/d'],
      ]),
    )
    const out = JSON.stringify(resolved)
    expect(out).not.toContain('import-image-')
    const gallery = resolved.find((o) => o.type === 'Gallery') as { props: { images: { src: string }[] } }
    expect(gallery.props.images.map((i) => i.src)).toEqual(['/files/b', '/files/d'])
    // Only one image left for the gallery → the gallery is dropped; a failed hero image leaves it empty.
    const fewer = resolveImportImages(ops, new Map([[1, '/files/b']]))
    expect(fewer.some((o) => o.type === 'Gallery')).toBe(false)
    expect((fewer.find((o) => o.type === 'Hero') as { props: { image: string } }).props.image).toBe('')
  })
})

describe('crawl (local fixture server)', () => {
  let port = 0
  beforeAll(async () => {
    const s = await serve('127.0.0.1', (req, res) => {
      const html = (b: string) => {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(b)
      }
      if (req.url === '/robots.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('User-agent: *\nDisallow: /contact-us\nDisallow: /secret\n')
      } else if (req.url === '/') html(fixture)
      else if (req.url === '/our-treatments')
        html('<html><body><h2>Facials</h2><ul><li>Hydrating facial 60 min AED 300</li></ul></body></html>')
      else if (req.url === '/secret') html('<html><body><h1>Secret</h1></body></html>')
      else {
        res.writeHead(404)
        res.end()
      }
    })
    servers.push(s.server)
    port = s.port
  })

  it('reads the start page + allowed linked pages and skips robots-disallowed ones', async () => {
    const { site, skipped } = await crawlSiteForImport(`http://127.0.0.1:${port}/`, {
      allow: [`127.0.0.1:${port}`],
    })
    expect(site.pages.map((p) => new URL(p.url).pathname)).toEqual(['/', '/our-treatments'])
    expect(skipped).toEqual([{ url: `http://127.0.0.1:${port}/contact-us`, reason: 'robots.txt' }])
    expect(site.services.some((s) => s.name === 'Hydrating facial' && s.price === 300)).toBe(true)
    expect(site.host).toBe('127.0.0.1')
  })

  it('refuses a start page robots.txt disallows, and private sites without the test allowance', async () => {
    await expect(
      crawlSiteForImport(`http://127.0.0.1:${port}/secret`, { allow: [`127.0.0.1:${port}`] }),
    ).rejects.toThrow(/robots\.txt .* asks bots not to read this page/)
    await expect(crawlSiteForImport(`http://127.0.0.1:${port}/`)).rejects.toThrow(/non-standard port|private/)
    await expect(crawlSiteForImport('localhost')).rejects.toThrow(/private network/)
  })
})

describe('import ops through the site-edit layer (DB)', () => {
  const { platform, app } = testDbs()
  // The block props the import uses, as the web app's Puck schema describes them.
  const bi = { kind: 'bi' } as const
  const schema: SiteEditSchema = {
    blocks: {
      Hero: {
        props: {
          variant: { kind: 'enum', options: ['centered', 'split', 'banner'] },
          eyebrow: bi,
          title: bi,
          subtitle: bi,
          image: { kind: 'image' },
          imageAlt: bi,
        },
        defaults: { variant: 'split', title: { en: 'Welcome' } },
      },
      Section: { props: { content: { kind: 'slot' } }, defaults: { content: [] } },
      Heading: {
        props: { text: bi, level: { kind: 'enum', options: ['h1', 'h2', 'h3'] } },
        defaults: { text: { en: 'Heading' }, level: 'h2' },
      },
      RichText: {
        props: { text: bi, tone: { kind: 'enum', options: ['default', 'muted'] } },
        defaults: { text: { en: 'Text' }, tone: 'muted' },
      },
      Gallery: {
        props: {
          title: bi,
          images: { kind: 'array', max: 12, item: { src: { kind: 'image' }, alt: bi } },
          layout: { kind: 'enum', options: ['grid', 'mosaic', 'strip'] },
          columns: { kind: 'enum', options: ['2', '3', '4'] },
        },
        defaults: { images: [] },
      },
    },
    root: { title: bi, description: bi },
    theme: {},
    presets: [],
  }
  let tenantId = ''
  const tx = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(tenantId, fn, app)

  beforeAll(async () => {
    await resetTestDatabase()
    const [t] = await platform.insert(tenants).values({ slug: 'import-spa', name: 'Import Spa' }).returning()
    tenantId = t!.id
    await tx((db) =>
      ensureSite(db, tenantId, {
        key: 'zen',
        name: 'Zen',
        theme: {},
        pages: [{ slug: '', title: { en: 'Home' }, data: { root: { props: {} }, content: [] } }],
      }),
    )
  })

  it('dry run previews; apply adds ONE hidden draft page (never published) with the real image URLs', async () => {
    const site = mergeImportPages([extractPage(fixture, 'https://lotusgarden.example/')])
    const ops = buildImportOps(site, { slug: 'imported', title: 'Imported site' })
    const dry = await tx((db) => runSiteEdit(db, { tenantId, ops, dryRun: true }, { schema }))
    expect(dry.ok, JSON.stringify(dry)).toBe(true)
    if (!dry.ok) return
    expect(dry.summary[0]).toBe('Added the page "Imported site" (/imported) as a draft')
    expect(await tx((db) => db.select().from(sitePages))).toHaveLength(1)

    const resolved = resolveImportImages(
      ops,
      new Map(usedImportImages(ops).map((n) => [n, `/files/img-${n}`])),
    )
    const r = await tx((db) => runSiteEdit(db, { tenantId, ops: resolved, dryRun: false }, { schema }))
    expect(r.ok).toBe(true)
    const pages = await tx((db) => listPages(db, tenantId))
    const imported = pages.find((p) => p.slug === 'imported')!
    expect(imported.publishedAt).toBeNull()
    const versions = await tx((db) =>
      db.select().from(pageVersions).where(eq(pageVersions.pageId, imported.id)),
    )
    expect(versions.map((v) => v.status)).toEqual(['draft'])
    const data = JSON.stringify(versions[0]!.data)
    expect(data).toContain('Unwind at Lotus Garden')
    expect(data).toContain('Thai massage · 60 min · AED 250')
    expect(data).toContain('/files/img-0')
    expect(data).not.toContain('import-image-')
    // Importing again to the same address is refused (slug taken), nothing half-written.
    const again = await tx((db) => runSiteEdit(db, { tenantId, ops: resolved, dryRun: false }, { schema }))
    expect(again.ok).toBe(false)
  })
})

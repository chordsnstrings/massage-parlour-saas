import { describe, expect, it } from 'vitest'
import {
  matchRedirect,
  normalizeRedirectSource,
  normalizeRedirectTarget,
  parseRedirectLines,
  REDIRECT_IMPORT_MAX_LINES,
  type RedirectRule,
  redirectChainEnd,
  redirectLoops,
  redirectPathProblem,
  redirectRequestKey,
  redirectSourceHref,
  redirectTargetKey,
} from '../src'

// R33: a spa's own redirects (old website addresses → its new pages).
const addresses = [
  'theirspa.ae',
  'www.theirspa.ae',
  'theirspa.spamanagement.co',
  'spamanagement.co/s/theirspa',
]
const opts = { addresses }
const src = (input: string) => normalizeRedirectSource(input, opts)
const dst = (input: string) => normalizeRedirectTarget(input, opts)

describe('old address (source)', () => {
  it('normalises paths: case, trailing slash, double slashes, hash', () => {
    expect(src('/Old-Page/')).toEqual({ path: '/old-page', query: '' })
    expect(src('old-page')).toEqual({ path: '/old-page', query: '' })
    expect(src('//old//page//#top')).toEqual({ error: 'old isn’t one of this spa’s addresses.' })
    expect(src('/old//page//#top')).toEqual({ path: '/old/page', query: '' })
    expect(src('  /Services/Thai%20Massage  ')).toEqual({ path: '/services/thai massage', query: '' })
  })

  it('accepts full URLs on the spa’s addresses only (any scheme, port, trailing dot)', () => {
    expect(src('https://theirspa.ae/About-Us/')).toEqual({ path: '/about-us', query: '' })
    expect(src('http://WWW.theirspa.ae./about')).toEqual({ path: '/about', query: '' })
    expect(src('http://theirspa.spamanagement.co:3000/about')).toEqual({ path: '/about', query: '' })
    expect(src('theirspa.ae/about')).toEqual({ path: '/about', query: '' })
    // Path routing: the `/s/{slug}` prefix is the site's address, not part of the old page's.
    expect(src('https://spamanagement.co/s/theirspa/about')).toEqual({ path: '/about', query: '' })
    expect(src('https://spamanagement.co/s/other/about')).toEqual({
      error: 'spamanagement.co isn’t one of this spa’s addresses.',
    })
    expect(src('https://otherspa.ae/about')).toEqual({
      error: 'otherspa.ae isn’t one of this spa’s addresses.',
    })
    expect(src('ftp://theirspa.ae/x')).toHaveProperty('error')
  })

  it('Arabic: decoded and percent-encoded are the same address; a broken % code is refused', () => {
    const decoded = src('https://theirspa.ae/ar/عن-السبا')
    const encoded = src('/AR/%D8%B9%D9%86-%D8%A7%D9%84%D8%B3%D8%A8%D8%A7/')
    expect(decoded).toEqual({ path: '/ar/عن-السبا', query: '' })
    expect(encoded).toEqual(decoded)
    expect(redirectRequestKey('/ar/%D8%B9%D9%86-%D8%A7%D9%84%D8%B3%D8%A8%D8%A7')).toBe('/ar/عن-السبا')
    expect(src('/bad%E0%A4%A')).toEqual({ error: 'The address has a broken % code.' })
    expect(redirectRequestKey('/bad%zz')).toBeNull()
    expect(src('/a/../b')).toHaveProperty('error')
  })

  it('a literal %, ? or # in an old path survives a round trip through its link (the service re-checks it)', () => {
    for (const [encoded, path] of [
      ['/50%25-Off', '/50%-off'],
      ['/old%3Fpage', '/old?page'],
      ['/a%23b', '/a#b'],
    ] as const) {
      expect(src(encoded)).toEqual({ path, query: '' })
      expect(src(redirectSourceHref(path, ''))).toEqual({ path, query: '' })
    }
    expect(src(redirectSourceHref('/old?page', 'p=1'))).toEqual({ path: '/old?page', query: 'p=1' })
  })

  it('refuses the site’s own routes and what the proxy never sees', () => {
    for (const path of [
      '/book',
      '/Book/',
      '/book/embed',
      '/voucher/abc',
      '/robots.txt',
      '/sitemap.xml',
      '/crm-data.json',
      '/crm-enquiry',
      '/api/health',
      '/_next/static/x',
      '/files/123',
      '/.well-known/x',
      '/wp-content/logo.PNG',
      '/style.css',
      '/app.js',
      '/font.woff2',
    ])
      expect(src(path), path).toHaveProperty('error')
    expect(src('/book')).toEqual({ error: '/book is used by the site itself (online booking).' })
    expect(redirectPathProblem('/old.png')).toMatch(/can’t be redirected/)
    // Not static by the proxy's matcher: old pages and documents can redirect.
    for (const path of ['/old.html', '/index.php', '/menu.pdf', '/feed.xml', '/voucher', '/booking'])
      expect(src(path), path).toHaveProperty('path')
  })

  it('home page only with a ?query (WordPress ?p=12); params sorted, values kept', () => {
    expect(src('/')).toHaveProperty('error')
    expect(src('https://theirspa.ae/')).toHaveProperty('error')
    expect(src('https://theirspa.ae/?p=12')).toEqual({ path: '/', query: 'p=12' })
    expect(src('/shop?b=2&a=Ab&&=x')).toEqual({ path: '/shop', query: 'a=Ab&b=2' })
  })

  it('the site’s own ?lang= and _rsc are never part of an old address (a path rule keeps them)', () => {
    expect(src('https://theirspa.ae/About/?lang=ar')).toEqual({ path: '/about', query: '' })
    expect(src('/shop?lang=ar&cat=1&_rsc=x1')).toEqual({ path: '/shop', query: 'cat=1' })
    expect(src('/?p=12&lang=ar')).toEqual({ path: '/', query: 'p=12' })
    expect(src('/?lang=ar')).toHaveProperty('error')
  })
})

describe('new address (target)', () => {
  it('keeps on-site paths, query and hash; drops the trailing slash', () => {
    expect(dst('/services/')).toEqual({ to: '/services' })
    expect(dst('services')).toEqual({ to: '/services' })
    expect(dst('/')).toEqual({ to: '/' })
    expect(dst('/Services?lang=ar#prices')).toEqual({ to: '/Services?lang=ar#prices' })
    expect(dst('https://theirspa.ae/book?src=old')).toEqual({ to: '/book?src=old' })
    expect(dst('https://theirspa.ae')).toEqual({ to: '/' })
    expect(dst('/عن')).toEqual({ to: '/%D8%B9%D9%86' })
  })

  it('never another site (open redirect attempts)', () => {
    for (const evil of [
      '//evil.com',
      '//evil.com/x',
      '/\\evil.com',
      '\\\\evil.com',
      'https://evil.com',
      'https://evil.com/theirspa.ae',
      'javascript:alert(1)',
      'mailto:a@b.c',
      '/.//evil.com',
      '/ x',
      '/a\nb',
    ])
      expect(dst(evil), evil).toHaveProperty('error')
    expect(dst('https://evil.com/x')).toEqual({
      error: 'Redirects can only go to this spa’s own pages. evil.com is another site.',
    })
    // A host-like first segment that isn't ours stays a path on this site.
    expect(dst('evil.com/x')).toEqual({ to: '/evil.com/x' })
  })
})

describe('matching', () => {
  const rules = [
    { from: '/old', query: '', to: '/new' },
    { from: '/', query: 'p=12', to: '/services' },
    { from: '/shop', query: 'cat=1', to: '/services?tab=a' },
    { from: '/shop', query: 'cat=1&item=2', to: '/services/thai' },
  ]
  const hit = (key: string, search = '') => matchRedirect(rules, key, search)?.to ?? null

  it('path rules match any query; the visitor’s params carry over', () => {
    expect(hit('/old')).toBe('/new')
    expect(hit('/old', '?gclid=abc&utm_source=g')).toBe('/new?gclid=abc&utm_source=g')
    expect(hit('/missing')).toBeNull()
  })

  it('query rules: all params present, most specific wins, matched params consumed, target params win', () => {
    expect(hit('/', '?p=12')).toBe('/services')
    expect(hit('/', '?p=12&gclid=1')).toBe('/services?gclid=1')
    expect(hit('/', '?p=13')).toBeNull()
    expect(hit('/', '')).toBeNull()
    expect(hit('/shop', '?cat=1')).toBe('/services?tab=a')
    expect(hit('/shop', '?item=2&cat=1')).toBe('/services/thai')
    expect(hit('/shop', '?cat=1&tab=x&utm_medium=cpc')).toBe('/services?tab=a&utm_medium=cpc')
  })

  it('request keys normalise like stored ones', () => {
    expect(redirectRequestKey('/Old/')).toBe('/old')
    expect(redirectRequestKey('//OLD')).toBe('/old')
    expect(redirectRequestKey('')).toBe('/')
    expect(redirectTargetKey('/Services/Thai?x=1#y')).toBe('/services/thai')
  })

  it('never to itself (loops)', () => {
    expect(redirectLoops({ from: '/old', query: '', to: '/Old' })).toBe(true)
    expect(redirectLoops({ from: '/old', query: '', to: '/old?x=1' })).toBe(true)
    expect(redirectLoops({ from: '/old', query: 'p=1', to: '/old?p=1&x=2' })).toBe(true)
    expect(redirectLoops({ from: '/old', query: 'p=1', to: '/old' })).toBe(false)
    expect(matchRedirect([{ from: '/old', query: '', to: '/old' }], '/old', '')).toBeNull()
  })

  it('follows chains hop by hop and finds loops, also through carried params', () => {
    const at = (rules: RedirectRule[]) => (key: string) => rules.filter((r) => r.from === key)
    const chain = at([
      { from: '/a', query: '', to: '/b' },
      { from: '/b', query: '', to: '/c?x=1' },
    ])
    expect(redirectChainEnd(chain, '/a?gclid=1')).toBe('/c?x=1&gclid=1')
    expect(redirectChainEnd(chain, '/none')).toBe('/none')
    // `/a → /b` with `/b?x=1 → /a?x=1`: only a visitor bringing x=1 loops.
    const carried = at([
      { from: '/a', query: '', to: '/b' },
      { from: '/b', query: 'x=1', to: '/a?x=1' },
    ])
    expect(redirectChainEnd(carried, '/a')).toBe('/b')
    expect(redirectChainEnd(carried, '/a?x=1')).toBeNull()
    // Consumed params end the chain: not a loop.
    const consumed = at([
      { from: '/a', query: '', to: '/b' },
      { from: '/b', query: 'x=1', to: '/a' },
    ])
    expect(redirectChainEnd(consumed, '/a?x=1')).toBe('/b')
    const long = at(Array.from({ length: 30 }, (_, i) => ({ from: `/p${i}`, query: '', to: `/p${i + 1}` })))
    expect(redirectChainEnd(long, '/p0')).toBeNull()
    expect(redirectChainEnd(long, '/p0', 40)).toBe('/p30')
  })

  it('links to the old address', () => {
    expect(redirectSourceHref('/ar/عن', 'p=1')).toBe('/ar/%D8%B9%D9%86?p=1')
    expect(redirectSourceHref('/a b', '')).toBe('/a%20b')
  })
})

describe('import lines', () => {
  const parse = (text: string, defaultTarget = '/') => parseRedirectLines(text, { addresses, defaultTarget })

  it('Search Console CSV export: header skipped, dates ignored, one-column lines → the default target', () => {
    const { rows, errors } = parse(
      [
        'URL,Last crawled',
        'https://theirspa.ae/old-services/,2026-10-01',
        '"https://theirspa.ae/?p=12",2026-09-30',
        'https://www.theirspa.ae/about-us',
        '',
        '# a note',
        'https://elsewhere.com/x,2026-09-01',
      ].join('\r\n'),
      '/services',
    )
    expect(rows).toEqual([
      { line: 2, from: '/old-services', query: '', to: '/services' },
      { line: 3, from: '/', query: 'p=12', to: '/services' },
      { line: 4, from: '/about-us', query: '', to: '/services' },
    ])
    expect(errors).toEqual([
      {
        line: 7,
        text: 'https://elsewhere.com/x,2026-09-01',
        error: 'elsewhere.com isn’t one of this spa’s addresses.',
      },
    ])
  })

  it('two columns (tab, comma, space, arrow) use their own target; duplicates: the last line wins', () => {
    const { rows, errors } = parse(
      [
        '/a\t/one',
        '/b,/two',
        '/c /three',
        '/d -> https://theirspa.ae/four/',
        '/A/ /five',
        '/e //evil.com',
        '/f /F',
        '/book /x',
      ].join('\n'),
    )
    expect(rows.map((r) => [r.from, r.to])).toEqual([
      ['/b', '/two'],
      ['/c', '/three'],
      ['/d', '/four'],
      ['/a', '/five'],
    ])
    expect(errors.map((e) => e.line)).toEqual([6, 7, 8])
    expect(errors[1]!.error).toBe('The old and new address are the same.')
  })

  it('one-column lines without a default target, and the line limit', () => {
    expect(parse('/old', '').errors[0]!.error).toMatch(/Add the new address/)
    const many = Array.from({ length: REDIRECT_IMPORT_MAX_LINES + 1 }, (_, i) => `/p${i}`).join('\n')
    const capped = parse(many)
    expect(capped.rows).toEqual([])
    expect(capped.errors[0]!.error).toMatch(/At most 500 lines/)
    expect(parse(many.split('\n').slice(1).join('\n')).rows).toHaveLength(REDIRECT_IMPORT_MAX_LINES)
  })

  it('long blank runs and dotted hosts stay linear (CodeQL polynomial regex)', () => {
    const started = performance.now()
    const blanks = parse(`/old${' '.repeat(100_000)}x`)
    const dots = parse(`https://theirspa.ae${'.'.repeat(100_000)}x/old`)
    expect(performance.now() - started).toBeLessThan(500)
    expect(blanks.errors.length + blanks.rows.length).toBe(1)
    expect(dots.rows).toEqual([])
    // A trailing-dot host is still the spa's own.
    expect(parse('https://theirspa.ae./old').rows[0]).toMatchObject({ from: '/old', to: '/' })
  })
})

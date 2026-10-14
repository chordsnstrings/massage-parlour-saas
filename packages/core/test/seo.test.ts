import { describe, expect, it } from 'vitest'
import {
  geoFromMapsUrl,
  jsonLdString,
  openingHoursSpecification,
  platformJsonLd,
  robotsTxt,
  sitemapXml,
  spaJsonLd,
} from '../src/seo'

// biome-ignore lint/suspicious/noExplicitAny: assertions walk loosely typed JSON-LD
type Graph = { '@context'?: string; '@graph': Record<string, any>[] }

const BREAKOUT = 'Spa </script><script>alert(1)</script> & <!-- \u2028'

describe('jsonLdString', () => {
  it('cannot close the script tag and round-trips to the same data', () => {
    const data = { name: BREAKOUT, nested: [{ v: '</SCRIPT >' }] }
    const out = jsonLdString(data)
    expect(out).not.toMatch(/[<>&\u2028\u2029]/)
    expect(out.toLowerCase()).not.toContain('</script')
    expect(JSON.parse(out)).toEqual(data)
  })
})

describe('openingHoursSpecification', () => {
  it('groups days with the same hours, Monday first, and maps 24:00 to 23:59', () => {
    expect(
      openingHoursSpecification({
        sun: [{ open: '10:00', close: '24:00' }],
        mon: [{ open: '10:00', close: '22:00' }],
        tue: [{ open: '10:00', close: '22:00' }],
        fri: [
          { open: '09:00', close: '13:00' },
          { open: '16:00', close: '02:00' },
        ],
        sat: [{ open: '10:00:00', close: '24:00' }],
      }),
    ).toEqual([
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Monday', 'Tuesday'],
        opens: '10:00',
        closes: '22:00',
      },
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Friday'], opens: '09:00', closes: '13:00' },
      // past midnight stays as is (Google reads a close before the open as the next day)
      { '@type': 'OpeningHoursSpecification', dayOfWeek: ['Friday'], opens: '16:00', closes: '02:00' },
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek: ['Saturday', 'Sunday'],
        opens: '10:00',
        closes: '23:59',
      },
    ])
  })

  it('skips closed days, malformed and empty intervals', () => {
    expect(openingHoursSpecification({})).toEqual([])
    expect(openingHoursSpecification(null)).toEqual([])
    expect(
      openingHoursSpecification({
        mon: [],
        tue: [{ open: '25:00', close: '26:00' }],
        wed: [{ open: '10:00', close: '10:00' }],
        // biome-ignore lint/suspicious/noExplicitAny: malformed stored JSON
        thu: [{ open: 1, close: '<b>' } as any],
      }),
    ).toEqual([])
  })
})

describe('geoFromMapsUrl', () => {
  it.each([
    [
      'https://www.google.com/maps/place/X/@25.1,55.2,17z/data=!3m1!4b1!4m6!3m5!8m2!3d25.0712345!4d55.1398765',
      25.071235,
      55.139877,
    ],
    ['https://www.google.com/maps/place/Marina+Walk/@25.07,55.13,17z', 25.07, 55.13],
    ['https://google.com/maps?q=25.2048,55.2708', 25.2048, 55.2708],
    ['https://www.google.com/maps/search/?api=1&query=24.45%2C54.37', 24.45, 54.37],
  ])('reads %s', (url, latitude, longitude) => expect(geoFromMapsUrl(url)).toEqual({ latitude, longitude }))

  it.each([
    'https://maps.app.goo.gl/AbCdEf123',
    'https://www.google.com/maps/search/?api=1&query=Marina+Walk',
    'https://evil.test/maps/@25.07,55.13',
    'https://www.google.com/maps/@95.0,55.13,17z',
    null,
  ])('none in %s', (url) => expect(geoFromMapsUrl(url)).toBeNull())
})

const SERVICES = [
  {
    name: 'Swedish massage',
    description: 'Long strokes.',
    category: 'Massage',
    variants: [
      { durationMin: 60, priceAed: '350.00' },
      { durationMin: 90, priceAed: '480.50' },
    ],
  },
  {
    name: 'Secret ritual',
    description: null,
    category: null,
    variants: [{ durationMin: 60, priceAed: null }],
  },
]

describe('spaJsonLd', () => {
  const base = {
    name: 'Birch Spa',
    url: 'https://birch.ae/',
    pageUrl: 'https://birch.ae/',
    logo: 'https://birch.ae/files/logo',
    branch: {
      name: 'Main',
      address: 'Shop 4, Marina Walk, Dubai',
      mapsUrl: 'https://www.google.com/maps/place/X/@25.07,55.13,17z',
      phone: '+971 4 123 4567',
      openingHours: { mon: [{ open: '10:00', close: '22:00' }] },
    },
    services: SERVICES,
    sameAs: ['https://www.instagram.com/birchspa', 'javascript:alert(1)', null],
  }

  it('describes the spa with branch, hours, profiles and offers; prices only where shown', () => {
    const ld = spaJsonLd(base) as Graph
    expect(ld['@context']).toBe('https://schema.org')
    const [spa] = ld['@graph']
    expect(ld['@graph']).toHaveLength(1)
    expect(spa).toMatchObject({
      '@type': 'DaySpa',
      name: 'Birch Spa',
      url: 'https://birch.ae/',
      logo: 'https://birch.ae/files/logo',
      image: 'https://birch.ae/files/logo',
      telephone: '+971 4 123 4567',
      address: {
        '@type': 'PostalAddress',
        streetAddress: 'Shop 4, Marina Walk, Dubai',
        addressRegion: 'Dubai',
        addressCountry: 'AE',
      },
      geo: { '@type': 'GeoCoordinates', latitude: 25.07, longitude: 55.13 },
      hasMap: 'https://www.google.com/maps/place/X/@25.07,55.13,17z',
      priceRange: 'AED 350–480.50',
      currenciesAccepted: 'AED',
      sameAs: ['https://www.instagram.com/birchspa'],
    })
    expect(spa!.openingHoursSpecification).toHaveLength(1)
    const [priced, hidden] = spa!.hasOfferCatalog.itemListElement
    expect(priced).toMatchObject({
      '@type': 'Offer',
      price: '350',
      priceCurrency: 'AED',
      itemOffered: { '@type': 'Service', name: 'Swedish massage', category: 'Massage' },
    })
    expect(priced.priceSpecification[1]).toMatchObject({
      price: '480.50',
      referenceQuantity: { value: 90, unitCode: 'MIN' },
    })
    expect(hidden).toEqual({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Secret ritual' } })
  })

  it('all prices hidden → no price anywhere; inner pages get a breadcrumb', () => {
    const ld = spaJsonLd({
      ...base,
      pageUrl: 'https://birch.ae/services',
      pageName: 'Services',
      image: 'https://birch.ae/files/hero',
      services: [{ ...SERVICES[0]!, variants: [{ durationMin: 60, priceAed: null }] }],
    }) as Graph
    const [spa, crumbs] = ld['@graph']
    expect(spa!.priceRange).toBeUndefined()
    expect(spa!.image).toBe('https://birch.ae/files/hero')
    expect(JSON.stringify(spa)).not.toContain('price"')
    expect(crumbs).toMatchObject({
      '@type': 'BreadcrumbList',
      itemListElement: [
        { position: 1, name: 'Birch Spa', item: 'https://birch.ae/' },
        { position: 2, name: 'Services', item: 'https://birch.ae/services' },
      ],
    })
  })

  it('stays valid JSON with hostile spa text', () => {
    const out = jsonLdString(spaJsonLd({ ...base, name: BREAKOUT, branch: { address: BREAKOUT } }))
    expect(out).not.toContain('<')
    expect((JSON.parse(out) as Graph)['@graph'][0].address.streetAddress).toBe(BREAKOUT.trim())
  })
})

describe('platformJsonLd', () => {
  it('has the Organization, WebSite and SoftwareApplication with AED offers', () => {
    const ld = platformJsonLd({
      url: 'https://spamanagement.co',
      name: 'spamanagement.co',
      legalName: '1997labs',
      email: 'ask@spamanagement.co',
      logo: 'https://spamanagement.co/brand/spamanagement-logo.svg',
      description: 'Spa software',
      plans: [{ name: 'Standard', priceAed: '18000.00' }],
    }) as Graph
    expect(ld['@graph'].map((n) => n['@type'])).toEqual(['Organization', 'WebSite', 'SoftwareApplication'])
    expect(ld['@graph'][0]).toMatchObject({ legalName: '1997labs', email: 'ask@spamanagement.co' })
    expect(ld['@graph'][2]!.offers).toEqual([
      {
        '@type': 'Offer',
        name: 'Standard',
        price: '18000',
        priceCurrency: 'AED',
        url: 'https://spamanagement.co/pricing',
      },
    ])
  })
})

describe('robotsTxt + sitemapXml', () => {
  it('writes allow/disallow rules and sitemap lines', () => {
    expect(robotsTxt({ disallow: ['/book/embed'], sitemaps: ['https://a.ae/sitemap.xml'] })).toBe(
      'User-agent: *\nAllow: /\nDisallow: /book/embed\n\nSitemap: https://a.ae/sitemap.xml\n',
    )
    expect(robotsTxt({ disallowAll: true })).toBe('User-agent: *\nDisallow: /\n')
  })

  it('escapes URLs and lists hreflang alternates', () => {
    const out = sitemapXml([
      {
        url: 'https://a.ae/?x=1&y=<2>',
        lastModified: new Date('2026-10-09T00:00:00Z'),
        alternates: { en: 'https://a.ae/', ar: 'https://a.ae/?lang=ar' },
      },
    ])
    expect(out).toContain('<loc>https://a.ae/?x=1&amp;y=&lt;2&gt;</loc>')
    expect(out).toContain('<xhtml:link rel="alternate" hreflang="ar" href="https://a.ae/?lang=ar"/>')
    expect(out).toContain('<lastmod>2026-10-09T00:00:00.000Z</lastmod>')
    expect(sitemapXml([])).toContain('<urlset')
  })
})

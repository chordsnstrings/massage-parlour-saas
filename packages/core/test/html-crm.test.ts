import { describe, expect, it } from 'vitest'
import { crmFeedPath } from '../src/hosts'
import {
  buildCrmContract,
  type CrmContractSource,
  crmAddress,
  crmHours,
  crmImageUrl,
  crmJsonMemo,
  crmName,
  crmScriptJson,
  crmSlug,
  cyrb53,
  htmlCrmContractOf,
  mergeCrmContract,
  spliceCrmData,
  uaePhoneDisplay,
} from '../src/html-crm'
import { apiSecurityHeaders } from '../src/security-headers'

// biome-ignore lint/suspicious/noExplicitAny: the tests read the merged JSON freely
type Json = any

const DATA = { spa: { name: 'Design Spa' }, services: [{ id: 'a', name: 'A', price: 9 }] }
const page = (script: string, head = '') =>
  `<!doctype html><html><head><meta charset="utf-8">${head}<title>x</title></head><body><h1>Hi</h1>${script}<script>render()</script></body></html>`

describe('htmlCrmContractOf', () => {
  it('finds the literal and its exact JSON range', () => {
    const json = JSON.stringify(DATA)
    const html = page(`<script>window.CRM_DATA = ${json};</script>`)
    const found = htmlCrmContractOf(html)!
    expect(found.mode).toBe('literal')
    expect(html.slice(found.literal!.start, found.literal!.end)).toBe(json)
    expect(found.literal!.data).toEqual(DATA)
    expect(found.endpoint).toBeNull()
  })

  it('handles attributes, CRLF, whitespace and no semicolon', () => {
    const json = JSON.stringify(DATA, null, 2).replace(/\n/g, '\r\n')
    const html = page(`<script type="text/javascript" data-x=">">\r\n  window.CRM_DATA=${json}\r\n</script>`)
    const found = htmlCrmContractOf(html)!
    expect(html.slice(found.literal!.start, found.literal!.end)).toBe(json)
  })

  it('ignores comments, non-JS scripts, src scripts, invalid JSON and non-objects', () => {
    const j = JSON.stringify(DATA)
    expect(htmlCrmContractOf(page(`<!-- <script>window.CRM_DATA = ${j};</script> -->`))).toBeNull()
    expect(
      htmlCrmContractOf(page(`<script type="text/x-template">window.CRM_DATA = ${j}</script>`)),
    ).toBeNull()
    expect(htmlCrmContractOf(page(`<script src="x.js">window.CRM_DATA = ${j}</script>`))).toBeNull()
    expect(htmlCrmContractOf(page(`<script>window.CRM_DATA = {spa: {name: 'x'}};</script>`))).toBeNull()
    expect(htmlCrmContractOf(page('<script>window.CRM_DATA = [1,2];</script>'))).toBeNull()
    expect(htmlCrmContractOf(page(`<script>window.CRM_DATA = ${j}; go()</script>`))).toBeNull()
    expect(htmlCrmContractOf(page(`<textarea><script>window.CRM_DATA = ${j}</script></textarea>`))).toBeNull()
    expect(htmlCrmContractOf(page('<script>const CRM_DATA = 1</script>'))).toBeNull()
  })

  it('reads the endpoint meta (alone or with the literal) and where to inject', () => {
    const meta = '<meta name="crm-endpoint" content="crm-data.json">'
    const only = page('', meta)
    const found = htmlCrmContractOf(only)!
    expect(found).toMatchObject({ mode: 'endpoint', literal: null, endpoint: 'crm-data.json' })
    expect(only.slice(found.inject).startsWith('<script>render()')).toBe(true)
    const both = htmlCrmContractOf(page(`<script>window.CRM_DATA = ${JSON.stringify(DATA)}</script>`, meta))!
    expect(both.mode).toBe('literal')
    expect(both.endpoint).toBe('crm-data.json')
    // A meta inside a comment / script doesn't count; no script at all → right after <head>.
    expect(htmlCrmContractOf(`<html><head><!--${meta}--></head><body>CRM_DATA</body></html>`)).toBeNull()
    const noScript = `<html><head>${meta}</head><body></body></html>`
    expect(noScript.slice(htmlCrmContractOf(noScript)!.inject).startsWith(meta)).toBe(true)
  })

  it('returns null fast for designs without the contract', () => {
    expect(htmlCrmContractOf('<html><body><script>go()</script></body></html>')).toBeNull()
  })
})

describe('helpers', () => {
  it('normalises identities', () => {
    expect(crmName('  Hot oil / Balm  MASSAGE ')).toBe('hot oil balm massage')
    expect(crmName('４-hands')).toBe('4 hands')
    expect(crmSlug('Normal massage')).toBe('normal-massage')
    expect(crmName(undefined)).toBe('')
  })

  it('shows UAE numbers locally', () => {
    expect(uaePhoneDisplay('971525108633')).toBe('052 510 8633')
    expect(uaePhoneDisplay('+97125576533')).toBe('02 557 6533')
    expect(uaePhoneDisplay('447700900123')).toBe('+447700900123')
  })

  it('splits addresses', () => {
    expect(crmAddress('250 Al Meena Street, Al Zahiyah, E14, Abu Dhabi, UAE')).toEqual({
      address_line1: '250 Al Meena Street',
      address_line2: 'Al Zahiyah, E14',
      city: 'Abu Dhabi',
      country: 'UAE',
    })
    expect(crmAddress('Shop 4, Marina Walk, Dubai, United Arab Emirates').city).toBe('Dubai')
    expect(crmAddress('Somewhere 12')).toEqual({
      address_line1: 'Somewhere 12',
      address_line2: '',
      city: '',
      country: 'UAE',
    })
  })

  it('turns opening hours into seven rows', () => {
    expect(crmHours({})).toEqual([])
    const rows = crmHours({
      mon: [
        { open: '16:00', close: '22:00' },
        { open: '10:00', close: '14:00' },
      ],
      tue: [{ open: '11:00', close: '02:00' }],
      wed: [{ open: '10:00', close: '24:00' }],
    })
    expect(rows).toHaveLength(7)
    expect(rows[0]).toEqual({ day: 'mon', open: '10:00', close: '22:00', closed: false })
    expect(rows[1]).toEqual({ day: 'tue', open: '11:00', close: '02:00', closed: false })
    expect(rows[2]!.close).toBe('24:00')
    expect(rows[6]).toEqual({ day: 'sun', open: '', close: '', closed: true })
  })

  it('makes images absolute or drops them', () => {
    expect(crmImageUrl('/files/x/a.webp', 'https://app.test/')).toBe('https://app.test/files/x/a.webp')
    expect(crmImageUrl('https://cdn.test/a.jpg', 'https://app.test')).toBe('https://cdn.test/a.jpg')
    expect(crmImageUrl('javascript:alert(1)', 'https://app.test')).toBe('')
    expect(crmImageUrl('//evil.test/a', 'https://app.test')).toBe('')
    expect(crmImageUrl(null, 'https://app.test')).toBe('')
  })

  it('hashes and matches feed paths', () => {
    expect(cyrb53('a')).not.toBe(cyrb53('b'))
    expect(cyrb53('same')).toBe(cyrb53('same'))
    expect(crmFeedPath('/site/zen/crm-data.json')).toBe('data')
    expect(crmFeedPath('/domain/zen.ae/crm-enquiry')).toBe('enquiry')
    expect(crmFeedPath('/site/zen/about/crm-data.json')).toBeNull()
    expect(crmFeedPath('/marketing/crm-enquiry')).toBeNull()
    expect(apiSecurityHeaders({ https: true, surface: 'domain' })['strict-transport-security']).toBe(
      'max-age=31536000',
    )
  })
})

const source = (over: Partial<CrmContractSource> = {}): CrmContractSource => ({
  spa: { name: 'Be Relax Massage Center and Spa', logoUrl: '/files/logo/logo.png' },
  branches: [
    {
      name: 'Main',
      address: '250 Al Meena Street, Al Zahiyah, Abu Dhabi, UAE',
      mapsUrl: null,
      phone: '02 557 6533',
      whatsappE164: '971525108633',
      openingHours: { mon: [{ open: '11:00', close: '02:00' }] },
    },
  ],
  services: [
    {
      id: 'u1',
      name: { en: 'Normal massage', ar: 'مساج عادي' },
      description: null,
      category: { en: 'Massage' },
      imageUrl: null,
      variants: [
        { durationMin: 90, priceAed: '350.00' },
        { durationMin: 60, priceAed: '250.00' },
        { durationMin: 60, priceAed: '260.00' },
      ],
    },
    {
      id: 'u2',
      name: { en: 'Hidden price' },
      description: { en: 'Lovely', ar: 'جميل' },
      category: null,
      imageUrl: '/files/s/2.webp',
      variants: [{ durationMin: 45, priceAed: null }],
    },
  ],
  staff: [{ id: 's1', name: 'Maya', bio: { en: 'Thai massage\nmore', ar: '' }, photoUrl: null }],
  bookingUrl: 'https://zen.test/book',
  formEndpoint: 'https://zen.test/crm-enquiry?page=',
  filesOrigin: 'https://app.test',
  ...over,
})

describe('buildCrmContract', () => {
  it('maps the CRM to the contract', () => {
    const c = buildCrmContract(source(), { locale: 'en' })
    expect(c.spa).toMatchObject({
      name: 'Be Relax Massage Center and Spa',
      logo_on_dark: 'https://app.test/files/logo/logo.png',
      logo_on_light: 'https://app.test/files/logo/logo.png',
      timezone: 'Asia/Dubai',
      currency: 'AED',
      area_label: 'Abu Dhabi',
    })
    expect(c.contact).toEqual({
      whatsapp_number: '+971525108633',
      phones: [
        { number: '+97125576533', display: '02 557 6533', label: '', calls: true, whatsapp: false },
        { number: '+971525108633', display: '052 510 8633', label: '', calls: false, whatsapp: true },
      ],
    })
    expect(c.location.maps_url).toContain('google.com/maps/search')
    expect(c.hours[0]).toEqual({ day: 'mon', open: '11:00', close: '02:00', closed: false })
    expect(c.services[0]).toMatchObject({ name: 'Normal massage', durations: [60, 90], price: 250 })
    expect(c.services[1]).toMatchObject({ price: null, image: 'https://app.test/files/s/2.webp' })
    expect(c.staff).toEqual([{ id: 's1', name: 'Maya', specialty: 'Thai massage', photo: '' }])
    expect(c.booking).toEqual({
      url: 'https://zen.test/book',
      form_endpoint: 'https://zen.test/crm-enquiry?page=',
    })
  })

  it('uses the locale with English fallback, decimals, dedupes phones across branches', () => {
    const src = source()
    src.services[0]!.variants = [{ durationMin: 60, priceAed: '199.50' }]
    src.branches.push({ ...src.branches[0]!, name: 'Marina', phone: '052 510 8633', whatsappE164: null })
    const c = buildCrmContract(src, { locale: 'ar' })
    expect(c.services[0]!.name).toBe('مساج عادي')
    expect(c.services[0]!.price).toBe(199.5)
    expect(c.services[1]!.description).toBe('جميل')
    expect(c.staff[0]!.specialty).toBe('Thai massage')
    const mobile = c.contact.phones.find((p) => p.number === '+971525108633')!
    expect(mobile).toMatchObject({ calls: true, whatsapp: true, label: 'Main' })
    expect(c.contact.phones).toHaveLength(2)
  })
})

describe('mergeCrmContract', () => {
  const design = {
    spa: {
      name: 'Old',
      short_name: 'Be Relax',
      area_label: 'Al Zahiyah',
      logo_on_dark: 'data:dark',
      experience: [{ title: 't' }],
    },
    journey: [{ id: 'welcome' }],
    contact: {
      whatsapp_number: '+971500000000',
      whatsapp_message: 'Hello {spa}',
      phones: [{ number: '+971 2 557 6533', label: 'Landline' }],
    },
    location: {
      address_line1: 'Old street',
      address_line2: 'Old 2',
      city: 'Dubai',
      country: 'UAE',
      maps_url: 'https://maps.test/pin',
    },
    hours: [{ day: 'mon', open: '09:00', close: '10:00', closed: false }],
    booking: {
      url: null,
      label: 'Book a session',
      image: 'data:book',
      form_endpoint: 'https://designer.test/post',
    },
    services: [
      {
        id: 'normal-massage',
        name: 'Normal Massage!',
        note: 'bikini',
        image: 'data:img',
        image_alt: 'Hands',
        price: 999,
      },
      { id: 'x', name: 'Other', image: 'data:other' },
    ],
    staff: [
      { id: 'staff-01', name: '', photo: 'data:nameless' },
      { id: 'staff-02', name: 'MAYA', photo: 'data:maya', photo_alt: 'Maya smiling' },
    ],
    theme: { x: 1 },
  }

  it('CRM wins for operational keys, the design keeps its own', () => {
    const m = mergeCrmContract(design, buildCrmContract(source(), { locale: 'en' })) as Json
    expect(m.spa.name).toBe('Be Relax Massage Center and Spa')
    expect(m.spa.short_name).toBe('Be Relax')
    expect(m.spa.area_label).toBe('Al Zahiyah')
    expect(m.spa.logo_on_dark).toBe('https://app.test/files/logo/logo.png')
    expect(m.spa.experience).toBe(design.spa.experience)
    expect(m.journey).toBe(design.journey)
    expect(m.theme).toBe(design.theme)
    expect(m.contact.whatsapp_message).toBe('Hello {spa}')
    expect(m.contact.whatsapp_number).toBe('+971525108633')
    expect(m.contact.phones[0]).toMatchObject({ number: '+97125576533', label: 'Landline' })
    expect(m.location).toMatchObject({
      address_line1: '250 Al Meena Street',
      address_line2: 'Al Zahiyah',
      city: 'Abu Dhabi',
    })
    expect(m.hours[0].open).toBe('11:00')
    expect(m.booking).toEqual({
      url: 'https://zen.test/book',
      label: 'Book a session',
      image: 'data:book',
      form_endpoint: 'https://zen.test/crm-enquiry?page=',
    })
    // Matched service: design note/image/alt, CRM id/name/price/durations; the design price never shows.
    expect(m.services[0]).toMatchObject({
      id: 'u1',
      name: 'Normal massage',
      note: 'bikini',
      image: 'data:img',
      image_alt: 'Hands',
      price: 250,
      durations: [60, 90],
    })
    expect(m.services[0].match).toBeUndefined()
    // Unmatched with a CRM image: its own image + name as alt.
    expect(m.services[1]).toMatchObject({
      id: 'u2',
      note: '',
      image: 'https://app.test/files/s/2.webp',
      image_alt: 'Hidden price',
      price: null,
    })
    expect(m.services).toHaveLength(2)
    // Staff: same name only (case-insensitive) — never the nameless photo.
    expect(m.staff).toEqual([
      { id: 's1', name: 'Maya', specialty: 'Thai massage', photo: 'data:maya', photo_alt: 'Maya smiling' },
    ])
  })

  it('empty CRM values / collections keep the design', () => {
    const crm = buildCrmContract(
      source({
        services: [],
        staff: [],
        bookingUrl: null,
        formEndpoint: null,
        spa: { name: 'Other Spa', logoUrl: null },
        branches: [],
      }),
      { locale: 'en' },
    )
    const m = mergeCrmContract(design, crm) as Json
    expect(m.services).toBe(design.services)
    expect(m.staff).toBe(design.staff)
    expect(m.hours).toBe(design.hours)
    expect(m.contact.phones).toBe(design.contact.phones)
    expect(m.contact.whatsapp_number).toBe('+971500000000')
    expect(m.location).toMatchObject(design.location)
    expect(m.spa.logo_on_dark).toBe('data:dark')
    expect(m.spa.short_name).toBe('Other Spa') // "Be Relax" isn't a start of "Other Spa"
    expect(m.booking.url).toBeNull()
    expect(m.booking.form_endpoint).toBeNull() // the designer's endpoint never receives posts from the platform
  })

  it('matches services by slug id and by the Arabic name', () => {
    const src = source()
    src.services[0]!.name = { en: 'Normal-massage', ar: 'أخرى' }
    const bySlug = mergeCrmContract(design, buildCrmContract(src, { locale: 'en' })) as Json
    expect(bySlug.services[0].note).toBe('bikini')
    const ar = { ...design, services: [{ name: 'أخرى', note: 'ar note' }] }
    src.services[0]!.name = { en: 'Something', ar: 'أخرى' }
    const byAr = mergeCrmContract(ar, buildCrmContract(src, { locale: 'ar' })) as Json
    expect(byAr.services[0].note).toBe('ar note')
  })

  it('without a design gives the CRM alone (empty lists stay empty)', () => {
    const m = mergeCrmContract(null, buildCrmContract(source({ staff: [] }), { locale: 'en' })) as Json
    expect(m.staff).toEqual([])
    expect(m.services[0].note).toBe('')
    expect(JSON.stringify(m)).not.toContain('"match"')
  })
})

describe('crmScriptJson + splice', () => {
  it('is script-safe and parses back', () => {
    const v = {
      a: '</script><!-- & > \u2028\u2029',
      b: '\ud800',
      c: [1, undefined, null],
      d: undefined,
      '<k>': true,
    }
    const json = crmScriptJson(v)
    expect(json).not.toMatch(/[<>&\u2028\u2029]/)
    expect(JSON.parse(json)).toEqual(JSON.parse(JSON.stringify(v)))
    expect(json.length).toBeGreaterThan(0)
  })

  it('memoised output equals JSON.stringify + escapes', () => {
    const big = `data:image/png;base64,${'A&'.repeat(5000)}`
    const memo = crmJsonMemo()
    const shared = { image: big, list: [1, 2, { x: '<' }] }
    const first = crmScriptJson({ a: shared, n: 1 }, memo)
    const second = crmScriptJson({ a: shared, n: 2 }, memo)
    const plain = (v: unknown) =>
      JSON.stringify(v).replace(/[<>&]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)
    expect(first).toBe(plain({ a: shared, n: 1 }))
    expect(second).toBe(plain({ a: shared, n: 2 }))
    expect(memo.strings.size).toBe(1)
  })

  it('replaces only the literal range; injects for endpoint designs in frames', () => {
    const html = page(`<script>window.CRM_DATA = ${JSON.stringify(DATA)};</script>`)
    const found = htmlCrmContractOf(html)!
    const json = crmScriptJson({ spa: { name: '</script>' } })
    const out = spliceCrmData(html, found, json, { inject: false })
    expect(out.slice(0, found.literal!.start)).toBe(html.slice(0, found.literal!.start))
    expect(out.slice(found.literal!.start + json.length)).toBe(html.slice(found.literal!.end))
    const again = htmlCrmContractOf(out)!
    expect(again.literal!.data).toEqual({ spa: { name: '</script>' } })

    const ep = page('', '<meta name="crm-endpoint" content="crm-data.json">')
    const epFound = htmlCrmContractOf(ep)!
    expect(spliceCrmData(ep, epFound, '{}', { inject: false })).toBe(ep)
    const framed = spliceCrmData(ep, epFound, '{"a":1}', { inject: true })
    expect(framed).toContain('<script>window.CRM_DATA={"a":1};</script><script>render()')
  })
})

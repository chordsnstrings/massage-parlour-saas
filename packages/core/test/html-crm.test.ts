import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { crmFeedPath } from '../src/hosts'
import { overlayHtmlContent } from '../src/html-content'
import {
  afterMidnight,
  buildCrmContract,
  CRM_DEFAULTS_MAX,
  type CrmContractSource,
  contractField,
  crmAddress,
  crmContractManifest,
  crmContractVersion,
  crmDesignData,
  crmHours,
  crmImageUrl,
  crmJsonMemo,
  crmName,
  crmScriptJson,
  crmSlug,
  cyrb53,
  englishOnly,
  htmlCrmContractOf,
  isOwnDesign,
  mergeCrmContract,
  spliceCrmData,
  systemCopy,
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

  it('after midnight: small hours of a day open past midnight are on the next calendar day', () => {
    // 2026-10-16 is a Friday (Dubai).
    const late = { fri: [{ open: '11:00', close: '02:00' }], sat: [{ open: '10:00', close: '22:00' }] }
    expect(afterMidnight('2026-10-16', '00:30', late)).toEqual({
      afterMidnight: true,
      calendarDate: '2026-10-17',
    })
    expect(afterMidnight('2026-10-16', '00:00', late).afterMidnight).toBe(true) // exactly midnight
    expect(afterMidnight('2026-10-16', '01:59', late).afterMidnight).toBe(true)
    expect(afterMidnight('2026-10-16', '02:00', late).afterMidnight).toBe(false) // closed from 02:00
    expect(afterMidnight('2026-10-16', '10:30', late).afterMidnight).toBe(false) // before opening
    expect(afterMidnight('2026-10-16', '23:30', late)).toEqual({
      afterMidnight: false,
      calendarDate: '2026-10-16',
    })
    // Same-day hours: 10:00–22:00, until 24:00, closing exactly at midnight.
    expect(afterMidnight('2026-10-17', '00:30', late).afterMidnight).toBe(false)
    const midnight = { fri: [{ open: '10:00', close: '24:00' }], sat: [{ open: '10:00', close: '00:00' }] }
    expect(afterMidnight('2026-10-16', '00:00', midnight).afterMidnight).toBe(false)
    expect(afterMidnight('2026-10-17', '00:00', midnight).afterMidnight).toBe(false)
    // The day's first open – last close (as the feed shows it).
    const split = {
      fri: [
        { open: '20:00', close: '01:00' },
        { open: '10:00', close: '14:00' },
      ],
    }
    expect(afterMidnight('2026-10-16', '00:15', split).afterMidnight).toBe(true)
    // Closed that weekday, hours not set up, a bad time: the date as sent.
    expect(afterMidnight('2026-10-18', '00:30', late)).toEqual({
      afterMidnight: false,
      calendarDate: '2026-10-18',
    })
    expect(afterMidnight('2026-10-16', '00:30', {}).afterMidnight).toBe(false)
    expect(afterMidnight('2026-10-16', '00:30', null).afterMidnight).toBe(false)
    expect(afterMidnight('2026-10-16', '0:30', late).afterMidnight).toBe(false)
    // Month and year ends roll over (2026-12-31 is a Thursday).
    const thu = { thu: [{ open: '11:00', close: '02:00' }] }
    expect(afterMidnight('2026-12-31', '01:00', thu).calendarDate).toBe('2027-01-01')
    // Hours not set up (the design shows its own): before the branch cutoff is the next day, as the calendar reads it.
    expect(afterMidnight('2026-10-16', '00:30', {}, '05:00')).toEqual({
      afterMidnight: true,
      calendarDate: '2026-10-17',
    })
    expect(afterMidnight('2026-10-16', '00:00', null, '05:00:00').afterMidnight).toBe(true)
    expect(afterMidnight('2026-10-16', '05:00', {}, '05:00').afterMidnight).toBe(false)
    expect(afterMidnight('2026-10-16', '23:30', {}, '05:00').afterMidnight).toBe(false)
    expect(afterMidnight('2026-10-16', '00:30', {}, '00:00').afterMidnight).toBe(false)
    // Set-up hours win over the cutoff: same-day hours and closed weekdays keep the date.
    expect(afterMidnight('2026-10-17', '00:30', late, '05:00').afterMidnight).toBe(false)
    expect(afterMidnight('2026-10-18', '00:30', late, '05:00').afterMidnight).toBe(false)
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
    // No booking url from the CRM (owner R26 (1): booking requests, never the automatic online booking page).
    expect(c.booking).toEqual({ form_endpoint: 'https://zen.test/crm-enquiry?page=' })
  })

  it('shows a treatment in two menus once (R28)', () => {
    const src = source()
    src.services.push(
      {
        id: 'u3',
        name: { en: 'NORMAL  massage', ar: 'مساج' },
        description: { en: 'Arabic menu' },
        category: { en: 'Arabic Menu' },
        imageUrl: '/files/s/3.webp',
        variants: [
          { durationMin: 120, priceAed: '200.00' },
          { durationMin: 60, priceAed: null },
        ],
      },
      { id: 'u4', name: { en: '' }, description: null, category: null, imageUrl: null, variants: [] },
      { id: 'u5', name: { en: '' }, description: null, category: null, imageUrl: null, variants: [] },
    )
    const c = buildCrmContract(src, { locale: 'en' })
    expect(c.services.map((s) => s.id)).toEqual(['u1', 'u2', 'u4', 'u5'])
    expect(c.services[0]).toMatchObject({
      name: 'Normal massage',
      category: 'Massage',
      description: 'Arabic menu',
      durations: [60, 90, 120],
      price: 200,
      image: 'https://app.test/files/s/3.webp',
    })
    expect(c.services[0]!.match.names).toEqual(['normal massage'])
    const ar = buildCrmContract(src, { locale: 'ar' })
    expect(ar.services[0]!.match.names).toEqual(['normal massage', 'مساج عادي', 'مساج'])
    expect(src.services[0]!.variants).toHaveLength(3) // the source is never changed
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
    // The design is this spa's own ("Be Relax" names it): its dark-background logo stays; the CRM logo on light.
    expect(m.spa.logo_on_dark).toBe('data:dark')
    expect(m.spa.logo_on_light).toBe('https://app.test/files/logo/logo.png')
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
      url: null,
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

  const emptyCrm = (name: string) =>
    buildCrmContract(
      source({ services: [], staff: [], formEndpoint: null, spa: { name, logoUrl: null }, branches: [] }),
      { locale: 'en' },
    )

  it("empty CRM values / collections keep the design's own values on the spa's own design", () => {
    const m = mergeCrmContract(design, emptyCrm('Be Relax Spa')) as Json // "Be Relax" names it
    expect(m.services).toBe(design.services)
    // Staff only with "Show on website": nobody → none (the design hides its team), never the design's people.
    expect(m.staff).toEqual([])
    expect(m.hours).toBe(design.hours)
    expect(m.contact.phones).toBe(design.contact.phones)
    expect(m.contact.whatsapp_number).toBe('+971500000000')
    expect(m.location).toMatchObject(design.location)
    expect(m.spa).toMatchObject({
      logo_on_dark: 'data:dark',
      short_name: 'Be Relax',
      area_label: 'Al Zahiyah',
    })
    expect(m.booking.url).toBeNull()
    expect(m.booking.form_endpoint).toBeNull() // the designer's endpoint never receives posts from the platform
  })

  it("another spa's design with an empty CRM shows nothing of that spa (R28 D1)", () => {
    const m = mergeCrmContract(design, emptyCrm('Other Spa')) as Json
    expect(m.services).toEqual([])
    expect(m.staff).toEqual([])
    expect(m.hours).toEqual([])
    expect(m.contact.phones).toEqual([])
    expect(m.contact.whatsapp_number).toBe('')
    expect(m.contact.whatsapp_message).toBe('Hello {spa}') // design-owned keys stay
    expect(m.location).toEqual({ address_line1: '', address_line2: '', city: '', country: '', maps_url: '' })
    expect(m.spa).toMatchObject({
      name: 'Other Spa',
      short_name: 'Other Spa', // "Be Relax" isn't a start of "Other Spa"
      area_label: '',
      logo_on_dark: '',
      logo_on_light: '',
    })
    expect(m.journey).toBe(design.journey)
    // With CRM values: the CRM's area, never the design's.
    expect(
      (
        mergeCrmContract(
          design,
          buildCrmContract(source({ spa: { name: 'Zen', logoUrl: null } }), { locale: 'en' }),
        ) as Json
      ).spa.area_label,
    ).toBe('Abu Dhabi')
  })

  it("the branch's own area label wins everywhere; empty = the address city (R28 P3)", () => {
    const main = source().branches[0]!
    const labelled = (areaLabel: { en: string; ar?: string } | null) =>
      source({ branches: [{ ...main, areaLabel }] })
    const en = buildCrmContract(labelled({ en: 'Al Barsha, Dubai', ar: 'البرشاء، دبي' }), { locale: 'en' })
    expect(en.spa).toMatchObject({ area_label: 'Al Barsha, Dubai', area_explicit: true })
    expect(
      buildCrmContract(labelled({ en: 'Al Barsha, Dubai', ar: 'البرشاء، دبي' }), { locale: 'ar' }).spa
        .area_label,
    ).toBe('البرشاء، دبي')
    // No Arabic → English; blank → the city, not explicit.
    expect(buildCrmContract(labelled({ en: 'Al Barsha, Dubai' }), { locale: 'ar' }).spa.area_label).toBe(
      'Al Barsha, Dubai',
    )
    const blank = buildCrmContract(labelled({ en: '  ' }), { locale: 'en' })
    expect(blank.spa).toMatchObject({ area_label: 'Abu Dhabi', area_explicit: false })
    expect(buildCrmContract(labelled(null), { locale: 'en' }).spa.area_label).toBe('Abu Dhabi')
    // The spa's own design: an explicit label beats the design's; without one the design's finer label stays.
    const own = mergeCrmContract(design, en) as Json
    expect(own.spa.area_label).toBe('Al Barsha, Dubai')
    expect(own.spa).not.toHaveProperty('area_explicit') // internal, never sent to the page
    expect((mergeCrmContract(design, blank) as Json).spa.area_label).toBe('Al Zahiyah')
    expect((mergeCrmContract(null, en) as Json).spa).not.toHaveProperty('area_explicit')
  })

  it('leaves out staff still without a photo (R28 D2)', () => {
    const src = source({
      staff: [
        { id: 's1', name: 'Maya', bio: null, photoUrl: null }, // the design's MAYA photo
        { id: 's2', name: 'Our therapist', bio: null, photoUrl: null },
        { id: 's3', name: 'Lina', bio: null, photoUrl: '/files/l.webp' },
      ],
    })
    const m = mergeCrmContract(design, buildCrmContract(src, { locale: 'en' })) as Json
    expect(m.staff.map((s: Json) => s.id)).toEqual(['s1', 's3'])
    expect(
      (mergeCrmContract(null, buildCrmContract(src, { locale: 'en' })) as Json).staff.map((s: Json) => s.id),
    ).toEqual(['s3'])
  })

  it("another spa's design: the CRM logo in both slots, the design's booking url kept", () => {
    const other = { ...design, spa: { ...design.spa, name: 'Design Spa', short_name: 'Design' } }
    const m = mergeCrmContract(
      { ...other, booking: { ...design.booking, url: '#book' } },
      buildCrmContract(source(), { locale: 'en' }),
    ) as Json
    expect(m.spa.logo_on_dark).toBe('https://app.test/files/logo/logo.png')
    expect(m.spa.logo_on_light).toBe('https://app.test/files/logo/logo.png')
    expect(m.spa.short_name).toBe('Be Relax Massage Center and Spa')
    expect(m.booking.url).toBe('#book')
    // Own design without a dark variant: the CRM logo fills it.
    const own = { ...design, spa: { ...design.spa, logo_on_dark: '' } }
    const m2 = mergeCrmContract(own, buildCrmContract(source(), { locale: 'en' })) as Json
    expect(m2.spa.logo_on_dark).toBe('https://app.test/files/logo/logo.png')
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

  it('v1 designs merge exactly as before P5 (snapshot)', () => {
    const fixtureLiteral = htmlCrmContractOf(
      readFileSync(new URL('../../../apps/web/e2e/fixtures/crm-contract.html', import.meta.url), 'utf8'),
    )!.literal!.data
    const other = buildCrmContract(
      source({ spa: { name: 'Seaside Test Spa', logoUrl: null }, branches: [], services: [], staff: [] }),
      { locale: 'ar' },
    )
    const crm = buildCrmContract(source(), { locale: 'en' })
    const out = [
      mergeCrmContract(design, crm),
      mergeCrmContract(design, other),
      mergeCrmContract(null, crm),
      mergeCrmContract(fixtureLiteral, crm),
      mergeCrmContract(fixtureLiteral, other),
    ].map((m) => JSON.stringify(m))
    expect(out).toMatchSnapshot()
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

describe('contract v2 (R28 P5)', () => {
  const manifest = {
    version: 2,
    locales: ['en', 'ar', 'fr'],
    fields: {
      'ui.wa.*': { locales: ['en'], group: 'WhatsApp message to the spa' },
      'journey[].clip': { label: 'Video (desktop)', bogus: 1 },
      'ui.*': { group: 'Interface texts' },
      'bad key!': { label: 'x' },
      'ui.nav.book': 'not an object',
    },
    l10n: { ar: { 'ui.nav.book': 'احجز', 'journey[welcome].tags': ['هدوء'], 'ui.n': 3, 'ui.x': [1] } },
  }
  const v2 = (spa: Record<string, unknown> = {}) => ({
    contract: manifest,
    spa: { name: 'Your Spa', short_name: 'Your Spa', logo_on_dark: '', logo_on_light: '', ...spa },
    contact: { whatsapp_number: '+971500000009', phones: [{ number: '+971500000009', label: 'Design' }] },
    location: { address_line1: 'Design street', city: 'Dubai' },
    hours: [{ day: 'mon', open: '09:00', close: '10:00', closed: false }],
    services: [{ id: 'x', name: 'Design treatment' }],
    ui: { nav: { book: 'Book' } },
  })
  const empty = () =>
    buildCrmContract(
      source({
        spa: { name: 'Be Relax Massage Center and Spa', logoUrl: null },
        branches: [],
        services: [],
        staff: [],
      }),
      { locale: 'en' },
    )

  it('parses the manifest (invalid parts dropped) and reads junk as v1', () => {
    const m = crmContractManifest({ contract: manifest })!
    expect(m.version).toBe(2)
    expect(m.locales).toEqual(['en', 'ar'])
    expect(Object.keys(m.fields)).toEqual(['ui.wa.*', 'journey[].clip', 'ui.*'])
    expect(m.fields['journey[].clip']).toEqual({ label: 'Video (desktop)' })
    expect(m.l10n.ar).toEqual({ 'ui.nav.book': 'احجز', 'journey[welcome].tags': ['هدوء'] })
    expect(crmContractManifest({ contract: { version: 7 } })).toEqual({
      version: 2,
      locales: ['en'],
      fields: {},
      l10n: { ar: {} },
    })
    for (const junk of [
      null,
      'x',
      {},
      { contract: [] },
      { contract: { version: 1 } },
      { contract: { version: '2' } },
    ])
      expect(crmContractVersion(junk)).toBe(1)
    expect(crmContractVersion({ contract: manifest })).toBe(2)
  })

  it('looks fields up by exact pattern, then the longest .* prefix', () => {
    const m = crmContractManifest({ contract: manifest })
    expect(contractField(m, 'journey[welcome].clip')?.label).toBe('Video (desktop)')
    expect(contractField(m, 'ui.wa.intro')?.group).toBe('WhatsApp message to the spa')
    expect(contractField(m, 'ui.nav.book')?.group).toBe('Interface texts')
    expect(contractField(m, 'ui')).toBeNull()
    expect(contractField(null, 'ui.nav.book')).toBeNull()
    expect(englishOnly(m, 'ui.wa.intro')).toBe(true)
    expect(englishOnly(m, 'ui.nav.book')).toBe(false)
    expect(systemCopy(m, 'ui.wa.intro')).toBe(true) // English-only
    expect(systemCopy(m, 'ui.nav.book')).toBe(true) // reviewed Arabic
    expect(systemCopy(m, 'ui.nav.journey')).toBe(false) // no Arabic yet: Write texts drafts it
    expect(systemCopy(m, 'journey[welcome].tags')).toBe(false) // not ui.*
    expect(systemCopy(null, 'ui.nav.book')).toBe(false)
  })

  it('finds crm-defaults only without a literal (≤ 512 KB) and reads its version', () => {
    const defaults = (body: string) =>
      `<html><head><meta name="crm-endpoint" content="{{crm_data_url}}"><script type="application/json" id="crm-defaults">\n${body}\n</script></head><body><script>run()</script></body></html>`
    const json = JSON.stringify(v2())
    const html = defaults(json)
    const found = htmlCrmContractOf(html)!
    expect(found.mode).toBe('endpoint')
    expect(found.literal).toBeNull()
    expect(html.slice(found.defaults!.start, found.defaults!.end)).toBe(json)
    expect(found.version).toBe(2)
    expect(found.manifest?.locales).toEqual(['en', 'ar'])
    expect(crmDesignData(found)).toEqual(v2())
    expect(
      htmlCrmContractOf(defaults(JSON.stringify({ a: 'x'.repeat(CRM_DEFAULTS_MAX) })))!.defaults,
    ).toBeNull()
    expect(htmlCrmContractOf(defaults('[1]'))!.defaults).toBeNull()
    expect(htmlCrmContractOf(defaults(JSON.stringify({ spa: {} })))!.version).toBe(1)
    const both = htmlCrmContractOf(
      `${defaults(json)}<script>window.CRM_DATA = ${JSON.stringify({ spa: { name: 'L' } })};</script>`,
    )!
    expect(both.mode).toBe('literal')
    expect(both.defaults).toBeNull()
    expect(both.version).toBe(1)
    expect(crmDesignData(both)).toEqual({ spa: { name: 'L' } })
    // A JS-typed or id-less JSON script is not the defaults.
    expect(htmlCrmContractOf(html.replace('id="crm-defaults"', 'id="other"'))!.defaults).toBeNull()
  })

  it('a v2 design is never the spa’s own, even when it names the tenant (D1 empties apply)', () => {
    const d = v2({ name: 'Be Relax', short_name: 'Be Relax' })
    expect(isOwnDesign(d, 'Be Relax Massage Center and Spa')).toBe(false)
    const m = mergeCrmContract(d, empty()) as Json
    expect(m.contact.phones).toEqual([])
    expect(m.contact.whatsapp_number).toBe('')
    expect(m.location).toEqual({ address_line1: '', address_line2: '', city: '', country: '', maps_url: '' })
    expect(m.hours).toEqual([])
    expect(m.services).toEqual([])
    // The design's own short name never shows on v2 (a spa's website content only), even when it names the tenant.
    expect(m.spa.short_name).toBe('Be Relax Massage Center and Spa')
    expect(m.ui).toBe(d.ui)
    expect(m.contract).toBe(d.contract)
  })

  it('v2 logos and short name: the spa’s website content or the CRM, never the design’s own defaults', () => {
    const crm = buildCrmContract(source(), { locale: 'en' })
    const design = v2({
      logo_on_dark: 'https://cdn.test/demo-dark.png',
      logo_on_light: 'https://cdn.test/demo-light.png',
      short_name: 'Be Relax',
    })
    const m = mergeCrmContract(design, crm) as Json
    expect(m.spa.logo_on_dark).toBe('https://app.test/files/logo/logo.png')
    expect(m.spa.logo_on_light).toBe('https://app.test/files/logo/logo.png')
    expect(m.spa.short_name).toBe('Be Relax Massage Center and Spa')
    const bare = mergeCrmContract(design, empty()) as Json
    expect([bare.spa.logo_on_dark, bare.spa.logo_on_light]).toEqual(['', ''])
    // Website content: dark = the content's first, light = the CRM's first; any short name, in the page locale.
    const content = {
      v: 1 as const,
      values: [
        { path: 'spa.logo_on_dark', value: { img: 'https://cdn.test/dark.png' } },
        { path: 'spa.logo_on_light', value: { img: 'https://cdn.test/light.png' } },
        { path: 'spa.short_name', value: { t: { en: 'Noor Spa', ar: 'نور' } } },
      ],
    }
    const own = overlayHtmlContent(design, content, { locale: 'en' })
    const withCrm = mergeCrmContract(own, crm) as Json
    expect(withCrm.spa.logo_on_dark).toBe('https://cdn.test/dark.png')
    expect(withCrm.spa.logo_on_light).toBe('https://app.test/files/logo/logo.png')
    expect(withCrm.spa.short_name).toBe('Noor Spa') // not a start of the tenant name: still the spa's choice
    expect((mergeCrmContract(own, empty()) as Json).spa.logo_on_light).toBe('https://cdn.test/light.png')
    const ar = overlayHtmlContent(design, content, { locale: 'ar' })
    expect((mergeCrmContract(ar, crm, { locale: 'ar' }) as Json).spa.short_name).toBe('نور')
    // A hidden short name → the CRM name.
    const hidden = overlayHtmlContent(
      design,
      { v: 1, values: [{ path: 'spa.short_name', value: { hide: true } }] },
      { locale: 'en' },
    )
    expect((mergeCrmContract(hidden, crm) as Json).spa.short_name).toBe('Be Relax Massage Center and Spa')
  })

  it('writes the locale last for v2 designs and the CRM alone, never for v1', () => {
    const crm = buildCrmContract(source(), { locale: 'ar' })
    const d = { ...v2(), locale: 'fr' }
    const m = mergeCrmContract(d, crm, { locale: 'ar' }) as Json
    expect(m.locale).toBe('ar')
    expect(Object.keys(mergeCrmContract(v2(), crm, { locale: 'en' })).at(-1)).toBe('locale')
    expect((mergeCrmContract(null, crm, { locale: 'ar' }) as Json).locale).toBe('ar')
    const v1 = { spa: { name: 'Old', short_name: 'Be Relax' }, journey: [{ id: 'welcome' }] }
    expect('locale' in mergeCrmContract(v1, crm, { locale: 'ar' })).toBe(false)
    expect(JSON.stringify(mergeCrmContract(v1, crm, { locale: 'ar' }))).toBe(
      JSON.stringify(mergeCrmContract(v1, crm)),
    )
    expect((mergeCrmContract({ ...v1, locale: 'xx' }, crm, { locale: 'ar' }) as Json).locale).toBe('xx') // v1: as before
    expect((mergeCrmContract(d, crm) as Json).locale).toBe('fr') // no platform locale given: the data's
  })
})

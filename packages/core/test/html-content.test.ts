import { describe, expect, it } from 'vitest'
import {
  carryHtmlContent,
  contractLocaleData,
  hasHtmlContent,
  hasHtmlPageContent,
  htmlContentErrors,
  htmlContentFileIds,
  htmlContentFrom,
  htmlContentLeftovers,
  htmlContentOf,
  htmlContentParts,
  htmlContentSlots,
  htmlContentView,
  htmlDesignOwnPins,
  htmlPictureAdjustments,
  overlayHtmlContent,
} from '../src/html-content'
import { listHtmlDesignImages, listHtmlDesignTexts } from '../src/html-design'

/** Stored content from values by path (the block stores a list, see HtmlDesignContent). */
const c = (data: Record<string, unknown>) => htmlContentOf(data as never) ?? { v: 1 as const }
const FILE = '/files/0b6c8a52-1d2e-4c3f-9a8b-7c6d5e4f3a21'

/** A small BE RELAX-shaped design literal. */
const design = () => ({
  spa: {
    name: 'Be Relax',
    short_name: 'Be Relax',
    area_label: 'Al Zahiyah, Abu Dhabi',
    logo_on_dark: 'data:image/png;base64,AAAA',
    logo_on_light: 'data:image/png;base64,BBBB',
    experience: [
      { title: 'Message us', text: 'Tell us the treatment' },
      { title: 'Arrive', text: 'We greet you' },
    ],
    experience_image: 'data:image/webp;base64,CCCC',
    experience_image_alt: 'Jojoba oil',
  },
  journey: [
    {
      id: 'welcome',
      label: 'Welcome',
      image: 'data:image/webp;base64,DDDD',
      focus: '62% 0%',
      accent: '#c27b3f',
      eyebrow: '{area} · {hours}',
      title: 'Slow down. Breathe.',
      body: 'Massage, Moroccan bath and jacuzzi in the heart of Abu Dhabi, with a team that looks after every detail.',
      tags: [],
      cta: false,
      scroll: 1.35,
    },
    { id: 'book', label: 'Book', title: 'Your hour is waiting.', tags: ['Calm'], cta: true },
  ],
  contact: { whatsapp_number: '+971500000000', whatsapp_message: 'Hello {spa}', phones: [] },
  location: { city: 'Abu Dhabi' },
  hours: [],
  booking: { url: null, label: 'Book a session', image: 'data:image/webp;base64,EEEE', form_endpoint: null },
  services: [{ id: 'normal', name: 'Normal massage', note: 'n' }],
  staff: [{ id: 'staff-01', name: '', photo: 'data:image/webp;base64,FFFF' }],
})

const freeze = <T>(v: T): T => {
  if (v && typeof v === 'object') {
    for (const x of Object.values(v)) freeze(x)
    Object.freeze(v)
  }
  return v
}

describe('htmlContentSlots', () => {
  it('lists every design-owned value with its kind, never an operational key', () => {
    const slots = htmlContentSlots(design())
    const byPath = Object.fromEntries(slots.map((s) => [s.path, s.kind]))
    expect(byPath).toEqual({
      'spa.logo_on_dark': 'image',
      'spa.experience[0].title': 'text',
      'spa.experience[0].text': 'text',
      'spa.experience[1].title': 'text',
      'spa.experience[1].text': 'text',
      'spa.experience_image': 'image',
      'spa.experience_image_alt': 'text',
      'journey[welcome].label': 'text',
      'journey[welcome].image': 'image',
      'journey[welcome].focus': 'focus',
      'journey[welcome].accent': 'color',
      'journey[welcome].eyebrow': 'text',
      'journey[welcome].title': 'text',
      'journey[welcome].body': 'longtext',
      'journey[welcome].tags': 'tags',
      'journey[welcome].cta': 'bool',
      'journey[book].label': 'text',
      'journey[book].title': 'text',
      'journey[book].tags': 'tags',
      'journey[book].cta': 'bool',
      'contact.whatsapp_message': 'text',
      'booking.label': 'text',
      'booking.image': 'image',
    })
    expect(slots.find((s) => s.path === 'journey[welcome].title')).toMatchObject({
      group: 'journey[welcome]',
      key: 'title',
      value: 'Slow down. Breathe.',
    })
    expect(htmlContentSlots(null)).toEqual([])
  })

  it('addresses items by index when ids are missing or repeat', () => {
    const d = {
      journey: [
        { id: 'a', title: 'x' },
        { id: 'a', title: 'y' },
      ],
    }
    expect(htmlContentSlots(d).map((s) => s.path)).toEqual(['journey[0].title', 'journey[1].title'])
  })
})

describe('overlayHtmlContent', () => {
  it('no content → the very same object', () => {
    const d = design()
    expect(overlayHtmlContent(d, undefined, { locale: 'en' })).toBe(d)
    expect(overlayHtmlContent(d, { v: 1 }, { locale: 'en' })).toBe(d)
    expect(hasHtmlContent(c({}))).toBe(false)
  })

  it('sets values copy-on-write, by locale, and leaves the input and untouched parts as they are', () => {
    const d = freeze(design())
    const out = overlayHtmlContent(
      d,
      c({
        'journey[welcome].title': { t: { en: 'Relax in Dubai.', ar: 'استرخِ في دبي.' } },
        'journey[welcome].image': { img: FILE },
        'journey[welcome].tags': { tags: { en: ['Quiet'], ar: [] } },
        'journey[book].cta': { on: false },
        'spa.experience[1].text': { hide: true },
        'booking.label': { t: { en: 'Request a session' } },
      }),
      { locale: 'ar', filesOrigin: 'https://zen.test' },
    ) as ReturnType<typeof design>
    expect(out.journey[0]!.title).toBe('استرخِ في دبي.')
    expect(out.journey[0]!.image).toBe(`https://zen.test${FILE}`)
    expect(out.journey[0]!.tags).toEqual(['Quiet']) // empty Arabic list → English
    expect(out.journey[1]!.cta).toBe(false)
    expect(out.spa.experience[1]!.text).toBe('')
    expect(out.booking.label).toBe('Request a session') // no Arabic → English
    // Untouched subtrees keep their identity (the serializer's memo); the input is never changed.
    expect(out.services).toBe(d.services)
    expect(out.spa.experience[0]).toBe(d.spa.experience[0])
    expect(out.journey[0]!.body).toBe(d.journey[0]!.body)
    expect(d.journey[0]!.title).toBe('Slow down. Breathe.')
    // English, relative files when no origin.
    const en = overlayHtmlContent(d, c({ 'journey[welcome].image': { img: FILE } }), { locale: 'en' })
    expect((en as ReturnType<typeof design>).journey[0]!.image).toBe(FILE)
  })

  it('skips stale paths, wrong kinds, unsafe URLs and operational keys', () => {
    const d = freeze(design())
    const out = overlayHtmlContent(
      d,
      c({
        'journey[gone].title': { t: { en: 'x' } },
        'journey[welcome].cta': { t: { en: 'yes' } },
        'journey[welcome].title': { img: FILE },
        'journey[welcome].image': { img: 'javascript:alert(1)' },
        'booking.image': { img: 'data:image/png;base64,AAAA' },
        'spa.name': { t: { en: 'Other spa' } },
        'contact.phones': { tags: { en: ['050'] } },
        'services[normal].note': { t: { en: 'x' } },
        'spa.nothere': { t: { en: 'x' } },
        'spa..x': { t: { en: 'x' } },
      } as never),
      { locale: 'en' },
    )
    expect(out).toBe(d)
  })
})

describe('htmlContentErrors', () => {
  const slots = htmlContentSlots(design())
  it('accepts valid content', () => {
    expect(
      htmlContentErrors(
        c({
          'journey[welcome].title': { t: { en: 'A', ar: 'ب' } },
          'journey[welcome].image': { img: FILE },
          'journey[welcome].accent': { t: { en: '#112233' } },
          'journey[welcome].focus': { t: { en: '50% 30%' } },
          'journey[welcome].tags': { tags: { en: ['x'] } },
          'journey[book].cta': { on: true },
          'booking.image': { img: 'https://cdn.example/a.jpg' },
          'spa.experience_image': { hide: true },
        }),
        slots,
      ),
    ).toEqual([])
    expect(htmlContentErrors(undefined, slots)).toEqual([])
  })

  it('names every problem', () => {
    const errors = htmlContentErrors(
      c({
        'spa.name': { t: { en: 'x' } },
        'journey[welcome].image': { img: 'data:image/png;base64,AAAA' },
        'journey[welcome].title': { img: FILE },
        'journey[welcome].accent': { t: { en: 'red' } },
        'journey[welcome].focus': { t: { en: 'top' } },
        'journey[welcome].body': { t: { en: 'x'.repeat(2001) } },
        'journey[book].tags': { tags: { en: Array(21).fill('x') } },
      }),
      slots,
    )
    expect(errors).toHaveLength(7)
    expect(errors[0]).toBe('spa.name: not an editable part of this design')
    expect(htmlContentErrors({ v: 2 }, slots)).toEqual(['content: unknown format'])
    expect(htmlContentErrors(c({ 'booking.label': { t: { en: 'x'.repeat(200_000) } } }), slots)).toEqual([
      'content: more than 192 KB',
    ])
  })

  it('lists the platform files it uses', () => {
    expect(
      htmlContentFileIds(
        c({
          a: { img: FILE },
          b: { video: FILE.toUpperCase().replace('/FILES/', '/files/') },
          c: { t: { en: FILE } },
        }),
      ),
    ).toEqual([FILE.slice(7)])
  })
})

describe('htmlContentLeftovers', () => {
  const d = () => {
    const x = design()
    x.journey[0]!.eyebrow = 'Al Zahiyah · {hours}'
    x.journey[1]!.title = 'Call 052 510 8633 or write to hello@berelax.ae'
    x.spa.experience[0]!.text = 'Welcome to Be Relax — Test Build'
    return x
  }

  it("flags what still belongs to the design's spa on another spa's site", () => {
    const out = htmlContentLeftovers(d(), undefined, { spaName: 'last test', city: 'Dubai', arabic: false })
    expect(out.map((o) => [o.path, o.reason])).toEqual([
      ['spa.experience[0].text', 'other-spa'],
      ['journey[welcome].body', 'city'], // "… heart of Abu Dhabi …" on a Dubai spa
      ['journey[book].title', 'phone'],
    ])
  })

  it('a page text echoed with its design English (plus Arabic) is still checked', () => {
    const html = '<h1>Serenity Spa Dubai</h1>'
    const texts = listHtmlDesignTexts(html)
    const content = {
      v: 1 as const,
      texts: [{ id: texts[0]!.id, src: texts[0]!.src, t: { en: 'Serenity Spa Dubai', ar: 'سيرينيتي' } }],
    }
    const out = htmlContentLeftovers(null, content, {
      spaName: 'Lotus',
      city: 'Sharjah',
      arabic: true,
      page: { texts, images: [] },
    })
    expect(out.map((o) => [o.path, o.reason])).toContainEqual([`text:${texts[0]!.id}`, 'city'])
  })

  it("an Arabic-only value keeps the design's English, so that English is still checked", () => {
    const data = d()
    const content = htmlContentOf({
      'spa.experience[0].text': { t: { en: data.spa.experience[0]!.text, ar: 'مرحباً' } },
    })
    const out = htmlContentLeftovers(data, content, { spaName: 'last test', city: 'Dubai', arabic: true })
    expect(out.map((o) => [o.path, o.reason])).toContainEqual(['spa.experience[0].text', 'other-spa'])
  })

  it("on the spa's own design its name is fine; replaced values, English-only and stale ones", () => {
    const own = htmlContentLeftovers(d(), undefined, {
      spaName: 'Be Relax Spa',
      city: 'Abu Dhabi',
      arabic: false,
    })
    expect(own.map((o) => [o.path, o.reason])).toEqual([
      ['spa.experience[0].text', 'test'],
      ['journey[book].title', 'phone'],
    ])
    const out = htmlContentLeftovers(
      d(),
      c({
        'journey[book].title': { t: { en: 'Your hour is waiting.' } },
        'journey[welcome].body': { t: { en: 'Massage in Dubai', ar: 'مساج في دبي' } },
        'journey[gone].title': { t: { en: 'x' } },
      }),
      { spaName: 'Be Relax Spa', city: 'Abu Dhabi', arabic: true },
    )
    expect(out.map((o) => [o.path, o.reason])).toEqual([
      ['spa.experience[0].text', 'test'],
      ['journey[book].title', 'arabic'],
      ['journey[gone].title', 'stale'],
    ])
  })
})

describe('website content parts (R28 P4)', () => {
  const FILE2 = '/files/9a8b7c6d-5e4f-4a3b-9c2d-1e0f9a8b7c6d'
  const stored = {
    v: 1,
    values: [{ path: 'booking.label', value: { t: { en: 'A' } } }],
    texts: [
      { id: 'txt-0', src: 'Old', t: { en: 'New' } },
      { id: 'bad', src: '', t: { en: 'x' } },
      { id: 'txt-0', src: 'Old', t: { en: 'Newer', ar: 'أحدث' } },
    ],
    pictures: [
      { id: 'img-0', src: 's', img: FILE },
      { id: 'img-x', src: 's', img: FILE },
    ],
  }
  const text = { id: 'txt-0', src: 'Old', t: { en: 'Newer', ar: 'أحدث' } }
  const picture = { id: 'img-0', src: 's', img: FILE }

  it('parts / from / of(map, keep) keep values, texts and pictures; empty → undefined', () => {
    const parts = htmlContentParts(stored)
    expect(parts).toEqual({
      values: { 'booking.label': { t: { en: 'A' } } },
      texts: { 'txt-0': text },
      pictures: { 'img-0': picture },
    })
    expect(htmlContentFrom(parts)).toEqual({
      v: 1,
      values: [{ path: 'booking.label', value: { t: { en: 'A' } } }],
      texts: [text],
      pictures: [picture],
    })
    expect(htmlContentOf({ 'journey[book].cta': { on: true } }, stored)).toEqual({
      v: 1,
      values: [{ path: 'journey[book].cta', value: { on: true } }],
      texts: [text],
      pictures: [picture],
    })
    expect(htmlContentOf({}, stored)).toEqual({ v: 1, texts: [text], pictures: [picture] })
    expect(htmlContentOf({})).toBeUndefined()
    expect(htmlContentFrom({ values: {}, texts: {}, pictures: {} })).toBeUndefined()
    // Texts / pictures only: no CRM_DATA splice (values only), but page content.
    expect(hasHtmlContent(htmlContentOf({}, stored))).toBe(false)
    expect(hasHtmlPageContent(stored)).toBe(true)
    expect(hasHtmlPageContent(c({ a: { on: true } }))).toBe(false)
  })

  it('htmlContentErrors: texts and pictures (id format, src ≤ 300, English and / or Arabic ≤ 2000 (one not blank), duplicates, list caps, URL incl. parentheses / character references refused ($ and a pasted &amp; fine), unknown parts, 192 KB)', () => {
    const slots = htmlContentSlots(design())
    expect(
      htmlContentErrors(
        {
          v: 1,
          texts: [text, { id: 'meta-description', src: '', t: { en: 'D' } }],
          pictures: [picture, { id: 'bg-1', src: 'y', img: 'https://cdn.example/a.jpg' }],
        },
        slots,
      ),
    ).toEqual([])
    expect(htmlContentErrors({ v: 1, texts: {} }, slots)).toEqual(['content: texts must be a list'])
    expect(htmlContentErrors({ v: 1, pictures: 'x' }, slots)).toEqual(['content: pictures must be a list'])
    expect(htmlContentErrors({ v: 1, data: {}, other: [] }, slots)).toEqual([
      'content: unknown part "data"',
      'content: unknown part "other"',
    ])
    expect(
      htmlContentErrors(
        {
          v: 1,
          texts: [
            { id: 'txt-a', src: '', t: { en: 'x' } },
            { id: 'txt-1', src: 'x'.repeat(301), t: { en: 'x' } },
            { id: 'txt-2', src: '', t: { en: '  ' } },
            { id: 'txt-3', src: '', t: { en: 'x'.repeat(2001) } },
            { id: 'txt-4', src: '', t: { en: 'x', ar: 5 } },
            { id: 'txt-5', src: '', t: { en: 'x' } },
            { id: 'txt-5', src: '', t: { en: 'y' } },
            { id: 'txt-6', src: '', t: { ar: 'مرحبا' } },
            { id: 'txt-7', src: '', t: { en: '', ar: ' ' } },
            { id: 'txt-8', src: '', t: {} },
          ],
        },
        slots,
      ),
    ).toEqual([
      'text txt-a: not a page text of a design',
      "text txt-1: src must be the design text's first 300 characters",
      'text txt-2: an English or Arabic text of 1 to 2000 characters',
      'text txt-3: the English text must be at most 2000 characters',
      'text txt-4: the Arabic text must be at most 2000 characters',
      'text txt-5: set twice',
      'text txt-7: an English or Arabic text of 1 to 2000 characters',
      'text txt-8: an English or Arabic text of 1 to 2000 characters',
    ])
    expect(
      htmlContentErrors(
        {
          v: 1,
          pictures: [
            { id: 'img-a', src: '', img: FILE },
            { id: 'img-1', src: '', img: 'data:image/png;base64,AA' },
            { id: 'img-2', src: '', img: 'http://x.test/a.jpg' },
            { id: 'img-3', src: '', img: 'https://x.test/a(1).jpg' },
            { id: 'img-4', src: 'x'.repeat(301), img: FILE },
            { id: 'img-5', src: '', img: FILE },
            { id: 'img-5', src: '', img: FILE },
            { id: 'img-6', src: '', img: 'https://x.test/a$&.jpg' },
            { id: 'img-7', src: '', img: 'https://x.test/a&#41;.jpg' },
            { id: 'img-8', src: '', img: 'https://x.test/a&rpar;.jpg' },
            { id: 'img-9', src: '', img: 'https://x.test/a.jpg?w=1&h=2' },
            { id: 'img-10', src: '', img: 'https://x.test/a.jpg?w=1&amp;h=2' },
            { id: 'img-11', src: '', img: 'https://x.test/a&amp;#41;.jpg' },
          ],
        },
        slots,
      ),
    ).toEqual([
      'picture img-a: not a picture of a design',
      'picture img-1: a picture from the media library (/files/…) or an https link',
      'picture img-2: a picture from the media library (/files/…) or an https link',
      'picture img-3: a picture from the media library (/files/…) or an https link',
      "picture img-4: src must be the design picture's first 300 characters",
      'picture img-5: set twice',
      'picture img-7: a picture from the media library (/files/…) or an https link',
      'picture img-8: a picture from the media library (/files/…) or an https link',
      'picture img-11: a picture from the media library (/files/…) or an https link',
    ])
    const many = (n: number, f: (i: number) => unknown) => Array.from({ length: n }, (_, i) => f(i))
    expect(
      htmlContentErrors(
        { v: 1, texts: many(2001, (i) => ({ id: `txt-${i}`, src: '', t: { en: 'x' } })) },
        slots,
      ),
    ).toEqual(['content: more than 2000 page texts'])
    expect(
      htmlContentErrors(
        { v: 1, pictures: many(201, (i) => ({ id: `img-${i}`, src: '', img: FILE })) },
        slots,
      ),
    ).toEqual(['content: more than 200 pictures'])
    expect(
      htmlContentErrors({ v: 1, texts: [{ id: 'txt-0', src: '', t: { en: 'x'.repeat(200_000) } }] }, slots),
    ).toEqual(['content: more than 192 KB'])
  })

  it('shape-only mode (slots null) accepts stale paths', () => {
    expect(
      htmlContentErrors(
        c({ 'journey[gone].title': { t: { en: 'x' } }, 'journey[welcome].accent': { t: { en: 'red' } } }),
        null,
      ),
    ).toEqual([])
    expect(
      htmlContentErrors(
        c({ a: { img: 'data:image/png;base64,AA' }, b: { t: { en: 'x'.repeat(2001) } }, d: { nope: 1 } }),
        null,
      ),
    ).toEqual([
      'a: a picture from the media library (/files/…) or an https link',
      'b: text must be at most 2000 characters',
      'd: invalid value',
    ])
  })

  it('fileIds include pictures', () => {
    expect(
      htmlContentFileIds({
        v: 1,
        values: [{ path: 'a', value: { img: FILE } }],
        pictures: [
          { id: 'img-0', src: '', img: FILE2 },
          { id: 'img-1', src: '', img: 'https://cdn.example/a.jpg' },
        ],
      }),
    ).toEqual([FILE.slice(7), FILE2.slice(7)])
  })

  it('htmlPictureAdjustments: merge by id keeps framing; mismatched src → own entry; none → same array; http:// and data: dropped', () => {
    const images = [
      { id: 'img-0', src: 'a.jpg', x: 20, fit: 'contain' as const },
      { id: 'bg-0', src: 'h.jpg', y: 10 },
    ]
    const frozen = JSON.stringify(images)
    expect(htmlPictureAdjustments(images, undefined)).toBe(images)
    expect(
      htmlPictureAdjustments(images, {
        v: 1,
        pictures: [
          { id: 'img-1', src: 'b', img: 'http://x.test/a.jpg' },
          { id: 'img-2', src: 'c', img: 'data:image/png;base64,AA' },
        ],
      }),
    ).toBe(images)
    expect(
      htmlPictureAdjustments(images, {
        v: 1,
        pictures: [
          { id: 'img-0', src: 'a.jpg', img: FILE },
          { id: 'bg-0', src: 'other.jpg', img: 'https://cdn.example/n.jpg' },
          { id: 'img-3', src: 'd.jpg', img: FILE2 },
        ],
      }),
    ).toEqual([
      { id: 'img-0', src: 'a.jpg', x: 20, fit: 'contain', replace: FILE },
      { id: 'bg-0', src: 'h.jpg', y: 10 },
      { id: 'bg-0', src: 'other.jpg', replace: 'https://cdn.example/n.jpg' },
      { id: 'img-3', src: 'd.jpg', replace: FILE2 },
    ])
    expect(JSON.stringify(images)).toBe(frozen)
  })

  it('leftovers with page: unbound untouched texts, stale text/picture, English-only text; bound skipped', () => {
    const html =
      '<html><head><title>Be Relax Abu Dhabi</title></head><body><h1 id="spa">Be Relax</h1><p>Call 052 510 8633</p>' +
      '<p>Calm hands</p><p>Visit us in Abu Dhabi</p><img src="a.jpg" alt="x">' +
      "<script>document.getElementById('spa').textContent = ''</script></body></html>"
    const page = { texts: listHtmlDesignTexts(html), images: listHtmlDesignImages(html) }
    const content = {
      v: 1 as const,
      texts: [
        { id: 'txt-1', src: 'Call 052 510 8633', t: { en: 'Call us' } },
        { id: 'txt-9', src: 'x', t: { en: 'gone' } },
        { id: 'txt-2', src: 'changed', t: { en: 'y', ar: 'ي' } },
      ],
      pictures: [
        { id: 'img-0', src: 'a.jpg', img: FILE },
        { id: 'img-5', src: 'z', img: FILE },
      ],
    }
    const ctx = { spaName: 'last test', city: 'Dubai', arabic: true }
    const out = htmlContentLeftovers(design(), content, { ...ctx, page })
    expect(out.filter((o) => /^(?:text|picture):/.test(o.path)).map((o) => [o.path, o.reason])).toEqual([
      ['text:title', 'other-spa'],
      ['text:txt-3', 'city'],
      ['text:txt-1', 'arabic'],
      ['text:txt-9', 'stale'],
      ['text:txt-2', 'stale'],
      ['picture:img-5', 'stale'],
    ])
    expect(htmlContentLeftovers(design(), content, ctx).some((o) => o.path.includes(':'))).toBe(false)
  })

  it('leftovers with page: an Arabic-only entry still has the English design text checked; one with English replaces it', () => {
    const html =
      '<html><head><title>Rituals</title></head><body><h1>Be Relax rituals</h1><h2>Be Relax gifts</h2><p>Calm</p></body></html>'
    const page = { texts: listHtmlDesignTexts(html), images: [] }
    const content = {
      v: 1 as const,
      texts: [
        { id: 'txt-0', src: 'Be Relax rituals', t: { ar: 'طقوس' } },
        { id: 'txt-1', src: 'Be Relax gifts', t: { en: 'Our gifts', ar: 'هدايا' } },
        { id: 'txt-2', src: 'Calm', t: { en: ' ', ar: 'هدوء' } },
      ],
    }
    const out = htmlContentLeftovers(design(), content, {
      spaName: 'last test',
      city: 'Dubai',
      arabic: true,
      page,
    })
    expect(out.filter((o) => o.path.startsWith('text:')).map((o) => [o.path, o.reason])).toEqual([
      ['text:txt-0', 'other-spa'],
    ])
  })

  it('htmlContentView with a clip: clipped page texts and data values are marked cut with their full length', () => {
    const long = 'Long text '.repeat(30).trim()
    const html = `<h1>Short</h1><p>${long}</p><script>window.CRM_DATA = {"booking":{"label":"Book","note":"${long}"}}</script>`
    const v = htmlContentView(html, undefined, { clip: 160 })
    expect(v.texts.map((t) => [t.id, t.cut ?? false, t.length ?? 0, t.design.length])).toEqual([
      ['txt-0', false, 0, 5],
      ['txt-1', true, long.length, 161],
    ])
    expect(v.slots.map((x) => [x.path, x.cut ?? false, x.length ?? 0])).toEqual([
      ['booking.label', false, 0],
      ['booking.note', true, long.length],
    ])
    expect(htmlContentView(html, undefined).texts.some((t) => 'cut' in t || 'length' in t)).toBe(false)
  })

  it('htmlContentView: no literal → slots [] but texts/pictures listed; search + paging + textsTotal; data: summarised; stale', () => {
    const html =
      '<!doctype html><html><head><title>Old</title></head><body><section aria-label="Intro"><h1 id="spa">Name</h1>' +
      `<p>Hello there</p><p>Second text</p></section><img src="data:image/png;base64,${'A'.repeat(4000)}">` +
      "<div style=\"background:url(https://cdn.test/bg.jpg)\"></div><script>document.getElementById('spa').textContent = 'x'</script></body></html>"
    const content = {
      v: 1,
      values: [{ path: 'x', value: { t: { en: 'y' } } }],
      texts: [
        { id: 'txt-1', src: 'Hello there', t: { en: 'Hi', ar: 'مرحبا' } },
        { id: 'txt-7', src: 'gone', t: { en: 'z' } },
      ],
      pictures: [
        { id: 'bg-0', src: 'https://cdn.test/bg.jpg', img: FILE },
        { id: 'img-3', src: 'q', img: FILE },
      ],
    }
    const v = htmlContentView(html, content)
    expect(v.crmData).toBe(false)
    expect(v.slots).toEqual([])
    expect(v.texts.map((t) => [t.id, t.bound])).toEqual([
      ['title', false],
      ['attr-0', false], // the section's aria-label
      ['txt-0', true],
      ['txt-1', false],
      ['txt-2', false],
    ])
    expect(v.texts[3]).toEqual({
      id: 'txt-1',
      kind: 'text',
      tag: 'p',
      group: 'Intro',
      design: 'Hello there',
      bound: false,
      spa: { en: 'Hi', ar: 'مرحبا' },
    })
    expect(v.textsTotal).toBe(5)
    expect(v.pictures).toEqual([
      { id: 'img-0', kind: 'img', design: 'embedded image/png, 3 KB' },
      { id: 'bg-0', kind: 'bg', design: 'https://cdn.test/bg.jpg', spa: FILE },
    ])
    expect(v.stale).toEqual(['x', 'text:txt-7', 'picture:img-3'])
    expect(htmlContentView(html, content, { search: 'مرحبا' }).texts.map((t) => t.id)).toEqual(['txt-1'])
    const intro = htmlContentView(html, content, { search: 'INTRO', bound: false, start: 1, limit: 1 })
    expect([intro.textsTotal, intro.texts.map((t) => t.id)]).toEqual([3, ['txt-1']])
    const pics = htmlContentView(html, content, { part: 'pictures', clip: 10 })
    expect([pics.texts, pics.textsTotal, pics.pictures[1]?.design]).toEqual([[], 0, 'https://cd…'])
    const data = htmlContentView(
      '<p>x</p><script>window.CRM_DATA = {"booking":{"label":"Book"},"journey":[{"id":"a","title":"T"}]}</script>',
      c({ 'booking.label': { t: { en: 'Reserve' } } }),
      { part: 'data', group: 'booking' },
    )
    expect(data).toEqual({
      crmData: true,
      slots: [
        {
          path: 'booking.label',
          kind: 'text',
          group: 'booking',
          design: 'Book',
          spa: { t: { en: 'Reserve' } },
        },
      ],
      texts: [],
      textsTotal: 0,
      pictures: [],
      stale: [],
    })
  })
})

describe('contract v2 content (R28 P5)', () => {
  /** A neutral v2 design (BE RELAX v2 shaped): ids on every list, ui{}, manifest with English-only WhatsApp copy. */
  const v2 = () => ({
    contract: {
      version: 2,
      locales: ['en', 'ar'],
      fields: { 'ui.wa.*': { locales: ['en'] }, 'journey[].clip': { label: 'Video (desktop)' } },
      l10n: {
        ar: {
          'ui.nav.book': 'احجز',
          'ui.wa.intro': 'مرحبا',
          'ui.form.err_phone': 'رقم مثل 050 123 4567',
          'journey[welcome].title': 'تمهل. تنفس.',
          'journey[welcome].tags': ['هدوء'],
          'journey[welcome].cta': 'not a switch',
          'spa.name': 'اسم',
          'ui.missing': 'x',
        },
      },
    },
    spa: {
      name: 'Your Spa',
      short_name: 'Your Spa',
      area_label: '',
      logo_on_dark: '',
      logo_on_light: '',
      experience: [
        { id: 'message', title: 'Message us', text: 'Tell us the treatment' },
        { id: 'arrive', title: 'Arrive', text: 'We greet you' },
      ],
      experience_image: 'data:image/webp;base64,CCCC',
    },
    journey: [
      {
        id: 'welcome',
        image: 'data:image/webp;base64,DDDD',
        focus: '62% 0%',
        title: 'Slow down. Breathe.',
        body: 'Massage in the heart of {city}.',
        tags: ['Calm'],
        cta: false,
        clip: null,
        clipMobile: null,
      },
    ],
    contact: { whatsapp_number: '', whatsapp_message: 'Hello {spa}', phones: [] },
    location: { city: '' },
    hours: [],
    booking: { url: null, label: 'Book a session', form_endpoint: null },
    services: [],
    staff: [],
    ui: {
      nav: { book: 'Book', journey: 'Journey' },
      wa: { intro: 'Hello {spa}, I would like to book:' },
      form: { err_phone: 'A number like 050 123 4567' },
    },
  })
  const paths = (d: Record<string, unknown>) => htmlContentSlots(d).map((x) => x.path)

  it('never lists the reserved roots; spa.short_name and spa.logo_on_light are content on v2 only', () => {
    const v1 = { ...design(), contract: { version: 1 }, locale: 'en' }
    expect(paths(v1).some((p) => p.startsWith('contract') || p.startsWith('locale'))).toBe(false)
    expect(paths(v1)).not.toContain('spa.short_name')
    expect(paths(v1)).not.toContain('spa.logo_on_light')
    const d = { ...v2(), locale: 'en' }
    expect(paths(d).some((p) => p.startsWith('contract') || p === 'locale')).toBe(false)
    expect(paths(d)).toEqual(
      expect.arrayContaining(['spa.short_name', 'spa.logo_on_light', 'spa.logo_on_dark']),
    )
    expect(htmlContentSlots(d).find((x) => x.path === 'journey[welcome].clip')?.kind).toBe('video')
    const o = overlayHtmlContent(
      d,
      c({ 'contract.version': { t: { en: '1' } }, locale: { t: { en: 'ar' } } }),
      {
        locale: 'en',
      },
    )
    expect(o).toBe(d)
  })

  it('English-only fields show their English on Arabic pages', () => {
    const d = v2()
    const content = c({
      'ui.wa.intro': { t: { en: 'Hi {spa}', ar: 'مرحبا' } },
      'ui.nav.book': { t: { en: 'Reserve', ar: 'احجز الآن' } },
    })
    const ar = overlayHtmlContent(d, content, { locale: 'ar' }) as typeof d
    expect(ar.ui.wa.intro).toBe('Hi {spa}')
    expect(ar.ui.nav.book).toBe('احجز الآن')
  })

  it('contractLocaleData: reviewed Arabic into its slots, copy on write; English pages, v1 and no l10n unchanged', () => {
    const d = freeze(v2())
    expect(contractLocaleData(d, 'en')).toBe(d)
    const v1 = design()
    expect(contractLocaleData(v1, 'ar')).toBe(v1)
    const none = { ...v2(), contract: { version: 2, locales: ['en'] } }
    expect(contractLocaleData(none, 'ar')).toBe(none)
    const ar = contractLocaleData(d, 'ar') as ReturnType<typeof v2>
    expect(ar).not.toBe(d)
    expect(ar.ui.nav.book).toBe('احجز')
    expect(ar.ui.nav.journey).toBe('Journey')
    expect(ar.ui.wa.intro).toBe('Hello {spa}, I would like to book:') // English-only
    expect(ar.journey[0]!.title).toBe('تمهل. تنفس.')
    expect(ar.journey[0]!.tags).toEqual(['هدوء'])
    expect(ar.journey[0]!.cta).toBe(false) // wrong kind
    expect(ar.spa.name).toBe('Your Spa') // operational
    expect(ar.spa.experience).toBe(d.spa.experience) // untouched subtrees keep their identity
    expect(d.ui.nav.book).toBe('Book')
    // Precedence (integrator decision 2026-10-13): content Arabic > l10n > content English > the design's English.
    const content = c({
      'ui.nav.book': { t: { en: 'Reserve' } }, // English only: the reviewed Arabic shows
      'journey[welcome].title': { t: { en: 'Rest', ar: 'استرح' } },
      'journey[welcome].tags': { tags: { en: ['Quiet'] } }, // tags too
      'journey[welcome].body': { t: { en: 'Massage in {city}.' } }, // no l10n: the content's English
      'ui.wa.intro': { t: { en: 'Hi {spa}' } }, // English-only field
    })
    type D = ReturnType<typeof v2>
    const page = overlayHtmlContent(ar, content, { locale: 'ar' }) as D
    expect(page.ui.nav.book).toBe('احجز')
    expect(page.journey[0]!.title).toBe('استرح')
    expect(page.journey[0]!.tags).toEqual(['هدوء'])
    expect(page.journey[0]!.body).toBe('Massage in {city}.')
    expect(page.ui.wa.intro).toBe('Hi {spa}')
    // The same without contractLocaleData first; English pages show the content's English.
    expect((overlayHtmlContent(d, content, { locale: 'ar' }) as D).ui.nav.book).toBe('احجز')
    expect((overlayHtmlContent(d, content, { locale: 'en' }) as D).ui.nav.book).toBe('Reserve')
    // The short name is a name: a spa's English one stays on Arabic pages.
    const named = { ...v2(), contract: { ...v2().contract, l10n: { ar: { 'spa.short_name': 'سبا' } } } }
    const short = c({ 'spa.short_name': { t: { en: 'Lotus' } } })
    expect(
      (overlayHtmlContent(contractLocaleData(named, 'ar'), short, { locale: 'ar' }) as D).spa.short_name,
    ).toBe('Lotus')
  })

  it('leftovers skip system copy and name no spa on v2', () => {
    const d = v2()
    d.spa.experience[0]!.text = 'Call 052 510 8633 at Your Spa'
    const out = htmlContentLeftovers(d, c({ 'ui.wa.intro': { t: { en: 'Hi' } } }), {
      spaName: 'Lotus',
      city: 'Dubai',
      arabic: true,
    })
    expect(out.map((o) => [o.path, o.reason])).toEqual([['spa.experience[message].text', 'phone']])
  })

  describe('carryHtmlContent', () => {
    const IMG_A = 'https://cdn.test/a.jpg'
    const oldHtml = `<html><head><title>Be Relax</title></head><body><nav><a href="#t">Treatments</a><a href="#b">Book</a></nav>
<h2>Our story</h2><p>Book</p><p>Book</p><img src="${IMG_A}" alt="Lounge"><p>Old only</p></body></html>`
    const newHtml = `<html><head><title>{{spa_name}}</title></head><body><header><p>New first</p></header>
<nav><a href="#t" data-crm-text="ui.nav.treatments">Treatments</a><a href="#b" data-crm-text="ui.nav.book">Book</a></nav>
<span data-crm="spa-name">Our story</span><h2>Our story</h2><p>Book</p><p>Book</p><img src="https://cdn.test/new.jpg"><img src="${IMG_A}" alt="Lounge"></body></html>`
    const newData = () => {
      const d = v2() as ReturnType<typeof v2> & { ui: { nav: Record<string, string> } }
      d.ui.nav.treatments = 'Treatments'
      return d
    }
    const ids = (h: string) => Object.fromEntries(listHtmlDesignTexts(h).map((x) => [`${x.id}`, x.text]))

    it('carries values (index → id), texts and pictures, converts bound texts and lists every drop', () => {
      const old = listHtmlDesignTexts(oldHtml)
      const id = (text: string, n = 0) => old.filter((x) => x.text === text)[n]!.id
      const content = {
        v: 1 as const,
        values: [
          { path: 'spa.experience[1].text', value: { t: { en: 'We welcome you', ar: 'نرحب بك' } } },
          { path: 'journey[welcome].clip', value: { video: FILE } },
          { path: 'journey[welcome].title', value: { img: FILE } }, // wrong kind
          { path: 'spa.experience[7].text', value: { t: { en: 'gone' } } },
          { path: 'journey[welcome].cta', value: { hide: true } },
        ],
        texts: [
          { id: id('Treatments'), src: 'Treatments', t: { ar: 'العلاجات' } }, // → ui.nav.treatments
          { id: id('Book'), src: 'Book', t: { en: 'Reserve' } }, // nav "Book" → ui.nav.book
          { id: id('Book', 1), src: 'Book', t: { en: 'Book now' } },
          { id: id('Book', 2), src: 'Book', t: { en: 'Book today' } },
          { id: id('Our story'), src: 'Our story', t: { en: 'Our way' } },
          { id: id('Old only'), src: 'Old only', t: { en: 'x' } },
          { id: 'title', src: 'Be Relax', t: { en: 'Lotus' } },
        ],
        pictures: [{ id: 'img-0', src: IMG_A, img: FILE }],
      }
      const r = carryHtmlContent(content, newData(), newHtml, oldHtml)
      const parts = htmlContentParts(r.content)
      expect(parts.values).toEqual({
        'spa.experience[arrive].text': { t: { en: 'We welcome you', ar: 'نرحب بك' } },
        'journey[welcome].clip': { video: FILE },
        'journey[welcome].cta': { hide: true },
        'ui.nav.treatments': { t: { en: 'Treatments', ar: 'العلاجات' } },
        'ui.nav.book': { t: { en: 'Reserve' } },
      })
      const fresh = ids(newHtml)
      // Paired by position among equal texts: the old first "Our story" is the new CRM-filled span (dropped as bound).
      expect(Object.values(parts.texts).map((x) => [x.id, fresh[x.id], x.t.en])).toEqual([
        ['txt-5', 'Book', 'Book now'],
        ['txt-6', 'Book', 'Book today'],
      ])
      expect(parts.pictures).toEqual({ 'img-1': { id: 'img-1', src: IMG_A, img: FILE } })
      expect(r.carried).toEqual({ values: 3, texts: 2, pictures: 1, converted: 2 })
      expect(r.dropped.map((x) => [x.part, x.key, x.reason, x.text])).toEqual([
        ['value', 'journey[welcome].title', 'kind', FILE],
        ['value', 'spa.experience[7].text', 'gone', 'gone'],
        ['text', id('Old only'), 'gone', 'x'],
        ['text', 'title', 'gone', 'Lotus'],
        ['text', id('Our story'), 'bound', 'Our way'],
      ])
      expect(htmlContentErrors(r.content, htmlContentSlots(newData()))).toEqual([])
    })

    it('without the old file pairs equal texts in id order; extra ones are ambiguous; a bound one without a slot is dropped', () => {
      const content = {
        v: 1 as const,
        values: [{ path: 'ui.nav.book', value: { t: { en: 'Set' } } }],
        texts: [
          { id: 'txt-9', src: 'Book', t: { en: 'B' } },
          { id: 'txt-3', src: 'Book', t: { en: 'A' } },
          { id: 'txt-12', src: 'Book', t: { en: 'C' } },
          { id: 'txt-13', src: 'Book', t: { en: 'D' } },
          { id: 'txt-1', src: 'Our story', t: { en: 'S' } },
        ],
      }
      const r = carryHtmlContent(content, newData(), newHtml.replace(/<h2>Our story<\/h2>/, ''))
      // Candidates "Book": the nav link (bound, ui.nav.book already set → duplicate), then two paragraphs.
      expect(r.dropped.map((x) => [x.key, x.reason])).toEqual([
        ['txt-13', 'ambiguous'],
        ['txt-3', 'duplicate'],
        ['txt-1', 'bound'],
      ])
      expect(Object.values(htmlContentParts(r.content).texts).map((x) => x.t.en)).toEqual(['B', 'C'])
      expect(htmlContentParts(r.content).values).toEqual({ 'ui.nav.book': { t: { en: 'Set' } } })
    })

    it('a design without data drops every value; nothing → no content', () => {
      const r = carryHtmlContent(c({ 'booking.label': { t: { en: 'x' } } }), null, '<p>Hi</p>')
      expect(r.content).toBeUndefined()
      expect(r.dropped).toEqual([{ part: 'value', key: 'booking.label', reason: 'gone', text: 'x' }])
      expect(carryHtmlContent(undefined, v2(), newHtml)).toEqual({
        content: undefined,
        carried: { values: 0, texts: 0, pictures: 0, converted: 0 },
        dropped: [],
      })
    })

    it('never converts a fragment (data-crm-tpl or several runs) nor a text missing the slot’s {tokens}', () => {
      const oldH = '<p>Open</p><p>Hello there</p><a>Book</a><a>Call</a><a>Go</a>'
      const newH = `<p data-crm-text="ui.hours.form_note" data-crm-tpl>Open <span data-crm="operating-days"></span>, <span data-crm="working-hours"></span></p>
<p data-crm-text="ui.nav.hello">Hello there <b>friend</b></p><a data-crm-text="ui.cta.book">Book</a>
<a data-crm-text="ui.cta.call">Call</a><a data-crm-text="ui.nav.book">Go</a>`
      const data = v2() as ReturnType<typeof v2> & Record<string, Record<string, unknown>>
      Object.assign(data.ui, {
        hours: { form_note: 'Open {days}, {hours}' },
        cta: { book: 'Book for {time}', call: 'Call {phone}' },
      })
      Object.assign(data.ui.nav, { hello: 'Hello there friend' })
      const texts = listHtmlDesignTexts(oldH).map((x, i) => ({
        id: x.id,
        src: x.src,
        t: [
          { en: 'We are open' },
          { en: 'Hi' },
          { en: 'Reserve for {time}', ar: 'احجز' }, // the Arabic lost {time}
          { en: 'Ring us' },
          { en: 'Go now', ar: 'اذهب' },
        ][i]!,
      }))
      const r = carryHtmlContent({ v: 1, texts }, data, newH, oldH)
      expect(r.dropped.map((x) => [x.text, x.reason])).toEqual([
        ['We are open', 'part'],
        ['Hi', 'part'],
        ['Reserve for {time}', 'tokens'],
        ['Ring us', 'tokens'],
      ])
      expect(htmlContentParts(r.content).values).toEqual({
        'ui.nav.book': { t: { en: 'Go now', ar: 'اذهب' } },
      })
      expect(r.carried.converted).toBe(1)
    })
  })

  describe('htmlDesignOwnPins', () => {
    const tenant = 'Be Relax Massage Center and Spa LLC'
    it('skips a text the v2 default says once its {city} / {area} / {spa} are filled with the old design’s values', () => {
      const old = design()
      old.journey[0]!.title = 'Slow down at Be Relax.'
      const fresh = v2()
      fresh.journey[0]!.body =
        'Massage, Moroccan bath and jacuzzi in the heart of {city}, with a team that looks after every detail.'
      fresh.journey[0]!.title = 'Slow down at {spa}.'
      const paths = (o: ReturnType<typeof design>) =>
        htmlDesignOwnPins(o, fresh, tenant).values.map((v) => v.path)
      expect(paths(old)).not.toContain('journey[welcome].body')
      expect(paths(old)).not.toContain('journey[welcome].title')
      old.location.city = 'Dubai' // another city: the old text differs from what the v2 default says
      old.journey[0]!.title = 'Slow down at {spa} today.'
      expect(paths(old)).toEqual(expect.arrayContaining(['journey[welcome].body', 'journey[welcome].title']))
    })

    it('pins the spa’s own v1 look onto v2 (files for embedded pictures), carried values win', () => {
      const old = design()
      old.journey[0]!.title = 'Be relaxed.'
      old.journey[0]!.image = 'data:image/webp;base64,ZZZZ'
      old.spa.experience_image = 'https://cdn.test/exp.jpg'
      old.spa.experience[1]!.text = 'We greet you warmly'
      const pins = htmlDesignOwnPins(
        old,
        v2(),
        tenant,
        c({ 'spa.experience[arrive].text': { t: { en: 'Kept' } } }),
      )
      expect(pins.files).toEqual([
        { path: 'spa.logo_on_dark', dataUrl: 'data:image/png;base64,AAAA' },
        { path: 'spa.logo_on_light', dataUrl: 'data:image/png;base64,BBBB' },
        { path: 'journey[welcome].image', dataUrl: 'data:image/webp;base64,ZZZZ' },
      ])
      // Same values (experience titles, focus, message, booking label) and ui.* / contract are never pinned.
      expect(pins.values).toEqual([
        { path: 'spa.short_name', value: { t: { en: 'Be Relax' } } },
        { path: 'spa.experience_image', value: { img: 'https://cdn.test/exp.jpg' } },
        { path: 'journey[welcome].title', value: { t: { en: 'Be relaxed.' } } },
        { path: 'journey[welcome].body', value: { t: { en: old.journey[0]!.body } } },
        { path: 'journey[welcome].tags', value: { tags: { en: [] } } },
      ])
      expect(htmlContentErrors({ v: 1, values: pins.values }, htmlContentSlots(v2()))).toEqual([])
    })

    it('only for the spa the v1 design names, and only onto v2', () => {
      expect(htmlDesignOwnPins(design(), v2(), 'Lotus Spa')).toEqual({ values: [], files: [] })
      expect(htmlDesignOwnPins(design(), design(), tenant)).toEqual({ values: [], files: [] })
      expect(htmlDesignOwnPins(v2(), v2(), 'Your Spa')).toEqual({ values: [], files: [] })
      expect(htmlDesignOwnPins(null, v2(), tenant)).toEqual({ values: [], files: [] })
    })
  })
})

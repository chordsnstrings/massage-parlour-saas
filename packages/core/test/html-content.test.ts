import { describe, expect, it } from 'vitest'
import {
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

  it('htmlContentErrors: texts and pictures (id format, src ≤ 300, en required ≤ 2000, duplicates, list caps, URL incl. parentheses refused, unknown parts, 192 KB)', () => {
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
          ],
        },
        slots,
      ),
    ).toEqual([
      'text txt-a: not a page text of a design',
      "text txt-1: src must be the design text's first 300 characters",
      'text txt-2: an English text of 1 to 2000 characters',
      'text txt-3: an English text of 1 to 2000 characters',
      'text txt-4: the Arabic text must be at most 2000 characters',
      'text txt-5: set twice',
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

  it('htmlContentView: no literal → slots [] but texts/pictures listed; search + paging + textsTotal; data: summarised; stale', () => {
    const html =
      '<!doctype html><html><head><title>Old</title></head><body><section aria-label="Intro"><h1 id="spa">Name</h1>' +
      `<p>Hello there</p><p>Second text</p></section><img src="data:image/png;base64,${'A'.repeat(4000)}">` +
      '<div style="background:url(https://cdn.test/bg.jpg)"></div><script>document.getElementById(\'spa\')</script></body></html>'
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

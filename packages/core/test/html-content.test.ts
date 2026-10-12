import { describe, expect, it } from 'vitest'
import {
  hasHtmlContent,
  htmlContentErrors,
  htmlContentFileIds,
  htmlContentSlots,
  overlayHtmlContent,
} from '../src/html-content'

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
    expect(hasHtmlContent({ v: 1, data: {} })).toBe(false)
  })

  it('sets values copy-on-write, by locale, and leaves the input and untouched parts as they are', () => {
    const d = freeze(design())
    const out = overlayHtmlContent(
      d,
      {
        v: 1,
        data: {
          'journey[welcome].title': { t: { en: 'Relax in Dubai.', ar: 'استرخِ في دبي.' } },
          'journey[welcome].image': { img: FILE },
          'journey[welcome].tags': { tags: { en: ['Quiet'], ar: [] } },
          'journey[book].cta': { on: false },
          'spa.experience[1].text': { hide: true },
          'booking.label': { t: { en: 'Request a session' } },
        },
      },
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
    const en = overlayHtmlContent(
      d,
      { v: 1, data: { 'journey[welcome].image': { img: FILE } } },
      { locale: 'en' },
    )
    expect((en as ReturnType<typeof design>).journey[0]!.image).toBe(FILE)
  })

  it('skips stale paths, wrong kinds, unsafe URLs and operational keys', () => {
    const d = freeze(design())
    const out = overlayHtmlContent(
      d,
      {
        v: 1,
        data: {
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
        } as never,
      },
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
        {
          v: 1,
          data: {
            'journey[welcome].title': { t: { en: 'A', ar: 'ب' } },
            'journey[welcome].image': { img: FILE },
            'journey[welcome].accent': { t: { en: '#112233' } },
            'journey[welcome].focus': { t: { en: '50% 30%' } },
            'journey[welcome].tags': { tags: { en: ['x'] } },
            'journey[book].cta': { on: true },
            'booking.image': { img: 'https://cdn.example/a.jpg' },
            'spa.experience_image': { hide: true },
          },
        },
        slots,
      ),
    ).toEqual([])
    expect(htmlContentErrors(undefined, slots)).toEqual([])
  })

  it('names every problem', () => {
    const errors = htmlContentErrors(
      {
        v: 1,
        data: {
          'spa.name': { t: { en: 'x' } },
          'journey[welcome].image': { img: 'data:image/png;base64,AAAA' },
          'journey[welcome].title': { img: FILE },
          'journey[welcome].accent': { t: { en: 'red' } },
          'journey[welcome].focus': { t: { en: 'top' } },
          'journey[welcome].body': { t: { en: 'x'.repeat(2001) } },
          'journey[book].tags': { tags: { en: Array(21).fill('x') } },
        },
      },
      slots,
    )
    expect(errors).toHaveLength(7)
    expect(errors[0]).toBe('spa.name: not an editable part of this design')
    expect(htmlContentErrors({ v: 2 }, slots)).toEqual(['content: unknown format'])
    expect(
      htmlContentErrors({ v: 1, data: { 'booking.label': { t: { en: 'x'.repeat(70_000) } } } }, slots),
    ).toEqual(['content: more than 64 KB'])
  })

  it('lists the platform files it uses', () => {
    expect(
      htmlContentFileIds({
        v: 1,
        data: {
          a: { img: FILE },
          b: { video: FILE.toUpperCase().replace('/FILES/', '/files/') },
          c: { t: { en: FILE } },
        },
      }),
    ).toEqual([FILE.slice(7)])
  })
})

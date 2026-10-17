import { describe, expect, it } from 'vitest'
import {
  applySiteEditOps,
  DEFAULT_FRAME,
  imageFrameVars,
  imageSrc,
  normalizeImage,
  preflight,
  resolveFrames,
  type SiteEditSchema,
  toImageProp,
  withImageSrc,
} from '../src/site-kit'

describe('image values (focal point / fit / zoom)', () => {
  it('reads legacy URLs, empty and malformed values as centred cover', () => {
    for (const v of ['/files/a.webp', '', null, undefined, 42, { nope: 1 }]) {
      expect(normalizeImage(v).frames).toEqual({ base: DEFAULT_FRAME })
    }
    expect(imageSrc('/files/a.webp')).toBe('/files/a.webp')
    expect(imageSrc({ src: '/files/b.webp', frame: {} })).toBe('/files/b.webp')
    expect(imageSrc({ nope: 1 })).toBe('')
  })

  it('clamps values and lets md inherit base, lg inherit md', () => {
    const v = {
      src: '/x',
      frame: { base: { x: 140, y: -5, fit: 'weird', zoom: 9 }, md: { x: 20 }, lg: { zoom: 1.5 } },
    }
    const [b, m, l] = resolveFrames(v)
    expect(b).toEqual({ x: 100, y: 0, fit: 'cover', zoom: 2 })
    expect(m).toEqual({ x: 20, y: 0, fit: 'cover', zoom: 2 })
    expect(l).toEqual({ x: 20, y: 0, fit: 'cover', zoom: 1.5 })
  })

  it('stores a plain URL while unframed and only real overrides otherwise', () => {
    expect(toImageProp('/x', { base: DEFAULT_FRAME })).toBe('/x')
    expect(toImageProp('/x', { base: DEFAULT_FRAME, md: DEFAULT_FRAME })).toBe('/x')
    const framed = toImageProp('/x', {
      base: { ...DEFAULT_FRAME, x: 30 },
      md: { ...DEFAULT_FRAME, x: 30 },
      lg: { ...DEFAULT_FRAME, x: 30, fit: 'contain' },
    })
    expect(framed).toEqual({
      src: '/x',
      frame: { base: { ...DEFAULT_FRAME, x: 30 }, lg: { ...DEFAULT_FRAME, x: 30, fit: 'contain' } },
    })
    expect(withImageSrc(framed, '/y')).toMatchObject({ src: '/y', frame: { base: { x: 30 } } })
    expect(withImageSrc('/x', '/y')).toBe('/y')
  })

  it('compiles CSS variables only for framed images', () => {
    expect(imageFrameVars('/x')).toEqual({})
    expect(
      imageFrameVars({
        src: '/x',
        frame: { base: { x: 20, y: 75, fit: 'contain', zoom: 1.4 }, lg: { x: 60 } },
      }),
    ).toEqual({
      '--if-b': 'contain',
      '--ip-b': '20% 75%',
      '--iz-b': '1.4',
      '--if-m': 'contain',
      '--ip-m': '20% 75%',
      '--iz-m': '1.4',
      '--if-l': 'contain',
      '--ip-l': '60% 75%',
      '--iz-l': '1.4',
    })
  })
})

describe('AI edit ops on images', () => {
  const schema: SiteEditSchema = {
    blocks: { Hero: { props: { image: { kind: 'image' } } } },
    root: {},
    theme: {},
    presets: [],
  }
  const data = (image: unknown) => ({
    root: { props: {} },
    content: [{ type: 'Hero', props: { id: 'h', image } }],
  })
  const run = (image: unknown, next: unknown) =>
    applySiteEditOps(
      { data: data(image), theme: {}, ops: [{ op: 'update', id: 'h', props: { image: next } }] },
      schema,
    )
  const imageOf = (r: ReturnType<typeof run>) => (r.ok ? r.data.content[0]?.props.image : r.errors)

  it('reframes the current photo when src is omitted and validates the frame', () => {
    expect(imageOf(run('/files/a.webp', { frame: { base: { x: 20, fit: 'contain' } } }))).toEqual({
      src: '/files/a.webp',
      frame: { base: { x: 20, y: 50, fit: 'contain', zoom: 1 } },
    })
    expect(imageOf(run('/files/a.webp', 'https://cdn.example.com/b.jpg'))).toBe(
      'https://cdn.example.com/b.jpg',
    )
    expect(run('/a', { frame: { tv: { x: 1 } } }).ok).toBe(false)
    expect(run('/a', { src: 'javascript:alert(1)' }).ok).toBe(false)
    expect(run('/a', { src: '/a', crop: 1 }).ok).toBe(false)
  })
})

describe('preflight on framed images', () => {
  it('checks the URL inside { src, frame } and keeps the framing in the https fix', () => {
    const page = {
      root: { props: {} },
      content: [
        {
          type: 'Hero',
          props: {
            id: 'h',
            image: { src: 'http://cdn.example.com/a.jpg', frame: { base: { x: 10 } } },
            imageAlt: { en: 'Room' },
          },
        },
      ],
    }
    const issues = preflight(page, {
      colors: {
        bg: '#fafaf8',
        surface: '#ffffff',
        subtle: '#f3f2ef',
        fg: '#1c1c1a',
        accent: '#a5b8ad',
        accentFg: '#ffffff',
        accentSoft: '#e8eeea',
        inverseBg: '#1c1c1a',
        inverseFg: '#fafaf8',
      },
      pages: [{ slug: '', visible: true, published: false }],
      currentSlug: '',
    })
    const insecure = issues.find((i) => i.rule === 'insecure-image')
    expect(insecure?.fix).toEqual({
      kind: 'set',
      label: 'Use https',
      value: { src: 'https://cdn.example.com/a.jpg', frame: { base: { x: 10 } } },
    })
  })
})

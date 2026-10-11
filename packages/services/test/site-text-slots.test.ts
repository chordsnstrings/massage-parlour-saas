import { describe, expect, it } from 'vitest'
import { fillTextSlots, plainText, type SiteEditSchema, textSlots } from '../src/site-kit'

const schema: SiteEditSchema = {
  blocks: {
    Section: { props: { content: { kind: 'slot' }, background: { kind: 'enum', options: ['none'] } } },
    Heading: { props: { text: { kind: 'bi' } } },
    RichText: { props: { text: { kind: 'bi', multiline: true } } },
    Hero: {
      props: {
        title: { kind: 'bi' },
        image: { kind: 'image' },
        imageAlt: { kind: 'bi' },
        buttons: { kind: 'array', item: { label: { kind: 'bi' }, href: { kind: 'text' } } },
        card: { kind: 'object', fields: { note: { kind: 'bi' } } },
      },
    },
  },
  root: { title: { kind: 'bi' }, description: { kind: 'bi', multiline: true } },
  theme: {},
  presets: [],
}

const page = () => ({
  root: { props: { title: { en: 'Home', ar: 'الرئيسية' }, description: { en: '' } } },
  content: [
    {
      type: 'Hero',
      props: {
        id: 'hero-1',
        title: { en: 'Unwind in the city' },
        image: { src: '/files/a', frame: { base: { x: 40, y: 50 } } },
        imageAlt: { en: 'Treatment room' },
        buttons: [
          { label: { en: 'Book now' }, href: '/book' },
          { label: { en: 'Call us', ar: 'اتصل بنا' }, href: 'tel:+971' },
        ],
        card: { note: { en: 'Open late' } },
      },
    },
    {
      type: 'Section',
      props: {
        id: 'sec-1',
        background: 'none',
        content: [
          { type: 'Heading', props: { id: 'h-1', text: { en: 'About us' } } },
          { type: 'RichText', props: { id: 'r-1', text: { en: 'We are calm.\n\nCome in.' } } },
        ],
      },
    },
    { type: 'GlobalSection', props: { id: 'g-1', sectionId: 'x', title: { en: 'Shared' } } },
  ],
})

describe('textSlots', () => {
  it('finds bilingual texts in root, blocks, slots, lists and objects; skips alt text, empty and unknown blocks', () => {
    const slots = textSlots(page(), schema)
    expect(slots.map((s) => s.key)).toEqual([
      'root/title',
      'hero-1/title',
      'hero-1/buttons.0.label',
      'hero-1/buttons.1.label',
      'hero-1/card.note',
      'h-1/text',
      'r-1/text',
    ])
    expect(slots.find((s) => s.key === 'r-1/text')).toMatchObject({ type: 'RichText', multiline: true })
    expect(slots.find((s) => s.key === 'hero-1/buttons.1.label')?.ar).toBe('اتصل بنا')
    expect(textSlots(page(), schema, { maxPerPage: 2 })).toHaveLength(2)
  })

  it('leaves HTML-design pages alone', () => {
    const html = {
      root: { props: { htmlDesign: true } },
      content: [{ type: 'Heading', props: { id: 'h', text: { en: 'x' } } }],
    }
    expect(textSlots(html, schema)).toEqual([])
  })
})

describe('fillTextSlots', () => {
  it('writes EN + AR into the seen slots only; everything else stays byte-identical', () => {
    const data = page()
    const slots = textSlots(data, schema)
    const r = fillTextSlots(data, slots, [
      { key: 'hero-1/title', en: 'Calm <b>starts</b>  here', ar: 'الهدوء يبدأ هنا' },
      { key: 'hero-1/buttons.0.label', en: 'Book a visit', ar: 'احجز زيارتك' },
      { key: 'r-1/text', en: 'Line one.\n\n\n\nLine   two.', ar: 'سطر.\n\nسطر.' },
      { key: 'nope/x', en: 'Unknown', ar: 'غير معروف' },
      { key: 'h-1/text', en: '   ', ar: 'فارغ' },
    ])
    expect(r.filled).toBe(3)
    expect(r.skipped).toBe(1)
    const hero = r.data.content[0]!.props as Record<string, unknown>
    expect(hero.title).toEqual({ en: 'Calm starts here', ar: 'الهدوء يبدأ هنا' })
    expect((hero.buttons as { label: unknown; href: string }[])[0]).toEqual({
      label: { en: 'Book a visit', ar: 'احجز زيارتك' },
      href: '/book',
    })
    expect(r.data.content[1]!.props.content).toMatchObject([
      { props: { text: { en: 'About us' } } },
      { props: { text: { en: 'Line one.\n\nLine two.', ar: 'سطر.\n\nسطر.' } } },
    ])
    // Images, links, alt text, styles and the shared section: unchanged.
    expect(hero.image).toEqual(data.content[0]!.props.image)
    expect(hero.imageAlt).toEqual({ en: 'Treatment room' })
    expect(r.data.content[2]).toEqual(data.content[2])
    expect(JSON.stringify(data)).toBe(JSON.stringify(page()))
  })

  it('skips a slot whose English text changed after the model saw it, and follows moved blocks by id', () => {
    const data = page()
    const slots = textSlots(data, schema)
    const now = page()
    now.content.reverse()
    // [GlobalSection, Section, Hero] now; the hero title was edited by hand meanwhile.
    ;(now.content[2]!.props as { title: { en: string } }).title.en = 'Edited by hand'
    const r = fillTextSlots(now, slots, [
      { key: 'hero-1/title', en: 'AI title', ar: 'عنوان' },
      { key: 'h-1/text', en: 'Who we are', ar: 'من نحن' },
    ])
    expect(r).toMatchObject({ filled: 1, skipped: 1 })
    expect((r.data.content[2]!.props as { title: unknown }).title).toEqual({ en: 'Edited by hand' })
    expect(JSON.stringify(r.data)).toContain('"Who we are"')
  })
})

describe('plainText', () => {
  it('strips tags and control characters, keeps {name} and caps the length', () => {
    expect(plainText('Hi <script>x</script>{name}\u0007!', false)).toBe('Hi x{name} !')
    expect(plainText('a\nb', false)).toBe('a b')
    expect(plainText('x'.repeat(500), false)).toHaveLength(200)
    expect(plainText('y'.repeat(2000), true)).toHaveLength(1500)
    // An emoji across the cap is kept whole or dropped, never split into a lone surrogate.
    const cut = plainText(`${'x'.repeat(199)}\u{1F33F}tail`, false)
    expect(cut).toBe(`${'x'.repeat(199)}\u{1F33F}`)
  })
})

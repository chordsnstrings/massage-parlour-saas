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

  it('with opts.html: content text/longtext slots + unbound page texts (title/meta included), never block, bound, image or tag slots', () => {
    const slots = textSlots(designPage(), schema, { html: design })
    expect(slots.map((s) => s.key)).toEqual([
      'd-1/content:journey[welcome].title',
      'd-1/content:journey[welcome].body',
      'd-1/text:title',
      'd-1/text:meta-description',
      'd-1/text:attr-0',
      'd-1/text:txt-0',
      'd-1/text:attr-1',
    ])
    // The spa's values over the design's (a hidden value and a stale page text: left out / the design's).
    expect(slots[0]).toMatchObject({
      type: 'HtmlDesign',
      prop: 'content:journey[welcome].title',
      en: 'Spa title',
    })
    expect(slots[0]!.ar).toBe('عنوان')
    expect(slots[1]).toMatchObject({ multiline: true, en: designData.journey[0]!.body })
    expect(slots.find((s) => s.key === 'd-1/text:txt-0')).toMatchObject({
      prop: 'text:txt-0',
      src: 'Welcome in',
      en: 'Come in',
      ar: 'تفضل',
    })
    expect(slots.find((s) => s.key === 'd-1/text:attr-1')).toMatchObject({
      src: 'A calm room',
      en: 'A calm room',
    })
    expect(slots.find((s) => s.key === 'd-1/text:meta-description')?.multiline).toBe(true)
    expect(textSlots(designPage(), schema, { html: design, maxPerPage: 2 })).toHaveLength(2)
    // Leftovers (`first`) go ahead before the cap: the last texts of a big page still make it.
    const first = new Set(['d-1/text:attr-1', 'd-1/text:txt-0', 'd-1/text:gone'])
    expect(textSlots(designPage(), schema, { html: design, maxPerPage: 3, first }).map((s) => s.key)).toEqual(
      ['d-1/text:txt-0', 'd-1/text:attr-1', 'd-1/content:journey[welcome].title'],
    )
  })
})

const designData = {
  spa: { name: 'Design Spa', tagline: 'Calm hands' },
  journey: [
    {
      id: 'welcome',
      title: 'Design title',
      body: `Long ${'words '.repeat(20)}`,
      tags: ['a', 'b'],
      image: 'https://example.com/i.jpg',
    },
  ],
}
const design = `<!doctype html><html><head><title>Design Spa</title><meta name="description" content="Calm in the city"></head><body>
<section aria-label="Story"><h2>Welcome in</h2><p id="live">Loading</p><img src="https://example.com/a.jpg" alt="A calm room"><p data-crm="spa.name">Design Spa</p></section>
<script>window.CRM_DATA = ${JSON.stringify(designData)};</script>
<script>document.getElementById('live').textContent = window.CRM_DATA.spa.tagline</script>
</body></html>`
const picture = {
  id: 'img-0',
  src: 'https://example.com/a.jpg',
  img: '/files/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e',
}
const designPage = () => ({
  root: { props: { htmlDesign: true, title: { en: 'Home' } } },
  content: [
    {
      type: 'HtmlDesign',
      props: {
        id: 'd-1',
        doc: { file: 'f', sha256: 'x', bytes: 1, chars: 1 },
        content: {
          v: 1,
          values: [
            { path: 'journey[welcome].title', value: { t: { en: 'Spa title', ar: 'عنوان' } } },
            { path: 'spa.tagline', value: { hide: true } },
          ],
          texts: [
            { id: 'txt-0', src: 'Welcome in', t: { en: 'Come in', ar: 'تفضل' } },
            { id: 'attr-1', src: 'An old alt', t: { en: 'Stale' } },
          ],
          pictures: [picture],
        },
      },
    },
    { type: 'Heading', props: { id: 'h', text: { en: 'Not on an HTML page' } } },
  ],
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

  it('with html writes values + texts (src from the design), keeps pictures; skips a changed en or a changed design text; without html skips HtmlDesign slots', () => {
    const data = designPage()
    const slots = textSlots(data, schema, { html: design })
    const drafts = [
      { key: 'd-1/content:journey[welcome].title', en: 'A <b>new</b> title', ar: 'عنوان جديد' },
      { key: 'd-1/text:attr-1', en: 'A quiet room', ar: 'غرفة هادئة' },
      { key: 'd-1/text:meta-description', en: 'Calm at our spa', ar: 'هدوء في مركزنا' },
      { key: 'd-1/text:txt-1', en: 'Bound', ar: 'مرتبط' },
    ]
    const none = fillTextSlots(data, slots, drafts)
    expect(none).toMatchObject({ filled: 0, skipped: 3 })
    expect(JSON.stringify(none.data)).toBe(JSON.stringify(designPage()))

    const r = fillTextSlots(data, slots, drafts, { html: design })
    expect(r).toMatchObject({ filled: 3, skipped: 0 })
    const content = (r.data.content[0]!.props as { content: Record<string, unknown> }).content
    expect(content.values).toEqual([
      { path: 'journey[welcome].title', value: { t: { en: 'A new title', ar: 'عنوان جديد' } } },
      { path: 'spa.tagline', value: { hide: true } },
    ])
    expect(content.texts).toEqual([
      { id: 'txt-0', src: 'Welcome in', t: { en: 'Come in', ar: 'تفضل' } },
      { id: 'attr-1', src: 'A calm room', t: { en: 'A quiet room', ar: 'غرفة هادئة' } },
      { id: 'meta-description', src: 'Calm in the city', t: { en: 'Calm at our spa', ar: 'هدوء في مركزنا' } },
    ])
    expect(content.pictures).toEqual([picture])
    expect(r.data.content[1]).toEqual(data.content[1])
    expect(JSON.stringify(data)).toBe(JSON.stringify(designPage()))

    // Edited meanwhile (the value) or a changed design (the text's src): those drafts are skipped.
    const now = designPage()
    now.content[0]!.props.content!.values![0]!.value = { t: { en: 'Edited by hand' } }
    const moved = design.replace('A calm room', 'A bright room')
    const later = fillTextSlots(now, slots, drafts, { html: moved })
    expect(later).toMatchObject({ filled: 1, skipped: 2 })
    expect(JSON.stringify(later.data)).toContain('"Calm at our spa"')
    expect(JSON.stringify(later.data)).not.toContain('A quiet room')
  })
})

describe('plainText', () => {
  it('strips tags and control characters, keeps {name} and caps the length', () => {
    expect(plainText('Hi <script>x</script>{name}\u0007!', false)).toBe('Hi x{name} !')
    // Nested / unclosed tags leave nothing tag-like behind; many '<' stay fast (linear).
    expect(plainText('<scr<script>ipt>alert(1)<img src=x', false)).toBe('scriptalert(1)img src=x')
    expect(plainText(`${'<'.repeat(50_000)}a`, false)).toBe('a')
    expect(plainText('a\nb', false)).toBe('a b')
    expect(plainText('x'.repeat(500), false)).toHaveLength(200)
    expect(plainText('y'.repeat(2000), true)).toHaveLength(1500)
    // An emoji across the cap is kept whole or dropped, never split into a lone surrogate.
    const cut = plainText(`${'x'.repeat(199)}\u{1F33F}tail`, false)
    expect(cut).toBe(`${'x'.repeat(199)}\u{1F33F}`)
  })
})

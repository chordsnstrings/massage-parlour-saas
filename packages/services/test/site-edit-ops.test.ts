import { describe, expect, it } from 'vitest'
import { applySiteEditOps, type SiteEditSchema, trimPageForPrompt } from '../src/site-kit'

const schema: SiteEditSchema = {
  blocks: {
    Section: {
      label: 'Section',
      props: {
        background: { kind: 'enum', options: ['none', 'inverse'] },
        padding: { kind: 'responsive', options: ['sm', 'md', 'lg'] },
        content: { kind: 'slot', disallow: ['WhatsAppButton'] },
      },
      defaults: { background: 'none', padding: { base: 'lg' }, content: [] },
    },
    Heading: { label: 'Heading', props: { text: { kind: 'bi' } }, defaults: { text: { en: 'Heading' } } },
    Hero: {
      label: 'Hero',
      props: {
        title: { kind: 'bi' },
        image: { kind: 'image' },
        align: { kind: 'responsive', options: ['start', 'center', 'end'] },
      },
      defaults: { title: { en: 'Welcome' }, align: { base: 'center' } },
    },
    FAQ: {
      label: 'FAQ',
      props: {
        title: { kind: 'bi' },
        items: { kind: 'array', max: 3, item: { q: { kind: 'bi' }, a: { kind: 'bi' } } },
      },
      defaults: { title: { en: 'Questions' }, items: [] },
    },
    WhatsAppButton: { label: 'WhatsApp', props: {}, defaults: {} },
  },
  root: { title: { kind: 'bi' } },
  theme: { accent: { kind: 'color' }, radius: { kind: 'enum', options: ['none', 'soft'] } },
  presets: [
    {
      key: 'cta-band',
      name: 'CTA band',
      category: 'cta',
      description: 'A call to action',
      node: {
        type: 'Section',
        props: { id: 'p', content: [{ type: 'Heading', props: { id: 'p2', text: { en: 'Book' } } }] },
      },
    },
  ],
}

const page = () => ({
  root: { props: { title: { en: 'Home' } } },
  content: [
    { type: 'Hero', props: { id: 'hero', title: { en: 'Calm', ar: 'هدوء' }, align: { base: 'center' } } },
    {
      type: 'Section',
      props: {
        id: 'sec',
        background: 'none',
        content: [{ type: 'Heading', props: { id: 'h1', text: { en: 'Services' } } }],
      },
    },
  ],
})
let n = 0
const ids = (type: string) => `${type}-new-${++n}`
const run = (ops: unknown[], data: unknown = page()) =>
  applySiteEditOps({ data, theme: { accent: '#5e7d6b', radius: 'soft' }, ops: ops as never }, schema, ids)

describe('applySiteEditOps', () => {
  it('updates bilingual text and per-device style by merging, leaving the input untouched', () => {
    const input = page()
    const r = run(
      [{ op: 'update', id: 'hero', props: { title: { ar: 'سكينة' }, align: { lg: 'start' } } }],
      input,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.content[0]!.props.title).toEqual({ en: 'Calm', ar: 'سكينة' })
    expect(r.data.content[0]!.props.align).toEqual({ base: 'center', lg: 'start' })
    expect(input.content[0]!.props.title).toEqual({ en: 'Calm', ar: 'هدوء' })
    expect(r.summary).toEqual(['Updated Hero (title, align)'])
    expect(r.theme).toBeNull()
  })

  it('adds blocks with defaults and fresh ids, inserts presets, moves and removes', () => {
    const r = run([
      {
        op: 'add',
        type: 'FAQ',
        after: 'hero',
        props: { items: [{ q: { en: 'Parking?' }, a: { en: 'Yes' } }] },
      },
      { op: 'add', type: 'Heading', into: { id: 'sec', slot: 'content' }, props: { text: 'Prices' } },
      { op: 'preset', key: 'cta-band' },
      { op: 'move', id: 'hero', before: 'sec' },
      { op: 'remove', id: 'h1' },
    ])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.content.map((c) => c.type)).toEqual(['FAQ', 'Hero', 'Section', 'Section'])
    const faq = r.data.content[0]!
    expect(faq.props.id).toMatch(/^FAQ-new-/)
    expect(faq.props.title).toEqual({ en: 'Questions' })
    const sec = r.data.content[2]!.props.content as { props: { id: string; text: unknown } }[]
    expect(sec).toHaveLength(1)
    expect(sec[0]!.props.text).toEqual({ en: 'Prices' })
    const preset = r.data.content[3]!
    expect(preset.props.id).not.toBe('p')
    expect((preset.props.content as { props: { id: string } }[])[0]!.props.id).not.toBe('p2')
    expect(r.summary[2]).toBe('Added the "CTA band" section at the end of the page')
  })

  it('applies theme tokens and page props', () => {
    const r = run([
      { op: 'theme', tokens: { accent: '#C9A227' } },
      { op: 'update', id: 'root', props: { title: { en: 'Gold spa' } } },
    ])
    expect(r.ok && r.theme).toEqual({ accent: '#c9a227', radius: 'soft' })
    expect(r.ok && r.data.root.props?.title).toEqual({ en: 'Gold spa' })
  })

  it('rejects unknown blocks, props, values, ids and disallowed placements — all or nothing', () => {
    const r = run([
      { op: 'update', id: 'hero', props: { title: { en: 'Ok' } } },
      { op: 'add', type: 'Marquee' },
      { op: 'update', id: 'hero', props: { onClick: 'x' } },
      { op: 'update', id: 'hero', props: { align: { base: 'left' } } },
      { op: 'update', id: 'hero', props: { image: 'javascript:alert(1)' } },
      { op: 'remove', id: 'nope' },
      { op: 'add', type: 'WhatsAppButton', into: { id: 'sec', slot: 'content' } },
      { op: 'theme', tokens: { accent: 'gold' } },
      { op: 'update', id: 'sec', props: { content: [] } },
      { op: 'add', type: 'FAQ', props: { items: [{}, {}, {}, {}] } },
      { op: 'publish' },
    ])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.errors).toHaveLength(10)
    expect(r.errors.join('\n')).toMatch(/unknown block "Marquee"/)
    expect(r.errors.join('\n')).toMatch(/no prop "onClick"/)
    expect(r.errors.join('\n')).toMatch(/can't go here/)
    expect(r.errors.join('\n')).toMatch(/unknown operation "publish"/)
  })

  it('refuses empty and oversized plans', () => {
    expect(run([]).ok).toBe(false)
    expect(run(Array.from({ length: 41 }, () => ({ op: 'remove', id: 'hero' }))).ok).toBe(false)
  })
})

describe('trimPageForPrompt', () => {
  it('keeps ids, types and props, clips long text, drops advanced CSS and nests slots', () => {
    const data = page()
    ;(data.content[1]!.props as Record<string, unknown>).advanced = { customCss: 'x{}' }
    ;(data.content[0]!.props.title as { en: string }).en = 'a'.repeat(400)
    const t = trimPageForPrompt(data, 100) as {
      content: { id: string; type: string; props: Record<string, unknown> }[]
    }
    expect(t.content[0]!.id).toBe('hero')
    expect((t.content[0]!.props.title as { en: string }).en).toHaveLength(101)
    expect(t.content[1]!.props.advanced).toBeUndefined()
    expect((t.content[1]!.props.content as { id: string }[])[0]!.id).toBe('h1')
  })
})

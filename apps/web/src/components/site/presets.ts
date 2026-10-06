import type { Bi } from './types'

/**
 * Section presets library (PLAN §11.2): designed sections that can be dropped into any page from the editor's
 * library panel. Each preset is a Puck content node (component type + props) built from the regular blocks, so
 * presets follow the active theme. Ids are regenerated on insert (see `instantiatePreset`).
 */
export type PresetCategory =
  | 'hero'
  | 'services'
  | 'about'
  | 'team'
  | 'offers'
  | 'social-proof'
  | 'faq'
  | 'contact'
  | 'cta'

export type PresetNode = { type: string; props: Record<string, unknown> }

export type SectionPreset = {
  key: string
  name: string
  category: PresetCategory
  description: string
  /** Template key this preset was designed for (it still works with every theme). */
  template?: string
  node: PresetNode
}

/** Page templates: whole pages added in one click (e.g. "Ramadan offers"). */
export type PageTemplate = {
  key: string
  name: string
  description: string
  slug: string
  title: Bi
  content: PresetNode[]
}

/** Deep-copies a preset node and gives it (and nested slot children) fresh ids. */
export function instantiatePreset(node: PresetNode, idPrefix: string): PresetNode {
  let n = 0
  const walk = (x: PresetNode): PresetNode => {
    const props: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(x.props)) {
      props[k] =
        Array.isArray(v) && v.every((c) => c && typeof c === 'object' && 'type' in c && 'props' in c)
          ? (v as PresetNode[]).map(walk)
          : structuredClone(v)
    }
    return { type: x.type, props: { ...props, id: `${idPrefix}-${x.type.toLowerCase()}-${++n}` } }
  }
  return walk(node)
}

const BOOK = { label: { en: 'Book now', ar: 'احجز الآن' }, action: 'book', target: '', style: 'primary' }

/** Seed presets; the full library is filled in by the templates module. */
export const SECTION_PRESETS: SectionPreset[] = [
  {
    key: 'cta-simple',
    name: 'Booking call-to-action',
    category: 'cta',
    description: 'Centered headline with a booking button.',
    node: {
      type: 'BookingCTA',
      props: {
        background: 'accent',
        padding: { base: 'lg' },
        variant: 'banner',
        title: { en: 'Ready to unwind?', ar: 'مستعد للاسترخاء؟' },
        text: { en: 'Book online in under a minute.', ar: 'احجز عبر الإنترنت في أقل من دقيقة.' },
        buttonLabel: BOOK.label,
        showWhatsApp: true,
      },
    },
  },
  {
    key: 'faq-basics',
    name: 'FAQ — the basics',
    category: 'faq',
    description: 'Booking, payment and arrival questions.',
    node: {
      type: 'FAQ',
      props: {
        title: { en: 'Good to know', ar: 'معلومات مفيدة' },
        background: 'none',
        padding: { base: 'lg' },
        width: 'contained',
        layout: 'columns',
        items: [
          {
            q: { en: 'How do I book?', ar: 'كيف أحجز؟' },
            a: {
              en: 'Online in a minute, or message us on WhatsApp.',
              ar: 'عبر الإنترنت خلال دقيقة، أو راسلنا على واتساب.',
            },
          },
          {
            q: { en: 'How do I pay?', ar: 'كيف أدفع؟' },
            a: {
              en: 'At the spa, by cash or card. Prices include VAT.',
              ar: 'في المركز نقداً أو بالبطاقة. الأسعار شاملة الضريبة.',
            },
          },
        ],
      },
    },
  },
]

export const PAGE_TEMPLATES: PageTemplate[] = []

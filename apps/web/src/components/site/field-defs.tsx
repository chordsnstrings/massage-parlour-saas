import type { CustomFieldRender, Field } from '@puckeditor/core'
import { lazy, Suspense } from 'react'
import { BilingualField, ResponsiveField } from './fields'
import type { Align, PadStep, Visibility } from './style'
import type { Bi, Responsive } from './types'

/** Puck passes these to custom field renderers; values may be undefined on blocks saved before a field existed. */
type FieldProps<V> = {
  field: { label?: string }
  name: string
  id: string
  value: V
  onChange: (value: V) => void
  readOnly?: boolean
}

// biome-ignore lint/suspicious/noExplicitAny: Puck types field values per prop; ours are checked in the renderers
type Loose = any
/** What a custom field holds, for AI editing (R16): Puck only knows them as `custom`. See `ai-schema.ts`. */
export type AiFieldMeta = { kind: 'bi' } | { kind: 'image' } | { kind: 'responsive'; options: string[] }
const custom = <V,>(
  label: string,
  render: (props: FieldProps<V | undefined>) => React.ReactElement,
  ai?: AiFieldMeta,
): Field =>
  ({
    type: 'custom',
    label,
    render: render as CustomFieldRender<Loose>,
    ai,
  }) as Field

/** Field builders shared by the blocks. Content fields are bilingual; style fields are responsive. */
export const biField = (label: string, opts: { multiline?: boolean } = {}) =>
  custom<Bi>(label, (props) => <BilingualField {...props} multiline={opts.multiline} />, { kind: 'bi' })

const responsive = <T extends string>(label: string, options: { value: T; label: string }[], fallback: T) =>
  custom<Responsive<T>>(
    label,
    (props) => <ResponsiveField<T> {...props} options={options} fallback={fallback} />,
    { kind: 'responsive', options: options.map((o) => o.value) },
  )

export const padField = (label = 'Padding') =>
  responsive<PadStep>(
    label,
    [
      { value: 'none', label: 'None' },
      { value: 'xs', label: 'XS' },
      { value: 'sm', label: 'S' },
      { value: 'md', label: 'M' },
      { value: 'lg', label: 'L' },
      { value: 'xl', label: 'XL' },
    ],
    'md',
  )

export const alignField = (label = 'Alignment') =>
  responsive<Align>(
    label,
    [
      { value: 'start', label: 'Start' },
      { value: 'center', label: 'Centre' },
      { value: 'end', label: 'End' },
    ],
    'start',
  )

export const hideField = () =>
  responsive<Visibility>(
    'Visibility',
    [
      { value: 'show', label: 'Show' },
      { value: 'hide', label: 'Hide' },
    ],
    'show',
  )

export const select = <T extends string>(label: string, options: [T, string][]): Field => ({
  type: 'select',
  label,
  options: options.map(([value, l]) => ({ value, label: l })),
})

export const radio = <T extends string | boolean>(label: string, options: [T, string][]): Field => ({
  type: 'radio',
  label,
  options: options.map(([value, l]) => ({ value, label: l })),
})

export const text = (label: string, placeholder?: string): Field => ({ type: 'text', label, placeholder })

/** Image field: preview + "Choose from library" (search, inline upload) + paste-URL fallback. Value is the URL. */
// Loaded on first render: the picker is client-only (router, server actions) and the block config must stay importable
// on its own (e.g. by the e2e structural checks).
const ImageFieldControl = lazy(() =>
  import('@/components/media/image-field').then((m) => ({ default: m.ImageFieldControl })),
)
export const imageField = (label = 'Image'): Field =>
  custom<string>(
    label,
    (props) => (
      <Suspense fallback={<div className="h-24 animate-pulse rounded-lg bg-subtle" />}>
        <ImageFieldControl {...props} />
      </Suspense>
    ),
    { kind: 'image' },
  )

export const buttonsField = (): Field => ({
  type: 'array',
  label: 'Buttons',
  max: 3,
  getItemSummary: (item: { label?: Bi }) => item.label?.en || 'Button',
  defaultItemProps: {
    label: { en: 'Book now', ar: 'احجز الآن' },
    action: 'book',
    target: '',
    style: 'primary',
  },
  arrayFields: {
    label: biField('Label'),
    action: select('Action', [
      ['book', 'Online booking'],
      ['whatsapp', 'WhatsApp'],
      ['phone', 'Call'],
      ['page', 'Go to page'],
      ['url', 'Link (URL)'],
    ]),
    target: text('Page slug or URL', 'services · https://…'),
    style: radio('Style', [
      ['primary', 'Filled'],
      ['secondary', 'Outline'],
      ['link', 'Link'],
    ]),
  },
})

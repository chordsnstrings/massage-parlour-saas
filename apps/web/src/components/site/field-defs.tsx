import type { CustomFieldRender, Field } from '@puckeditor/core'
import { ImageFieldControl } from '@/components/media/image-field'
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
const custom = <V,>(
  label: string,
  render: (props: FieldProps<V | undefined>) => React.ReactElement,
): Field => ({
  type: 'custom',
  label,
  render: render as CustomFieldRender<Loose>,
})

/** Field builders shared by the blocks. Content fields are bilingual; style fields are responsive. */
export const biField = (label: string, opts: { multiline?: boolean } = {}) =>
  custom<Bi>(label, (props) => <BilingualField {...props} multiline={opts.multiline} />)

const responsive = <T extends string>(label: string, options: { value: T; label: string }[], fallback: T) =>
  custom<Responsive<T>>(label, (props) => (
    <ResponsiveField<T> {...props} options={options} fallback={fallback} />
  ))

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
export const imageField = (label = 'Image'): Field =>
  custom<string>(label, (props) => <ImageFieldControl {...props} />)

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

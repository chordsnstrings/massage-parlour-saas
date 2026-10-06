import type { ComponentConfig, Slot } from '@puckeditor/core'
import { cn } from '@/lib/utils'
import { alignField, hideField, padField, radio, select, text } from '../field-defs'
import { type Align, type PadStep, responsiveStyle, type Visibility } from '../style'
import type { Responsive, SiteMeta } from '../types'
import { container, metaOf } from './shared'

export type Background = 'none' | 'surface' | 'subtle' | 'soft' | 'inverse' | 'accent' | 'image'
const BG: Record<Background, string> = {
  none: '',
  surface: 'sb-bg-surface',
  subtle: 'sb-bg-subtle',
  soft: 'sb-bg-soft',
  inverse: 'sb-bg-inverse',
  accent: 'sb-bg-accent',
  image: 'sb-bg-image',
}
export const backgroundField = select<Background>('Background', [
  ['none', 'Page'],
  ['surface', 'Surface'],
  ['subtle', 'Subtle'],
  ['soft', 'Accent tint'],
  ['inverse', 'Dark band'],
  ['accent', 'Accent band'],
  ['image', 'Image'],
])

export type ShellProps = {
  background: Background
  padding: Responsive<PadStep>
  hide?: Responsive<Visibility>
  width?: keyof typeof container
  bgImage?: string
  anchor?: string
}

/** Every top-level band (Section and the smart blocks) shares this shell: background, padding, width, entrance. */
export function SectionShell({
  meta,
  background,
  padding,
  hide,
  width = 'contained',
  bgImage,
  anchor,
  className,
  children,
}: ShellProps & { meta: SiteMeta; className?: string; children: React.ReactNode }) {
  const s = responsiveStyle({ padding, hide }, { editing: meta.editing, padFallback: 'lg' })
  const image = background === 'image' && bgImage
  return (
    <section
      id={anchor || undefined}
      data-reveal={meta.editing ? undefined : ''}
      {...s.attrs}
      className={cn('relative isolate', BG[background] ?? '', s.className)}
      style={s.style}
    >
      {image && (
        <>
          {/* biome-ignore lint/performance/noImgElement: tenant-provided URL, no loader configured */}
          <img src={bgImage} alt="" className="absolute inset-0 -z-10 size-full object-cover" />
          <div className="absolute inset-0 -z-10 bg-black/45" />
        </>
      )}
      <div className={cn(container[width], className)}>{children}</div>
    </section>
  )
}

const shellFields = {
  background: backgroundField,
  bgImage: text('Background image URL', 'https://…'),
  width: radio('Width', [
    ['narrow', 'Narrow'],
    ['contained', 'Contained'],
    ['full', 'Full-bleed'],
  ]),
  padding: padField('Vertical padding'),
  hide: hideField(),
  anchor: text('Anchor id', 'e.g. offers'),
}
export const shellDefaults: ShellProps = { background: 'none', padding: { base: 'lg' }, width: 'contained' }
/** Smart blocks expose the band controls too (without the background image / anchor extras). */
export const bandFields = {
  background: shellFields.background,
  padding: shellFields.padding,
  hide: shellFields.hide,
}

export const Section: ComponentConfig<ShellProps & { content: Slot; gap: 'sm' | 'md' | 'lg' }> = {
  label: 'Section',
  fields: {
    ...shellFields,
    gap: radio('Spacing', [
      ['sm', 'Tight'],
      ['md', 'Normal'],
      ['lg', 'Loose'],
    ]),
    content: { type: 'slot', disallow: ['WhatsAppButton'] },
  },
  defaultProps: { ...shellDefaults, gap: 'md', content: [] },
  render: ({ puck, content: Content, gap, ...shell }) => (
    <SectionShell meta={metaOf(puck)} {...shell}>
      <Content
        className={cn('flex flex-col', gap === 'sm' ? 'gap-4' : gap === 'lg' ? 'gap-12' : 'gap-7')}
        minEmptyHeight={96}
      />
    </SectionShell>
  ),
}

const RATIOS = {
  '1-1': 'md:grid-cols-2',
  '1-2': 'md:grid-cols-[1fr_2fr]',
  '2-1': 'md:grid-cols-[2fr_1fr]',
  '1-3': 'md:grid-cols-[1fr_3fr]',
  '3-1': 'md:grid-cols-[3fr_1fr]',
  '1-1-1': 'md:grid-cols-3',
  '1-1-1-1': 'sm:grid-cols-2 lg:grid-cols-4',
} as const
type Ratio = keyof typeof RATIOS

export const Columns: ComponentConfig<{
  ratio: Ratio
  gap: 'sm' | 'md' | 'lg'
  valign: Align
  mobileOrder: 'normal' | 'reverse'
  hide?: Responsive<Visibility>
  col1: Slot
  col2: Slot
  col3: Slot
  col4: Slot
}> = {
  label: 'Columns',
  fields: {
    ratio: select<Ratio>('Layout', [
      ['1-1', '50 / 50'],
      ['1-2', '33 / 67'],
      ['2-1', '67 / 33'],
      ['1-3', '25 / 75'],
      ['3-1', '75 / 25'],
      ['1-1-1', '3 columns'],
      ['1-1-1-1', '4 columns'],
    ]),
    gap: radio('Gap', [
      ['sm', 'S'],
      ['md', 'M'],
      ['lg', 'L'],
    ]),
    valign: radio<Align>('Vertical align', [
      ['start', 'Top'],
      ['center', 'Middle'],
      ['end', 'Bottom'],
    ]),
    mobileOrder: radio('Order on mobile', [
      ['normal', 'As shown'],
      ['reverse', 'Reversed'],
    ]),
    hide: hideField(),
    col1: { type: 'slot', disallow: ['WhatsAppButton', 'Section'] },
    col2: { type: 'slot', disallow: ['WhatsAppButton', 'Section'] },
    col3: { type: 'slot', disallow: ['WhatsAppButton', 'Section'] },
    col4: { type: 'slot', disallow: ['WhatsAppButton', 'Section'] },
  },
  defaultProps: {
    ratio: '1-1',
    gap: 'md',
    valign: 'center',
    mobileOrder: 'normal',
    col1: [],
    col2: [],
    col3: [],
    col4: [],
  },
  render: ({ puck, ratio, gap, valign, mobileOrder, hide, col1, col2, col3, col4 }) => {
    const meta = metaOf(puck)
    const s = responsiveStyle({ hide }, { editing: meta.editing })
    const cols = [col1, col2, col3, col4].slice(0, ratio.split('-').length)
    return (
      <div
        {...s.attrs}
        className={cn(
          'grid grid-cols-1',
          RATIOS[ratio],
          gap === 'sm' ? 'gap-5' : gap === 'lg' ? 'gap-12 lg:gap-20' : 'gap-8 lg:gap-12',
          valign === 'center' ? 'items-center' : valign === 'end' ? 'items-end' : 'items-start',
        )}
      >
        {cols.map((Col, i) => (
          <Col
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed column positions
            key={i}
            className={cn(
              'flex min-w-0 flex-col gap-6',
              mobileOrder === 'reverse' && (i === 0 ? 'order-2 md:order-none' : 'order-1 md:order-none'),
            )}
            minEmptyHeight={80}
          />
        ))}
      </div>
    )
  },
}

export const Stack: ComponentConfig<{
  items: Slot
  direction: 'vertical' | 'horizontal'
  gap: 'xs' | 'sm' | 'md' | 'lg'
  align: Responsive<Align>
  wrap: boolean
  hide?: Responsive<Visibility>
}> = {
  label: 'Stack',
  fields: {
    direction: radio('Direction', [
      ['vertical', 'Vertical'],
      ['horizontal', 'Horizontal'],
    ]),
    gap: radio('Gap', [
      ['xs', 'XS'],
      ['sm', 'S'],
      ['md', 'M'],
      ['lg', 'L'],
    ]),
    align: alignField(),
    wrap: radio('Wrap', [
      [true, 'Wrap'],
      [false, 'Single line'],
    ]),
    hide: hideField(),
    items: { type: 'slot', disallow: ['WhatsAppButton', 'Section'] },
  },
  defaultProps: { direction: 'vertical', gap: 'sm', align: { base: 'start' }, wrap: true, items: [] },
  render: ({ puck, items: Items, direction, gap, align, wrap, hide }) => {
    const meta = metaOf(puck)
    const s = responsiveStyle({ align, hide }, { editing: meta.editing })
    return (
      <div {...s.attrs} style={s.style}>
        <Items
          className={cn(
            'flex',
            s.className,
            direction === 'horizontal' ? 'flex-row' : 'flex-col',
            wrap && 'flex-wrap',
            { xs: 'gap-2', sm: 'gap-4', md: 'gap-6', lg: 'gap-10' }[gap],
          )}
          minEmptyHeight={64}
        />
      </div>
    )
  },
}

export const Spacer: ComponentConfig<{ height: Responsive<PadStep>; hide?: Responsive<Visibility> }> = {
  label: 'Spacer',
  fields: { height: padField('Height'), hide: hideField() },
  defaultProps: { height: { base: 'sm', lg: 'md' } },
  render: ({ puck, height, hide }) => {
    const meta = metaOf(puck)
    const s = responsiveStyle({ height, hide }, { editing: meta.editing })
    return (
      <div
        aria-hidden
        {...s.attrs}
        className={cn(
          s.className,
          meta.editing &&
            'bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,var(--subtle)_6px,var(--subtle)_7px)]',
        )}
        style={s.style}
      />
    )
  },
}

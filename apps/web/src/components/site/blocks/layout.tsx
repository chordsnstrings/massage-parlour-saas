import type { ComponentConfig, CustomFieldRender, Field, PuckContext, Slot } from '@puckeditor/core'
import { cn } from '@/lib/utils'
import { alignField, hideField, imageField, padField, radio, select, text } from '../field-defs'
import { CustomCssField, ScheduleField } from '../fields'
import {
  type AdvancedProps,
  type Align,
  advancedStyle,
  type PadStep,
  responsiveStyle,
  type Visibility,
} from '../style'
import type { Responsive, SiteMeta } from '../types'
import { container, metaOf } from './shared'

// biome-ignore lint/suspicious/noExplicitAny: Puck types props per component; the wrapper is prop-agnostic
type AnyComponent = ComponentConfig<any>

/** "Advanced" group on every band (PLAN §11.3 layer 6): Puck props `advanced: { schedule, customCss }`. */
export const advancedField: Field = {
  type: 'object',
  label: 'Advanced',
  objectFields: {
    schedule: {
      type: 'custom',
      label: 'Schedule',
      render: ScheduleField as unknown as CustomFieldRender<AdvancedProps['schedule']>,
    },
    customCss: {
      type: 'custom',
      label: 'Custom CSS',
      render: CustomCssField as unknown as CustomFieldRender<string | undefined>,
    },
  },
}

/**
 * Section-level advanced shell: wraps a band in `[data-section-id]` with its sanitised, scoped CSS, and hides
 * it outside its schedule. In the editor a scheduled band stays visible (ghosted when hidden) with a badge.
 */
export function AdvancedShell({
  id,
  meta,
  advanced,
  children,
}: {
  id: string
  meta: SiteMeta
  advanced?: AdvancedProps
  children: React.ReactNode
}) {
  const a = advancedStyle(id, advanced)
  if (!a.visible && !meta.editing) return null
  if (!a.css && a.state === 'always') return <>{children}</>
  const body = (
    <div data-section-id={a.sectionId}>
      {/* Sanitised + scoped by advancedStyle (never contains `<`). */}
      {/* biome-ignore lint/security/noDangerouslySetInnerHtml: CSS must not be HTML-escaped */}
      {a.css && <style dangerouslySetInnerHTML={{ __html: a.css }} />}
      {children}
    </div>
  )
  if (!meta.editing || a.state === 'always') return body
  return (
    <div className="relative">
      <span
        className={cn(
          'pointer-events-none absolute start-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-sans text-[11px] font-medium tracking-normal shadow-[0_1px_3px_rgb(0_0_0/0.12)]',
          a.visible ? 'bg-white/95 text-[#3f5f4c]' : 'bg-[#f5eedf] text-[#7a5d22]',
        )}
      >
        <span className={cn('size-1.5 rounded-full', a.visible ? 'bg-[#5e7d6b]' : 'bg-[#a8823a]')} />
        {a.visible ? 'Scheduled' : 'Hidden now'} · {a.label}
      </span>
      <div className={a.visible ? undefined : 'opacity-45'}>{body}</div>
    </div>
  )
}

/** Adds the Advanced group to a band block and renders it through AdvancedShell. */
export function withAdvanced(component: AnyComponent): AnyComponent {
  const Inner = component.render
  return {
    ...component,
    fields: { ...component.fields, advanced: advancedField },
    render: (props: { id: string; puck: PuckContext; advanced?: AdvancedProps }) => (
      <AdvancedShell id={props.id} meta={metaOf(props.puck)} advanced={props.advanced}>
        <Inner {...props} />
      </AdvancedShell>
    ),
  }
}

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

/**
 * Per-section scroll effect (scroll-scenes engine, `lib/scenes.ts`). `auto` keeps the theme's gentle entrance.
 * Only on the public site and preview — never in the editor.
 */
export type SceneKey = 'auto' | 'none' | 'reveal' | 'rise' | 'assemble' | 'flip' | 'depart'
export const sceneField = select<SceneKey>('Scroll effect', [
  ['auto', 'Theme default'],
  ['none', 'None'],
  ['reveal', 'Tilt up'],
  ['rise', 'Wipe in, one by one'],
  ['assemble', 'Fly into place'],
  ['flip', 'Flip open'],
  ['depart', 'Sink back (hero)'],
])
const SCENE_ATTRS: Partial<Record<SceneKey, Record<string, string>>> = {
  reveal: { 'data-span': '.45' },
  depart: { 'data-mode': 'leave' },
}

export type ShellProps = {
  background: Background
  padding: Responsive<PadStep>
  hide?: Responsive<Visibility>
  width?: keyof typeof container
  bgImage?: string
  anchor?: string
  scene?: SceneKey
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
  scene = 'auto',
  className,
  children,
}: ShellProps & { meta: SiteMeta; className?: string; children: React.ReactNode }) {
  const s = responsiveStyle({ padding, hide }, { editing: meta.editing, padFallback: 'lg' })
  const image = background === 'image' && bgImage
  const scripted = !meta.editing && scene !== 'auto' && scene !== 'none'
  return (
    <section
      id={anchor || undefined}
      data-reveal={meta.editing || scene !== 'auto' ? undefined : ''}
      data-scene={scripted ? scene : undefined}
      {...(scripted ? SCENE_ATTRS[scene] : undefined)}
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
      <div
        data-beats={scripted ? '' : undefined}
        data-world={scripted && scene === 'depart' ? '' : undefined}
        className={cn(container[width], className)}
      >
        {children}
      </div>
    </section>
  )
}

const shellFields = {
  background: backgroundField,
  bgImage: imageField('Background image'),
  width: radio('Width', [
    ['narrow', 'Narrow'],
    ['contained', 'Contained'],
    ['full', 'Full-bleed'],
  ]),
  padding: padField('Vertical padding'),
  hide: hideField(),
  anchor: text('Anchor id', 'e.g. offers'),
  scene: sceneField,
}
export const shellDefaults: ShellProps = { background: 'none', padding: { base: 'lg' }, width: 'contained' }
/** Smart blocks expose the band controls too (without the background image / anchor extras). */
export const bandFields = {
  background: shellFields.background,
  padding: shellFields.padding,
  hide: shellFields.hide,
  scene: sceneField,
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

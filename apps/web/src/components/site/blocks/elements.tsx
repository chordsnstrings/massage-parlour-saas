import type { ComponentConfig } from '@puckeditor/core'
import { cn } from '@/lib/utils'
import { alignField, biField, buttonsField, hideField, imageField, radio, select } from '../field-defs'
import { tr } from '../i18n'
import { type Align, responsiveStyle, type Visibility } from '../style'
import type { Bi, Responsive } from '../types'
import { Emphasis, HeroBackdrop, HeroEmblem } from './hero-art'
import { type Background, bandFields, type SceneKey, SectionShell, type ShellProps } from './layout'
import { ArtPlaceholder, type ButtonItem, metaOf, SiteButton } from './shared'

const SIZES = {
  display: 'text-[clamp(2.5rem,7vw,4.75rem)]',
  xl: 'text-[clamp(2rem,5vw,3.25rem)]',
  lg: 'text-[clamp(1.6rem,3.6vw,2.4rem)]',
  md: 'text-xl sm:text-2xl',
} as const

export const Heading: ComponentConfig<{
  eyebrow: Bi
  text: Bi
  level: 'h1' | 'h2' | 'h3'
  size: keyof typeof SIZES
  align: Responsive<Align>
  hide?: Responsive<Visibility>
}> = {
  label: 'Heading',
  fields: {
    eyebrow: biField('Eyebrow (small text above)'),
    text: biField('Heading'),
    level: radio('Level', [
      ['h1', 'H1'],
      ['h2', 'H2'],
      ['h3', 'H3'],
    ]),
    size: select('Size', [
      ['display', 'Display'],
      ['xl', 'Extra large'],
      ['lg', 'Large'],
      ['md', 'Medium'],
    ]),
    align: alignField(),
    hide: hideField(),
  },
  defaultProps: {
    eyebrow: { en: '' },
    text: { en: 'A calm heading' },
    level: 'h2',
    size: 'lg',
    align: { base: 'start' },
  },
  render: ({ puck, eyebrow, text: value, level, size, align, hide }) => {
    const meta = metaOf(puck)
    const s = responsiveStyle({ align, hide }, { editing: meta.editing })
    const Tag = level
    const kicker = tr(eyebrow, meta)
    return (
      <div {...s.attrs} className={cn('flex flex-col gap-4', s.className)} style={s.style}>
        {kicker && <p className="text-xs font-medium tracking-[0.22em] text-muted uppercase">{kicker}</p>}
        <Tag className={cn('sb-heading max-w-4xl', SIZES[size])}>
          <Emphasis text={tr(value, meta)} />
        </Tag>
      </div>
    )
  },
}

export const RichText: ComponentConfig<{
  text: Bi
  size: 'sm' | 'md' | 'lg'
  tone: 'default' | 'muted'
  measure: 'narrow' | 'normal' | 'full'
  align: Responsive<Align>
  hide?: Responsive<Visibility>
}> = {
  label: 'Text',
  fields: {
    text: biField('Text (blank line = new paragraph)', { multiline: true }),
    size: radio('Size', [
      ['sm', 'S'],
      ['md', 'M'],
      ['lg', 'L'],
    ]),
    tone: radio('Tone', [
      ['default', 'Default'],
      ['muted', 'Muted'],
    ]),
    measure: radio('Line length', [
      ['narrow', 'Narrow'],
      ['normal', 'Normal'],
      ['full', 'Full'],
    ]),
    align: alignField(),
    hide: hideField(),
  },
  defaultProps: {
    text: { en: 'Tell your guests what makes your spa special.' },
    size: 'md',
    tone: 'muted',
    measure: 'normal',
    align: { base: 'start' },
  },
  render: ({ puck, text: value, size, tone, measure, align, hide }) => {
    const meta = metaOf(puck)
    const s = responsiveStyle({ align, hide }, { editing: meta.editing })
    const paragraphs = tr(value, meta)
      .split(/\n\s*\n/)
      .filter(Boolean)
    return (
      <div {...s.attrs} className={cn('flex flex-col', s.className)} style={s.style}>
        <div
          className={cn(
            'sb-prose space-y-4',
            size === 'sm' ? 'text-[15px]' : size === 'lg' ? 'text-lg sm:text-xl' : 'text-[17px]',
            tone === 'muted' ? 'text-muted' : 'text-fg',
            measure === 'narrow' ? 'max-w-xl' : measure === 'normal' ? 'max-w-2xl' : 'max-w-none',
          )}
        >
          {paragraphs.map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static paragraphs
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>
      </div>
    )
  },
}

export const ButtonGroup: ComponentConfig<{
  buttons: ButtonItem[]
  size: 'md' | 'lg'
  align: Responsive<Align>
  stackOnMobile: boolean
  hide?: Responsive<Visibility>
}> = {
  label: 'Buttons',
  fields: {
    buttons: buttonsField(),
    size: radio('Size', [
      ['md', 'Regular'],
      ['lg', 'Large'],
    ]),
    stackOnMobile: radio('On phones', [
      [true, 'Full width'],
      [false, 'Inline'],
    ]),
    align: alignField(),
    hide: hideField(),
  },
  defaultProps: {
    buttons: [
      { label: { en: 'Book now', ar: 'احجز الآن' }, action: 'book', target: '', style: 'primary' },
      {
        label: { en: 'WhatsApp us', ar: 'راسلنا على واتساب' },
        action: 'whatsapp',
        target: '',
        style: 'secondary',
      },
    ],
    size: 'lg',
    stackOnMobile: false,
    align: { base: 'start' },
  },
  render: ({ puck, buttons, size, align, stackOnMobile, hide }) => {
    const meta = metaOf(puck)
    const s = responsiveStyle({ align, hide }, { editing: meta.editing })
    return (
      <div
        {...s.attrs}
        className={cn('flex flex-wrap gap-3', stackOnMobile && 'flex-col sm:flex-row', s.className)}
        style={s.style}
      >
        {(buttons ?? []).map((b, i) => (
          <SiteButton
            // biome-ignore lint/suspicious/noArrayIndexKey: editor-ordered list
            key={i}
            item={b}
            meta={meta}
            size={size}
            className={cn(stackOnMobile && 'w-full sm:w-auto')}
          />
        ))}
      </div>
    )
  },
}

const ASPECT = {
  auto: '',
  square: 'aspect-square',
  portrait: 'aspect-[4/5]',
  landscape: 'aspect-[4/3]',
  wide: 'aspect-[16/9]',
} as const

export const Image: ComponentConfig<{
  src: string
  alt: Bi
  caption: Bi
  aspect: keyof typeof ASPECT
  rounded: boolean
  hide?: Responsive<Visibility>
}> = {
  label: 'Image',
  fields: {
    src: imageField('Image'),
    alt: biField('Alt text (describe the image)'),
    caption: biField('Caption'),
    aspect: select('Shape', [
      ['auto', 'Original'],
      ['square', 'Square'],
      ['portrait', 'Portrait'],
      ['landscape', 'Landscape'],
      ['wide', 'Wide'],
    ]),
    rounded: radio('Corners', [
      [true, 'Theme radius'],
      [false, 'Square'],
    ]),
    hide: hideField(),
  },
  defaultProps: { src: '', alt: { en: '' }, caption: { en: '' }, aspect: 'portrait', rounded: true },
  render: ({ puck, id, src, alt, caption, aspect, rounded, hide }) => {
    const meta = metaOf(puck)
    const s = responsiveStyle({ hide }, { editing: meta.editing })
    const cap = tr(caption, meta)
    const shape = cn(
      'w-full overflow-hidden',
      ASPECT[aspect] || (!src && 'aspect-[4/3]'),
      rounded && 'sb-card',
    )
    return (
      <figure {...s.attrs} className="m-0 w-full">
        {src ? (
          // biome-ignore lint/performance/noImgElement: tenant-provided URL
          <img src={src} alt={tr(alt, meta)} loading="lazy" className={cn(shape, 'h-auto object-cover')} />
        ) : (
          <ArtPlaceholder seed={id.length} className={shape} />
        )}
        {cap && <figcaption className="mt-3 text-sm text-muted">{cap}</figcaption>}
      </figure>
    )
  },
}

type GalleryImage = { src: string; alt: Bi }
export const Gallery: ComponentConfig<
  ShellProps & {
    title: Bi
    images: GalleryImage[]
    layout: 'grid' | 'mosaic' | 'strip'
    columns: '2' | '3' | '4'
  }
> = {
  label: 'Gallery',
  fields: {
    title: biField('Title'),
    images: {
      type: 'array',
      label: 'Images',
      max: 12,
      getItemSummary: (item: GalleryImage, i?: number) => item.alt?.en || `Image ${(i ?? 0) + 1}`,
      defaultItemProps: { src: '', alt: { en: '' } },
      arrayFields: { src: imageField('Image'), alt: biField('Alt text') },
    },
    layout: radio('Layout', [
      ['grid', 'Grid'],
      ['mosaic', 'Mosaic'],
      ['strip', 'Scrolling strip'],
    ]),
    columns: radio('Columns (desktop)', [
      ['2', '2'],
      ['3', '3'],
      ['4', '4'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    title: { en: '' },
    images: [
      { src: '', alt: { en: '' } },
      { src: '', alt: { en: '' } },
      { src: '', alt: { en: '' } },
    ],
    layout: 'grid',
    columns: '3',
    background: 'none',
    padding: { base: 'md', lg: 'lg' },
  },
  render: ({ puck, title, images, layout, columns, ...shell }) => {
    const meta = metaOf(puck)
    const t = tr(title, meta)
    const cols = {
      '2': 'sm:grid-cols-2',
      '3': 'sm:grid-cols-2 lg:grid-cols-3',
      '4': 'sm:grid-cols-2 lg:grid-cols-4',
    }[columns]
    // Array items carry no ids; position + URL is stable enough for a static list.
    const keys = images.map((img, n) => `${n}:${img.src}`)
    const item = (img: GalleryImage, i: number, extra?: string) =>
      img.src ? (
        // biome-ignore lint/performance/noImgElement: tenant-provided URL
        <img
          src={img.src}
          alt={tr(img.alt, meta)}
          loading="lazy"
          className={cn('sb-card size-full object-cover', extra)}
        />
      ) : (
        <ArtPlaceholder seed={i + 3} className={cn('sb-card size-full', extra)} />
      )
    return (
      <SectionShell meta={meta} {...shell} width="contained">
        {t && <h2 className="sb-heading mb-10 text-3xl sm:text-4xl">{t}</h2>}
        {layout === 'strip' ? (
          <div className="-mx-5 flex snap-x snap-mandatory gap-4 overflow-x-auto px-5 pb-2 sm:-mx-8 sm:px-8">
            {images.map((img, i) => (
              <div key={keys[i]} className="aspect-[4/5] w-[72%] shrink-0 snap-start sm:w-[40%] lg:w-[28%]">
                {item(img, i)}
              </div>
            ))}
          </div>
        ) : layout === 'mosaic' ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4 lg:grid-rows-2">
            {images.slice(0, 5).map((img, i) => (
              <div
                key={keys[i]}
                className={cn('aspect-square', i === 0 && 'col-span-2 row-span-2 lg:aspect-auto')}
              >
                {item(img, i)}
              </div>
            ))}
          </div>
        ) : (
          <div className={cn('grid grid-cols-1 gap-4', cols)}>
            {images.map((img, i) => (
              <div key={keys[i]} className="aspect-[4/3]">
                {item(img, i)}
              </div>
            ))}
          </div>
        )}
      </SectionShell>
    )
  },
}

export const Hero: ComponentConfig<{
  variant: 'centered' | 'split' | 'banner'
  eyebrow: Bi
  title: Bi
  subtitle: Bi
  buttons: ButtonItem[]
  image: string
  imageAlt: Bi
  background: Background
  hide?: Responsive<Visibility>
  scene?: SceneKey
}> = {
  label: 'Hero',
  fields: {
    variant: radio('Layout', [
      ['centered', 'Centred'],
      ['split', 'Split with image'],
      ['banner', 'Full image'],
    ]),
    eyebrow: biField('Eyebrow'),
    title: biField('Headline'),
    subtitle: biField('Subheading', { multiline: true }),
    buttons: buttonsField(),
    image: imageField('Image'),
    imageAlt: biField('Image alt text'),
    background: bandFields.background,
    hide: hideField(),
    scene: bandFields.scene,
  },
  defaultProps: {
    variant: 'split',
    eyebrow: { en: 'Massage & wellness', ar: 'مساج وعافية' },
    title: { en: 'Welcome to {name}', ar: 'أهلًا بكم في {name}' },
    subtitle: { en: 'Unhurried treatments by skilled therapists.', ar: 'جلسات هادئة على أيدي معالجين مهرة.' },
    buttons: [{ label: { en: 'Book now', ar: 'احجز الآن' }, action: 'book', target: '', style: 'primary' }],
    image: '',
    imageAlt: { en: '' },
    background: 'none',
  },
  render: ({
    puck,
    id,
    variant,
    eyebrow,
    title,
    subtitle,
    buttons,
    image,
    imageAlt,
    background,
    hide,
    scene,
  }) => {
    const meta = metaOf(puck)
    // Design templates (R5): CSS-drawn backdrop + an emblem made from the spa name where there is no photo.
    const emblemKind = meta.theme.emblem ?? 'none'
    const backdrop = <HeroBackdrop kind={meta.theme.backdrop ?? 'none'} meta={meta} />
    const emblem = <HeroEmblem kind={emblemKind} meta={meta} id={id} />
    const kicker = tr(eyebrow, meta)
    const sub = tr(subtitle, meta)
    const copy = (center: boolean, split = false) => (
      <div className={cn('flex flex-col gap-6', center && 'items-center text-center')}>
        {kicker && <p className="text-xs font-medium tracking-[0.24em] text-muted uppercase">{kicker}</p>}
        <h1
          className={cn(
            'sb-heading max-w-3xl',
            split ? 'text-[clamp(2.4rem,5.6vw,4.25rem)]' : 'text-[clamp(2.6rem,7.5vw,5rem)]',
          )}
        >
          <Emphasis text={tr(title, meta)} />
        </h1>
        {sub && <p className="sb-prose max-w-xl text-lg text-muted sm:text-xl">{sub}</p>}
        <div className={cn('mt-2 flex flex-wrap gap-3', center && 'justify-center')}>
          {(buttons ?? []).map((b, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: editor-ordered list
            <SiteButton key={i} item={b} meta={meta} size="lg" />
          ))}
        </div>
      </div>
    )
    if (variant === 'banner') {
      return (
        <SectionShell
          meta={meta}
          background={image ? 'image' : 'inverse'}
          bgImage={image}
          padding={{ base: 'xl', lg: 'xl' }}
          hide={hide}
          scene={scene}
          className="flex min-h-[min(78vh,760px)] items-end"
        >
          {copy(false)}
        </SectionShell>
      )
    }
    if (variant === 'centered') {
      return (
        <SectionShell
          meta={meta}
          background={background}
          padding={{ base: 'xl', lg: 'xl' }}
          hide={hide}
          scene={scene}
          width="contained"
          backdrop={backdrop}
        >
          {emblemKind !== 'none' && emblemKind !== 'bento' ? (
            <div className="flex flex-col items-center gap-10">
              {emblem}
              {copy(true)}
            </div>
          ) : (
            <>
              {copy(true)}
              {emblemKind === 'bento' && <div className="mx-auto mt-12 max-w-xl">{emblem}</div>}
            </>
          )}
        </SectionShell>
      )
    }
    return (
      <SectionShell
        meta={meta}
        background={background}
        padding={{ base: 'lg', lg: 'xl' }}
        hide={hide}
        scene={scene}
        backdrop={backdrop}
      >
        <div className="grid items-center gap-10 md:grid-cols-[1.1fr_1fr] lg:gap-16">
          {copy(false, true)}
          {!image && emblemKind !== 'none' ? (
            emblem
          ) : image ? (
            // biome-ignore lint/performance/noImgElement: tenant-provided URL
            <img src={image} alt={tr(imageAlt, meta)} className="sb-card aspect-[4/5] w-full object-cover" />
          ) : (
            <ArtPlaceholder
              seed={id.length + 7}
              className="sb-card aspect-[4/5] w-full max-md:aspect-[4/3]"
            />
          )}
        </div>
      </SectionShell>
    )
  },
}

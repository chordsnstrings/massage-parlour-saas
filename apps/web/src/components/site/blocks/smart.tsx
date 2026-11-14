import type { ComponentConfig } from '@puckeditor/core'
import { CalendarCheck, MapPin, MessageCircle, Phone, Plus, Quote, Store } from 'lucide-react'
import { cn, initials } from '@/lib/utils'
import { biField, radio, text } from '../field-defs'
import { clock, dayName, minutes, tr, ui, variantPrice, WEEKDAYS } from '../i18n'
import { addressLinkProps, bookHref, linkProps, mapHref, pageHref, phoneHref, whatsappHref } from '../links'
import type { Bi } from '../types'
import { bandFields, SectionShell, type ShellProps } from './layout'
import { metaOf, SectionTitle } from './shared'

type Band = Omit<ShellProps, 'width' | 'bgImage' | 'anchor'>
const band: Band = { background: 'none', padding: { base: 'lg' } }

/* ------------------------------------------------------------------ Services menu (live prices) */

export const ServicesMenu: ComponentConfig<
  Band & {
    title: Bi
    intro: Bi
    layout: 'list' | 'cards'
    showDescriptions: boolean
    showBook: boolean
    limit: number
  }
> = {
  label: 'Services menu',
  fields: {
    title: biField('Title'),
    intro: biField('Intro', { multiline: true }),
    layout: radio('Layout', [
      ['list', 'Price list'],
      ['cards', 'Cards'],
    ]),
    showDescriptions: radio('Descriptions', [
      [true, 'Show'],
      [false, 'Hide'],
    ]),
    showBook: radio('Book button', [
      [true, 'Show'],
      [false, 'Hide'],
    ]),
    limit: { type: 'number', label: 'Show at most (0 = all)', min: 0, max: 50 },
    ...bandFields,
  },
  defaultProps: {
    ...band,
    title: { en: 'Treatments', ar: 'الجلسات' },
    intro: { en: '', ar: '' },
    layout: 'list',
    showDescriptions: true,
    showBook: true,
    limit: 0,
  },
  render: ({ puck, title, intro, layout, showDescriptions, showBook, limit, ...shell }) => {
    const meta = metaOf(puck)
    const all = meta.data.services
    const services = limit > 0 ? all.slice(0, limit) : all
    return (
      <SectionShell meta={meta} {...shell}>
        <SectionTitle title={title} intro={intro} meta={meta} />
        {services.length === 0 ? (
          <p className="text-muted">{ui('noServices', meta.locale)}</p>
        ) : layout === 'cards' ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <article
                key={s.id}
                data-reveal-item
                className="sb-card sb-lift flex flex-col border bg-surface p-6"
              >
                <h3 className="sb-heading text-xl">{tr(s.name, meta)}</h3>
                {showDescriptions && s.description && (
                  <p className="mt-2 text-[15px] text-muted">{tr(s.description, meta)}</p>
                )}
                <ul className="mt-5 flex-1 space-y-2 border-t pt-4">
                  {s.variants.map((v) => (
                    <li key={v.durationMin} className="flex items-baseline justify-between gap-4 text-[15px]">
                      <span className="text-muted">{minutes(v.durationMin, meta.locale)}</span>
                      <span className="font-medium tabular-nums">
                        {variantPrice(v.priceAed, meta.locale)}
                      </span>
                    </li>
                  ))}
                </ul>
                {showBook && (
                  <a {...linkProps(meta, bookHref(meta))} className="sb-btn sb-btn-secondary mt-6 w-full">
                    {ui('bookShort', meta.locale)}
                  </a>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="divide-y border-y">
            {services.map((s) => (
              <article key={s.id} className="grid gap-3 py-6 sm:grid-cols-[1fr_auto] sm:gap-10">
                <div className="min-w-0">
                  <h3 className="sb-heading text-xl sm:text-2xl">{tr(s.name, meta)}</h3>
                  {showDescriptions && s.description && (
                    <p className="mt-1.5 max-w-xl text-[15px] text-muted">{tr(s.description, meta)}</p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-2 sm:justify-end">
                  {s.variants.map((v) => (
                    <span key={v.durationMin} className="inline-flex items-baseline gap-2 text-[15px]">
                      <span className="text-muted">{minutes(v.durationMin, meta.locale)}</span>
                      <span className="font-medium tabular-nums">
                        {variantPrice(v.priceAed, meta.locale)}
                      </span>
                    </span>
                  ))}
                  {showBook && (
                    <a
                      {...linkProps(meta, bookHref(meta))}
                      className="sb-btn sb-btn-secondary min-h-10 px-4 text-sm"
                    >
                      {ui('bookShort', meta.locale)}
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionShell>
    )
  },
}

/* ------------------------------------------------------------------ Team */

export const Team: ComponentConfig<
  Band & { title: Bi; intro: Bi; layout: 'grid' | 'compact'; showBio: boolean }
> = {
  label: 'Team',
  fields: {
    title: biField('Title'),
    intro: biField('Intro', { multiline: true }),
    layout: radio('Layout', [
      ['grid', 'Portraits'],
      ['compact', 'Compact'],
    ]),
    showBio: radio('Bios', [
      [true, 'Show'],
      [false, 'Hide'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    ...band,
    title: { en: 'Our therapists', ar: 'فريقنا' },
    intro: { en: '', ar: '' },
    layout: 'grid',
    showBio: true,
  },
  render: ({ puck, title, intro, layout, showBio, ...shell }) => {
    const meta = metaOf(puck)
    const staff = meta.data.staff
    return (
      <SectionShell meta={meta} {...shell}>
        <SectionTitle title={title} intro={intro} meta={meta} />
        {staff.length === 0 ? (
          <p className="text-muted">{ui('noTeam', meta.locale)}</p>
        ) : layout === 'compact' ? (
          <ul className="flex flex-wrap gap-x-10 gap-y-6">
            {staff.map((p) => (
              <li key={p.id} className="flex items-center gap-3">
                <Avatar name={p.name} photo={p.photoUrl} className="size-12 text-sm" />
                <span className="font-medium">{p.name}</span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 lg:grid-cols-4">
            {staff.map((p) => (
              <figure key={p.id} className="m-0">
                <Avatar
                  name={p.name}
                  photo={p.photoUrl}
                  className="sb-card aspect-[4/5] w-full text-3xl"
                  square
                />
                <figcaption className="mt-4">
                  <p className="sb-heading text-lg">{p.name}</p>
                  {showBio && p.bio && <p className="mt-1 text-sm text-muted">{tr(p.bio, meta)}</p>}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </SectionShell>
    )
  },
}

function Avatar({
  name,
  photo,
  className,
  square,
}: {
  name: string
  photo: string | null
  className?: string
  square?: boolean
}) {
  if (photo) {
    return (
      // biome-ignore lint/performance/noImgElement: staff photo URL
      <img
        src={photo}
        alt={name}
        loading="lazy"
        className={cn('object-cover', !square && 'rounded-full', className)}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={cn(
        'sb-heading grid place-items-center bg-[var(--accent-soft)] text-[var(--brand)]',
        !square && 'rounded-full',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

/* ------------------------------------------------------------------ Booking call-to-action */

export const BookingCTA: ComponentConfig<
  Band & { variant: 'banner' | 'card' | 'split'; title: Bi; text: Bi; buttonLabel: Bi; showWhatsApp: boolean }
> = {
  label: 'Booking call-to-action',
  fields: {
    variant: radio('Layout', [
      ['banner', 'Banner'],
      ['card', 'Card'],
      ['split', 'Split'],
    ]),
    title: biField('Title'),
    text: biField('Text', { multiline: true }),
    buttonLabel: biField('Button label'),
    showWhatsApp: radio('WhatsApp button', [
      [true, 'Show'],
      [false, 'Hide'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    background: 'accent',
    padding: { base: 'lg' },
    variant: 'banner',
    title: { en: 'Ready when you are', ar: 'نحن بانتظارك' },
    text: { en: 'Choose a treatment and time in under a minute.', ar: 'اختر الجلسة والوقت في أقل من دقيقة.' },
    buttonLabel: { en: 'Book online', ar: 'احجز أونلاين' },
    showWhatsApp: true,
  },
  render: ({ puck, variant, title, text: body, buttonLabel, showWhatsApp, ...shell }) => {
    const meta = metaOf(puck)
    const wa = showWhatsApp ? whatsappHref(meta) : null
    const actions = (
      <div className="flex flex-wrap gap-3">
        <a {...linkProps(meta, bookHref(meta))} className="sb-btn sb-btn-primary sb-btn-lg">
          <CalendarCheck strokeWidth={1.75} />
          {tr(buttonLabel, meta) || ui('book', meta.locale)}
        </a>
        {wa && (
          <a {...linkProps(meta, wa)} className="sb-btn sb-btn-secondary sb-btn-lg">
            <MessageCircle strokeWidth={1.75} />
            {ui('whatsapp', meta.locale)}
          </a>
        )}
      </div>
    )
    const copy = (
      <div className="space-y-3">
        <h2 className="sb-heading text-3xl sm:text-[2.6rem]">{tr(title, meta)}</h2>
        {tr(body, meta) && <p className="sb-prose max-w-xl text-[17px] text-muted">{tr(body, meta)}</p>}
      </div>
    )
    if (variant === 'card') {
      return (
        <SectionShell
          meta={meta}
          {...shell}
          background={shell.background === 'accent' ? 'none' : shell.background}
        >
          <div className="sb-card sb-bg-accent flex flex-col items-center gap-8 px-6 py-12 text-center sm:px-12 sm:py-16">
            <div className="flex flex-col items-center">{copy}</div>
            {actions}
          </div>
        </SectionShell>
      )
    }
    if (variant === 'split') {
      return (
        <SectionShell meta={meta} {...shell}>
          <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
            {copy}
            {actions}
          </div>
        </SectionShell>
      )
    }
    return (
      <SectionShell meta={meta} {...shell} width="narrow">
        <div className="flex flex-col items-center gap-8 text-center">
          {copy}
          {actions}
        </div>
      </SectionShell>
    )
  },
}

/* ------------------------------------------------------------------ Opening hours + map link */

export const OpeningHours: ComponentConfig<
  Band & { title: Bi; layout: 'split' | 'table'; showMap: boolean }
> = {
  label: 'Opening hours',
  fields: {
    title: biField('Title'),
    layout: radio('Layout', [
      ['split', 'Hours + address'],
      ['table', 'Hours only'],
    ]),
    showMap: radio('Map link', [
      [true, 'Show'],
      [false, 'Hide'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    ...band,
    background: 'subtle',
    title: { en: 'Visit us', ar: 'زورونا' },
    layout: 'split',
    showMap: true,
  },
  render: ({ puck, title, layout, showMap, ...shell }) => {
    const meta = metaOf(puck)
    const branch = meta.data.branch
    const hours = branch?.openingHours ?? {}
    const table = (
      <dl className="divide-y border-y text-[15px]">
        {WEEKDAYS.map((d) => {
          const slots = hours[d] ?? []
          const isToday = meta.today === d
          return (
            <div
              key={d}
              className={cn('flex items-center justify-between gap-6 py-3', isToday && 'font-medium')}
            >
              <dt className="flex items-center gap-2">
                {dayName(d, meta.locale)}
                {isToday && (
                  <span className="rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] text-[var(--brand)]">
                    {ui('today', meta.locale)}
                  </span>
                )}
              </dt>
              <dd className="m-0 text-end tabular-nums text-muted" dir="ltr">
                {slots.length
                  ? slots
                      .map((s) => `${clock(s.open, meta.locale)} – ${clock(s.close, meta.locale)}`)
                      .join(', ')
                  : ui('closed', meta.locale)}
              </dd>
            </div>
          )
        })}
      </dl>
    )
    if (layout === 'table') {
      return (
        <SectionShell meta={meta} {...shell} width="narrow">
          <SectionTitle title={title} meta={meta} />
          {table}
        </SectionShell>
      )
    }
    const phone = phoneHref(meta)
    const wa = whatsappHref(meta)
    return (
      <SectionShell meta={meta} {...shell}>
        <div className="grid gap-12 md:grid-cols-2 lg:gap-20">
          <div className="space-y-8">
            <h2 className="sb-heading text-3xl sm:text-4xl">{tr(title, meta)}</h2>
            <div className="space-y-4 text-[15px]">
              {branch?.address && (
                <p className="flex gap-3">
                  <MapPin className="mt-0.5 size-5 shrink-0 text-muted" strokeWidth={1.5} />
                  <a {...addressLinkProps(meta)} className="text-inherit hover:underline">
                    {branch.address}
                  </a>
                </p>
              )}
              {branch?.phone && (
                <p className="flex gap-3">
                  <Phone className="mt-0.5 size-5 shrink-0 text-muted" strokeWidth={1.5} />
                  <a {...linkProps(meta, phone)} dir="ltr" className="hover:underline">
                    {branch.phone}
                  </a>
                </p>
              )}
              {branch?.name && branch.name !== meta.data.tenant.name && (
                <p className="flex gap-3 text-muted">
                  <Store className="mt-0.5 size-5 shrink-0" strokeWidth={1.5} />
                  <span>{branch.name}</span>
                </p>
              )}
            </div>
            <div className="flex flex-wrap gap-3">
              {showMap && branch?.address && (
                <a {...linkProps(meta, mapHref(meta))} className="sb-btn sb-btn-primary">
                  <MapPin strokeWidth={1.75} />
                  {ui('directions', meta.locale)}
                </a>
              )}
              {wa && (
                <a {...linkProps(meta, wa)} className="sb-btn sb-btn-secondary">
                  <MessageCircle strokeWidth={1.75} />
                  {ui('whatsapp', meta.locale)}
                </a>
              )}
            </div>
          </div>
          {table}
        </div>
      </SectionShell>
    )
  },
}

/* ------------------------------------------------------------------ Floating WhatsApp */

export const WhatsAppButton: ComponentConfig<{
  label: Bi
  message: Bi
  side: 'end' | 'start'
  style: 'pill' | 'icon'
}> = {
  label: 'WhatsApp button (floating)',
  fields: {
    label: biField('Label'),
    message: biField('Pre-filled message', { multiline: true }),
    side: radio('Position', [
      ['end', 'Right'],
      ['start', 'Left'],
    ]),
    style: radio('Style', [
      ['pill', 'With label'],
      ['icon', 'Icon only'],
    ]),
  },
  defaultProps: {
    label: { en: 'WhatsApp', ar: 'واتساب' },
    message: { en: "Hi {name}, I'd like to book a massage.", ar: 'مرحبًا {name}، أود حجز جلسة مساج.' },
    side: 'end',
    style: 'pill',
  },
  render: ({ puck, label, message, side, style }) => {
    const meta = metaOf(puck)
    const href = whatsappHref(meta, message)
    if (!href) {
      return meta.editing ? (
        <p className="mx-auto max-w-6xl px-5 py-3 text-sm text-muted">
          WhatsApp button: add a WhatsApp number in Settings to show it.
        </p>
      ) : (
        <span hidden />
      )
    }
    const text = tr(label, meta) || 'WhatsApp'
    return (
      <a
        {...linkProps(meta, href)}
        data-side={side}
        className={cn(
          'sb-float inline-flex h-14 items-center gap-2 rounded-full bg-[#25d366] font-medium text-[#0b3d1f] shadow-[0_12px_32px_-12px_rgb(0_0_0/0.45)] transition-transform duration-200 hover:-translate-y-0.5 active:scale-[0.97]',
          style === 'icon' ? 'w-14 justify-center' : 'px-5',
        )}
      >
        <MessageCircle className="size-5" strokeWidth={2} />
        <span className={style === 'pill' ? undefined : 'sr-only'}>{text}</span>
      </a>
    )
  },
}

/* ------------------------------------------------------------------ Testimonials (static) */

type TestimonialItem = { quote: Bi; author: string; detail: Bi }
export const Testimonials: ComponentConfig<
  Band & { title: Bi; items: TestimonialItem[]; layout: 'grid' | 'feature' }
> = {
  label: 'Testimonials',
  fields: {
    title: biField('Title'),
    items: {
      type: 'array',
      label: 'Quotes',
      max: 9,
      getItemSummary: (item: TestimonialItem) => item.author || 'Quote',
      defaultItemProps: {
        quote: { en: 'Wonderful, calm and professional.' },
        author: 'Guest',
        detail: { en: '' },
      },
      arrayFields: {
        quote: biField('Quote', { multiline: true }),
        author: text('Name'),
        detail: biField('Detail (e.g. treatment)'),
      },
    },
    layout: radio('Layout', [
      ['grid', 'Grid'],
      ['feature', 'Single feature'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    ...band,
    title: { en: 'Kind words', ar: 'آراء ضيوفنا' },
    layout: 'grid',
    items: [
      {
        quote: {
          en: 'The most relaxing hour of my month. Beautiful space and lovely therapists.',
          ar: 'أكثر ساعة استرخاء في شهري. مكان جميل ومعالجون رائعون.',
        },
        author: 'Layla',
        detail: { en: 'Swedish massage', ar: 'مساج سويدي' },
      },
      {
        quote: {
          en: 'Booked on WhatsApp in a minute and they were right on time.',
          ar: 'حجزت عبر واتساب في دقيقة وكانوا في الموعد تمامًا.',
        },
        author: 'Daniel',
        detail: { en: 'Deep tissue', ar: 'مساج الأنسجة العميقة' },
      },
      {
        quote: {
          en: 'Spotless, quiet and genuinely skilled. I always leave lighter.',
          ar: 'نظيف وهادئ ومهارة حقيقية. أخرج دائمًا وأنا أخف.',
        },
        author: 'Mariam',
        detail: { en: 'Hot stone', ar: 'الأحجار الساخنة' },
      },
    ],
  },
  render: ({ puck, title, items, layout, ...shell }) => {
    const meta = metaOf(puck)
    const list = items ?? []
    if (layout === 'feature' && list[0]) {
      const q = list[0]
      return (
        <SectionShell meta={meta} {...shell} width="narrow">
          <figure className="m-0 text-center">
            <Quote className="mx-auto size-8 text-muted" strokeWidth={1.25} />
            <blockquote className="sb-heading mt-6 text-2xl sm:text-3xl">“{tr(q.quote, meta)}”</blockquote>
            <figcaption className="mt-6 text-sm text-muted">
              {q.author}
              {tr(q.detail, meta) && ` · ${tr(q.detail, meta)}`}
            </figcaption>
          </figure>
        </SectionShell>
      )
    }
    return (
      <SectionShell meta={meta} {...shell}>
        <SectionTitle title={title} meta={meta} />
        <div className="grid gap-4 md:grid-cols-3">
          {list.map((q, i) => (
            <figure
              // biome-ignore lint/suspicious/noArrayIndexKey: editor-ordered list
              key={i}
              className="sb-card sb-lift m-0 flex flex-col justify-between gap-6 border bg-surface p-6 sm:p-8"
            >
              <blockquote className="sb-prose m-0 text-[17px]">“{tr(q.quote, meta)}”</blockquote>
              <figcaption className="text-sm text-muted">
                <span className="font-medium text-fg">{q.author}</span>
                {tr(q.detail, meta) && ` · ${tr(q.detail, meta)}`}
              </figcaption>
            </figure>
          ))}
        </div>
      </SectionShell>
    )
  },
}

/* ------------------------------------------------------------------ FAQ */

type FaqItem = { q: Bi; a: Bi }
export const FAQ: ComponentConfig<Band & { title: Bi; items: FaqItem[]; layout: 'accordion' | 'columns' }> = {
  label: 'FAQ',
  fields: {
    title: biField('Title'),
    items: {
      type: 'array',
      label: 'Questions',
      max: 20,
      getItemSummary: (item: FaqItem) => item.q?.en || 'Question',
      defaultItemProps: { q: { en: 'New question' }, a: { en: 'Answer' } },
      arrayFields: { q: biField('Question'), a: biField('Answer', { multiline: true }) },
    },
    layout: radio('Layout', [
      ['accordion', 'Accordion'],
      ['columns', 'Two columns'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    ...band,
    title: { en: 'Good to know', ar: 'معلومات مفيدة' },
    layout: 'accordion',
    items: [
      {
        q: { en: 'How do I book?', ar: 'كيف أحجز؟' },
        a: {
          en: 'Book online in a minute, or message us on WhatsApp.',
          ar: 'احجز أونلاين خلال دقيقة، أو راسلنا على واتساب.',
        },
      },
      {
        q: { en: 'Can I choose a female or male therapist?', ar: 'هل يمكنني اختيار معالجة أو معالج؟' },
        a: { en: 'Yes — tell us your preference when you book.', ar: 'نعم، أخبرنا بتفضيلك عند الحجز.' },
      },
      {
        q: { en: 'How do I pay?', ar: 'كيف أدفع؟' },
        a: {
          en: 'Pay at the spa by cash or card. Prices include VAT.',
          ar: 'الدفع في المركز نقدًا أو بالبطاقة. الأسعار شاملة الضريبة.',
        },
      },
    ],
  },
  render: ({ puck, title, items, layout, ...shell }) => {
    const meta = metaOf(puck)
    const list = items ?? []
    if (layout === 'columns') {
      return (
        <SectionShell meta={meta} {...shell}>
          <SectionTitle title={title} meta={meta} />
          <dl className="grid gap-x-12 gap-y-10 md:grid-cols-2">
            {list.map((f, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: editor-ordered list
              <div key={i}>
                <dt className="sb-heading text-lg">{tr(f.q, meta)}</dt>
                <dd className="sb-prose m-0 mt-2 whitespace-pre-line text-muted">{tr(f.a, meta)}</dd>
              </div>
            ))}
          </dl>
        </SectionShell>
      )
    }
    return (
      <SectionShell meta={meta} {...shell} width="narrow">
        <SectionTitle title={title} meta={meta} />
        <div className="divide-y border-y">
          {list.map((f, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: editor-ordered list
            <details key={i} className="sb-faq group" open={meta.editing && i === 0}>
              <summary className="flex min-h-14 items-center justify-between gap-6 py-4 text-[17px] font-medium">
                {tr(f.q, meta)}
                <Plus className="sb-faq-icon size-5 shrink-0 text-muted" strokeWidth={1.5} />
              </summary>
              <p className="sb-faq-body sb-prose m-0 pb-5 whitespace-pre-line text-muted">{tr(f.a, meta)}</p>
            </details>
          ))}
        </div>
      </SectionShell>
    )
  },
}

/* ------------------------------------------------------------------ Footer */

export const Footer: ComponentConfig<
  Band & { tagline: Bi; variant: 'columns' | 'simple'; showHours: boolean }
> = {
  label: 'Footer',
  fields: {
    tagline: biField('Tagline'),
    variant: radio('Layout', [
      ['columns', 'Columns'],
      ['simple', 'Simple'],
    ]),
    showHours: radio('Hours summary', [
      [true, 'Show'],
      [false, 'Hide'],
    ]),
    ...bandFields,
  },
  defaultProps: {
    background: 'inverse',
    padding: { base: 'md', lg: 'lg' },
    tagline: { en: 'Massage & wellness', ar: 'مساج وعافية' },
    variant: 'columns',
    showHours: true,
  },
  render: ({ puck, tagline, variant, showHours, ...shell }) => {
    const meta = metaOf(puck)
    const { tenant, branch, pages } = meta.data
    const year = new Date().getFullYear()
    const wa = whatsappHref(meta)
    const phone = phoneHref(meta)
    const todays = meta.today
      ? branch?.openingHours?.[meta.today as keyof typeof branch.openingHours]
      : undefined
    const nav = (
      <ul className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]">
        {pages.map((p) => (
          <li key={p.slug}>
            <a
              {...linkProps(meta, pageHref(meta, p.slug))}
              className="text-muted transition-colors hover:text-fg"
            >
              {tr(p.title, meta)}
            </a>
          </li>
        ))}
      </ul>
    )
    if (variant === 'simple') {
      return (
        <footer>
          <SectionShell meta={meta} {...shell}>
            <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <p className="sb-heading text-lg">{tenant.name}</p>
              {nav}
              <p className="text-sm text-muted">
                © {year} {tenant.name}
              </p>
            </div>
          </SectionShell>
        </footer>
      )
    }
    return (
      <footer>
        <SectionShell meta={meta} {...shell}>
          <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
            <div className="space-y-3">
              <p className="sb-heading text-2xl">{tenant.name}</p>
              {tr(tagline, meta) && <p className="text-muted">{tr(tagline, meta)}</p>}
              {showHours && todays !== undefined && (
                <p className="text-sm text-muted">
                  {ui('today', meta.locale)}:{' '}
                  <span dir="ltr">
                    {todays.length
                      ? todays
                          .map((s) => `${clock(s.open, meta.locale)} – ${clock(s.close, meta.locale)}`)
                          .join(', ')
                      : ui('closed', meta.locale)}
                  </span>
                </p>
              )}
            </div>
            <div className="space-y-3">
              <p className="text-xs font-medium tracking-[0.2em] text-muted uppercase">
                {ui('pages', meta.locale)}
              </p>
              <ul className="space-y-2 text-[15px]">
                {pages.map((p) => (
                  <li key={p.slug}>
                    <a
                      {...linkProps(meta, pageHref(meta, p.slug))}
                      className="transition-colors hover:text-muted"
                    >
                      {tr(p.title, meta)}
                    </a>
                  </li>
                ))}
                <li>
                  <a {...linkProps(meta, bookHref(meta))} className="transition-colors hover:text-muted">
                    {ui('book', meta.locale)}
                  </a>
                </li>
              </ul>
            </div>
            <div className="space-y-3">
              <p className="text-xs font-medium tracking-[0.2em] text-muted uppercase">
                {ui('contact', meta.locale)}
              </p>
              <ul className="space-y-2 text-[15px]">
                {branch?.address && (
                  <li className="text-muted">
                    <a {...addressLinkProps(meta)} className="text-inherit hover:underline">
                      {branch.address}
                    </a>
                  </li>
                )}
                {phone && (
                  <li>
                    <a {...linkProps(meta, phone)} dir="ltr" className="hover:text-muted">
                      {branch?.phone}
                    </a>
                  </li>
                )}
                {wa && (
                  <li>
                    <a {...linkProps(meta, wa)} className="hover:text-muted">
                      WhatsApp
                    </a>
                  </li>
                )}
              </ul>
            </div>
          </div>
          <p className="mt-12 border-t pt-6 text-sm text-muted">
            © {year} {tenant.name}. {ui('rights', meta.locale)}
          </p>
        </SectionShell>
      </footer>
    )
  },
}

import type { SiteTemplate } from '@spa/services'
import type { SiteTheme } from './theme'
import type { Bi } from './types'

/**
 * Full-site templates (PLAN §11.2): theme tokens + starter pages built from the shared blocks, so switching
 * template keeps content and only swaps tokens. Nodes that hold the spa's own words carry a copy slot in their
 * id (`…--hero`, `…--about`, `…--usp-1-title`, `…--faq`, `…--cta`) so the AI site writer can fill them.
 */
type Node = { type: string; props: Record<string, unknown> }
type Build = (type: string, props?: Record<string, unknown>, slot?: string) => Node

function builder(prefix: string): Build {
  let n = 0
  return (type, props = {}, slot) => ({
    type,
    props: { id: `${prefix}-${type.toLowerCase()}-${++n}${slot ? `--${slot}` : ''}`, ...props },
  })
}

type PageData = { root: { props: { title: Bi; description: Bi } }; content: Node[] }
const page = (title: Bi, description: Bi, content: Node[]): PageData => ({
  root: { props: { title, description } },
  content,
})

type Button = { label: Bi; action: string; target: string; style: string }
const BOOK: Button = {
  label: { en: 'Book a treatment', ar: 'احجز جلستك' },
  action: 'book',
  target: '',
  style: 'primary',
}
const SEE_MENU: Button = {
  label: { en: 'See the menu', ar: 'تصفح القائمة' },
  action: 'page',
  target: 'services',
  style: 'secondary',
}
const WHATSAPP: Button = {
  label: { en: 'WhatsApp us', ar: 'راسلنا على واتساب' },
  action: 'whatsapp',
  target: '',
  style: 'secondary',
}
const ABOUT_LINK: Button = {
  label: { en: 'Our story', ar: 'قصتنا' },
  action: 'page',
  target: 'about',
  style: 'link',
}

const SEO = {
  home: {
    title: { en: '{name} — Massage & wellness', ar: '{name} — مساج وعافية' },
    description: {
      en: 'Book a massage at {name}. Skilled therapists, calm rooms and clear prices.',
      ar: 'احجز جلسة مساج في {name}. معالجون مهرة وغرف هادئة وأسعار واضحة.',
    },
  },
  services: {
    title: { en: 'Treatments & prices — {name}', ar: 'الجلسات والأسعار — {name}' },
    description: {
      en: 'Our full massage menu with prices in AED.',
      ar: 'قائمة جلسات المساج الكاملة مع الأسعار بالدرهم.',
    },
  },
  about: {
    title: { en: 'About us — {name}', ar: 'من نحن — {name}' },
    description: {
      en: 'Meet the team and the story behind {name}.',
      ar: 'تعرّف على فريقنا وعلى قصة {name}.',
    },
  },
  gallery: {
    title: { en: 'Gallery — {name}', ar: 'المعرض — {name}' },
    description: { en: 'A look inside {name}.', ar: 'نظرة إلى داخل {name}.' },
  },
  offers: {
    title: { en: 'Offers & packages — {name}', ar: 'العروض والباقات — {name}' },
    description: {
      en: 'Current offers and massage packages at {name}.',
      ar: 'العروض الحالية وباقات المساج في {name}.',
    },
  },
  contact: {
    title: { en: 'Contact & opening hours — {name}', ar: 'التواصل وساعات العمل — {name}' },
    description: {
      en: 'Find us, call or WhatsApp {name}.',
      ar: 'اعثر علينا أو اتصل بنا أو راسل {name} على واتساب.',
    },
  },
}

const PAGE_TITLES = {
  home: { en: 'Home', ar: 'الرئيسية' },
  services: { en: 'Treatments', ar: 'الجلسات' },
  about: { en: 'About', ar: 'من نحن' },
  gallery: { en: 'Gallery', ar: 'المعرض' },
  offers: { en: 'Offers', ar: 'العروض' },
  contact: { en: 'Contact', ar: 'تواصل' },
}

type Bg = 'none' | 'surface' | 'subtle' | 'soft' | 'inverse' | 'accent'
type Pad = { base: string; md?: string; lg?: string }
type Faq = { q: Bi; a: Bi }
type Quote = { quote: Bi; author: string; detail: Bi }
type Usp = [title: Bi, text: Bi]

/* ------------------------------------------------------------------ Block helpers */

const heading = (
  c: Build,
  eyebrow: Bi,
  text: Bi,
  o: { level?: 'h1' | 'h2' | 'h3'; size?: 'display' | 'xl' | 'lg' | 'md'; align?: string } = {},
  slot?: string,
) =>
  c(
    'Heading',
    { eyebrow, text, level: o.level ?? 'h2', size: o.size ?? 'lg', align: { base: o.align ?? 'start' } },
    slot,
  )

const para = (
  c: Build,
  text: Bi,
  o: { size?: 'sm' | 'md' | 'lg'; tone?: 'default' | 'muted'; measure?: string; align?: string } = {},
  slot?: string,
) =>
  c(
    'RichText',
    {
      text,
      size: o.size ?? 'md',
      tone: o.tone ?? 'muted',
      measure: o.measure ?? 'normal',
      align: { base: o.align ?? 'start' },
    },
    slot,
  )

const buttons = (
  c: Build,
  items: Button[],
  o: { size?: 'md' | 'lg'; stack?: boolean; align?: string } = {},
) =>
  c('ButtonGroup', {
    buttons: items,
    size: o.size ?? 'md',
    stackOnMobile: o.stack ?? false,
    align: { base: o.align ?? 'start' },
  })

const section = (
  c: Build,
  content: Node[],
  o: {
    background?: Bg
    width?: 'narrow' | 'contained' | 'full'
    padding?: Pad
    gap?: 'sm' | 'md' | 'lg'
  } = {},
) =>
  c('Section', {
    background: o.background ?? 'none',
    width: o.width ?? 'contained',
    padding: o.padding ?? { base: 'lg', lg: 'xl' },
    gap: o.gap ?? 'md',
    content,
  })

const columns = (
  c: Build,
  ratio: string,
  cols: Node[][],
  o: { gap?: 'sm' | 'md' | 'lg'; valign?: string; mobileOrder?: 'normal' | 'reverse' } = {},
) =>
  c('Columns', {
    ratio,
    gap: o.gap ?? 'lg',
    valign: o.valign ?? 'start',
    mobileOrder: o.mobileOrder ?? 'normal',
    col1: cols[0] ?? [],
    col2: cols[1] ?? [],
    col3: cols[2] ?? [],
    col4: cols[3] ?? [],
  })

const image = (c: Build, alt: Bi, aspect = 'portrait') =>
  c('Image', { src: '', alt, caption: { en: '' }, aspect, rounded: true })

/** A USP: small heading + text. The first three are AI copy slots (usp-1…3). */
const usp = (c: Build, i: number, [title, text]: Usp, align = 'start') =>
  c('Stack', {
    direction: 'vertical',
    gap: 'xs',
    align: { base: align },
    wrap: false,
    items: [
      heading(
        c,
        { en: '' },
        title,
        { level: 'h3', size: 'md', align },
        i < 3 ? `usp-${i + 1}-title` : undefined,
      ),
      para(c, text, { measure: 'full', align }, i < 3 ? `usp-${i + 1}-text` : undefined),
    ],
  })

const uspRow = (c: Build, items: Usp[], o: { background?: Bg; align?: string; padding?: Pad } = {}) =>
  section(
    c,
    [
      columns(
        c,
        items.length === 4 ? '1-1-1-1' : '1-1-1',
        items.map((u, i) => [usp(c, i, u, o.align)]),
      ),
    ],
    { background: o.background ?? 'surface', padding: o.padding ?? { base: 'lg' } },
  )

const services = (
  c: Build,
  o: {
    title: Bi
    intro?: Bi
    layout: 'list' | 'cards'
    limit?: number
    background?: Bg
    descriptions?: boolean
    padding?: Pad
  },
) =>
  c('ServicesMenu', {
    title: o.title,
    intro: o.intro ?? { en: '' },
    layout: o.layout,
    showDescriptions: o.descriptions ?? true,
    showBook: true,
    limit: o.limit ?? 6,
    background: o.background ?? 'none',
    padding: o.padding ?? { base: 'lg', lg: 'xl' },
  })

const team = (c: Build, title: Bi, o: { layout?: 'grid' | 'compact'; background?: Bg; intro?: Bi } = {}) =>
  c('Team', {
    title,
    intro: o.intro ?? { en: '' },
    layout: o.layout ?? 'grid',
    showBio: true,
    background: o.background ?? 'none',
    padding: { base: 'lg', lg: 'xl' },
  })

const testimonials = (
  c: Build,
  title: Bi,
  items: Quote[],
  o: { layout?: 'grid' | 'feature'; background?: Bg } = {},
) =>
  c('Testimonials', {
    title,
    layout: o.layout ?? 'grid',
    items,
    background: o.background ?? 'none',
    padding: { base: 'lg', lg: 'xl' },
  })

const faq = (
  c: Build,
  items: Faq[],
  o: { title?: Bi; layout?: 'accordion' | 'columns'; background?: Bg } = {},
) =>
  c(
    'FAQ',
    {
      title: o.title ?? { en: 'Good to know', ar: 'معلومات مفيدة' },
      layout: o.layout ?? 'accordion',
      items,
      background: o.background ?? 'none',
      padding: { base: 'lg', lg: 'xl' },
    },
    'faq',
  )

const cta = (
  c: Build,
  o: { variant: 'banner' | 'card' | 'split'; title: Bi; text: Bi; background?: Bg; label?: Bi },
) =>
  c(
    'BookingCTA',
    {
      variant: o.variant,
      title: o.title,
      text: o.text,
      buttonLabel: o.label ?? { en: 'Book online', ar: 'احجز أونلاين' },
      showWhatsApp: true,
      background: o.background ?? 'accent',
      padding: { base: 'lg', lg: 'xl' },
    },
    'cta',
  )

const hours = (c: Build, o: { title?: Bi; layout?: 'split' | 'table'; background?: Bg } = {}) =>
  c('OpeningHours', {
    title: o.title ?? { en: 'Visit us', ar: 'زورونا' },
    layout: o.layout ?? 'split',
    showMap: true,
    background: o.background ?? 'none',
    padding: { base: 'lg', lg: 'xl' },
  })

const gallery = (
  c: Build,
  o: {
    title: Bi
    count: number
    layout: 'grid' | 'mosaic' | 'strip'
    columns?: '2' | '3' | '4'
    background?: Bg
  },
) =>
  c('Gallery', {
    title: o.title,
    images: Array.from({ length: o.count }, (_, i) => ({
      src: '',
      alt: GALLERY_ALTS[i % GALLERY_ALTS.length]!,
    })),
    layout: o.layout,
    columns: o.columns ?? '3',
    background: o.background ?? 'none',
    padding: { base: 'lg', lg: 'xl' },
  })

const GALLERY_ALTS: Bi[] = [
  { en: 'Treatment room', ar: 'غرفة العلاج' },
  { en: 'Reception', ar: 'الاستقبال' },
  { en: 'Warm oils and towels', ar: 'زيوت دافئة ومناشف' },
  { en: 'Relaxation lounge', ar: 'صالة الاسترخاء' },
  { en: 'Massage in progress', ar: 'جلسة مساج' },
  { en: 'Details of the spa', ar: 'تفاصيل من المركز' },
]

const footer = (c: Build, tagline: Bi, variant: 'columns' | 'simple' = 'columns') =>
  c('Footer', {
    variant,
    tagline,
    showHours: true,
    background: 'inverse',
    padding: { base: 'md', lg: 'lg' },
  })

const whatsapp = (c: Build, style: 'pill' | 'icon' = 'pill') =>
  c('WhatsAppButton', {
    label: { en: 'WhatsApp', ar: 'واتساب' },
    message: { en: "Hi {name}, I'd like to book a massage.", ar: 'مرحبًا {name}، أود حجز جلسة مساج.' },
    side: 'end',
    style,
  })

/** Page intro band: eyebrow + H1 + lead text (+ optional buttons). */
const intro = (
  c: Build,
  eyebrow: Bi,
  title: Bi,
  lead: Bi | null,
  o: { background?: Bg; align?: string; extra?: Node[] } = {},
) =>
  section(
    c,
    [
      heading(c, eyebrow, title, { level: 'h1', size: 'xl', align: o.align }),
      ...(lead ? [para(c, lead, { size: 'lg', align: o.align })] : []),
      ...(o.extra ?? []),
    ],
    { background: o.background, width: o.align === 'center' ? 'narrow' : 'contained' },
  )

/* ------------------------------------------------------------------ Shared copy */

const FAQ_BASICS: Faq[] = [
  {
    q: { en: 'How do I book?', ar: 'كيف أحجز؟' },
    a: {
      en: 'Online in a minute, or message us on WhatsApp.',
      ar: 'أونلاين خلال دقيقة، أو راسلنا على واتساب.',
    },
  },
  {
    q: { en: 'How do I pay?', ar: 'كيف أدفع؟' },
    a: {
      en: 'At the spa, by cash or card. Prices include VAT.',
      ar: 'في المركز نقدًا أو بالبطاقة. الأسعار شاملة الضريبة.',
    },
  },
  {
    q: { en: 'Can I choose a female or male therapist?', ar: 'هل يمكنني اختيار معالجة أو معالج؟' },
    a: {
      en: 'Of course — add your preference to the booking note.',
      ar: 'بالتأكيد، أضف تفضيلك في ملاحظة الحجز.',
    },
  },
  {
    q: { en: 'What if I am running late?', ar: 'ماذا لو تأخرت؟' },
    a: {
      en: 'Message us; we will do our best to keep your full time.',
      ar: 'راسلنا وسنبذل جهدنا للحفاظ على وقتك كاملًا.',
    },
  },
]

const FAQ_VISIT: Faq[] = [
  {
    q: { en: 'Where do I park?', ar: 'أين أركن سيارتي؟' },
    a: {
      en: 'Ask us on WhatsApp and we will send directions and parking tips.',
      ar: 'راسلنا على واتساب وسنرسل لك الاتجاهات ومكان الوقوف.',
    },
  },
  {
    q: { en: 'Can I come without a booking?', ar: 'هل يمكنني الحضور دون حجز؟' },
    a: {
      en: 'Walk-ins are welcome when a therapist is free; booking guarantees your time.',
      ar: 'نرحب بالزيارات دون حجز عند توفر معالج، والحجز يضمن موعدك.',
    },
  },
]

const QUOTES: Quote[] = [
  {
    quote: {
      en: 'Five-star hotel quality without the hotel prices.',
      ar: 'جودة فنادق الخمس نجوم بدون أسعارها.',
    },
    author: 'Sara',
    detail: { en: 'Hot stone', ar: 'الأحجار الساخنة' },
  },
  {
    quote: {
      en: 'Impeccable from the welcome tea to the last minute.',
      ar: 'مثالي من شاي الترحيب حتى آخر دقيقة.',
    },
    author: 'Omar',
    detail: { en: 'Deep tissue', ar: 'الأنسجة العميقة' },
  },
  {
    quote: { en: 'The best massage I have had in Dubai.', ar: 'أفضل مساج جربته في دبي.' },
    author: 'Anna',
    detail: { en: 'Swedish massage', ar: 'مساج سويدي' },
  },
]

/* ------------------------------------------------------------------ Shared pages */

function servicesPage(
  c: Build,
  o: {
    layout: 'list' | 'cards'
    ctaBg: Bg
    ctaVariant?: 'banner' | 'card' | 'split'
    footer?: 'columns' | 'simple'
    title?: Bi
    descriptions?: boolean
    whatsapp?: 'pill' | 'icon'
  },
) {
  return page(SEO.services.title, SEO.services.description, [
    section(
      c,
      [
        heading(
          c,
          { en: 'Menu', ar: 'القائمة' },
          o.title ?? { en: 'Treatments & prices', ar: 'الجلسات والأسعار' },
          {
            level: 'h1',
            size: 'xl',
          },
        ),
        para(
          c,
          {
            en: 'All prices are in AED and include VAT. Not sure what to choose? Message us and we will help.',
            ar: 'جميع الأسعار بالدرهم وشاملة ضريبة القيمة المضافة. لست متأكدًا؟ راسلنا وسنساعدك.',
          },
          { size: 'lg' },
        ),
      ],
      { padding: { base: 'lg', lg: 'xl' } },
    ),
    services(c, {
      title: { en: '' },
      layout: o.layout,
      limit: 0,
      descriptions: o.descriptions,
      padding: { base: 'sm', lg: 'md' },
    }),
    cta(c, {
      variant: o.ctaVariant ?? 'banner',
      title: { en: 'Found your treatment?', ar: 'وجدت جلستك؟' },
      text: { en: 'Pick a time that suits you.', ar: 'اختر الوقت المناسب لك.' },
      background: o.ctaBg,
    }),
    footer(c, { en: 'Massage & wellness', ar: 'مساج وعافية' }, o.footer),
    whatsapp(c, o.whatsapp),
  ])
}

function contactPage(
  c: Build,
  o: {
    faqLayout?: 'accordion' | 'columns'
    hoursBg?: Bg
    footer?: 'columns' | 'simple'
    title?: Bi
    whatsapp?: 'pill' | 'icon'
  } = {},
) {
  return page(SEO.contact.title, SEO.contact.description, [
    section(c, [
      heading(
        c,
        { en: 'Contact', ar: 'تواصل' },
        o.title ?? { en: 'We would love to see you', ar: 'يسعدنا استقبالكم' },
        {
          level: 'h1',
          size: 'xl',
        },
      ),
      buttons(c, [BOOK, WHATSAPP], { size: 'lg', stack: true }),
    ]),
    hours(c, { background: o.hoursBg ?? 'subtle' }),
    faq(c, [...FAQ_VISIT, ...FAQ_BASICS.slice(0, 2)], { layout: o.faqLayout }),
    footer(c, { en: 'Massage & wellness', ar: 'مساج وعافية' }, o.footer),
    whatsapp(c, o.whatsapp),
  ])
}

function aboutPage(
  c: Build,
  o: {
    title: Bi
    lead: Bi
    aboutTitle: Bi
    about: Bi
    usps: Usp[]
    imageAspect?: string
    teamLayout?: 'grid' | 'compact'
    ctaBg?: Bg
    ctaVariant?: 'banner' | 'card' | 'split'
    footer?: 'columns' | 'simple'
    tagline: Bi
    introAlign?: string
    whatsapp?: 'pill' | 'icon'
  },
) {
  return page(SEO.about.title, SEO.about.description, [
    intro(c, { en: 'About us', ar: 'من نحن' }, o.title, o.lead, { align: o.introAlign }),
    section(
      c,
      [
        columns(
          c,
          '1-1',
          [
            [image(c, { en: 'Our spa', ar: 'مركزنا' }, o.imageAspect ?? 'portrait')],
            [heading(c, { en: '' }, o.aboutTitle), para(c, o.about, {}, 'about')],
          ],
          { valign: 'center', mobileOrder: 'reverse' },
        ),
      ],
      { background: 'surface' },
    ),
    uspRow(c, o.usps, { background: 'none' }),
    team(c, { en: 'Meet the team', ar: 'تعرّف على الفريق' }, { layout: o.teamLayout, background: 'subtle' }),
    cta(c, {
      variant: o.ctaVariant ?? 'banner',
      title: { en: 'Come and see for yourself', ar: 'تعال وجرّب بنفسك' },
      text: { en: 'Book online in under a minute.', ar: 'احجز أونلاين في أقل من دقيقة.' },
      background: o.ctaBg ?? 'accent',
    }),
    footer(c, o.tagline, o.footer),
    whatsapp(c, o.whatsapp),
  ])
}

function galleryPage(
  c: Build,
  o: { title: Bi; lead: Bi; layout: 'grid' | 'mosaic'; tagline: Bi; whatsapp?: 'pill' | 'icon' },
) {
  return page(SEO.gallery.title, SEO.gallery.description, [
    intro(c, { en: 'Gallery', ar: 'المعرض' }, o.title, o.lead),
    gallery(c, { title: { en: '' }, count: 9, layout: o.layout, columns: '3' }),
    cta(c, {
      variant: 'card',
      title: { en: 'See it in person', ar: 'شاهده بنفسك' },
      text: { en: 'Your room is ready when you are.', ar: 'غرفتك جاهزة متى شئت.' },
      background: 'none',
    }),
    footer(c, o.tagline),
    whatsapp(c, o.whatsapp),
  ])
}

type Offer = { title: Bi; text: Bi }
function offersPage(
  c: Build,
  o: {
    title: Bi
    lead: Bi
    offers: Offer[]
    tagline: Bi
    footer?: 'columns' | 'simple'
    aspect?: string
    whatsapp?: 'pill' | 'icon'
  },
) {
  const card = (offer: Offer) =>
    c('Stack', {
      direction: 'vertical',
      gap: 'sm',
      align: { base: 'start' },
      wrap: false,
      items: [
        image(c, offer.title, o.aspect ?? 'landscape'),
        heading(c, { en: '' }, offer.title, { level: 'h3', size: 'md' }),
        para(c, offer.text, { measure: 'full' }),
        buttons(c, [{ ...BOOK, label: { en: 'Book this offer', ar: 'احجز هذا العرض' }, style: 'secondary' }]),
      ],
    })
  return page(SEO.offers.title, SEO.offers.description, [
    intro(c, { en: 'Offers', ar: 'العروض' }, o.title, o.lead),
    section(
      c,
      [
        columns(
          c,
          o.offers.length === 2 ? '1-1' : '1-1-1',
          o.offers.map((x) => [card(x)]),
        ),
      ],
      {
        padding: { base: 'md', lg: 'lg' },
      },
    ),
    faq(
      c,
      [
        {
          q: { en: 'Can I combine offers?', ar: 'هل يمكنني الجمع بين العروض؟' },
          a: { en: 'One offer per visit, please.', ar: 'عرض واحد لكل زيارة من فضلك.' },
        },
        {
          q: { en: 'Can I buy an offer as a gift?', ar: 'هل يمكنني شراء عرض كهدية؟' },
          a: {
            en: 'Yes — ask us for a gift card at the spa or on WhatsApp.',
            ar: 'نعم، اطلب بطاقة هدية في المركز أو عبر واتساب.',
          },
        },
      ],
      { title: { en: 'The small print', ar: 'تفاصيل العروض' }, layout: 'columns', background: 'subtle' },
    ),
    footer(c, o.tagline, o.footer),
    whatsapp(c, o.whatsapp),
  ])
}

type StarterPages = Partial<Record<keyof typeof PAGE_TITLES, PageData>>
const ORDER = ['home', 'services', 'about', 'gallery', 'offers', 'contact'] as const
const SLUGS: Record<(typeof ORDER)[number], string> = {
  home: '',
  services: 'services',
  about: 'about',
  gallery: 'gallery',
  offers: 'offers',
  contact: 'contact',
}
const pages = (p: StarterPages) =>
  ORDER.filter((k) => p[k]).map((k) => ({ slug: SLUGS[k], title: PAGE_TITLES[k], data: p[k]! }))

/* ------------------------------------------------------------------ Zen Minimal */

const zenTheme: SiteTheme = {
  bg: '#f5f2ec',
  surface: '#fbf9f5',
  subtle: '#ebe5db',
  border: '#ddd5c8',
  fg: '#2a2723',
  muted: '#756d62',
  accent: '#7d6a55',
  accentFg: '#fbf9f5',
  accentSoft: '#ece4d8',
  inverseBg: '#2a2723',
  inverseFg: '#f5f2ec',
  headingFont: 'serif',
  bodyFont: 'sans',
  headingWeight: 400,
  headingCase: 'none',
  headingTracking: -0.01,
  radius: 'soft',
  buttonShape: 'pill',
  density: 'airy',
  motion: 'subtle',
  pattern: 'none',
  arabicFont: 'naskh',
  imageShape: 'theme',
}

const ZEN_ABOUT: Bi = {
  en: 'Every treatment starts with a short conversation about how you feel today. Then we take our time — no rushing, no noise.\n\nOur therapists are trained in Swedish, deep tissue, Thai and hot stone massage.',
  ar: 'تبدأ كل جلسة بحديث قصير عن شعورك اليوم، ثم نأخذ وقتنا بلا استعجال ولا ضجيج.\n\nمعالجونا مدرّبون على المساج السويدي والأنسجة العميقة والتايلاندي والأحجار الساخنة.',
}
const CALM_USPS: Usp[] = [
  [
    { en: 'Skilled therapists', ar: 'معالجون مهرة' },
    {
      en: 'Certified, experienced and attentive to how you feel.',
      ar: 'معتمدون وذوو خبرة ومنتبهون لما تشعر به.',
    },
  ],
  [
    { en: 'Clear prices', ar: 'أسعار واضحة' },
    {
      en: 'Prices in AED, VAT included. No surprises at checkout.',
      ar: 'الأسعار بالدرهم شاملة الضريبة. بلا مفاجآت عند الدفع.',
    },
  ],
  [
    { en: 'Easy booking', ar: 'حجز سهل' },
    { en: 'Book online or on WhatsApp — whatever suits you.', ar: 'احجز أونلاين أو عبر واتساب، كما يناسبك.' },
  ],
]

function zen(): SiteTemplate {
  const c = builder('zen')
  const home = page(SEO.home.title, SEO.home.description, [
    c(
      'Hero',
      {
        variant: 'centered',
        eyebrow: { en: 'Massage & wellness', ar: 'مساج وعافية' },
        title: { en: 'Slow down. Breathe. Restore.', ar: 'تمهّل. تنفّس. استعد توازنك.' },
        subtitle: {
          en: 'Quiet rooms, warm oils and unhurried hands at {name}.',
          ar: 'غرف هادئة وزيوت دافئة وأيدٍ لا تستعجل في {name}.',
        },
        buttons: [BOOK, SEE_MENU],
        image: '',
        imageAlt: { en: '' },
        background: 'none',
      },
      'hero',
    ),
    section(
      c,
      [
        columns(
          c,
          '1-1',
          [
            [image(c, { en: 'Treatment room', ar: 'غرفة العلاج' })],
            [
              heading(
                c,
                { en: 'Our approach', ar: 'فلسفتنا' },
                { en: 'Time that belongs to you', ar: 'وقت مخصص لك وحدك' },
              ),
              para(c, ZEN_ABOUT, {}, 'about'),
              buttons(c, [{ ...SEE_MENU, style: 'link' }]),
            ],
          ],
          { valign: 'center', mobileOrder: 'reverse' },
        ),
      ],
      { background: 'surface' },
    ),
    services(c, {
      title: { en: 'Treatments', ar: 'الجلسات' },
      intro: { en: 'Prices include VAT.', ar: 'الأسعار شاملة الضريبة.' },
      layout: 'list',
    }),
    testimonials(
      c,
      { en: 'Kind words', ar: 'آراء ضيوفنا' },
      [
        {
          quote: {
            en: 'The calmest hour of my week. I leave feeling lighter every time.',
            ar: 'أهدأ ساعة في أسبوعي. أخرج كل مرة وأنا أشعر بخفة.',
          },
          author: 'Layla',
          detail: { en: 'Swedish massage', ar: 'مساج سويدي' },
        },
      ],
      { layout: 'feature', background: 'subtle' },
    ),
    hours(c),
    cta(c, {
      variant: 'card',
      title: { en: 'Your hour of calm is waiting', ar: 'ساعة هدوئك بانتظارك' },
      text: { en: 'Book online in under a minute.', ar: 'احجز أونلاين في أقل من دقيقة.' },
      background: 'none',
    }),
    footer(c, { en: 'Massage & wellness', ar: 'مساج وعافية' }),
    whatsapp(c),
  ])
  return {
    key: 'zen',
    name: 'Zen Minimal',
    theme: zenTheme,
    pages: pages({
      home,
      services: servicesPage(c, { layout: 'list', ctaBg: 'accent' }),
      about: aboutPage(c, {
        title: { en: 'A quiet place in a busy city', ar: 'مكان هادئ في مدينة مزدحمة' },
        lead: {
          en: '{name} was created for one simple thing: an hour where nothing is asked of you.',
          ar: 'أُنشئ {name} لأمر واحد بسيط: ساعة لا يُطلب منك فيها شيء.',
        },
        aboutTitle: { en: 'Our approach', ar: 'فلسفتنا' },
        about: ZEN_ABOUT,
        usps: CALM_USPS,
        ctaVariant: 'card',
        ctaBg: 'none',
        tagline: { en: 'Massage & wellness', ar: 'مساج وعافية' },
      }),
      contact: contactPage(c),
    }),
  }
}

/* ------------------------------------------------------------------ Dark Luxury */

const luxuryTheme: SiteTheme = {
  bg: '#0e0d0b',
  surface: '#17150f',
  subtle: '#1d1a14',
  border: '#2e2a21',
  fg: '#f2ece0',
  muted: '#a99f8c',
  accent: '#c6a15b',
  accentFg: '#15120c',
  accentSoft: '#2a2416',
  inverseBg: '#1b1813',
  inverseFg: '#f2ece0',
  headingFont: 'serif',
  bodyFont: 'sans',
  headingWeight: 400,
  headingCase: 'uppercase',
  headingTracking: 0.06,
  radius: 'none',
  buttonShape: 'square',
  density: 'comfortable',
  motion: 'expressive',
  pattern: 'none',
  arabicFont: 'naskh',
  imageShape: 'theme',
}

const LUX_ABOUT: Bi = {
  en: 'Warm towels, aromatic oils and therapists with years of experience. Every visit is tailored to you, from pressure to music.',
  ar: 'مناشف دافئة وزيوت عطرية ومعالجون بخبرة سنوات. كل زيارة مصممة لك، من قوة الضغط إلى الموسيقى.',
}

function luxury(): SiteTemplate {
  const c = builder('lux')
  const home = page(SEO.home.title, SEO.home.description, [
    c(
      'Hero',
      {
        variant: 'banner',
        eyebrow: { en: '{name}', ar: '{name}' },
        title: { en: 'The art of deep relaxation', ar: 'فنّ الاسترخاء العميق' },
        subtitle: {
          en: 'Signature massages in a private, candle-lit retreat.',
          ar: 'جلسات مساج مميزة في ملاذ خاص على ضوء الشموع.',
        },
        buttons: [BOOK, { ...SEE_MENU, style: 'link' }],
        image: '',
        imageAlt: { en: '' },
        background: 'inverse',
      },
      'hero',
    ),
    section(c, [
      columns(c, '1-2', [
        [
          heading(
            c,
            { en: 'The experience', ar: 'التجربة' },
            { en: 'Unhurried luxury', ar: 'فخامة بلا استعجال' },
          ),
        ],
        [para(c, LUX_ABOUT, { size: 'lg' }, 'about')],
      ]),
    ]),
    services(c, {
      title: { en: 'Signature treatments', ar: 'جلساتنا المميزة' },
      layout: 'cards',
      background: 'subtle',
    }),
    team(c, { en: 'Your therapists', ar: 'معالجوك' }),
    testimonials(c, { en: 'Guests say', ar: 'يقول ضيوفنا' }, QUOTES),
    cta(c, {
      variant: 'split',
      title: { en: 'Reserve your ritual', ar: 'احجز طقسك الخاص' },
      text: { en: 'Same-day appointments are often available.', ar: 'تتوفر غالبًا مواعيد في اليوم نفسه.' },
    }),
    hours(c),
    footer(c, { en: 'A private retreat in the city', ar: 'ملاذ خاص في قلب المدينة' }),
    whatsapp(c, 'icon'),
  ])
  return {
    key: 'luxury',
    name: 'Dark Luxury',
    theme: luxuryTheme,
    pages: pages({
      home,
      services: servicesPage(c, { layout: 'cards', ctaBg: 'accent', whatsapp: 'icon' }),
      about: aboutPage(c, {
        title: { en: 'Crafted for deep rest', ar: 'صُمّم للراحة العميقة' },
        lead: {
          en: 'A private retreat where every detail — light, scent and sound — is chosen for you.',
          ar: 'ملاذ خاص اختيرت كل تفاصيله لك: الضوء والعطر والصوت.',
        },
        aboutTitle: { en: 'Unhurried luxury', ar: 'فخامة بلا استعجال' },
        about: LUX_ABOUT,
        usps: [
          [
            { en: 'Private suites', ar: 'أجنحة خاصة' },
            { en: 'Candle-lit rooms for one or two.', ar: 'غرف على ضوء الشموع لشخص أو شخصين.' },
          ],
          [
            { en: 'Master therapists', ar: 'معالجون خبراء' },
            { en: 'Years of experience in every pair of hands.', ar: 'سنوات من الخبرة في كل يد.' },
          ],
          [
            { en: 'Rare oils', ar: 'زيوت نادرة' },
            {
              en: 'Oud, amber and rose, warmed before every treatment.',
              ar: 'عود وعنبر وورد، تُدفّأ قبل كل جلسة.',
            },
          ],
        ],
        ctaVariant: 'split',
        tagline: { en: 'A private retreat in the city', ar: 'ملاذ خاص في قلب المدينة' },
        whatsapp: 'icon',
      }),
      contact: contactPage(c, { whatsapp: 'icon' }),
    }),
  }
}

/* ------------------------------------------------------------------ Nordic Clean */

const nordicTheme: SiteTheme = {
  bg: '#ffffff',
  surface: '#faf8f4',
  subtle: '#f3efe8',
  border: '#e8e2d8',
  fg: '#1d232a',
  muted: '#5f666e',
  accent: '#3d5a80',
  accentFg: '#ffffff',
  accentSoft: '#e7edf4',
  inverseBg: '#1d232a',
  inverseFg: '#f7f5f1',
  headingFont: 'sans',
  bodyFont: 'sans',
  headingWeight: 600,
  headingCase: 'none',
  headingTracking: -0.03,
  radius: 'round',
  buttonShape: 'rounded',
  density: 'airy',
  motion: 'subtle',
  pattern: 'none',
  arabicFont: 'sans',
  imageShape: 'theme',
}

function nordic(): SiteTemplate {
  const c = builder('nordic')
  const home = page(SEO.home.title, SEO.home.description, [
    c(
      'Hero',
      {
        variant: 'split',
        eyebrow: { en: 'Massage studio', ar: 'استوديو مساج' },
        title: { en: 'Calm, clear and restorative.', ar: 'هدوء وصفاء وتجدد.' },
        subtitle: {
          en: 'Thoughtful massage in a bright, quiet space. Book in seconds and simply arrive.',
          ar: 'مساج مدروس في مكان مشرق وهادئ. احجز في ثوانٍ وتعال فقط.',
        },
        buttons: [BOOK, WHATSAPP],
        image: '',
        imageAlt: { en: '' },
        background: 'none',
      },
      'hero',
    ),
    uspRow(c, CALM_USPS),
    services(c, {
      title: { en: 'Treatments', ar: 'الجلسات' },
      intro: {
        en: 'Choose your time and pressure. All prices include VAT.',
        ar: 'اختر المدة وقوة الضغط. جميع الأسعار شاملة الضريبة.',
      },
      layout: 'list',
    }),
    team(c, { en: 'The team', ar: 'الفريق' }, { background: 'subtle' }),
    faq(c, FAQ_BASICS, { layout: 'columns' }),
    hours(c, { title: { en: 'Find us', ar: 'موقعنا' }, background: 'surface' }),
    cta(c, {
      variant: 'banner',
      title: { en: 'Ready for your reset?', ar: 'مستعد لاستعادة نشاطك؟' },
      text: {
        en: 'Pick a treatment and time — it takes under a minute.',
        ar: 'اختر الجلسة والوقت، يستغرق ذلك أقل من دقيقة.',
      },
    }),
    footer(c, { en: 'Massage studio', ar: 'استوديو مساج' }),
    whatsapp(c),
  ])
  return {
    key: 'nordic',
    name: 'Nordic Clean',
    theme: nordicTheme,
    pages: pages({
      home,
      services: servicesPage(c, { layout: 'list', ctaBg: 'soft' }),
      about: aboutPage(c, {
        title: { en: 'Simple, honest massage', ar: 'مساج بسيط وصادق' },
        lead: {
          en: 'Bright rooms, clear prices and therapists who listen.',
          ar: 'غرف مشرقة وأسعار واضحة ومعالجون يصغون إليك.',
        },
        aboutTitle: { en: 'How we work', ar: 'كيف نعمل' },
        about: {
          en: 'We keep things simple: a short chat before you start, the pressure you ask for and enough time to get up slowly afterwards.\n\nBook online or on WhatsApp and simply arrive.',
          ar: 'نحافظ على البساطة: حديث قصير قبل البدء، والضغط الذي تطلبه، ووقت كافٍ للنهوض بهدوء بعد الجلسة.\n\nاحجز أونلاين أو عبر واتساب وتعال فقط.',
        },
        usps: CALM_USPS,
        imageAspect: 'landscape',
        tagline: { en: 'Massage studio', ar: 'استوديو مساج' },
      }),
      contact: contactPage(c, { faqLayout: 'columns' }),
    }),
  }
}

/* ------------------------------------------------------------------ Thai Teak */

const teakTheme: SiteTheme = {
  bg: '#f6efe6',
  surface: '#fbf6ef',
  subtle: '#efe3d3',
  border: '#e0cfb8',
  fg: '#2b1d12',
  muted: '#7a6250',
  accent: '#8b5a2b',
  accentFg: '#fff8ef',
  accentSoft: '#f0e0cc',
  inverseBg: '#3a2616',
  inverseFg: '#f6efe6',
  headingFont: 'serif',
  bodyFont: 'sans',
  headingWeight: 500,
  headingCase: 'none',
  headingTracking: 0,
  radius: 'soft',
  buttonShape: 'rounded',
  density: 'comfortable',
  motion: 'subtle',
  pattern: 'lattice',
  arabicFont: 'naskh',
  imageShape: 'theme',
}

const TEAK_ABOUT: Bi = {
  en: 'Thai massage is done fully clothed on a padded mat. Your therapist uses palms, thumbs and gentle stretches to ease tight muscles and restore your energy.\n\nPrefer oil? Choose an aromatic oil massage or a warm herbal compress — every treatment is tailored to you.',
  ar: 'يُجرى المساج التايلاندي بالملابس على فراش مريح، ويستخدم المعالج راحتي اليدين والإبهامين وتمددات لطيفة لإرخاء العضلات المشدودة واستعادة نشاطك.\n\nتفضّل الزيت؟ اختر مساج الزيوت العطرية أو كمادات الأعشاب الدافئة، فكل جلسة مصممة لك.',
}
const TEAK_USPS: Usp[] = [
  [
    { en: 'Thai-trained therapists', ar: 'معالجون مدرّبون في تايلاند' },
    { en: 'Years of practice in traditional technique.', ar: 'سنوات من الممارسة في التقنيات التقليدية.' },
  ],
  [
    { en: 'Herbal compresses', ar: 'كمادات الأعشاب' },
    {
      en: 'Lemongrass, turmeric and kaffir lime, steamed fresh.',
      ar: 'عشبة الليمون والكركم وورق الليمون الكفيري، مبخّرة طازجة.',
    },
  ],
  [
    { en: 'Fair, clear prices', ar: 'أسعار واضحة وعادلة' },
    { en: 'AED prices with VAT included, no surprises.', ar: 'الأسعار بالدرهم شاملة الضريبة، بلا مفاجآت.' },
  ],
]

function teak(): SiteTemplate {
  const c = builder('teak')
  const tagline = { en: 'Traditional Thai massage', ar: 'مساج تايلاندي تقليدي' }
  const home = page(SEO.home.title, SEO.home.description, [
    c(
      'Hero',
      {
        variant: 'split',
        eyebrow: tagline,
        title: { en: 'Ancient touch, modern calm', ar: 'لمسة عريقة وهدوء عصري' },
        subtitle: {
          en: 'Thai therapists, warm herbal compresses and teak-lined rooms at {name}.',
          ar: 'معالجون تايلانديون وكمادات أعشاب دافئة وغرف من خشب الساج في {name}.',
        },
        buttons: [BOOK, SEE_MENU],
        image: '',
        imageAlt: { en: 'Thai massage room', ar: 'غرفة المساج التايلاندي' },
        background: 'none',
      },
      'hero',
    ),
    section(
      c,
      [
        columns(c, '1-2', [
          [
            heading(
              c,
              { en: 'The Thai way', ar: 'الطريقة التايلاندية' },
              { en: 'Stretch, press, release', ar: 'تمدّد، ضغط، استرخاء' },
            ),
          ],
          [para(c, TEAK_ABOUT, { size: 'lg' }, 'about'), buttons(c, [ABOUT_LINK])],
        ]),
      ],
      { background: 'subtle' },
    ),
    uspRow(c, TEAK_USPS, { background: 'none' }),
    services(c, {
      title: { en: 'Treatments', ar: 'الجلسات' },
      intro: { en: 'Prices include VAT.', ar: 'الأسعار شاملة الضريبة.' },
      layout: 'cards',
      background: 'soft',
    }),
    gallery(c, { title: { en: 'Inside our sala', ar: 'داخل صالتنا' }, count: 5, layout: 'strip' }),
    testimonials(c, { en: 'Guests say', ar: 'يقول ضيوفنا' }, [
      {
        quote: {
          en: 'Exactly like the massages I had in Chiang Mai. Strong, careful and so relaxing.',
          ar: 'تمامًا مثل المساج الذي جربته في شيانغ ماي. قوي ودقيق ومريح جدًا.',
        },
        author: 'Hessa',
        detail: { en: 'Thai massage', ar: 'مساج تايلاندي' },
      },
      {
        quote: {
          en: 'The herbal compress was the best thing for my back after a long week.',
          ar: 'كمادات الأعشاب كانت أفضل ما جربته لظهري بعد أسبوع طويل.',
        },
        author: 'James',
        detail: { en: 'Herbal compress', ar: 'كمادات الأعشاب' },
      },
      {
        quote: {
          en: 'Warm welcome, spotless rooms, fair prices.',
          ar: 'ترحيب دافئ وغرف نظيفة وأسعار عادلة.',
        },
        author: 'Noura',
        detail: { en: 'Foot massage', ar: 'مساج القدمين' },
      },
    ]),
    cta(c, {
      variant: 'split',
      title: { en: 'Make time for yourself', ar: 'خصّص وقتًا لنفسك' },
      text: { en: 'Same-day appointments are often available.', ar: 'تتوفر غالبًا مواعيد في اليوم نفسه.' },
      background: 'inverse',
    }),
    hours(c, { background: 'subtle' }),
    footer(c, tagline),
    whatsapp(c),
  ])
  return {
    key: 'teak',
    name: 'Thai Teak',
    theme: teakTheme,
    pages: pages({
      home,
      services: servicesPage(c, { layout: 'cards', ctaBg: 'inverse', ctaVariant: 'split' }),
      about: aboutPage(c, {
        title: { en: 'A family tradition of healing hands', ar: 'تقليد عائلي من الأيدي الماهرة' },
        lead: {
          en: 'Our therapists learned their craft in Thailand and bring it to {name} with the same care.',
          ar: 'تعلّم معالجونا حرفتهم في تايلاند ويقدّمونها في {name} بالعناية نفسها.',
        },
        aboutTitle: { en: 'The Thai way', ar: 'الطريقة التايلاندية' },
        about: TEAK_ABOUT,
        usps: TEAK_USPS,
        ctaBg: 'inverse',
        ctaVariant: 'split',
        tagline,
      }),
      contact: contactPage(c, { hoursBg: 'soft' }),
    }),
  }
}

/* ------------------------------------------------------------------ Desert Sand */

const desertTheme: SiteTheme = {
  bg: '#f7efe4',
  surface: '#fcf7f0',
  subtle: '#efe2cf',
  border: '#e3d1b8',
  fg: '#3b2a1e',
  muted: '#80695a',
  accent: '#b0532f',
  accentFg: '#fff7f0',
  accentSoft: '#f3dccf',
  inverseBg: '#4a2c1d',
  inverseFg: '#f7efe4',
  headingFont: 'serif',
  bodyFont: 'sans',
  headingWeight: 500,
  headingCase: 'none',
  headingTracking: -0.005,
  radius: 'round',
  buttonShape: 'pill',
  density: 'airy',
  motion: 'subtle',
  pattern: 'arabesque',
  arabicFont: 'kufi',
  imageShape: 'arch',
}

const DESERT_ABOUT: Bi = {
  en: 'Every visit begins with Arabic coffee and dates. Then we take our time: a warm hammam, a gentle scrub and a massage with oils scented with oud and rose.\n\nOur therapists are trained in Moroccan hammam, Swedish and deep tissue techniques.',
  ar: 'تبدأ كل زيارة بالقهوة العربية والتمر، ثم نأخذ وقتنا: حمّام دافئ وتقشير لطيف ومساج بزيوت معطّرة بالعود والورد.\n\nمعالجونا مدرّبون على الحمّام المغربي والمساج السويدي ومساج الأنسجة العميقة.',
}
const DESERT_USPS: Usp[] = [
  [
    { en: 'Private suites', ar: 'أجنحة خاصة' },
    {
      en: 'Quiet rooms for one or two, with showers and fresh towels.',
      ar: 'غرف هادئة لشخص أو شخصين مع دش ومناشف نظيفة.',
    },
  ],
  [
    { en: 'Oud & rose oils', ar: 'زيوت العود والورد' },
    {
      en: 'Warm, fragrant oils inspired by Arabian hospitality.',
      ar: 'زيوت دافئة عطرة مستوحاة من الضيافة العربية.',
    },
  ],
  [
    { en: 'Book your way', ar: 'احجز بطريقتك' },
    {
      en: 'Online in a minute or on WhatsApp — as you prefer.',
      ar: 'أونلاين خلال دقيقة أو عبر واتساب، كما تفضّل.',
    },
  ],
]

function desert(): SiteTemplate {
  const c = builder('desert')
  const tagline = { en: 'Hammam & massage', ar: 'حمّام ومساج' }
  const home = page(SEO.home.title, SEO.home.description, [
    c(
      'Hero',
      {
        variant: 'centered',
        // Arabic-forward: the Arabic greeting leads even on the English site.
        eyebrow: { en: 'أهلاً وسهلاً · Welcome', ar: 'أهلاً وسهلاً بكم' },
        title: { en: 'Desert rituals, oasis calm', ar: 'طقوس الصحراء وسكينة الواحة' },
        subtitle: {
          en: 'Warm oud oils, hammam scrubs and unhurried massage at {name}.',
          ar: 'زيوت العود الدافئة وتقشير الحمّام ومساج بلا استعجال في {name}.',
        },
        buttons: [BOOK, WHATSAPP],
        image: '',
        imageAlt: { en: '' },
        background: 'soft',
      },
      'hero',
    ),
    section(
      c,
      [
        columns(
          c,
          '1-1',
          [
            [image(c, { en: 'Hammam room', ar: 'غرفة الحمّام' })],
            [
              heading(
                c,
                { en: 'الضيافة · Hospitality', ar: 'الضيافة' },
                { en: 'Hospitality is our tradition', ar: 'الضيافة من تقاليدنا' },
              ),
              para(c, DESERT_ABOUT, {}, 'about'),
              buttons(c, [ABOUT_LINK]),
            ],
          ],
          { valign: 'center', mobileOrder: 'reverse' },
        ),
      ],
      { background: 'none' },
    ),
    services(c, {
      title: { en: 'The ritual menu', ar: 'قائمة الطقوس' },
      intro: { en: 'All prices in AED, VAT included.', ar: 'جميع الأسعار بالدرهم شاملة الضريبة.' },
      layout: 'list',
      background: 'subtle',
    }),
    uspRow(c, DESERT_USPS, { background: 'none', align: 'center' }),
    testimonials(
      c,
      { en: 'Kind words', ar: 'كلمات طيبة' },
      [
        {
          quote: {
            en: 'The hammam and oud massage felt like a holiday in one afternoon.',
            ar: 'الحمّام ومساج العود كانا كعطلة كاملة في عصر واحد.',
          },
          author: 'Mariam',
          detail: { en: 'Hammam ritual', ar: 'طقس الحمّام' },
        },
      ],
      { layout: 'feature', background: 'soft' },
    ),
    faq(c, FAQ_BASICS, { title: { en: 'Questions & answers', ar: 'أسئلة وأجوبة' } }),
    cta(c, {
      variant: 'card',
      title: { en: 'Your ritual awaits', ar: 'طقسك بانتظارك' },
      text: { en: 'Book online in under a minute.', ar: 'احجز أونلاين في أقل من دقيقة.' },
      background: 'none',
    }),
    hours(c, { background: 'subtle' }),
    footer(c, tagline),
    whatsapp(c),
  ])
  return {
    key: 'desert',
    name: 'Desert Sand',
    theme: desertTheme,
    pages: pages({
      home,
      services: servicesPage(c, {
        layout: 'list',
        ctaBg: 'accent',
        ctaVariant: 'card',
        title: { en: 'The ritual menu', ar: 'قائمة الطقوس' },
      }),
      about: aboutPage(c, {
        title: { en: 'Rooted in Arabian hospitality', ar: 'متجذّرون في الضيافة العربية' },
        lead: {
          en: 'At {name}, a massage is a ritual: coffee, warmth, scent and time.',
          ar: 'في {name} المساج طقس متكامل: قهوة ودفء وعطر ووقت.',
        },
        aboutTitle: { en: 'Hospitality is our tradition', ar: 'الضيافة من تقاليدنا' },
        about: DESERT_ABOUT,
        usps: DESERT_USPS,
        teamLayout: 'compact',
        ctaVariant: 'card',
        ctaBg: 'soft',
        tagline,
        introAlign: 'center',
      }),
      offers: offersPage(c, {
        title: { en: 'Seasonal rituals', ar: 'طقوس موسمية' },
        lead: {
          en: 'Treatments we love this season. Ask us about prices and availability.',
          ar: 'جلسات نحبها هذا الموسم. اسألنا عن الأسعار والمواعيد المتاحة.',
        },
        offers: [
          {
            title: { en: 'Hammam & oud massage', ar: 'حمّام ومساج بالعود' },
            text: {
              en: 'Steam, scrub and a 60-minute oud oil massage.',
              ar: 'بخار وتقشير ومساج بزيت العود لمدة 60 دقيقة.',
            },
          },
          {
            title: { en: 'Bride-to-be ritual', ar: 'طقس العروس' },
            text: {
              en: 'Rose scrub, massage and quiet time before the big day.',
              ar: 'تقشير بالورد ومساج ووقت هادئ قبل اليوم الكبير.',
            },
          },
          {
            title: { en: 'Friends afternoon', ar: 'عصرية الصديقات' },
            text: {
              en: 'Book together and share coffee in the lounge.',
              ar: 'احجزن معًا واستمتعن بالقهوة في الصالة.',
            },
          },
        ],
        tagline,
        aspect: 'portrait',
      }),
      contact: contactPage(c, {
        title: { en: 'Ahlan — we are here for you', ar: 'أهلاً بكم، نحن هنا لخدمتكم' },
      }),
    }),
  }
}

/* ------------------------------------------------------------------ Tropical Bali */

const baliTheme: SiteTheme = {
  bg: '#f3f6ef',
  surface: '#fafcf7',
  subtle: '#e5ecdc',
  border: '#d3dfc6',
  fg: '#1f2c22',
  muted: '#5a6b5c',
  accent: '#2f6b4f',
  accentFg: '#f6fbf4',
  accentSoft: '#dceadf',
  inverseBg: '#1d3326',
  inverseFg: '#eef4ea',
  headingFont: 'serif',
  bodyFont: 'sans',
  headingWeight: 400,
  headingCase: 'none',
  headingTracking: -0.015,
  radius: 'round',
  buttonShape: 'pill',
  density: 'airy',
  motion: 'subtle',
  pattern: 'leaf',
  arabicFont: 'naskh',
  imageShape: 'organic',
}

const BALI_ABOUT: Bi = {
  en: 'Balinese massage blends gentle stretches, acupressure and long, flowing strokes. It is slower than you expect — and that is the point.\n\nWe use warm coconut and frangipani oils and finish every treatment with ginger tea in the garden lounge.',
  ar: 'يجمع مساج بالي بين التمدد اللطيف والضغط بالأصابع والحركات الطويلة المتدفقة. إنه أبطأ مما تتوقع، وهذا هو الهدف.\n\nنستخدم زيوت جوز الهند والفرانجيباني الدافئة، وننهي كل جلسة بشاي الزنجبيل في صالة الحديقة.',
}
const BALI_USPS: Usp[] = [
  [
    { en: 'Balinese technique', ar: 'تقنية بالي' },
    {
      en: 'Acupressure and long strokes in one flowing treatment.',
      ar: 'ضغط بالأصابع وحركات طويلة في جلسة واحدة متدفقة.',
    },
  ],
  [
    { en: 'Natural oils', ar: 'زيوت طبيعية' },
    {
      en: 'Coconut, frangipani and lemongrass, blended in-house.',
      ar: 'جوز الهند والفرانجيباني وعشبة الليمون، نمزجها بأنفسنا.',
    },
  ],
  [
    { en: 'A garden of calm', ar: 'حديقة من الهدوء' },
    { en: 'Green, quiet rooms designed to slow you down.', ar: 'غرف خضراء هادئة صُممت لتمنحك السكينة.' },
  ],
]

function bali(): SiteTemplate {
  const c = builder('bali')
  const tagline = { en: 'Balinese massage & rituals', ar: 'مساج وطقوس بالي' }
  const home = page(SEO.home.title, SEO.home.description, [
    c(
      'Hero',
      {
        variant: 'split',
        eyebrow: tagline,
        title: { en: 'Breathe in the island', ar: 'تنفّس روح الجزيرة' },
        subtitle: {
          en: 'Long flowing strokes, frangipani oils and a slower rhythm at {name}.',
          ar: 'حركات طويلة متدفقة وزيوت الفرانجيباني وإيقاع أهدأ في {name}.',
        },
        buttons: [BOOK, { ...SEE_MENU, style: 'link' }],
        image: '',
        imageAlt: { en: 'Garden treatment room', ar: 'غرفة علاج مطلة على الحديقة' },
        background: 'soft',
      },
      'hero',
    ),
    uspRow(c, BALI_USPS, { background: 'none', align: 'center' }),
    section(
      c,
      [
        columns(
          c,
          '1-1',
          [
            [image(c, { en: 'Frangipani and oils', ar: 'زهور الفرانجيباني والزيوت' }, 'square')],
            [
              heading(
                c,
                { en: 'Island rhythm', ar: 'إيقاع الجزيرة' },
                { en: 'Slower is better', ar: 'الأبطأ أجمل' },
              ),
              para(c, BALI_ABOUT, {}, 'about'),
              buttons(c, [ABOUT_LINK]),
            ],
          ],
          { valign: 'center', gap: 'lg' },
        ),
      ],
      { background: 'surface' },
    ),
    services(c, { title: { en: 'Treatments', ar: 'الجلسات' }, layout: 'list', background: 'subtle' }),
    gallery(c, {
      title: { en: 'A little piece of Bali', ar: 'قطعة صغيرة من بالي' },
      count: 5,
      layout: 'mosaic',
    }),
    testimonials(
      c,
      { en: 'Guests say', ar: 'يقول ضيوفنا' },
      [
        {
          quote: {
            en: 'I forgot I was in the middle of the city. Pure, slow calm.',
            ar: 'نسيت أنني في وسط المدينة. هدوء صافٍ وبطيء.',
          },
          author: 'Chloe',
          detail: { en: 'Balinese massage', ar: 'مساج بالي' },
        },
      ],
      { layout: 'feature', background: 'soft' },
    ),
    cta(c, {
      variant: 'banner',
      title: { en: 'Your island hour is waiting', ar: 'ساعة الجزيرة بانتظارك' },
      text: { en: 'Pick a treatment and time in under a minute.', ar: 'اختر الجلسة والوقت في أقل من دقيقة.' },
    }),
    hours(c),
    footer(c, tagline),
    whatsapp(c),
  ])
  return {
    key: 'bali',
    name: 'Tropical Bali',
    theme: baliTheme,
    pages: pages({
      home,
      services: servicesPage(c, { layout: 'cards', ctaBg: 'soft' }),
      about: aboutPage(c, {
        title: { en: 'Inspired by the island of the gods', ar: 'مستوحى من جزيرة الآلهة' },
        lead: {
          en: 'Natural oils, gentle hands and a garden of calm in the middle of the city.',
          ar: 'زيوت طبيعية وأيدٍ لطيفة وحديقة من الهدوء في قلب المدينة.',
        },
        aboutTitle: { en: 'Slower is better', ar: 'الأبطأ أجمل' },
        about: BALI_ABOUT,
        usps: BALI_USPS,
        imageAspect: 'square',
        tagline,
      }),
      gallery: galleryPage(c, {
        title: { en: 'A little piece of Bali', ar: 'قطعة صغيرة من بالي' },
        lead: { en: 'Green rooms, natural textures and soft light.', ar: 'غرف خضراء وملمس طبيعي وضوء ناعم.' },
        layout: 'mosaic',
        tagline,
      }),
      contact: contactPage(c),
    }),
  }
}

/* ------------------------------------------------------------------ Urban Express */

const expressTheme: SiteTheme = {
  bg: '#ffffff',
  surface: '#f6f6f4',
  subtle: '#efefec',
  border: '#e2e2de',
  fg: '#111111',
  muted: '#55554f',
  accent: '#d9481f',
  accentFg: '#ffffff',
  accentSoft: '#fde6de',
  inverseBg: '#111111',
  inverseFg: '#ffffff',
  headingFont: 'sans',
  bodyFont: 'sans',
  headingWeight: 700,
  headingCase: 'uppercase',
  headingTracking: -0.01,
  radius: 'none',
  buttonShape: 'square',
  density: 'compact',
  motion: 'expressive',
  pattern: 'none',
  arabicFont: 'kufi',
  imageShape: 'theme',
}

const EXPRESS_USPS: Usp[] = [
  [
    { en: 'Walk in', ar: 'ادخل مباشرة' },
    { en: 'No booking needed when a chair is free.', ar: 'لا حاجة للحجز عند توفر مقعد.' },
  ],
  [
    { en: 'From 30 min', ar: 'من 30 دقيقة' },
    { en: 'Quick sessions that fit your break.', ar: 'جلسات سريعة تناسب استراحتك.' },
  ],
  [
    { en: 'Open late', ar: 'مفتوح حتى وقت متأخر' },
    { en: 'See today’s hours below.', ar: 'اطّلع على ساعات اليوم أدناه.' },
  ],
  [
    { en: 'Pay your way', ar: 'ادفع كما تريد' },
    { en: 'Cash or card at the counter.', ar: 'نقدًا أو بالبطاقة عند الكاونتر.' },
  ],
]

function express(): SiteTemplate {
  const c = builder('express')
  const tagline = { en: 'Express massage', ar: 'مساج سريع' }
  const home = page(SEO.home.title, SEO.home.description, [
    c(
      'Hero',
      {
        variant: 'banner',
        eyebrow: { en: 'Express massage · Walk-ins welcome', ar: 'مساج سريع · نرحب بالزيارات دون حجز' },
        title: { en: 'Feel better in 30 minutes.', ar: 'اشعر بالراحة خلال 30 دقيقة.' },
        subtitle: {
          en: 'Foot, back and shoulder massage between meetings, shopping or flights. No fuss, fair prices.',
          ar: 'مساج للقدمين والظهر والكتفين بين الاجتماعات أو التسوق أو الرحلات. بلا تعقيد وبأسعار عادلة.',
        },
        buttons: [{ ...BOOK, label: { en: 'Book now', ar: 'احجز الآن' } }, WHATSAPP],
        image: '',
        imageAlt: { en: '' },
        background: 'inverse',
      },
      'hero',
    ),
    services(c, {
      title: { en: 'Prices', ar: 'الأسعار' },
      intro: { en: 'All prices in AED, VAT included.', ar: 'جميع الأسعار بالدرهم شاملة الضريبة.' },
      layout: 'cards',
      limit: 0,
      descriptions: false,
      padding: { base: 'md', lg: 'lg' },
    }),
    uspRow(c, EXPRESS_USPS, { background: 'subtle', padding: { base: 'md', lg: 'lg' } }),
    cta(c, {
      variant: 'banner',
      title: { en: 'Skip the queue', ar: 'تجاوز الانتظار' },
      text: { en: 'Book online and walk straight in.', ar: 'احجز أونلاين وادخل مباشرة.' },
      label: { en: 'Book now', ar: 'احجز الآن' },
    }),
    hours(c, { title: { en: 'Opening hours', ar: 'ساعات العمل' }, layout: 'table' }),
    faq(c, FAQ_BASICS, {
      title: { en: 'Quick answers', ar: 'إجابات سريعة' },
      layout: 'columns',
      background: 'subtle',
    }),
    footer(c, tagline, 'simple'),
    whatsapp(c, 'icon'),
  ])
  return {
    key: 'express',
    name: 'Urban Express',
    theme: expressTheme,
    pages: pages({
      home,
      services: servicesPage(c, {
        layout: 'cards',
        ctaBg: 'accent',
        footer: 'simple',
        title: { en: 'Prices', ar: 'الأسعار' },
        descriptions: false,
        whatsapp: 'icon',
      }),
      about: aboutPage(c, {
        title: { en: 'Massage for busy people', ar: 'مساج لأصحاب الوقت الضيق' },
        lead: {
          en: 'Good massage should be quick to book, easy to fit in and fairly priced. That is all we do.',
          ar: 'يجب أن يكون المساج الجيد سهل الحجز وسهل الإدراج في يومك وبسعر عادل. هذا كل ما نفعله.',
        },
        aboutTitle: { en: 'In and out, feeling better', ar: 'ادخل واخرج وأنت أفضل' },
        about: {
          en: 'Short on time? Choose 30, 45 or 60 minutes of foot, back or full-body massage. Walk in when a chair is free or book ahead to skip the wait.',
          ar: 'وقتك ضيق؟ اختر 30 أو 45 أو 60 دقيقة من مساج القدمين أو الظهر أو الجسم كاملًا. ادخل مباشرة عند توفر مقعد أو احجز مسبقًا لتتجاوز الانتظار.',
        },
        usps: EXPRESS_USPS.slice(0, 3),
        imageAspect: 'landscape',
        teamLayout: 'compact',
        footer: 'simple',
        tagline,
        whatsapp: 'icon',
      }),
      offers: offersPage(c, {
        title: { en: 'Deals', ar: 'العروض' },
        lead: { en: 'Simple deals, no small print surprises.', ar: 'عروض بسيطة بلا مفاجآت.' },
        offers: [
          {
            title: { en: 'Lunch-break special', ar: 'عرض استراحة الغداء' },
            text: {
              en: '30-minute back & shoulders, weekdays 12–3 pm.',
              ar: '30 دقيقة للظهر والكتفين، أيام الأسبوع 12–3 ظهرًا.',
            },
          },
          {
            title: { en: 'Feet first', ar: 'القدمان أولًا' },
            text: { en: 'Upgrade any foot massage to 45 minutes.', ar: 'رقِّ أي مساج للقدمين إلى 45 دقيقة.' },
          },
          {
            title: { en: '5-visit card', ar: 'بطاقة 5 زيارات' },
            text: { en: 'Buy five, save on every visit.', ar: 'اشترِ خمس زيارات ووفّر في كل زيارة.' },
          },
        ],
        footer: 'simple',
        tagline,
        aspect: 'wide',
        whatsapp: 'icon',
      }),
      contact: contactPage(c, {
        faqLayout: 'columns',
        footer: 'simple',
        title: { en: 'Find us', ar: 'موقعنا' },
        whatsapp: 'icon',
      }),
    }),
  }
}

/* ------------------------------------------------------------------ Hotel Spa */

const hotelTheme: SiteTheme = {
  bg: '#fbfaf7',
  surface: '#ffffff',
  subtle: '#f2efe8',
  border: '#e6e1d6',
  fg: '#1f2326',
  muted: '#66645f',
  accent: '#2c4a5a',
  accentFg: '#ffffff',
  accentSoft: '#e3eaee',
  inverseBg: '#16242c',
  inverseFg: '#f4f1ea',
  headingFont: 'serif',
  bodyFont: 'sans',
  headingWeight: 400,
  headingCase: 'none',
  headingTracking: -0.005,
  radius: 'none',
  buttonShape: 'square',
  density: 'airy',
  motion: 'subtle',
  pattern: 'none',
  arabicFont: 'naskh',
  imageShape: 'theme',
}

const HOTEL_ABOUT: Bi = {
  en: 'From the moment you arrive, our team takes care of everything: a welcome tea, a short consultation and a treatment designed around you. Afterwards, stay as long as you like in the relaxation lounge.',
  ar: 'منذ لحظة وصولك يتولى فريقنا كل شيء: شاي ترحيبي واستشارة قصيرة وجلسة مصممة حولك. وبعدها ابقَ في صالة الاسترخاء قدر ما تشاء.',
}
const HOTEL_USPS: Usp[] = [
  [
    { en: 'Signature rituals', ar: 'طقوس مميزة' },
    {
      en: 'Head-to-toe treatments created by our spa director.',
      ar: 'جلسات متكاملة من الرأس إلى القدمين صممتها مديرة السبا.',
    },
  ],
  [
    { en: 'Thermal suite', ar: 'الجناح الحراري' },
    { en: 'Steam room and sauna to begin or end your visit.', ar: 'غرفة بخار وساونا لبدء زيارتك أو ختامها.' },
  ],
  [
    { en: 'Day at the spa', ar: 'يوم في السبا' },
    {
      en: 'Make a day of it with lounge access and light lunch.',
      ar: 'اجعلها يومًا كاملًا مع الصالة وغداء خفيف.',
    },
  ],
]

function hotel(): SiteTemplate {
  const c = builder('hotel')
  const tagline = { en: 'Spa & wellness', ar: 'سبا وعافية' }
  const home = page(SEO.home.title, SEO.home.description, [
    c(
      'Hero',
      {
        variant: 'banner',
        eyebrow: { en: 'The Spa at {name}', ar: 'السبا في {name}' },
        title: { en: 'A sanctuary above the city', ar: 'ملاذ هادئ فوق المدينة' },
        subtitle: {
          en: 'Signature treatments, a thermal suite and unhurried service — for hotel guests and visitors.',
          ar: 'جلسات مميزة وجناح حراري وخدمة بلا استعجال، لنزلاء الفندق والزوار.',
        },
        buttons: [BOOK, { ...SEE_MENU, style: 'link' }],
        image: '',
        imageAlt: { en: '' },
        background: 'inverse',
      },
      'hero',
    ),
    section(
      c,
      [
        heading(
          c,
          { en: 'Welcome', ar: 'أهلاً بكم' },
          { en: 'Time, beautifully spent', ar: 'وقت يُقضى بأجمل صورة' },
          { align: 'center', size: 'xl' },
        ),
        para(c, HOTEL_ABOUT, { size: 'lg', align: 'center', measure: 'narrow' }, 'about'),
      ],
      { width: 'narrow', padding: { base: 'xl' } },
    ),
    gallery(c, { title: { en: 'The spa', ar: 'السبا' }, count: 6, layout: 'grid', columns: '3' }),
    services(c, {
      title: { en: 'Treatment menu', ar: 'قائمة الجلسات' },
      layout: 'cards',
      background: 'subtle',
    }),
    section(c, [
      columns(
        c,
        '2-1',
        [
          [
            heading(
              c,
              { en: 'Thermal suite', ar: 'الجناح الحراري' },
              { en: 'Warm up, slow down', ar: 'تدفّأ واسترخِ' },
            ),
            para(c, {
              en: 'Arrive early and enjoy the steam room, sauna and relaxation lounge before your treatment. Robes, slippers and refreshments are waiting for you.',
              ar: 'احضر مبكرًا واستمتع بغرفة البخار والساونا وصالة الاسترخاء قبل جلستك. الأرواب والنعال والمرطبات بانتظارك.',
            }),
            buttons(c, [{ ...BOOK, style: 'secondary' }]),
          ],
          [image(c, { en: 'Thermal suite', ar: 'الجناح الحراري' }, 'portrait')],
        ],
        { valign: 'center' },
      ),
    ]),
    uspRow(c, HOTEL_USPS, { background: 'soft' }),
    gallery(c, { title: { en: 'Moments', ar: 'لحظات' }, count: 4, layout: 'strip' }),
    team(c, { en: 'Our therapists', ar: 'معالجونا' }, { layout: 'compact' }),
    testimonials(c, { en: 'Guest reviews', ar: 'آراء النزلاء' }, QUOTES, { background: 'subtle' }),
    faq(c, FAQ_BASICS),
    cta(c, {
      variant: 'split',
      title: { en: 'Reserve your treatment', ar: 'احجز جلستك' },
      text: { en: 'Hotel guests and visitors welcome.', ar: 'نرحب بنزلاء الفندق والزوار.' },
      background: 'inverse',
    }),
    hours(c, { background: 'surface' }),
    footer(c, tagline),
    whatsapp(c, 'icon'),
  ])
  return {
    key: 'hotel',
    name: 'Hotel Spa',
    theme: hotelTheme,
    pages: pages({
      home,
      services: servicesPage(c, { layout: 'cards', ctaBg: 'inverse', ctaVariant: 'split', whatsapp: 'icon' }),
      about: aboutPage(c, {
        title: { en: 'Hospitality, refined', ar: 'ضيافة راقية' },
        lead: {
          en: 'A calm, beautifully run spa where every detail is looked after for you.',
          ar: 'سبا هادئ ومُدار بعناية، حيث نهتم بكل تفصيل من أجلك.',
        },
        aboutTitle: { en: 'Time, beautifully spent', ar: 'وقت يُقضى بأجمل صورة' },
        about: HOTEL_ABOUT,
        usps: HOTEL_USPS,
        imageAspect: 'landscape',
        teamLayout: 'compact',
        ctaBg: 'inverse',
        ctaVariant: 'split',
        tagline,
        introAlign: 'center',
        whatsapp: 'icon',
      }),
      gallery: galleryPage(c, {
        title: { en: 'Inside the spa', ar: 'داخل السبا' },
        lead: {
          en: 'Treatment suites, thermal area and relaxation lounge.',
          ar: 'أجنحة العلاج والمنطقة الحرارية وصالة الاسترخاء.',
        },
        layout: 'grid',
        tagline,
        whatsapp: 'icon',
      }),
      offers: offersPage(c, {
        title: { en: 'Spa packages', ar: 'باقات السبا' },
        lead: {
          en: 'Half-day and full-day experiences. Ask us about current prices.',
          ar: 'تجارب لنصف يوم أو يوم كامل. اسألنا عن الأسعار الحالية.',
        },
        offers: [
          {
            title: { en: 'Half-day escape', ar: 'هروب لنصف يوم' },
            text: {
              en: 'Thermal suite, 60-minute massage and lounge access.',
              ar: 'الجناح الحراري ومساج 60 دقيقة ودخول الصالة.',
            },
          },
          {
            title: { en: 'Couples retreat', ar: 'ملاذ للأزواج' },
            text: { en: 'Side-by-side massage in a private suite.', ar: 'مساج جنبًا إلى جنب في جناح خاص.' },
          },
          {
            title: { en: 'Full-day ritual', ar: 'طقس اليوم الكامل' },
            text: {
              en: 'Two treatments, light lunch and the thermal suite.',
              ar: 'جلستان وغداء خفيف والجناح الحراري.',
            },
          },
        ],
        tagline,
        whatsapp: 'icon',
      }),
      contact: contactPage(c, { hoursBg: 'surface', whatsapp: 'icon' }),
    }),
  }
}

/* ------------------------------------------------------------------ Catalogue */

type BuiltIn = SiteTemplate & { feel: string }
export const TEMPLATES = {
  zen: { ...zen(), feel: 'Stone and off-white, serif headings, slow fades.' },
  luxury: { ...luxury(), feel: 'Black and gold, editorial, expressive motion.' },
  nordic: { ...nordic(), feel: 'White and birch, airy sans, crisp and bright.' },
  teak: { ...teak(), feel: 'Warm teak tones, lattice patterns, traditional Thai.' },
  desert: { ...desert(), feel: 'Beige and terracotta, arches, Arabic-forward type.' },
  bali: { ...bali(), feel: 'Garden greens, organic shapes, soft and slow.' },
  express: { ...express(), feel: 'Bold, price-forward, made for walk-ins.' },
  hotel: { ...hotel(), feel: 'Premium long-form with rich galleries.' },
} satisfies Record<string, BuiltIn>
export type TemplateKey = keyof typeof TEMPLATES
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[]
export const isTemplateKey = (key: string): key is TemplateKey => Object.hasOwn(TEMPLATES, key)

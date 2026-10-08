import { TEMPLATES } from './templates'
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
  | 'motion'

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
  /** Search-result title/description (root props); `{name}` is the spa name. */
  seo?: { title: Bi; description: Bi }
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

/** Puck page data for a page template, with fresh ids per section. */
export function pageTemplateData(t: PageTemplate, idPrefix: string) {
  return {
    root: { props: { title: t.seo?.title ?? t.title, description: t.seo?.description ?? { en: '' } } },
    content: t.content.map((node, i) => instantiatePreset(node, `${idPrefix}-${i + 1}`)),
  }
}

/* ------------------------------------------------------------------ Building blocks */

const n = (type: string, props: Record<string, unknown>): PresetNode => ({ type, props })
type Btn = { label: Bi; action: string; target: string; style: string }
const BOOK: Btn = { label: { en: 'Book now', ar: 'احجز الآن' }, action: 'book', target: '', style: 'primary' }
const WHATSAPP: Btn = {
  label: { en: 'WhatsApp us', ar: 'راسلنا على واتساب' },
  action: 'whatsapp',
  target: '',
  style: 'secondary',
}
const CALL: Btn = {
  label: { en: 'Call us', ar: 'اتصل بنا' },
  action: 'phone',
  target: '',
  style: 'secondary',
}
const MENU: Btn = {
  label: { en: 'See the menu', ar: 'تصفح القائمة' },
  action: 'page',
  target: 'services',
  style: 'secondary',
}

const heading = (eyebrow: Bi, text: Bi, o: { level?: string; size?: string; align?: string } = {}) =>
  n('Heading', {
    eyebrow,
    text,
    level: o.level ?? 'h2',
    size: o.size ?? 'lg',
    align: { base: o.align ?? 'start' },
  })
const text = (value: Bi, o: { size?: string; tone?: string; measure?: string; align?: string } = {}) =>
  n('RichText', {
    text: value,
    size: o.size ?? 'md',
    tone: o.tone ?? 'muted',
    measure: o.measure ?? 'normal',
    align: { base: o.align ?? 'start' },
  })
const buttons = (items: Btn[], o: { size?: string; align?: string; stack?: boolean } = {}) =>
  n('ButtonGroup', {
    buttons: items,
    size: o.size ?? 'md',
    stackOnMobile: o.stack ?? false,
    align: { base: o.align ?? 'start' },
  })
const image = (alt: Bi, aspect = 'portrait') =>
  n('Image', { src: '', alt, caption: { en: '' }, aspect, rounded: true })
const section = (
  content: PresetNode[],
  o: { background?: string; width?: string; padding?: Record<string, string>; gap?: string } = {},
) =>
  n('Section', {
    background: o.background ?? 'none',
    width: o.width ?? 'contained',
    padding: o.padding ?? { base: 'lg', lg: 'xl' },
    gap: o.gap ?? 'md',
    content,
  })
const columns = (
  ratio: string,
  cols: PresetNode[][],
  o: { valign?: string; mobileOrder?: string; gap?: string } = {},
) =>
  n('Columns', {
    ratio,
    gap: o.gap ?? 'lg',
    valign: o.valign ?? 'start',
    mobileOrder: o.mobileOrder ?? 'normal',
    col1: cols[0] ?? [],
    col2: cols[1] ?? [],
    col3: cols[2] ?? [],
    col4: cols[3] ?? [],
  })
const stack = (items: PresetNode[], o: { gap?: string; align?: string } = {}) =>
  n('Stack', {
    direction: 'vertical',
    gap: o.gap ?? 'xs',
    align: { base: o.align ?? 'start' },
    wrap: false,
    items,
  })
const card = (title: Bi, body: Bi, align = 'start') =>
  stack(
    [heading({ en: '' }, title, { level: 'h3', size: 'md', align }), text(body, { measure: 'full', align })],
    { align },
  )
const offerCard = (title: Bi, body: Bi, label: Bi = { en: 'Book this offer', ar: 'احجز هذا العرض' }) =>
  stack(
    [
      image(title, 'landscape'),
      heading({ en: '' }, title, { level: 'h3', size: 'md' }),
      text(body, { measure: 'full' }),
      buttons([{ ...BOOK, label, style: 'secondary' }]),
    ],
    { gap: 'sm' },
  )
const hero = (
  variant: string,
  eyebrow: Bi,
  title: Bi,
  subtitle: Bi,
  o: { background?: string; buttons?: Btn[] } = {},
) =>
  n('Hero', {
    variant,
    eyebrow,
    title,
    subtitle,
    buttons: o.buttons ?? [BOOK],
    image: '',
    imageAlt: { en: '' },
    background: o.background ?? 'none',
  })
const band = (background = 'none', padding: Record<string, string> = { base: 'lg', lg: 'xl' }) => ({
  background,
  padding,
})
const faqBlock = (title: Bi, items: { q: Bi; a: Bi }[], layout = 'accordion', background = 'none') =>
  n('FAQ', { title, items, layout, ...band(background) })
const ctaBlock = (variant: string, title: Bi, body: Bi, background = 'accent', buttonLabel?: Bi) =>
  n('BookingCTA', {
    variant,
    title,
    text: body,
    buttonLabel: buttonLabel ?? { en: 'Book online', ar: 'احجز أونلاين' },
    showWhatsApp: true,
    ...band(background),
  })
const footer = () =>
  n('Footer', {
    variant: 'columns',
    tagline: { en: 'Massage & wellness', ar: 'مساج وعافية' },
    showHours: true,
    ...band('inverse', { base: 'md', lg: 'lg' }),
  })
const floatingWhatsApp = () =>
  n('WhatsAppButton', {
    label: { en: 'WhatsApp', ar: 'واتساب' },
    message: { en: "Hi {name}, I'd like to book a massage.", ar: 'مرحبًا {name}، أود حجز جلسة مساج.' },
    side: 'end',
    style: 'pill',
  })
const quotes = [
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
]
const FAQ_BASICS = [
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
]

/* ------------------------------------------------------------------ Section presets */

export const SECTION_PRESETS: SectionPreset[] = [
  // Hero ×4
  {
    key: 'hero-centered',
    name: 'Hero — centred',
    category: 'hero',
    description: 'Large centred headline with two buttons.',
    template: 'zen',
    node: hero(
      'centered',
      { en: 'Massage & wellness', ar: 'مساج وعافية' },
      { en: 'Slow down. Breathe. Restore.', ar: 'تمهّل. تنفّس. استعد توازنك.' },
      { en: 'Unhurried treatments by skilled therapists.', ar: 'جلسات هادئة على أيدي معالجين مهرة.' },
      { buttons: [BOOK, MENU] },
    ),
  },
  {
    key: 'hero-split',
    name: 'Hero — split with image',
    category: 'hero',
    description: 'Headline beside a portrait photo.',
    template: 'nordic',
    node: hero(
      'split',
      { en: 'Massage studio', ar: 'استوديو مساج' },
      { en: 'Calm, clear and restorative.', ar: 'هدوء وصفاء وتجدد.' },
      {
        en: 'Thoughtful massage in a bright, quiet space. Book in seconds and simply arrive.',
        ar: 'مساج مدروس في مكان مشرق وهادئ. احجز في ثوانٍ وتعال فقط.',
      },
      { buttons: [BOOK, WHATSAPP] },
    ),
  },
  {
    key: 'hero-banner',
    name: 'Hero — full image',
    category: 'hero',
    description: 'Full-bleed photo with the headline on top.',
    template: 'luxury',
    node: hero(
      'banner',
      { en: '{name}', ar: '{name}' },
      { en: 'The art of deep relaxation', ar: 'فنّ الاسترخاء العميق' },
      { en: 'Signature massages in a private retreat.', ar: 'جلسات مساج مميزة في ملاذ خاص.' },
      { background: 'inverse', buttons: [BOOK, { ...MENU, style: 'link' }] },
    ),
  },
  {
    key: 'hero-statement',
    name: 'Hero — typographic statement',
    category: 'hero',
    description: 'A big centred statement on a tinted band, no photo needed.',
    template: 'desert',
    node: section(
      [
        heading(
          { en: 'أهلاً وسهلاً · Welcome', ar: 'أهلاً وسهلاً بكم' },
          { en: 'Rest is a ritual', ar: 'الراحة طقس' },
          { level: 'h1', size: 'display', align: 'center' },
        ),
        text(
          {
            en: 'Warm oils, quiet rooms and time that belongs to you.',
            ar: 'زيوت دافئة وغرف هادئة ووقت مخصص لك.',
          },
          { size: 'lg', align: 'center' },
        ),
        buttons([BOOK, WHATSAPP], { size: 'lg', align: 'center' }),
      ],
      { background: 'soft', width: 'narrow', padding: { base: 'xl' } },
    ),
  },
  // Services ×3
  {
    key: 'services-list',
    name: 'Price list',
    category: 'services',
    description: 'Your live menu as an elegant price list.',
    node: n('ServicesMenu', {
      title: { en: 'Treatments', ar: 'الجلسات' },
      intro: { en: 'Prices include VAT.', ar: 'الأسعار شاملة الضريبة.' },
      layout: 'list',
      showDescriptions: true,
      showBook: true,
      limit: 0,
      ...band(),
    }),
  },
  {
    key: 'services-cards',
    name: 'Treatment cards',
    category: 'services',
    description: 'Live menu as cards on a tinted band.',
    template: 'luxury',
    node: n('ServicesMenu', {
      title: { en: 'Signature treatments', ar: 'جلساتنا المميزة' },
      intro: { en: '' },
      layout: 'cards',
      showDescriptions: true,
      showBook: true,
      limit: 6,
      ...band('subtle'),
    }),
  },
  {
    key: 'services-price-wall',
    name: 'Price wall',
    category: 'services',
    description: 'Bold, compact prices on a dark band — great for express menus.',
    template: 'express',
    node: n('ServicesMenu', {
      title: { en: 'Prices', ar: 'الأسعار' },
      intro: { en: 'All prices in AED, VAT included.', ar: 'جميع الأسعار بالدرهم شاملة الضريبة.' },
      layout: 'cards',
      showDescriptions: false,
      showBook: true,
      limit: 0,
      ...band('inverse', { base: 'md', lg: 'lg' }),
    }),
  },
  // About ×3
  {
    key: 'about-split',
    name: 'About — photo and story',
    category: 'about',
    description: 'A photo beside a short story about your spa.',
    node: section(
      [
        columns(
          '1-1',
          [
            [image({ en: 'Treatment room', ar: 'غرفة العلاج' })],
            [
              heading(
                { en: 'Our approach', ar: 'فلسفتنا' },
                { en: 'Time that belongs to you', ar: 'وقت مخصص لك وحدك' },
              ),
              text({
                en: 'Every treatment starts with a short conversation about how you feel today. Then we take our time — no rushing, no noise.',
                ar: 'تبدأ كل جلسة بحديث قصير عن شعورك اليوم، ثم نأخذ وقتنا بلا استعجال ولا ضجيج.',
              }),
              buttons([{ ...MENU, style: 'link' }]),
            ],
          ],
          { valign: 'center', mobileOrder: 'reverse' },
        ),
      ],
      { background: 'surface' },
    ),
  },
  {
    key: 'about-statement',
    name: 'About — centred statement',
    category: 'about',
    description: 'A short, centred welcome in large type.',
    template: 'hotel',
    node: section(
      [
        heading(
          { en: 'Welcome', ar: 'أهلاً بكم' },
          { en: 'Time, beautifully spent', ar: 'وقت يُقضى بأجمل صورة' },
          {
            align: 'center',
            size: 'xl',
          },
        ),
        text(
          {
            en: 'From the moment you arrive, our team takes care of everything — a welcome tea, a short consultation and a treatment designed around you.',
            ar: 'منذ لحظة وصولك يتولى فريقنا كل شيء: شاي ترحيبي واستشارة قصيرة وجلسة مصممة حولك.',
          },
          { size: 'lg', align: 'center', measure: 'narrow' },
        ),
      ],
      { width: 'narrow', padding: { base: 'xl' } },
    ),
  },
  {
    key: 'about-usps',
    name: 'Three reasons',
    category: 'about',
    description: 'Three short reasons to choose you, side by side.',
    node: section(
      [
        columns('1-1-1', [
          [
            card(
              { en: 'Skilled therapists', ar: 'معالجون مهرة' },
              { en: 'Certified, experienced and attentive.', ar: 'معتمدون وذوو خبرة ومنتبهون.' },
            ),
          ],
          [
            card(
              { en: 'Clear prices', ar: 'أسعار واضحة' },
              { en: 'Prices in AED, VAT included.', ar: 'الأسعار بالدرهم شاملة الضريبة.' },
            ),
          ],
          [
            card(
              { en: 'Easy booking', ar: 'حجز سهل' },
              { en: 'Online or on WhatsApp — as you prefer.', ar: 'أونلاين أو عبر واتساب، كما تفضّل.' },
            ),
          ],
        ]),
      ],
      { background: 'surface', padding: { base: 'lg' } },
    ),
  },
  // Team ×2
  {
    key: 'team-portraits',
    name: 'Team — portraits',
    category: 'team',
    description: 'Your bookable therapists with photos and bios (live).',
    node: n('Team', {
      title: { en: 'Your therapists', ar: 'معالجوك' },
      intro: { en: '' },
      layout: 'grid',
      showBio: true,
      ...band(),
    }),
  },
  {
    key: 'team-compact',
    name: 'Team — compact list',
    category: 'team',
    description: 'A compact list of your therapists on a tinted band.',
    node: n('Team', {
      title: { en: 'The team', ar: 'الفريق' },
      intro: {
        en: 'Tell us your preference when you book — we will match you with the right therapist.',
        ar: 'أخبرنا بتفضيلك عند الحجز وسنختار لك المعالج المناسب.',
      },
      layout: 'compact',
      showBio: true,
      ...band('subtle'),
    }),
  },
  // Offers ×3
  {
    key: 'offers-cards',
    name: 'Offer cards',
    category: 'offers',
    description: 'Three offers with photos and a book button each.',
    node: section([
      heading({ en: 'Offers', ar: 'العروض' }, { en: 'This month', ar: 'هذا الشهر' }),
      columns('1-1-1', [
        [
          offerCard(
            { en: 'Weekday mornings', ar: 'صباحات أيام الأسبوع' },
            { en: 'A calmer spa and a little extra time.', ar: 'مركز أهدأ ووقت إضافي قليل.' },
          ),
        ],
        [
          offerCard(
            { en: 'Bring a friend', ar: 'أحضر صديقًا' },
            { en: 'Book two treatments together.', ar: 'احجزا جلستين معًا.' },
          ),
        ],
        [
          offerCard(
            { en: 'Package of five', ar: 'باقة الخمس جلسات' },
            { en: 'Buy five sessions and save on each visit.', ar: 'اشترِ خمس جلسات ووفّر في كل زيارة.' },
          ),
        ],
      ]),
    ]),
  },
  {
    key: 'offers-banner',
    name: 'Offer banner',
    category: 'offers',
    description: 'One highlighted offer on an accent band.',
    node: section(
      [
        columns(
          '2-1',
          [
            [
              heading(
                { en: 'Limited time', ar: 'لفترة محدودة' },
                {
                  en: 'Add a 15-minute scalp massage to any treatment',
                  ar: 'أضف مساجًا لفروة الرأس لمدة 15 دقيقة إلى أي جلسة',
                },
              ),
              text(
                { en: 'Mention this offer when you book.', ar: 'اذكر هذا العرض عند الحجز.' },
                { tone: 'default' },
              ),
            ],
            [buttons([BOOK], { size: 'lg', align: 'end', stack: true })],
          ],
          { valign: 'center' },
        ),
      ],
      { background: 'accent', padding: { base: 'lg' } },
    ),
  },
  {
    key: 'offers-package',
    name: 'Package spotlight',
    category: 'offers',
    description: 'A photo beside one package and what it includes.',
    template: 'hotel',
    node: section(
      [
        columns(
          '1-1',
          [
            [image({ en: 'Spa package', ar: 'باقة السبا' }, 'landscape')],
            [
              heading({ en: 'Package', ar: 'باقة' }, { en: 'Half-day escape', ar: 'هروب لنصف يوم' }),
              text({
                en: 'A 60-minute massage, a foot ritual and time in the relaxation lounge.\n\nAsk us about this month’s price.',
                ar: 'مساج لمدة 60 دقيقة وطقس للقدمين ووقت في صالة الاسترخاء.\n\nاسألنا عن سعر هذا الشهر.',
              }),
              buttons([BOOK, WHATSAPP]),
            ],
          ],
          { valign: 'center' },
        ),
      ],
      { background: 'soft' },
    ),
  },
  // Social proof ×3
  {
    key: 'reviews-grid',
    name: 'Reviews — grid',
    category: 'social-proof',
    description: 'Three guest quotes side by side.',
    node: n('Testimonials', {
      title: { en: 'Kind words', ar: 'آراء ضيوفنا' },
      layout: 'grid',
      items: quotes,
      ...band(),
    }),
  },
  {
    key: 'reviews-feature',
    name: 'Review — featured quote',
    category: 'social-proof',
    description: 'One large quote on a tinted band.',
    template: 'zen',
    node: n('Testimonials', {
      title: { en: 'Guests say', ar: 'يقول ضيوفنا' },
      layout: 'feature',
      items: quotes.slice(0, 1),
      ...band('subtle'),
    }),
  },
  {
    key: 'stats-row',
    name: 'Numbers row',
    category: 'social-proof',
    description: 'Four quick facts in big numbers.',
    node: section(
      [
        columns('1-1-1-1', [
          [
            stack([
              heading({ en: '' }, { en: '10+', ar: '+10' }, { size: 'xl', level: 'h3' }),
              text({ en: 'years of experience', ar: 'سنوات من الخبرة' }),
            ]),
          ],
          [
            stack([
              heading({ en: '' }, { en: '4.9 ★', ar: '4.9 ★' }, { size: 'xl', level: 'h3' }),
              text({ en: 'average guest rating', ar: 'متوسط تقييم الضيوف' }),
            ]),
          ],
          [
            stack([
              heading({ en: '' }, { en: '7 days', ar: '7 أيام' }, { size: 'xl', level: 'h3' }),
              text({ en: 'open every week', ar: 'مفتوح طوال الأسبوع' }),
            ]),
          ],
          [
            stack([
              heading({ en: '' }, { en: '1 min', ar: 'دقيقة' }, { size: 'xl', level: 'h3' }),
              text({ en: 'to book online', ar: 'للحجز أونلاين' }),
            ]),
          ],
        ]),
      ],
      { background: 'surface', padding: { base: 'lg' } },
    ),
  },
  // FAQ ×2
  {
    key: 'faq-basics',
    name: 'FAQ — the basics',
    category: 'faq',
    description: 'Booking, payment and arrival questions.',
    node: faqBlock({ en: 'Good to know', ar: 'معلومات مفيدة' }, FAQ_BASICS, 'columns'),
  },
  {
    key: 'faq-first-visit',
    name: 'FAQ — your first visit',
    category: 'faq',
    description: 'What to wear, when to arrive and how to choose.',
    node: faqBlock({ en: 'Your first visit', ar: 'زيارتك الأولى' }, [
      {
        q: { en: 'When should I arrive?', ar: 'متى يجب أن أصل؟' },
        a: { en: 'Ten minutes early is perfect.', ar: 'الوصول قبل عشر دقائق مثالي.' },
      },
      {
        q: { en: 'What should I wear?', ar: 'ماذا أرتدي؟' },
        a: {
          en: 'Whatever is comfortable — we provide everything you need.',
          ar: 'ما يريحك، فنحن نوفر كل ما تحتاجه.',
        },
      },
      {
        q: { en: 'Which massage should I choose?', ar: 'أي مساج أختار؟' },
        a: {
          en: 'Tell us how you feel and we will suggest the right treatment.',
          ar: 'أخبرنا بما تشعر به وسنقترح الجلسة المناسبة.',
        },
      },
      {
        q: { en: 'Can I request a female therapist?', ar: 'هل يمكنني طلب معالجة؟' },
        a: { en: 'Of course — add it to your booking note.', ar: 'بالتأكيد، أضف ذلك في ملاحظة الحجز.' },
      },
    ]),
  },
  // Contact ×2
  {
    key: 'contact-hours',
    name: 'Hours and address',
    category: 'contact',
    description: 'Live opening hours, address and map link.',
    node: n('OpeningHours', {
      title: { en: 'Visit us', ar: 'زورونا' },
      layout: 'split',
      showMap: true,
      ...band('subtle'),
    }),
  },
  {
    key: 'contact-buttons',
    name: 'Get in touch',
    category: 'contact',
    description: 'Headline with book, WhatsApp and call buttons.',
    node: section([
      heading({ en: 'Contact', ar: 'تواصل' }, { en: 'We would love to see you', ar: 'يسعدنا استقبالكم' }),
      text({
        en: 'Book online, message us on WhatsApp or give us a call.',
        ar: 'احجز أونلاين أو راسلنا على واتساب أو اتصل بنا.',
      }),
      buttons([BOOK, WHATSAPP, CALL], { size: 'lg', stack: true }),
    ]),
  },
  // CTA ×2
  {
    key: 'cta-simple',
    name: 'Booking call-to-action',
    category: 'cta',
    description: 'Centered headline with a booking button.',
    node: ctaBlock(
      'banner',
      { en: 'Ready to unwind?', ar: 'مستعد للاسترخاء؟' },
      { en: 'Book online in under a minute.', ar: 'احجز عبر الإنترنت في أقل من دقيقة.' },
      'accent',
      BOOK.label,
    ),
  },
  {
    key: 'cta-split',
    name: 'Booking — dark split',
    category: 'cta',
    description: 'Headline and buttons split across a dark band.',
    template: 'teak',
    node: ctaBlock(
      'split',
      { en: 'Make time for yourself', ar: 'خصّص وقتًا لنفسك' },
      { en: 'Same-day appointments are often available.', ar: 'تتوفر غالبًا مواعيد في اليوم نفسه.' },
      'inverse',
    ),
  },
]

/* ------------------------------------------------------------------ Page templates */

const GALLERY_ALTS: Bi[] = [
  { en: 'Treatment room', ar: 'غرفة العلاج' },
  { en: 'Reception', ar: 'الاستقبال' },
  { en: 'Warm oils and towels', ar: 'زيوت دافئة ومناشف' },
  { en: 'Relaxation lounge', ar: 'صالة الاسترخاء' },
  { en: 'Massage in progress', ar: 'جلسة مساج' },
  { en: 'Details of the spa', ar: 'تفاصيل من المركز' },
]
const galleryBlock = (title: Bi, count: number, layout: string, background = 'none') =>
  n('Gallery', {
    title,
    images: Array.from({ length: count }, (_, i) => ({
      src: '',
      alt: GALLERY_ALTS[i % GALLERY_ALTS.length],
    })),
    layout,
    columns: '3',
    ...band(background),
  })
const intro = (eyebrow: Bi, title: Bi, lead: Bi, align = 'start') =>
  section([heading(eyebrow, title, { level: 'h1', size: 'xl', align }), text(lead, { size: 'lg', align })], {
    width: align === 'center' ? 'narrow' : 'contained',
  })

/**
 * 3D motion bands of the design templates (R5): each template's services band and "your visit" steps with its
 * scroll scene, deduplicated by scene, so any page can borrow a motion (the look follows the active theme).
 */
const SCENE_NAMES: Record<string, string> = {
  fan: 'dealt from a fan',
  cube: 'turning cube',
  doors: 'opening doors',
  coverflow: 'coverflow',
  road: 'down the road',
  pages: 'turning pages',
  prism: 'glass prism',
  slabs: 'sliding slabs',
  layers: 'separating layers',
  blocks: 'block by block',
  brochure: 'unfolding brochure',
  turn: 'flip to the front',
  assemble: 'fly into place',
  rise: 'rising pillars',
  flip: 'split-flap rows',
}
function motionPresets(): SectionPreset[] {
  const seen = new Set<string>()
  const out: SectionPreset[] = []
  for (const t of Object.values(TEMPLATES).slice(8)) {
    const home = t.pages.find((p) => p.slug === '')?.data.content as PresetNode[] | undefined
    for (const node of home ?? []) {
      const scene = String(node.props.scene ?? '')
      const kind = node.type === 'ServicesMenu' ? 'Services' : node.type === 'Section' ? 'Your visit' : null
      if (!kind || !SCENE_NAMES[scene] || seen.has(`${kind}:${scene}`)) continue
      if (kind === 'Your visit' && !JSON.stringify(node.props).includes('01  ')) continue
      seen.add(`${kind}:${scene}`)
      out.push({
        key: `motion-${kind === 'Services' ? 'services' : 'visit'}-${scene}`,
        name: `${kind} — ${SCENE_NAMES[scene]}`,
        category: 'motion',
        description: `From ${t.name}: the ${kind === 'Services' ? 'treatment cards' : 'four steps'} arrive with a 3D scroll scene.`,
        template: t.key,
        node,
      })
    }
  }
  return out
}
SECTION_PRESETS.push(...motionPresets())

export const PAGE_TEMPLATES: PageTemplate[] = [
  {
    key: 'ramadan-offers',
    name: 'Ramadan offers',
    description: 'Evening hours, Ramadan treatments and Eid gift cards.',
    slug: 'ramadan-offers',
    title: { en: 'Ramadan offers', ar: 'عروض رمضان' },
    seo: {
      title: { en: 'Ramadan offers — {name}', ar: 'عروض رمضان — {name}' },
      description: {
        en: 'Ramadan evenings of calm at {name}: late opening, special treatments and Eid gift cards.',
        ar: 'أمسيات رمضانية هادئة في {name}: ساعات عمل متأخرة وجلسات خاصة وبطاقات هدايا العيد.',
      },
    },
    content: [
      hero(
        'centered',
        { en: 'Ramadan Kareem', ar: 'رمضان كريم' },
        { en: 'Ramadan evenings of calm', ar: 'أمسيات رمضانية من الهدوء' },
        {
          en: 'Open after iftar until late. Treat yourself or someone you love.',
          ar: 'نفتح بعد الإفطار حتى وقت متأخر. دلّل نفسك أو من تحب.',
        },
        { background: 'soft', buttons: [BOOK, WHATSAPP] },
      ),
      section([
        heading(
          { en: 'This Ramadan', ar: 'في رمضان هذا العام' },
          { en: 'Ramadan treatments', ar: 'جلسات رمضان' },
        ),
        columns('1-1-1', [
          [
            offerCard(
              { en: 'After-iftar massage', ar: 'مساج بعد الإفطار' },
              { en: 'A gentle full-body massage to end the day.', ar: 'مساج لطيف للجسم كاملًا لختام اليوم.' },
            ),
          ],
          [
            offerCard(
              { en: 'Ramadan package', ar: 'باقة رمضان' },
              {
                en: 'Four visits to enjoy through the holy month.',
                ar: 'أربع زيارات للاستمتاع بها طوال الشهر الفضيل.',
              },
            ),
          ],
          [
            offerCard(
              { en: 'Eid gift cards', ar: 'بطاقات هدايا العيد' },
              {
                en: 'The perfect Eid gift — ask us on WhatsApp.',
                ar: 'هدية العيد المثالية، اسألنا عبر واتساب.',
              },
              { en: 'Ask about gift cards', ar: 'اسأل عن بطاقات الهدايا' },
            ),
          ],
        ]),
      ]),
      n('OpeningHours', {
        title: { en: 'Ramadan hours', ar: 'ساعات العمل في رمضان' },
        layout: 'table',
        showMap: true,
        ...band('subtle'),
      }),
      ctaBlock(
        'banner',
        { en: 'Book your Ramadan evening', ar: 'احجز أمسيتك الرمضانية' },
        { en: 'Evening times fill up quickly — book ahead.', ar: 'مواعيد المساء تمتلئ بسرعة، احجز مسبقًا.' },
      ),
      footer(),
      floatingWhatsApp(),
    ],
  },
  {
    key: 'couples',
    name: 'Couples package',
    description: 'A side-by-side treatment page with what is included.',
    slug: 'couples',
    title: { en: 'Couples', ar: 'للأزواج' },
    seo: {
      title: { en: 'Couples massage — {name}', ar: 'مساج للأزواج — {name}' },
      description: {
        en: 'Side-by-side massage in a private room at {name}.',
        ar: 'مساج جنبًا إلى جنب في غرفة خاصة في {name}.',
      },
    },
    content: [
      hero(
        'split',
        { en: 'Couples package', ar: 'باقة الأزواج' },
        { en: 'Side by side', ar: 'جنبًا إلى جنب' },
        {
          en: 'Two therapists, one private room and an hour to share.',
          ar: 'معالجان وغرفة خاصة وساعة تتشاركانها.',
        },
        { buttons: [BOOK, WHATSAPP] },
      ),
      section(
        [
          columns('1-1-1', [
            [
              card(
                { en: 'Private room', ar: 'غرفة خاصة' },
                { en: 'Your own room with two tables.', ar: 'غرفة خاصة بكما مع سريرين.' },
              ),
            ],
            [
              card(
                { en: 'Your choice of massage', ar: 'اختيار المساج' },
                {
                  en: 'Each of you chooses treatment and pressure.',
                  ar: 'يختار كل منكما الجلسة وقوة الضغط.',
                },
              ),
            ],
            [
              card(
                { en: 'Tea afterwards', ar: 'شاي بعد الجلسة' },
                { en: 'Take your time in the lounge.', ar: 'خذا وقتكما في صالة الاسترخاء.' },
              ),
            ],
          ]),
        ],
        { background: 'surface', padding: { base: 'lg' } },
      ),
      n('ServicesMenu', {
        title: { en: 'Choose your treatments', ar: 'اختارا جلساتكما' },
        intro: { en: 'Prices are per person and include VAT.', ar: 'الأسعار للشخص الواحد وشاملة الضريبة.' },
        layout: 'cards',
        showDescriptions: true,
        showBook: true,
        limit: 6,
        ...band(),
      }),
      faqBlock({ en: 'Good to know', ar: 'معلومات مفيدة' }, [
        {
          q: { en: 'How do we book for two?', ar: 'كيف نحجز لشخصين؟' },
          a: {
            en: 'Message us on WhatsApp and we will reserve two therapists at the same time.',
            ar: 'راسلنا على واتساب وسنحجز لكما معالجين في الوقت نفسه.',
          },
        },
        ...FAQ_BASICS.slice(1),
      ]),
      ctaBlock(
        'card',
        { en: 'Plan your visit together', ar: 'خططا لزيارتكما معًا' },
        { en: 'Weekend evenings are popular — book early.', ar: 'أمسيات نهاية الأسبوع مطلوبة، احجزا مبكرًا.' },
        'none',
      ),
      footer(),
      floatingWhatsApp(),
    ],
  },
  {
    key: 'corporate-wellness',
    name: 'Corporate wellness',
    description: 'Team vouchers and wellness days for companies.',
    slug: 'corporate-wellness',
    title: { en: 'Corporate', ar: 'للشركات' },
    seo: {
      title: { en: 'Corporate wellness — {name}', ar: 'العافية للشركات — {name}' },
      description: {
        en: 'Massage vouchers and wellness days for your team at {name}.',
        ar: 'قسائم مساج وأيام عافية لفريقك في {name}.',
      },
    },
    content: [
      hero(
        'centered',
        { en: 'For companies', ar: 'للشركات' },
        { en: 'Wellness for your team', ar: 'العافية لفريقك' },
        {
          en: 'Thank your people with time to recharge — vouchers, team days and regular sessions.',
          ar: 'اشكر فريقك بوقت لاستعادة النشاط: قسائم وأيام جماعية وجلسات منتظمة.',
        },
        {
          buttons: [{ ...WHATSAPP, label: { en: 'Ask for a proposal', ar: 'اطلب عرضًا' }, style: 'primary' }],
        },
      ),
      section(
        [
          columns('1-1-1', [
            [
              card(
                { en: 'Team vouchers', ar: 'قسائم للفريق' },
                {
                  en: 'Gift cards in any amount, ready for your team.',
                  ar: 'بطاقات هدايا بأي قيمة جاهزة لفريقك.',
                },
              ),
            ],
            [
              card(
                { en: 'Wellness days', ar: 'أيام العافية' },
                { en: 'Reserve the spa for your team.', ar: 'احجز المركز لفريقك.' },
              ),
            ],
            [
              card(
                { en: 'Simple invoicing', ar: 'فوترة بسيطة' },
                {
                  en: 'One invoice for your company, VAT included.',
                  ar: 'فاتورة واحدة لشركتك شاملة الضريبة.',
                },
              ),
            ],
          ]),
        ],
        { background: 'surface', padding: { base: 'lg' } },
      ),
      section([
        columns(
          '1-1',
          [
            [image({ en: 'Relaxation lounge', ar: 'صالة الاسترخاء' }, 'landscape')],
            [
              heading(
                { en: 'How it works', ar: 'كيف يعمل' },
                { en: 'Three easy steps', ar: 'ثلاث خطوات سهلة' },
              ),
              text({
                en: '1. Tell us your team size and budget.\n\n2. We send a simple proposal.\n\n3. Your team books online or on WhatsApp.',
                ar: '1. أخبرنا بحجم فريقك وميزانيتك.\n\n2. نرسل لك عرضًا بسيطًا.\n\n3. يحجز فريقك أونلاين أو عبر واتساب.',
              }),
            ],
          ],
          { valign: 'center' },
        ),
      ]),
      faqBlock(
        { en: 'Questions from companies', ar: 'أسئلة الشركات' },
        [
          {
            q: { en: 'Is there a minimum?', ar: 'هل هناك حد أدنى؟' },
            a: { en: 'No — from one voucher to the whole office.', ar: 'لا، من قسيمة واحدة إلى المكتب كله.' },
          },
          {
            q: { en: 'Do you issue tax invoices?', ar: 'هل تصدرون فواتير ضريبية؟' },
            a: { en: 'Yes, with VAT shown.', ar: 'نعم، مع إظهار ضريبة القيمة المضافة.' },
          },
        ],
        'columns',
        'subtle',
      ),
      footer(),
      floatingWhatsApp(),
    ],
  },
  {
    key: 'gift-cards',
    name: 'Gift cards',
    description: 'Explain your gift cards and how to buy them.',
    slug: 'gift-cards',
    title: { en: 'Gift cards', ar: 'بطاقات الهدايا' },
    seo: {
      title: { en: 'Gift cards — {name}', ar: 'بطاقات الهدايا — {name}' },
      description: {
        en: 'Give the gift of calm with a {name} gift card.',
        ar: 'أهدِ لحظات من الهدوء ببطاقة هدايا من {name}.',
      },
    },
    content: [
      hero(
        'split',
        { en: 'Gift cards', ar: 'بطاقات الهدايا' },
        { en: 'Give the gift of calm', ar: 'أهدِ لحظات من الهدوء' },
        {
          en: 'For birthdays, Eid, thank-yous or just because. Buy at the spa or on WhatsApp.',
          ar: 'لأعياد الميلاد والعيد والشكر أو دون مناسبة. اشترِها في المركز أو عبر واتساب.',
        },
        {
          buttons: [
            { ...WHATSAPP, label: { en: 'Order on WhatsApp', ar: 'اطلب عبر واتساب' }, style: 'primary' },
          ],
        },
      ),
      section(
        [
          columns('1-1-1', [
            [
              card(
                { en: 'Any amount', ar: 'أي قيمة' },
                { en: 'They choose the treatment they love.', ar: 'يختار المُهدى إليه الجلسة التي يحبها.' },
              ),
            ],
            [
              card(
                { en: 'A favourite treatment', ar: 'جلسة مفضلة' },
                { en: 'Gift a specific massage and duration.', ar: 'أهدِ مساجًا محددًا بمدة محددة.' },
              ),
            ],
            [
              card(
                { en: 'A package', ar: 'باقة' },
                { en: 'Several visits to enjoy over time.', ar: 'عدة زيارات للاستمتاع بها مع الوقت.' },
              ),
            ],
          ]),
        ],
        { background: 'surface', padding: { base: 'lg' } },
      ),
      faqBlock({ en: 'Gift card questions', ar: 'أسئلة عن بطاقات الهدايا' }, [
        {
          q: { en: 'How do I buy one?', ar: 'كيف أشتري بطاقة؟' },
          a: {
            en: 'At the spa, or message us on WhatsApp and pay when you collect.',
            ar: 'في المركز، أو راسلنا على واتساب وادفع عند الاستلام.',
          },
        },
        {
          q: { en: 'How long is it valid?', ar: 'ما مدة صلاحيتها؟' },
          a: { en: 'The expiry date is printed on every card.', ar: 'تاريخ الانتهاء مطبوع على كل بطاقة.' },
        },
        {
          q: { en: 'How is it redeemed?', ar: 'كيف تُستخدم؟' },
          a: { en: 'Show the card code when you pay.', ar: 'أظهر رمز البطاقة عند الدفع.' },
        },
      ]),
      footer(),
      floatingWhatsApp(),
    ],
  },
  {
    key: 'our-story',
    name: 'Our story',
    description: 'Your history, values and a guest quote.',
    slug: 'our-story',
    title: { en: 'Our story', ar: 'قصتنا' },
    seo: {
      title: { en: 'Our story — {name}', ar: 'قصتنا — {name}' },
      description: { en: 'How {name} began and what we believe in.', ar: 'كيف بدأ {name} وما نؤمن به.' },
    },
    content: [
      intro(
        { en: 'Our story', ar: 'قصتنا' },
        { en: 'How it all began', ar: 'كيف بدأ كل شيء' },
        {
          en: 'We opened {name} to create the place we always wanted to visit ourselves.',
          ar: 'افتتحنا {name} لنصنع المكان الذي طالما أردنا زيارته بأنفسنا.',
        },
        'center',
      ),
      section(
        [
          columns(
            '1-1',
            [
              [image({ en: 'Our spa', ar: 'مركزنا' })],
              [
                heading(
                  { en: 'What we believe', ar: 'ما نؤمن به' },
                  { en: 'Care in every detail', ar: 'عناية في كل تفصيل' },
                ),
                text({
                  en: 'Skilled hands, honest prices and a calm, spotless space. We listen first, then tailor every treatment to you.',
                  ar: 'أيدٍ ماهرة وأسعار صادقة ومكان هادئ ونظيف. نستمع أولًا ثم نصمم كل جلسة لك.',
                }),
              ],
            ],
            { valign: 'center', mobileOrder: 'reverse' },
          ),
        ],
        { background: 'surface' },
      ),
      n('Testimonials', {
        title: { en: 'Guests say', ar: 'يقول ضيوفنا' },
        layout: 'feature',
        items: quotes.slice(2),
        ...band('subtle'),
      }),
      ctaBlock(
        'banner',
        { en: 'Come and see for yourself', ar: 'تعال وجرّب بنفسك' },
        { en: 'Book online in under a minute.', ar: 'احجز أونلاين في أقل من دقيقة.' },
      ),
      footer(),
      floatingWhatsApp(),
    ],
  },
  {
    key: 'team',
    name: 'Team',
    description: 'Introduce your therapists (live from your staff list).',
    slug: 'team',
    title: { en: 'Team', ar: 'الفريق' },
    seo: {
      title: { en: 'Our therapists — {name}', ar: 'معالجونا — {name}' },
      description: { en: 'Meet the therapists at {name}.', ar: 'تعرّف على المعالجين في {name}.' },
    },
    content: [
      intro(
        { en: 'Team', ar: 'الفريق' },
        { en: 'Meet your therapists', ar: 'تعرّف على معالجيك' },
        {
          en: 'Experienced, certified and genuinely caring. Tell us your preference when you book.',
          ar: 'ذوو خبرة ومعتمدون ويهتمون بك حقًا. أخبرنا بتفضيلك عند الحجز.',
        },
      ),
      n('Team', {
        title: { en: '' },
        intro: { en: '' },
        layout: 'grid',
        showBio: true,
        ...band('none', { base: 'sm', lg: 'md' }),
      }),
      ctaBlock(
        'split',
        { en: 'Book with your favourite therapist', ar: 'احجز مع معالجك المفضل' },
        { en: 'Choose a therapist when you book online.', ar: 'اختر المعالج عند الحجز أونلاين.' },
        'inverse',
      ),
      footer(),
      floatingWhatsApp(),
    ],
  },
  {
    key: 'gallery',
    name: 'Gallery',
    description: 'A photo grid and a scrolling strip.',
    slug: 'gallery',
    title: { en: 'Gallery', ar: 'المعرض' },
    seo: {
      title: { en: 'Gallery — {name}', ar: 'المعرض — {name}' },
      description: { en: 'A look inside {name}.', ar: 'نظرة إلى داخل {name}.' },
    },
    content: [
      intro(
        { en: 'Gallery', ar: 'المعرض' },
        { en: 'A look inside', ar: 'نظرة إلى الداخل' },
        { en: 'Our rooms, lounge and the little details.', ar: 'غرفنا وصالتنا والتفاصيل الصغيرة.' },
      ),
      galleryBlock({ en: '' }, 9, 'grid'),
      galleryBlock({ en: 'Details', ar: 'تفاصيل' }, 5, 'strip', 'subtle'),
      ctaBlock(
        'card',
        { en: 'See it in person', ar: 'شاهده بنفسك' },
        { en: 'Your room is ready when you are.', ar: 'غرفتك جاهزة متى شئت.' },
        'none',
      ),
      footer(),
      floatingWhatsApp(),
    ],
  },
]

export const isPageTemplateKey = (key: string) => PAGE_TEMPLATES.some((t) => t.key === key)

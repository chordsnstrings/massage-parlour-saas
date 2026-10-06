import type { SiteTemplate } from '@spa/services'
import type { SiteTheme } from './theme'
import type { Bi } from './types'

/**
 * P1 templates (PLAN §11.2): Zen Minimal, Dark Luxury, Nordic Clean. Each = theme tokens + starter pages
 * built from the same blocks, so switching template can keep content and only swap tokens.
 */
type Node = { type: string; props: Record<string, unknown> }

function builder(prefix: string) {
  let n = 0
  return (type: string, props: Record<string, unknown> = {}): Node => ({
    type,
    props: { id: `${prefix}-${type.toLowerCase()}-${++n}`, ...props },
  })
}

const page = (title: Bi, description: Bi, content: Node[]) => ({
  root: { props: { title, description } },
  content,
})

const BOOK = {
  label: { en: 'Book a treatment', ar: 'احجز جلستك' },
  action: 'book',
  target: '',
  style: 'primary',
}
const SEE_MENU = {
  label: { en: 'See the menu', ar: 'تصفح القائمة' },
  action: 'page',
  target: 'services',
  style: 'secondary',
}
const WHATSAPP = {
  label: { en: 'WhatsApp us', ar: 'راسلنا على واتساب' },
  action: 'whatsapp',
  target: '',
  style: 'secondary',
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
  contact: { en: 'Contact', ar: 'تواصل' },
}

function servicesPage(c: ReturnType<typeof builder>, layout: 'list' | 'cards', ctaBg: string) {
  return page(SEO.services.title, SEO.services.description, [
    c('Section', {
      background: 'none',
      width: 'contained',
      padding: { base: 'lg', lg: 'xl' },
      gap: 'md',
      content: [
        c('Heading', {
          eyebrow: { en: 'Menu', ar: 'القائمة' },
          text: { en: 'Treatments & prices', ar: 'الجلسات والأسعار' },
          level: 'h1',
          size: 'xl',
          align: { base: 'start' },
        }),
        c('RichText', {
          text: {
            en: 'All prices are in AED and include VAT. Not sure what to choose? Message us and we will help.',
            ar: 'جميع الأسعار بالدرهم وشاملة ضريبة القيمة المضافة. لست متأكدًا؟ راسلنا وسنساعدك.',
          },
          size: 'lg',
          tone: 'muted',
          measure: 'normal',
          align: { base: 'start' },
        }),
      ],
    }),
    c('ServicesMenu', {
      title: { en: '' },
      intro: { en: '' },
      layout,
      showDescriptions: true,
      showBook: true,
      limit: 0,
      background: 'none',
      padding: { base: 'sm', lg: 'md' },
    }),
    c('BookingCTA', {
      variant: 'banner',
      title: { en: 'Found your treatment?', ar: 'وجدت جلستك؟' },
      text: { en: 'Pick a time that suits you.', ar: 'اختر الوقت المناسب لك.' },
      buttonLabel: { en: 'Book online', ar: 'احجز أونلاين' },
      showWhatsApp: true,
      background: ctaBg,
      padding: { base: 'lg' },
    }),
    c('Footer', {
      variant: 'columns',
      tagline: { en: 'Massage & wellness', ar: 'مساج وعافية' },
      showHours: true,
      background: 'inverse',
      padding: { base: 'md', lg: 'lg' },
    }),
    c('WhatsAppButton', {
      label: { en: 'WhatsApp', ar: 'واتساب' },
      message: { en: "Hi {name}, I'd like to book a massage.", ar: 'مرحبًا {name}، أود حجز جلسة مساج.' },
      side: 'end',
      style: 'pill',
    }),
  ])
}

function contactPage(c: ReturnType<typeof builder>) {
  return page(SEO.contact.title, SEO.contact.description, [
    c('Section', {
      background: 'none',
      width: 'contained',
      padding: { base: 'lg', lg: 'xl' },
      gap: 'md',
      content: [
        c('Heading', {
          eyebrow: { en: 'Contact', ar: 'تواصل' },
          text: { en: 'We would love to see you', ar: 'يسعدنا استقبالكم' },
          level: 'h1',
          size: 'xl',
          align: { base: 'start' },
        }),
        c('ButtonGroup', {
          buttons: [BOOK, WHATSAPP],
          size: 'lg',
          stackOnMobile: true,
          align: { base: 'start' },
        }),
      ],
    }),
    c('OpeningHours', {
      title: { en: 'Visit us', ar: 'زورونا' },
      layout: 'split',
      showMap: true,
      background: 'subtle',
      padding: { base: 'lg' },
    }),
    c('FAQ', {
      title: { en: 'Good to know', ar: 'معلومات مفيدة' },
      layout: 'accordion',
      items: [
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
      ],
      background: 'none',
      padding: { base: 'lg' },
    }),
    c('Footer', {
      variant: 'columns',
      tagline: { en: 'Massage & wellness', ar: 'مساج وعافية' },
      showHours: true,
      background: 'inverse',
      padding: { base: 'md', lg: 'lg' },
    }),
  ])
}

const pages = (
  home: ReturnType<typeof page>,
  services: ReturnType<typeof page>,
  contact: ReturnType<typeof page>,
) => [
  { slug: '', title: PAGE_TITLES.home, data: home },
  { slug: 'services', title: PAGE_TITLES.services, data: services },
  { slug: 'contact', title: PAGE_TITLES.contact, data: contact },
]

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
}

function zen(): SiteTemplate {
  const c = builder('zen')
  const home = page(SEO.home.title, SEO.home.description, [
    c('Hero', {
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
    }),
    c('Section', {
      background: 'surface',
      width: 'contained',
      padding: { base: 'lg', lg: 'xl' },
      gap: 'md',
      content: [
        c('Columns', {
          ratio: '1-1',
          gap: 'lg',
          valign: 'center',
          mobileOrder: 'reverse',
          col1: [
            c('Image', {
              src: '',
              alt: { en: 'Treatment room' },
              caption: { en: '' },
              aspect: 'portrait',
              rounded: true,
            }),
          ],
          col2: [
            c('Heading', {
              eyebrow: { en: 'Our approach', ar: 'فلسفتنا' },
              text: { en: 'Time that belongs to you', ar: 'وقت مخصص لك وحدك' },
              level: 'h2',
              size: 'lg',
              align: { base: 'start' },
            }),
            c('RichText', {
              text: {
                en: 'Every treatment starts with a short conversation about how you feel today. Then we take our time — no rushing, no noise.\n\nOur therapists are trained in Swedish, deep tissue, Thai and hot stone massage.',
                ar: 'تبدأ كل جلسة بحديث قصير عن شعورك اليوم، ثم نأخذ وقتنا بلا استعجال ولا ضجيج.\n\nمعالجونا مدرّبون على المساج السويدي والأنسجة العميقة والتايلاندي والأحجار الساخنة.',
              },
              size: 'md',
              tone: 'muted',
              measure: 'normal',
              align: { base: 'start' },
            }),
            c('ButtonGroup', {
              buttons: [{ ...SEE_MENU, style: 'link' }],
              size: 'md',
              stackOnMobile: false,
              align: { base: 'start' },
            }),
          ],
          col3: [],
          col4: [],
        }),
      ],
    }),
    c('ServicesMenu', {
      title: { en: 'Treatments', ar: 'الجلسات' },
      intro: { en: 'Prices include VAT.', ar: 'الأسعار شاملة الضريبة.' },
      layout: 'list',
      showDescriptions: true,
      showBook: true,
      limit: 6,
      background: 'none',
      padding: { base: 'lg', lg: 'xl' },
    }),
    c('Testimonials', {
      title: { en: 'Kind words', ar: 'آراء ضيوفنا' },
      layout: 'feature',
      items: [
        {
          quote: {
            en: 'The calmest hour of my week. I leave feeling lighter every time.',
            ar: 'أهدأ ساعة في أسبوعي. أخرج كل مرة وأنا أشعر بخفة.',
          },
          author: 'Layla',
          detail: { en: 'Swedish massage', ar: 'مساج سويدي' },
        },
      ],
      background: 'subtle',
      padding: { base: 'lg', lg: 'xl' },
    }),
    c('OpeningHours', {
      title: { en: 'Visit us', ar: 'زورونا' },
      layout: 'split',
      showMap: true,
      background: 'none',
      padding: { base: 'lg', lg: 'xl' },
    }),
    c('BookingCTA', {
      variant: 'card',
      title: { en: 'Your hour of calm is waiting', ar: 'ساعة هدوئك بانتظارك' },
      text: { en: 'Book online in under a minute.', ar: 'احجز أونلاين في أقل من دقيقة.' },
      buttonLabel: { en: 'Book online', ar: 'احجز أونلاين' },
      showWhatsApp: true,
      background: 'none',
      padding: { base: 'md', lg: 'lg' },
    }),
    c('Footer', {
      variant: 'columns',
      tagline: { en: 'Massage & wellness', ar: 'مساج وعافية' },
      showHours: true,
      background: 'inverse',
      padding: { base: 'md', lg: 'lg' },
    }),
    c('WhatsAppButton', {
      label: { en: 'WhatsApp', ar: 'واتساب' },
      message: { en: "Hi {name}, I'd like to book a massage.", ar: 'مرحبًا {name}، أود حجز جلسة مساج.' },
      side: 'end',
      style: 'pill',
    }),
  ])
  return {
    key: 'zen',
    name: 'Zen Minimal',
    theme: zenTheme,
    pages: pages(home, servicesPage(c, 'list', 'accent'), contactPage(c)),
  }
}

/* ------------------------------------------------------------------ Dark Luxury */

const Testimonials3 = [
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
}

function luxury(): SiteTemplate {
  const c = builder('lux')
  const home = page(SEO.home.title, SEO.home.description, [
    c('Hero', {
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
    }),
    c('Section', {
      background: 'none',
      width: 'contained',
      padding: { base: 'lg', lg: 'xl' },
      gap: 'md',
      content: [
        c('Columns', {
          ratio: '1-2',
          gap: 'lg',
          valign: 'start',
          mobileOrder: 'normal',
          col1: [
            c('Heading', {
              eyebrow: { en: 'The experience', ar: 'التجربة' },
              text: { en: 'Unhurried luxury', ar: 'فخامة بلا استعجال' },
              level: 'h2',
              size: 'lg',
              align: { base: 'start' },
            }),
          ],
          col2: [
            c('RichText', {
              text: {
                en: 'Warm towels, aromatic oils and therapists with years of experience. Every visit is tailored to you, from pressure to music.',
                ar: 'مناشف دافئة وزيوت عطرية ومعالجون بخبرة سنوات. كل زيارة مصممة لك، من قوة الضغط إلى الموسيقى.',
              },
              size: 'lg',
              tone: 'muted',
              measure: 'normal',
              align: { base: 'start' },
            }),
          ],
          col3: [],
          col4: [],
        }),
      ],
    }),
    c('ServicesMenu', {
      title: { en: 'Signature treatments', ar: 'جلساتنا المميزة' },
      intro: { en: '' },
      layout: 'cards',
      showDescriptions: true,
      showBook: true,
      limit: 6,
      background: 'subtle',
      padding: { base: 'lg', lg: 'xl' },
    }),
    c('Team', {
      title: { en: 'Your therapists', ar: 'معالجوك' },
      intro: { en: '' },
      layout: 'grid',
      showBio: true,
      background: 'none',
      padding: { base: 'lg', lg: 'xl' },
    }),
    c('Testimonials', {
      title: { en: 'Guests say', ar: 'يقول ضيوفنا' },
      layout: 'grid',
      items: Testimonials3,
      background: 'none',
      padding: { base: 'lg' },
    }),
    c('BookingCTA', {
      variant: 'split',
      title: { en: 'Reserve your ritual', ar: 'احجز طقسك الخاص' },
      text: { en: 'Same-day appointments are often available.', ar: 'تتوفر غالبًا مواعيد في اليوم نفسه.' },
      buttonLabel: { en: 'Book online', ar: 'احجز أونلاين' },
      showWhatsApp: true,
      background: 'accent',
      padding: { base: 'lg' },
    }),
    c('OpeningHours', {
      title: { en: 'Visit us', ar: 'زورونا' },
      layout: 'split',
      showMap: true,
      background: 'none',
      padding: { base: 'lg', lg: 'xl' },
    }),
    c('Footer', {
      variant: 'columns',
      tagline: { en: 'A private retreat in the city', ar: 'ملاذ خاص في قلب المدينة' },
      showHours: true,
      background: 'inverse',
      padding: { base: 'md', lg: 'lg' },
    }),
    c('WhatsAppButton', {
      label: { en: 'WhatsApp', ar: 'واتساب' },
      message: { en: "Hi {name}, I'd like to book a massage.", ar: 'مرحبًا {name}، أود حجز جلسة مساج.' },
      side: 'end',
      style: 'icon',
    }),
  ])
  return {
    key: 'luxury',
    name: 'Dark Luxury',
    theme: luxuryTheme,
    pages: pages(home, servicesPage(c, 'cards', 'accent'), contactPage(c)),
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
}

const USP = (title: Bi, text: Bi, c: ReturnType<typeof builder>) =>
  c('Stack', {
    direction: 'vertical',
    gap: 'xs',
    align: { base: 'start' },
    wrap: false,
    items: [
      c('Heading', { eyebrow: { en: '' }, text: title, level: 'h3', size: 'md', align: { base: 'start' } }),
      c('RichText', { text, size: 'md', tone: 'muted', measure: 'full', align: { base: 'start' } }),
    ],
  })

function nordic(): SiteTemplate {
  const c = builder('nordic')
  const home = page(SEO.home.title, SEO.home.description, [
    c('Hero', {
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
    }),
    c('Section', {
      background: 'surface',
      width: 'contained',
      padding: { base: 'lg' },
      gap: 'md',
      content: [
        c('Columns', {
          ratio: '1-1-1',
          gap: 'lg',
          valign: 'start',
          mobileOrder: 'normal',
          col1: [
            USP(
              { en: 'Skilled therapists', ar: 'معالجون مهرة' },
              {
                en: 'Certified, experienced and attentive to how you feel.',
                ar: 'معتمدون وذوو خبرة ومنتبهون لما تشعر به.',
              },
              c,
            ),
          ],
          col2: [
            USP(
              { en: 'Clear prices', ar: 'أسعار واضحة' },
              {
                en: 'Prices in AED, VAT included. No surprises at checkout.',
                ar: 'الأسعار بالدرهم شاملة الضريبة. بلا مفاجآت عند الدفع.',
              },
              c,
            ),
          ],
          col3: [
            USP(
              { en: 'Easy booking', ar: 'حجز سهل' },
              {
                en: 'Book online or on WhatsApp — whatever suits you.',
                ar: 'احجز أونلاين أو عبر واتساب، كما يناسبك.',
              },
              c,
            ),
          ],
          col4: [],
        }),
      ],
    }),
    c('ServicesMenu', {
      title: { en: 'Treatments', ar: 'الجلسات' },
      intro: {
        en: 'Choose your time and pressure. All prices include VAT.',
        ar: 'اختر المدة وقوة الضغط. جميع الأسعار شاملة الضريبة.',
      },
      layout: 'list',
      showDescriptions: true,
      showBook: true,
      limit: 6,
      background: 'none',
      padding: { base: 'lg', lg: 'xl' },
    }),
    c('Team', {
      title: { en: 'The team', ar: 'الفريق' },
      intro: { en: '' },
      layout: 'grid',
      showBio: true,
      background: 'subtle',
      padding: { base: 'lg', lg: 'xl' },
    }),
    c('FAQ', {
      title: { en: 'Good to know', ar: 'معلومات مفيدة' },
      layout: 'columns',
      items: [
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
            en: 'At the studio, by cash or card. Prices include VAT.',
            ar: 'في الاستوديو نقدًا أو بالبطاقة. الأسعار شاملة الضريبة.',
          },
        },
        {
          q: { en: 'Can I request a female therapist?', ar: 'هل يمكنني طلب معالجة؟' },
          a: { en: 'Of course — add it to your booking note.', ar: 'بالتأكيد، أضف ذلك في ملاحظة الحجز.' },
        },
        {
          q: { en: 'What if I am running late?', ar: 'ماذا لو تأخرت؟' },
          a: {
            en: 'Message us; we will do our best to keep your full time.',
            ar: 'راسلنا وسنبذل جهدنا للحفاظ على وقتك كاملًا.',
          },
        },
      ],
      background: 'none',
      padding: { base: 'lg', lg: 'xl' },
    }),
    c('OpeningHours', {
      title: { en: 'Find us', ar: 'موقعنا' },
      layout: 'split',
      showMap: true,
      background: 'surface',
      padding: { base: 'lg', lg: 'xl' },
    }),
    c('BookingCTA', {
      variant: 'banner',
      title: { en: 'Ready for your reset?', ar: 'مستعد لاستعادة نشاطك؟' },
      text: {
        en: 'Pick a treatment and time — it takes under a minute.',
        ar: 'اختر الجلسة والوقت، يستغرق ذلك أقل من دقيقة.',
      },
      buttonLabel: { en: 'Book online', ar: 'احجز أونلاين' },
      showWhatsApp: true,
      background: 'accent',
      padding: { base: 'lg', lg: 'xl' },
    }),
    c('Footer', {
      variant: 'columns',
      tagline: { en: 'Massage studio', ar: 'استوديو مساج' },
      showHours: true,
      background: 'inverse',
      padding: { base: 'md', lg: 'lg' },
    }),
    c('WhatsAppButton', {
      label: { en: 'WhatsApp', ar: 'واتساب' },
      message: { en: "Hi {name}, I'd like to book a massage.", ar: 'مرحبًا {name}، أود حجز جلسة مساج.' },
      side: 'end',
      style: 'pill',
    }),
  ])
  return {
    key: 'nordic',
    name: 'Nordic Clean',
    theme: nordicTheme,
    pages: pages(home, servicesPage(c, 'list', 'soft'), contactPage(c)),
  }
}

export const TEMPLATES: Record<'zen' | 'luxury' | 'nordic', SiteTemplate & { feel: string }> = {
  zen: { ...zen(), feel: 'Stone and off-white, serif headings, slow fades.' },
  luxury: { ...luxury(), feel: 'Black and gold, editorial, expressive motion.' },
  nordic: { ...nordic(), feel: 'White and birch, airy sans, crisp and bright.' },
}
export type TemplateKey = keyof typeof TEMPLATES
export const TEMPLATE_KEYS = Object.keys(TEMPLATES) as TemplateKey[]
export const isTemplateKey = (key: string): key is TemplateKey => key in TEMPLATES

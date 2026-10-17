import type { SceneKey } from './blocks/layout'
import type { BuiltIn, TemplateKit } from './templates'
import type { SiteTheme } from './theme'
import type { Bi } from './types'

/**
 * Design templates (R5, docs/PLAN.md §14.8): rebuilt for spas from the owner's design collection — the look
 * (palette, type, hero art) lives in theme tokens, the motion in per-section scroll scenes (lib/scenes.ts).
 * Same blocks and copy slots as the classic templates, so switching keeps content and the AI writer still fills
 * them. Headlines mark their accent words with `*…*` (styled by the theme's `emphasis` token).
 */

type Bg = 'none' | 'surface' | 'subtle' | 'soft' | 'inverse' | 'accent'
type Node = { type: string; props: Record<string, unknown> }

/* ------------------------------------------------------------------ palette helpers */

const hex = (h: string) => {
  const v = h.replace('#', '')
  const f = v.length === 3 ? [...v].map((c) => c + c).join('') : v
  return [0, 2, 4].map((i) => Number.parseInt(f.slice(i, i + 2), 16))
}
/** a → b by t (0…1), as #rrggbb. */
const mix = (a: string, b: string, t: number) => {
  const [x, y] = [hex(a), hex(b)]
  return `#${x
    .map((c, i) =>
      Math.round(c + ((y[i] ?? 0) - c) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

type Palette = { bg: string; surface: string; fg: string; muted: string; accent: string; accentFg: string }
function theme(p: Palette, t: Partial<SiteTheme>): SiteTheme {
  const dark = hex(p.bg).reduce((s, c) => s + c, 0) < 384
  return {
    ...p,
    subtle: mix(p.bg, p.fg, dark ? 0.05 : 0.04),
    border: mix(p.bg, p.fg, dark ? 0.14 : 0.12),
    accentSoft: mix(p.bg, p.accent, dark ? 0.16 : 0.12),
    inverseBg: dark ? mix(p.bg, p.fg, 0.07) : mix(p.fg, p.bg, 0.04),
    inverseFg: dark ? p.fg : p.bg,
    headingFont: 'serif',
    bodyFont: 'sans',
    headingWeight: 400,
    headingCase: 'none',
    headingTracking: -0.01,
    radius: 'soft',
    buttonShape: 'square',
    density: 'comfortable',
    motion: 'expressive',
    pattern: 'none',
    arabicFont: 'amiri',
    imageShape: 'theme',
    headingFace: 'theme',
    backdrop: 'none',
    emblem: 'none',
    emphasis: 'italic',
    ...t,
  }
}

/* ------------------------------------------------------------------ shared copy */

const STEPS: [Bi, Bi][] = [
  [
    { en: '01  Choose your treatment', ar: '01  اختر جلستك' },
    {
      en: 'Browse the menu — prices in AED, VAT included.',
      ar: 'تصفح القائمة، الأسعار بالدرهم شاملة الضريبة.',
    },
  ],
  [
    { en: '02  Book in a minute', ar: '02  احجز في دقيقة' },
    { en: 'Online or on WhatsApp, whenever suits you.', ar: 'أونلاين أو عبر واتساب، متى ما ناسبك.' },
  ],
  [
    { en: '03  Arrive and unwind', ar: '03  وصول واسترخاء' },
    {
      en: 'Tea, a quiet lounge and a short chat about how you feel.',
      ar: 'شاي وصالة هادئة وحديث قصير عن شعورك.',
    },
  ],
  [
    { en: '04  Leave lighter', ar: '04  اخرج أخف' },
    {
      en: 'Aftercare tips and an easy rebook for next time.',
      ar: 'نصائح للعناية بعد الجلسة وحجز سهل للمرة القادمة.',
    },
  ],
]
const PROMISES: [Bi, Bi][] = [
  [
    { en: 'Skilled therapists', ar: 'معالجون مهرة' },
    { en: 'Certified, experienced and attentive.', ar: 'معتمدون وذوو خبرة ومنتبهون لكل تفصيل.' },
  ],
  [
    { en: 'Clear prices', ar: 'أسعار واضحة' },
    { en: 'In AED with VAT included. No surprises.', ar: 'بالدرهم شاملة الضريبة. بلا مفاجآت.' },
  ],
  [
    { en: 'Easy booking', ar: 'حجز سهل' },
    { en: 'Online or on WhatsApp in a minute.', ar: 'أونلاين أو عبر واتساب في دقيقة.' },
  ],
]

/* ------------------------------------------------------------------ the template recipe */

type Motion = {
  /** Scroll scene per block type (top-level bands); unlisted bands keep the theme's gentle entrance. */
  services: SceneKey
  steps: SceneKey
  team?: SceneKey
  gallery?: SceneKey
  reviews?: SceneKey
  faq?: SceneKey
}

type Spec = {
  key: string
  name: string
  feel: string
  theme: SiteTheme
  hero: 'split' | 'centered'
  heroBg?: Bg
  eyebrow: Bi
  title: Bi
  subtitle: Bi
  aboutTitle: Bi
  about: Bi
  tagline: Bi
  servicesTitle: Bi
  servicesLayout: 'cards' | 'list'
  stepsTitle: Bi
  motion: Motion
  bands?: { about?: Bg; services?: Bg; steps?: Bg; reviews?: Bg; cta?: Bg }
  galleryLayout?: 'grid' | 'mosaic' | 'strip'
  whatsapp?: 'pill' | 'icon'
  ctaVariant?: 'banner' | 'card' | 'split'
}

/** Puts the template's scroll scenes on the top-level bands of every page. */
function applyMotion(content: Node[], m: Motion): Node[] {
  return content.map((n) => {
    const scene =
      n.type === 'ServicesMenu'
        ? m.services
        : n.type === 'Team'
          ? m.team
          : n.type === 'Gallery'
            ? m.gallery
            : n.type === 'Testimonials'
              ? m.reviews
              : n.type === 'FAQ'
                ? m.faq
                : n.type === 'Section' && isStepRow(n)
                  ? m.steps
                  : undefined
    return scene && n.props.scene === undefined ? { ...n, props: { ...n.props, scene } } : n
  })
}
/** A band holding one 3- or 4-column row (USPs, steps). */
const isStepRow = (n: Node) => {
  const kids = n.props.content as Node[] | undefined
  const col = kids?.length === 1 ? kids[0] : undefined
  return col?.type === 'Columns' && ['1-1-1', '1-1-1-1'].includes(String(col.props.ratio))
}

function build(k: TemplateKit, s: Spec): BuiltIn {
  const c = k.builder(s.key)
  const b = s.bands ?? {}
  const wa = s.whatsapp ?? 'icon'
  const home = k.page(k.SEO.home.title, k.SEO.home.description, [
    c(
      'Hero',
      {
        variant: s.hero,
        eyebrow: s.eyebrow,
        title: s.title,
        subtitle: s.subtitle,
        buttons: [k.BOOK, { ...k.WHATSAPP, style: 'secondary' }],
        image: '',
        imageAlt: { en: '' },
        background: s.heroBg ?? 'none',
        scene: 'depart',
      },
      'hero',
    ),
    k.section(
      c,
      [
        k.columns(
          c,
          '1-1',
          [
            [k.image(c, { en: 'Treatment room', ar: 'غرفة العلاج' })],
            [
              k.heading(c, { en: 'Our approach', ar: 'فلسفتنا' }, s.aboutTitle),
              k.para(c, s.about, {}, 'about'),
              k.buttons(c, [k.ABOUT_LINK]),
            ],
          ],
          { valign: 'center', mobileOrder: 'reverse' },
        ),
      ],
      { background: b.about ?? 'surface' },
    ),
    k.services(c, {
      title: s.servicesTitle,
      intro: { en: 'Prices in AED, VAT included.', ar: 'الأسعار بالدرهم شاملة الضريبة.' },
      layout: s.servicesLayout,
      background: b.services ?? 'none',
    }),
    k.section(c, [k.heading(c, { en: 'Your visit', ar: 'زيارتك' }, s.stepsTitle, { align: 'center' })], {
      background: b.steps ?? 'subtle',
      padding: { base: 'lg', lg: 'xl' },
      width: 'narrow',
    }),
    k.uspRow(c, STEPS, { background: b.steps ?? 'subtle', padding: { base: 'md', lg: 'lg' } }),
    k.team(c, { en: 'Your therapists', ar: 'معالجوك' }),
    k.gallery(c, {
      title: { en: 'Inside {name}', ar: 'داخل {name}' },
      count: 6,
      layout: s.galleryLayout ?? 'grid',
      columns: '3',
      background: 'none',
    }),
    k.testimonials(c, { en: 'Guests say', ar: 'يقول ضيوفنا' }, k.QUOTES, {
      background: b.reviews ?? 'subtle',
    }),
    k.faq(c, k.FAQ_BASICS, { layout: 'accordion' }),
    k.hours(c),
    k.cta(c, {
      variant: s.ctaVariant ?? 'split',
      title: { en: 'Your hour of calm is waiting', ar: 'ساعة هدوئك بانتظارك' },
      text: { en: 'Book online in under a minute.', ar: 'احجز أونلاين في أقل من دقيقة.' },
      background: b.cta ?? 'accent',
    }),
    k.footer(c, s.tagline),
    k.whatsapp(c, wa),
  ])
  const all = k.pages({
    home,
    services: k.servicesPage(c, {
      layout: s.servicesLayout,
      ctaBg: b.cta ?? 'accent',
      ctaVariant: s.ctaVariant ?? 'split',
      whatsapp: wa,
    }),
    about: k.aboutPage(c, {
      title: s.aboutTitle,
      lead: s.subtitle,
      aboutTitle: { en: 'Our approach', ar: 'فلسفتنا' },
      about: s.about,
      usps: PROMISES,
      ctaVariant: s.ctaVariant ?? 'split',
      ctaBg: b.cta ?? 'accent',
      tagline: s.tagline,
      whatsapp: wa,
    }),
    gallery: k.galleryPage(c, {
      title: { en: 'A look inside', ar: 'نظرة إلى الداخل' },
      lead: { en: 'Rooms, details and quiet corners at {name}.', ar: 'غرف وتفاصيل وزوايا هادئة في {name}.' },
      layout: 'grid',
      tagline: s.tagline,
      whatsapp: wa,
    }),
    contact: k.contactPage(c, { whatsapp: wa }),
  })
  return {
    key: s.key,
    name: s.name,
    feel: s.feel,
    theme: s.theme,
    pages: all.map((p) => ({ ...p, data: { ...p.data, content: applyMotion(p.data.content, s.motion) } })),
  }
}

/* ------------------------------------------------------------------ the designs */

export function designTemplates(k: TemplateKit) {
  const t = (s: Spec) => build(k, s)
  return {
    signature: t({
      key: 'signature',
      name: 'Signature',
      feel: 'The final compilation: soft grey and calm blue, live tiles, hairlines, cards that fly into place.',
      theme: theme(
        {
          bg: '#ecece8',
          surface: '#ffffff',
          fg: '#141615',
          muted: '#5f6461',
          accent: '#3e5bd8',
          accentFg: '#ffffff',
        },
        {
          headingFont: 'sans',
          headingFace: 'manrope',
          headingWeight: 700,
          headingTracking: -0.035,
          radius: 'round',
          buttonShape: 'rounded',
          arabicFont: 'sans',
          backdrop: 'hairlines',
          emblem: 'bento',
          emphasis: 'muted',
        },
      ),
      hero: 'split',
      eyebrow: { en: '{name} · Massage & wellness', ar: '{name} · مساج وعافية' },
      title: { en: 'Less stress. *More calm.* Better sleep.', ar: 'توتر أقل. *هدوء أكثر.* نوم أعمق.' },
      subtitle: {
        en: 'Skilled therapists, quiet rooms and clear prices — book online or on WhatsApp in a minute.',
        ar: 'معالجون مهرة وغرف هادئة وأسعار واضحة، احجز أونلاين أو عبر واتساب في دقيقة.',
      },
      aboutTitle: { en: 'Everything you need, *nothing you don’t*', ar: 'كل ما تحتاجه، *ولا شيء زائد*' },
      about: {
        en: 'Every treatment starts with a short conversation about how you feel. Then we take our time — pressure, oils and music chosen for you.',
        ar: 'تبدأ كل جلسة بحديث قصير عن شعورك، ثم نأخذ وقتنا: قوة الضغط والزيوت والموسيقى مختارة لك.',
      },
      tagline: { en: 'Massage & wellness', ar: 'مساج وعافية' },
      servicesTitle: {
        en: 'Pick what you need. *We take care of the rest.*',
        ar: 'اختر ما تحتاجه. *ونحن نهتم بالباقي.*',
      },
      servicesLayout: 'cards',
      stepsTitle: {
        en: 'Four calm steps. *From booking to bliss.*',
        ar: 'أربع خطوات هادئة. *من الحجز إلى الراحة.*',
      },
      motion: {
        services: 'assemble',
        steps: 'rise',
        gallery: 'coverflow',
        team: 'reveal',
        reviews: 'reveal',
      },
      ctaVariant: 'card',
      bands: { cta: 'none' },
      whatsapp: 'pill',
    }),
    noir: t({
      key: 'noir',
      name: 'Noir Gold',
      feel: 'Black and champagne gold, classic serif; treatments deal out like a fanned hand of cards.',
      theme: theme(
        {
          bg: '#0e0d0b',
          surface: '#17150f',
          fg: '#f1ece2',
          muted: '#a39b8b',
          accent: '#c9a96e',
          accentFg: '#15120b',
        },
        { headingFace: 'cormorant', backdrop: 'rings', emblem: 'numeral', headingTracking: 0 },
      ),
      hero: 'centered',
      eyebrow: { en: 'Massage & wellness · UAE', ar: 'مساج وعافية · الإمارات' },
      title: { en: 'Deep rest. Quiet hands. *Pure gold.*', ar: 'راحة عميقة. أيدٍ هادئة. *لحظات من ذهب.*' },
      subtitle: {
        en: 'Signature massages in a candle-lit retreat, by therapists with years of experience.',
        ar: 'جلسات مساج مميزة في ملاذ على ضوء الشموع، على أيدي معالجين بخبرة سنوات.',
      },
      aboutTitle: {
        en: 'Crafted rituals, *for unhurried evenings*',
        ar: 'طقوس متقنة، *لأمسيات بلا استعجال*',
      },
      about: {
        en: 'Warm towels, aromatic oils and a room that is yours alone. Every visit is tailored, from pressure to music.',
        ar: 'مناشف دافئة وزيوت عطرية وغرفة لك وحدك. كل زيارة مصممة لك، من قوة الضغط إلى الموسيقى.',
      },
      tagline: { en: 'A private retreat in the city', ar: 'ملاذ خاص في قلب المدينة' },
      servicesTitle: { en: 'Signature treatments, *for deep rest*', ar: 'جلسات مميزة، *لراحة عميقة*' },
      servicesLayout: 'cards',
      stepsTitle: { en: 'An evening, *in four acts*', ar: 'أمسية، *في أربعة فصول*' },
      motion: { services: 'fan', steps: 'reveal', gallery: 'assemble', team: 'fan', reviews: 'reveal' },
      bands: { about: 'none', services: 'subtle' },
    }),
    ivory: t({
      key: 'ivory',
      name: 'Ivory Marble',
      feel: 'Ivory with slowly moving marble veins and gold hairlines; each treatment turns in like a cube face.',
      theme: theme(
        {
          bg: '#f5f2ec',
          surface: '#ffffff',
          fg: '#1c1a17',
          muted: '#6b655c',
          accent: '#a8874f',
          accentFg: '#ffffff',
        },
        { headingFace: 'playfair', backdrop: 'marble', emblem: 'tile', density: 'airy' },
      ),
      hero: 'split',
      eyebrow: { en: '{name} · Massage & wellness', ar: '{name} · مساج وعافية' },
      title: { en: 'Calm, polished *to perfection.*', ar: 'هدوء مصقول *حتى الكمال.*' },
      subtitle: {
        en: 'Light-filled rooms, warm marble and unhurried treatments by skilled hands.',
        ar: 'غرف مضيئة ورخام دافئ وجلسات هادئة على أيدٍ ماهرة.',
      },
      aboutTitle: { en: 'Every detail, *considered*', ar: 'كل تفصيل، *مدروس*' },
      about: {
        en: 'Fresh linen, heated beds and oils warmed before you arrive. We keep the calm so you can let go.',
        ar: 'بياضات نظيفة وأسرّة دافئة وزيوت تُدفّأ قبل وصولك. نحافظ على الهدوء لتستسلم للراحة.',
      },
      tagline: { en: 'Massage & wellness', ar: 'مساج وعافية' },
      servicesTitle: { en: 'Every side of wellbeing, *handled*', ar: 'كل جوانب العافية، *بعناية*' },
      servicesLayout: 'cards',
      stepsTitle: { en: 'Your visit, *step by step*', ar: 'زيارتك، *خطوة بخطوة*' },
      motion: { services: 'cube', steps: 'reveal', gallery: 'cube', reviews: 'reveal' },
      bands: { cta: 'inverse' },
    }),
    navy: t({
      key: 'navy',
      name: 'Navy Official',
      feel: 'Navy and silver, trustworthy and composed; the four steps rise like pillars.',
      theme: theme(
        {
          bg: '#0d1b2a',
          surface: '#13243a',
          fg: '#eef2f6',
          muted: '#9aa8b8',
          accent: '#c7ced6',
          accentFg: '#0d1b2a',
        },
        { headingFace: 'baskerville', backdrop: 'sheen', emblem: 'seal', radius: 'none' },
      ),
      hero: 'split',
      eyebrow: { en: '{name} · Massage & wellness', ar: '{name} · مساج وعافية' },
      title: {
        en: 'Trusted hands. Proven care. *Real rest.*',
        ar: 'أيدٍ موثوقة. عناية مجرّبة. *راحة حقيقية.*',
      },
      subtitle: {
        en: 'Certified therapists, spotless rooms and clear prices — the standard you can rely on.',
        ar: 'معالجون معتمدون وغرف نظيفة تمامًا وأسعار واضحة، معيار يمكنك الاعتماد عليه.',
      },
      aboutTitle: { en: 'Built on standards. *Kept every day.*', ar: 'مبني على المعايير. *محفوظ كل يوم.*' },
      about: {
        en: 'Licensed therapists, hygiene checks between every guest and a treatment plan agreed with you before we begin.',
        ar: 'معالجون مرخّصون وفحوص نظافة بين كل ضيف وآخر، وخطة جلسة نتفق عليها معك قبل البدء.',
      },
      tagline: { en: 'Trusted massage & wellness', ar: 'مساج وعافية موثوقان' },
      servicesTitle: { en: 'Our treatments. *Clearly priced.*', ar: 'جلساتنا. *بأسعار واضحة.*' },
      servicesLayout: 'list',
      stepsTitle: { en: 'Built on four pillars. *Made to last.*', ar: 'مبنية على أربع ركائز. *لتدوم.*' },
      motion: { services: 'reveal', steps: 'rise', team: 'rise', gallery: 'assemble', reviews: 'reveal' },
    }),
    emerald: t({
      key: 'emerald',
      name: 'Emerald Prestige',
      feel: 'Emerald and gold Art Deco with a sunburst; the treatment grid opens like two Deco doors.',
      theme: theme(
        {
          bg: '#0e241d',
          surface: '#143029',
          fg: '#f1ede3',
          muted: '#a9b3a6',
          accent: '#d4b26a',
          accentFg: '#0e241d',
        },
        {
          headingFace: 'bodoni',
          backdrop: 'rays',
          emblem: 'arch',
          radius: 'none',
          headingTracking: 0,
          pattern: 'arabesque',
        },
      ),
      hero: 'centered',
      eyebrow: { en: 'Massage & wellness · Since day one', ar: 'مساج وعافية · منذ اليوم الأول' },
      title: { en: 'A heritage of calm. *A ritual of renewal.*', ar: 'إرث من الهدوء. *وطقس للتجدد.*' },
      subtitle: {
        en: 'Time-honoured techniques, rare oils and a welcome worthy of a grand hotel.',
        ar: 'تقنيات عريقة وزيوت نادرة وترحيب يليق بأفخم الفنادق.',
      },
      aboutTitle: { en: 'Old-world care, *made for today*', ar: 'عناية عريقة، *لأيامنا هذه*' },
      about: {
        en: 'Oud, amber and rose warmed before every treatment, private suites for one or two, and therapists who know their craft.',
        ar: 'عود وعنبر وورد تُدفّأ قبل كل جلسة، وأجنحة خاصة لشخص أو شخصين، ومعالجون يتقنون حرفتهم.',
      },
      tagline: { en: 'Prestige massage & wellness', ar: 'مساج وعافية بفخامة' },
      servicesTitle: { en: 'Open the door *to deep rest*', ar: 'افتح الباب *لراحة عميقة*' },
      servicesLayout: 'cards',
      stepsTitle: { en: 'Your ritual, *in four steps*', ar: 'طقسك، *في أربع خطوات*' },
      motion: { services: 'doors', steps: 'reveal', gallery: 'doors', team: 'reveal', reviews: 'reveal' },
      bands: { about: 'none', services: 'soft', steps: 'surface' },
    }),
    platinum: t({
      key: 'platinum',
      name: 'Platinum Minimal',
      feel: 'White and black ultra-minimal with hairlines and a giant monogram; cards slide past like a coverflow.',
      theme: theme(
        {
          bg: '#f7f7f5',
          surface: '#ffffff',
          fg: '#0f0f0f',
          muted: '#6e6e6a',
          accent: '#0f0f0f',
          accentFg: '#ffffff',
        },
        {
          headingFont: 'sans',
          headingFace: 'intertight',
          headingWeight: 600,
          headingTracking: -0.045,
          radius: 'none',
          arabicFont: 'sans',
          backdrop: 'hairlines',
          emphasis: 'underline',
        },
      ),
      hero: 'split',
      eyebrow: { en: '{name} · Massage & wellness', ar: '{name} · مساج وعافية' },
      title: { en: 'Less noise. More rest. *Nothing extra.*', ar: 'ضجيج أقل. راحة أكثر. *بلا زوائد.*' },
      subtitle: {
        en: 'Precise, unhurried massage in a clean, quiet space. Book in a minute.',
        ar: 'مساج دقيق بلا استعجال في مكان نظيف وهادئ. احجز في دقيقة.',
      },
      aboutTitle: { en: 'Simple, *by design*', ar: 'بسيط، *عن قصد*' },
      about: {
        en: 'No clutter, no upselling — just skilled therapists, clear prices and the time you booked, fully yours.',
        ar: 'بلا فوضى ولا مبيعات إضافية، فقط معالجون مهرة وأسعار واضحة ووقتك المحجوز لك بالكامل.',
      },
      tagline: { en: 'Massage, simply', ar: 'مساج ببساطة' },
      servicesTitle: { en: 'Selected treatments. *Better rest.*', ar: 'جلسات مختارة. *راحة أفضل.*' },
      servicesLayout: 'cards',
      stepsTitle: { en: 'Four steps. *That’s all.*', ar: 'أربع خطوات. *هذا كل شيء.*' },
      motion: {
        services: 'coverflow',
        steps: 'reveal',
        gallery: 'coverflow',
        team: 'coverflow',
        reviews: 'reveal',
      },
      bands: { about: 'none', steps: 'none', reviews: 'none', cta: 'inverse' },
    }),
    nightfall: t({
      key: 'nightfall',
      name: 'Desert Night',
      feel: 'Night purple and rose gold over a city skyline; your visit comes towards you down a 3D road.',
      theme: theme(
        {
          bg: '#161122',
          surface: '#1e1830',
          fg: '#f3edf2',
          muted: '#ada3b8',
          accent: '#e0b39a',
          accentFg: '#1a1222',
        },
        { headingFace: 'playfair', backdrop: 'skyline', emblem: 'numeral', buttonShape: 'rounded' },
      ),
      hero: 'centered',
      eyebrow: { en: 'Evening massage · UAE', ar: 'مساج المساء · الإمارات' },
      title: { en: 'The city sleeps. *You finally rest.*', ar: 'المدينة تنام. *وأنت ترتاح أخيرًا.*' },
      subtitle: {
        en: 'Late-evening treatments under soft light, minutes from your door.',
        ar: 'جلسات في ساعات المساء تحت ضوء خافت، على بعد دقائق منك.',
      },
      aboutTitle: { en: 'Made for *after hours*', ar: 'صُمّم *لما بعد الدوام*' },
      about: {
        en: 'Long day? Come as you are. Warm tea, a quiet room and hands that know where the day sits.',
        ar: 'يوم طويل؟ تعال كما أنت. شاي دافئ وغرفة هادئة وأيدٍ تعرف أين يستقر تعب اليوم.',
      },
      tagline: { en: 'Evening massage & wellness', ar: 'مساج وعافية في المساء' },
      servicesTitle: { en: 'Treatments *for the night ahead*', ar: 'جلسات *لليلة هادئة*' },
      servicesLayout: 'cards',
      stepsTitle: { en: 'Your journey *to rest*', ar: 'رحلتك *إلى الراحة*' },
      motion: { services: 'reveal', steps: 'road', gallery: 'road', team: 'reveal', reviews: 'reveal' },
      bands: { about: 'none', steps: 'none' },
    }),
    atelier: t({
      key: 'atelier',
      name: 'Monogram Atelier',
      feel: 'Cream and burgundy, couture serif and a monogram ring; the steps turn like the pages of a book.',
      theme: theme(
        {
          bg: '#efe8dc',
          surface: '#faf6ef',
          fg: '#2a1a1a',
          muted: '#75625e',
          accent: '#6e1e2b',
          accentFg: '#ffffff',
        },
        {
          headingFace: 'cormorant',
          headingWeight: 500,
          backdrop: 'monogram',
          emblem: 'monogram',
          density: 'airy',
        },
      ),
      hero: 'centered',
      eyebrow: { en: 'Maison de massage', ar: 'دار المساج' },
      title: { en: 'Tailored touch. *Made to measure.*', ar: 'لمسة مصممة لك. *على مقاسك.*' },
      subtitle: {
        en: 'Bespoke treatments, fitted to you like couture — pressure, oils and pace.',
        ar: 'جلسات مفصّلة لك كالأزياء الراقية: قوة الضغط والزيوت والإيقاع.',
      },
      aboutTitle: { en: 'Turn the page *on stress*', ar: 'اطوِ صفحة *التوتر*' },
      about: {
        en: 'A small house with a few rooms and a long list of regulars. We remember how you like it.',
        ar: 'دار صغيرة بغرف قليلة وقائمة طويلة من الضيوف الدائمين. نتذكر ما تفضّله.',
      },
      tagline: { en: 'Maison de massage', ar: 'دار المساج' },
      servicesTitle: { en: 'The collection, *season after season*', ar: 'المجموعة، *موسمًا بعد موسم*' },
      servicesLayout: 'list',
      stepsTitle: { en: 'Your story, *in four chapters*', ar: 'قصتك، *في أربعة فصول*' },
      motion: { services: 'reveal', steps: 'pages', gallery: 'pages', team: 'pages', reviews: 'reveal' },
      bands: { steps: 'surface', reviews: 'none' },
    }),
    obsidian: t({
      key: 'obsidian',
      name: 'Obsidian Glass',
      feel: 'Black with frosted glass and a soft spotlight; treatments unwrap from a turning glass prism.',
      theme: theme(
        {
          bg: '#0a0a0b',
          surface: '#141416',
          fg: '#f0f0f2',
          muted: '#9a9aa2',
          accent: '#e8e8ec',
          accentFg: '#0a0a0b',
        },
        {
          headingFont: 'sans',
          headingFace: 'sora',
          headingWeight: 300,
          headingTracking: -0.03,
          radius: 'round',
          buttonShape: 'pill',
          arabicFont: 'sans',
          backdrop: 'glow',
          emblem: 'glass',
          emphasis: 'muted',
        },
      ),
      hero: 'split',
      eyebrow: { en: '{name} · Massage & wellness', ar: '{name} · مساج وعافية' },
      title: { en: 'Clear mind. *Deep rest.*', ar: 'ذهن صافٍ. *راحة عميقة.*' },
      subtitle: {
        en: 'Modern treatments in a dark, quiet space designed to switch you off.',
        ar: 'جلسات عصرية في مكان هادئ خافت الإضاءة، صُمّم ليفصلك عن كل شيء.',
      },
      aboutTitle: { en: 'Six senses, *one clear calm*', ar: 'ست حواس، *وهدوء واحد صافٍ*' },
      about: {
        en: 'Low light, warm stone, soft sound. Every surface and scent is chosen to quiet the noise.',
        ar: 'ضوء خافت وحجر دافئ وصوت ناعم. كل سطح ورائحة مختار ليهدئ الضجيج.',
      },
      tagline: { en: 'Modern massage & wellness', ar: 'مساج وعافية بروح عصرية' },
      servicesTitle: { en: 'Treatments, *one clear choice*', ar: 'جلسات، *واختيار واحد واضح*' },
      servicesLayout: 'cards',
      stepsTitle: { en: 'Four steps *to silence*', ar: 'أربع خطوات *إلى السكون*' },
      motion: { services: 'prism', steps: 'reveal', gallery: 'prism', team: 'reveal', reviews: 'reveal' },
      bands: { about: 'none', cta: 'surface' },
      ctaVariant: 'card',
    }),
    sandstone: t({
      key: 'sandstone',
      name: 'Sandstone Bronze',
      feel: 'Warm stone and bronze with strata lines; the steps slide apart like stone slabs.',
      theme: theme(
        {
          bg: '#e9e1d3',
          surface: '#f5efe4',
          fg: '#2b241c',
          muted: '#6f6455',
          accent: '#8c6239',
          accentFg: '#ffffff',
        },
        {
          headingFace: 'marcellus',
          backdrop: 'strata',
          emblem: 'tile',
          imageShape: 'arch',
          pattern: 'lattice',
        },
      ),
      hero: 'split',
      eyebrow: { en: '{name} · Massage & wellness', ar: '{name} · مساج وعافية' },
      title: { en: 'Grounded. Warm. *Restored.*', ar: 'ثبات. دفء. *تجدد.*' },
      subtitle: {
        en: 'Hot stones, warm oils and natural textures — calm you can feel in your shoulders.',
        ar: 'أحجار ساخنة وزيوت دافئة وملامس طبيعية، هدوء تشعر به في كتفيك.',
      },
      aboutTitle: { en: 'Laid stone by stone. *Built to restore.*', ar: 'حجرًا فوق حجر. *بُني ليجدّدك.*' },
      about: {
        en: 'Natural materials, earthy scents and techniques that work slowly and deeply.',
        ar: 'مواد طبيعية وروائح ترابية وتقنيات تعمل ببطء وعمق.',
      },
      tagline: { en: 'Natural massage & wellness', ar: 'مساج وعافية بطبيعتها' },
      servicesTitle: { en: 'Treatments *rooted in nature*', ar: 'جلسات *متجذرة في الطبيعة*' },
      servicesLayout: 'cards',
      stepsTitle: { en: 'Our method, *slab by slab*', ar: 'طريقتنا، *خطوة بخطوة*' },
      motion: { services: 'slabs', steps: 'slabs', gallery: 'slabs', reviews: 'reveal' },
    }),
    flap: t({
      key: 'flap',
      name: 'Split Flap',
      feel: 'Black and soft gold, airport-board style; the treatment rows flip open one by one.',
      theme: theme(
        {
          bg: '#101010',
          surface: '#181818',
          fg: '#f2f0ea',
          muted: '#9c9a94',
          accent: '#e6c068',
          accentFg: '#141006',
        },
        { headingFace: 'dmserif', emblem: 'flap', headingTracking: -0.01 },
      ),
      hero: 'centered',
      eyebrow: { en: 'Now boarding: calm', ar: 'الصعود الآن: إلى الهدوء' },
      title: { en: 'Your next departure: *deep relaxation.*', ar: 'رحلتك القادمة: *استرخاء عميق.*' },
      subtitle: {
        en: 'Every treatment on time, every time. Arrive, unwind and leave lighter.',
        ar: 'كل جلسة في موعدها، دائمًا. احضر واسترخِ واخرج أخف.',
      },
      aboutTitle: { en: 'On time, *every time*', ar: 'في الموعد، *دائمًا*' },
      about: {
        en: 'Your therapist is ready when you are. No waiting room, no rush — the hour you booked starts on the minute.',
        ar: 'معالجك جاهز متى كنت جاهزًا. بلا انتظار ولا استعجال، ساعتك تبدأ في دقيقتها.',
      },
      tagline: { en: 'Massage & wellness, on time', ar: 'مساج وعافية في الموعد' },
      servicesTitle: { en: 'Departures: *every treatment, on time*', ar: 'المغادرات: *كل جلسة في موعدها*' },
      servicesLayout: 'list',
      stepsTitle: { en: 'Four gates *to calm*', ar: 'أربع بوابات *إلى الهدوء*' },
      motion: { services: 'flip', steps: 'flip', faq: 'flip', gallery: 'assemble', reviews: 'reveal' },
      bands: { about: 'none', steps: 'none' },
    }),
    aurora: t({
      key: 'aurora',
      name: 'Aurora Glass',
      feel: 'Light and airy glass panels in indigo, teal and peach; layers separate in 3D as you scroll.',
      theme: theme(
        {
          bg: '#f6f7fc',
          surface: '#ffffff',
          fg: '#1a1d33',
          muted: '#5d6280',
          accent: '#4b4fd8',
          accentFg: '#ffffff',
        },
        {
          headingFont: 'sans',
          headingFace: 'jakarta',
          headingWeight: 700,
          headingTracking: -0.03,
          radius: 'round',
          buttonShape: 'pill',
          arabicFont: 'sans',
          backdrop: 'aurora',
          emblem: 'glass',
          emphasis: 'muted',
          motion: 'subtle',
        },
      ),
      hero: 'split',
      eyebrow: { en: '{name} · Massage & wellness', ar: '{name} · مساج وعافية' },
      title: { en: 'Every layer of tension, *gently released.*', ar: 'كل طبقة من التوتر، *تتلاشى بلطف.*' },
      subtitle: {
        en: 'Friendly therapists, bright rooms and easy online booking.',
        ar: 'معالجون ودودون وغرف مشرقة وحجز أونلاين سهل.',
      },
      aboutTitle: { en: 'Light, airy, *easy*', ar: 'خفيف ومريح *وسهل*' },
      about: {
        en: 'Book in a minute, arrive to a smile, and choose exactly how much pressure you like.',
        ar: 'احجز في دقيقة، واستقبل بابتسامة، واختر قوة الضغط التي تحبها تمامًا.',
      },
      tagline: { en: 'Massage & wellness', ar: 'مساج وعافية' },
      servicesTitle: { en: 'Treatments, *connected to you*', ar: 'جلسات، *مصممة لك*' },
      servicesLayout: 'cards',
      stepsTitle: { en: 'Four easy steps', ar: 'أربع خطوات سهلة' },
      motion: { services: 'layers', steps: 'layers', gallery: 'layers', reviews: 'reveal' },
      bands: { about: 'none', cta: 'soft' },
      ctaVariant: 'card',
      whatsapp: 'pill',
    }),
    blueprint: t({
      key: 'blueprint',
      name: 'Blueprint',
      feel: 'Warm ivory, editorial and precise with a drafting grid; treatment cards rise block by block.',
      theme: theme(
        {
          bg: '#f3efe6',
          surface: '#fbf9f4',
          fg: '#1e1b15',
          muted: '#655f52',
          accent: '#c46a1e',
          accentFg: '#ffffff',
        },
        {
          headingFont: 'sans',
          headingFace: 'grotesk',
          headingWeight: 600,
          headingTracking: -0.03,
          radius: 'none',
          arabicFont: 'kufi',
          backdrop: 'grid',
          emblem: 'tile',
          emphasis: 'muted',
        },
      ),
      hero: 'split',
      eyebrow: { en: '{name} · Massage & wellness', ar: '{name} · مساج وعافية' },
      title: { en: 'Recovery, *built block by block.*', ar: 'تعافٍ، *يُبنى خطوة بخطوة.*' },
      subtitle: {
        en: 'Sports, deep tissue and recovery massage planned around how your body works.',
        ar: 'مساج رياضي وأنسجة عميقة وتعافٍ مخطط حسب طريقة عمل جسمك.',
      },
      aboutTitle: { en: 'A plan, *not a guess*', ar: 'خطة، *لا تخمين*' },
      about: {
        en: 'We check how you move, agree a plan and track how you feel from one visit to the next.',
        ar: 'نفحص حركتك ونتفق على خطة ونتابع شعورك من زيارة إلى أخرى.',
      },
      tagline: { en: 'Recovery massage & wellness', ar: 'مساج التعافي والعافية' },
      servicesTitle: { en: 'Treatments, *engineered for recovery*', ar: 'جلسات، *مصممة للتعافي*' },
      servicesLayout: 'cards',
      stepsTitle: { en: 'Four steps. *One plan.*', ar: 'أربع خطوات. *خطة واحدة.*' },
      motion: { services: 'blocks', steps: 'blocks', gallery: 'blocks', team: 'blocks', reviews: 'reveal' },
      bands: { about: 'none' },
    }),
    sahara: t({
      key: 'sahara',
      name: 'Sahara',
      feel: 'Warm sand, deep green and an elegant serif over dunes; the steps unfold like a brochure.',
      theme: theme(
        {
          bg: '#f3ece1',
          surface: '#fbf7f0',
          fg: '#2a2118',
          muted: '#6e6253',
          accent: '#1f6b4f',
          accentFg: '#ffffff',
        },
        {
          headingFace: 'fraunces',
          headingWeight: 500,
          buttonShape: 'pill',
          arabicFont: 'kufi',
          backdrop: 'dunes',
          emblem: 'seal',
          pattern: 'arabesque',
        },
      ),
      hero: 'split',
      eyebrow: { en: '{name} · Massage & wellness', ar: '{name} · مساج وعافية' },
      title: { en: 'Desert warmth. *Oasis calm.*', ar: 'دفء الصحراء. *وسكينة الواحة.*' },
      subtitle: {
        en: 'Arabian hospitality, warm oils and treatments that melt the heat of the day.',
        ar: 'ضيافة عربية وزيوت دافئة وجلسات تذيب حرارة اليوم.',
      },
      aboutTitle: { en: 'Local warmth, *timeless care*', ar: 'دفء محلي، *وعناية خالدة*' },
      about: {
        en: 'Dates and Arabic coffee on arrival, oud in the air and therapists who treat you like family.',
        ar: 'تمر وقهوة عربية عند الوصول، وعبق العود في المكان، ومعالجون يعاملونك كأهل البيت.',
      },
      tagline: { en: 'Massage & wellness, the UAE way', ar: 'مساج وعافية على الطريقة الإماراتية' },
      servicesTitle: { en: 'Treatments *from the oasis*', ar: 'جلسات *من الواحة*' },
      servicesLayout: 'cards',
      stepsTitle: { en: 'Your visit, *unfolded*', ar: 'زيارتك، *خطوة بخطوة*' },
      motion: {
        services: 'reveal',
        steps: 'brochure',
        gallery: 'brochure',
        team: 'reveal',
        reviews: 'reveal',
      },
      bands: { steps: 'soft' },
    }),
    clay: t({
      key: 'clay',
      name: 'Clay',
      feel: 'Soft lavender, friendly rounded type and floating clay shapes; cards flip over to their front.',
      theme: theme(
        {
          bg: '#eeeaf7',
          surface: '#ffffff',
          fg: '#2b2540',
          muted: '#6b6585',
          accent: '#7357f0',
          accentFg: '#ffffff',
        },
        {
          headingFont: 'sans',
          headingFace: 'nunito',
          headingWeight: 800,
          headingTracking: -0.02,
          radius: 'round',
          buttonShape: 'pill',
          arabicFont: 'sans',
          imageShape: 'organic',
          backdrop: 'blobs',
          emphasis: 'muted',
          motion: 'subtle',
        },
      ),
      hero: 'split',
      eyebrow: { en: '{name} · Massage & wellness', ar: '{name} · مساج وعافية' },
      title: { en: 'Feel softer. *Smile more.*', ar: 'جسم أخف. *ابتسامة أكبر.*' },
      subtitle: {
        en: 'Friendly, no-fuss massage for busy people — book online in a minute.',
        ar: 'مساج ودود وبسيط للمشغولين، احجز أونلاين في دقيقة.',
      },
      aboutTitle: { en: 'The old way vs. *our way*', ar: 'الطريقة القديمة *وطريقتنا*' },
      about: {
        en: 'No phone tag, no hidden extras, no awkward silences. Just a warm welcome and a great massage.',
        ar: 'بلا مكالمات متكررة ولا رسوم خفية ولا لحظات محرجة. فقط ترحيب دافئ ومساج رائع.',
      },
      tagline: { en: 'Friendly massage & wellness', ar: 'مساج وعافية بروح ودودة' },
      servicesTitle: { en: 'Pick your *happy hour*', ar: 'اختر *ساعتك السعيدة*' },
      servicesLayout: 'cards',
      stepsTitle: { en: 'Easy as one, two, three, four', ar: 'سهلة كواحد، اثنين، ثلاثة، أربعة' },
      motion: { services: 'turn', steps: 'turn', team: 'turn', gallery: 'assemble', reviews: 'reveal' },
      bands: { about: 'none', cta: 'accent' },
      ctaVariant: 'card',
      whatsapp: 'pill',
    }),
  } satisfies Record<string, BuiltIn>
}

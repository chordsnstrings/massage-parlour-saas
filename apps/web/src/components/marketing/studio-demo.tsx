'use client'
import { useState } from 'react'

// Website Studio demo: one spa's home page, restyled live — a taste of how the studio composes each section.

const STYLES = {
  serene: {
    label: 'Serene',
    bg: '#f4f1ea',
    ink: '#2f3a33',
    mute: '#6c766f',
    accent: '#5e7d6b',
    soft: '#e2ebe5',
    font: 'ui-serif, Georgia, "Times New Roman", serif',
  },
  desert: {
    label: 'Desert',
    bg: '#f8f0e6',
    ink: '#4a3426',
    mute: '#86705f',
    accent: '#b4734f',
    soft: '#f0dfcf',
    font: 'ui-sans-serif, system-ui, sans-serif',
  },
  midnight: {
    label: 'Midnight',
    bg: '#1e2225',
    ink: '#f3efe8',
    mute: '#a9a49b',
    accent: '#c9a86a',
    soft: '#2b3135',
    font: 'ui-serif, Georgia, "Times New Roman", serif',
  },
  signature: {
    label: 'Signature',
    bg: '#ecece8',
    ink: '#141615',
    mute: '#5f6461',
    accent: '#3e5bd8',
    soft: '#dde1ee',
    font: 'ui-sans-serif, system-ui, sans-serif',
  },
  noirGold: {
    label: 'Noir Gold',
    bg: '#0e0d0b',
    ink: '#f2ede4',
    mute: '#a39a8a',
    accent: '#c9a96e',
    soft: '#1d1a15',
    font: 'ui-serif, Georgia, "Times New Roman", serif',
  },
  ivoryMarble: {
    label: 'Ivory Marble',
    bg: '#f5f2ec',
    ink: '#2a2620',
    mute: '#7a7266',
    accent: '#a8874f',
    soft: '#ebe4d6',
    font: 'ui-serif, Georgia, "Times New Roman", serif',
  },
  navyOfficial: {
    label: 'Navy Official',
    bg: '#0d1b2a',
    ink: '#e8edf2',
    mute: '#9aa8b6',
    accent: '#c7ced6',
    soft: '#16283b',
    font: 'ui-sans-serif, system-ui, sans-serif',
  },
  emerald: {
    label: 'Emerald Prestige',
    bg: '#0e241d',
    ink: '#efe9dc',
    mute: '#a7b3a7',
    accent: '#d4b26a',
    soft: '#173329',
    font: 'ui-serif, Georgia, "Times New Roman", serif',
  },
  platinum: {
    label: 'Platinum Minimal',
    bg: '#f7f7f5',
    ink: '#0f0f0f',
    mute: '#6b6b6b',
    accent: '#0f0f0f',
    soft: '#e8e8e5',
    font: 'ui-sans-serif, system-ui, sans-serif',
  },
  desertNight: {
    label: 'Desert Night',
    bg: '#161122',
    ink: '#f1e7dc',
    mute: '#b0a3a0',
    accent: '#e0b39a',
    soft: '#221a31',
    font: 'ui-serif, Georgia, "Times New Roman", serif',
  },
  monogram: {
    label: 'Monogram Atelier',
    bg: '#efe8dc',
    ink: '#2b1d1f',
    mute: '#7d6a62',
    accent: '#6e1e2b',
    soft: '#e3d6c6',
    font: 'ui-serif, Georgia, "Times New Roman", serif',
  },
  obsidian: {
    label: 'Obsidian Glass',
    bg: '#0a0a0b',
    ink: '#e8e8ec',
    mute: '#94949c',
    accent: '#b9c2ff',
    soft: '#17171a',
    font: 'ui-sans-serif, system-ui, sans-serif',
  },
  sandstone: {
    label: 'Sandstone Bronze',
    bg: '#e9e1d3',
    ink: '#3a2c1f',
    mute: '#7d6a55',
    accent: '#8a5a2b',
    soft: '#ddd1bd',
    font: 'ui-serif, Georgia, "Times New Roman", serif',
  },
} as const
type StyleKey = keyof typeof STYLES
const STYLE_OPTIONS = Object.fromEntries(
  (Object.keys(STYLES) as StyleKey[]).map((k) => [k, STYLES[k].label]),
) as Record<StyleKey, string>

const HEROES = { centered: 'Centred', split: 'Split', photo: 'Full photo' } as const
type HeroKey = keyof typeof HEROES

const COPY = {
  en: {
    name: 'Al Waha Spa',
    nav: ['Treatments', 'Team', 'Visit'],
    title: 'Slow down. Breathe in.',
    sub: 'Massage and hammam rituals in Jumeirah, open until midnight.',
    cta: 'Book a treatment',
    menu: 'Treatments',
    photo: 'Your own photography',
    items: [
      ['Signature massage', '60 min', 'AED 350'],
      ['Hot stone ritual', '90 min', 'AED 480'],
      ['Moroccan hammam', '45 min', 'AED 290'],
    ],
  },
  ar: {
    name: 'سبا الواحة',
    nav: ['العلاجات', 'الفريق', 'زورونا'],
    title: 'تمهّل. وتنفّس بعمق.',
    sub: 'جلسات مساج وحمّام مغربي في جميرا، مفتوح حتى منتصف الليل.',
    cta: 'احجز جلستك',
    menu: 'العلاجات',
    photo: 'صوركم الخاصة',
    items: [
      ['المساج المميز', '٦٠ دقيقة', '٣٥٠ د.إ'],
      ['طقوس الأحجار الساخنة', '٩٠ دقيقة', '٤٨٠ د.إ'],
      ['الحمّام المغربي', '٤٥ دقيقة', '٢٩٠ د.إ'],
    ],
  },
} as const
type Lang = keyof typeof COPY

function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: Record<T, string>
  value: T
  onChange: (v: T) => void
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2.5 text-[12px] font-bold tracking-[0.12em] text-[var(--mute)] uppercase">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(options) as T[]).map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={value === k}
            onClick={() => onChange(k)}
            className="min-h-10 rounded-[10px] bg-[var(--surface)] px-4 py-2 text-[14px] font-semibold text-[var(--ink)] shadow-[inset_0_0_0_1px_var(--line)] transition-[background-color,color,box-shadow] duration-200 hover:shadow-[inset_0_0_0_1px_var(--text)] aria-pressed:bg-[var(--text)] aria-pressed:text-white"
          >
            {options[k]}
          </button>
        ))}
      </div>
    </fieldset>
  )
}

export function StudioDemo() {
  const [style, setStyle] = useState<StyleKey>('serene')
  const [hero, setHero] = useState<HeroKey>('split')
  const [lang, setLang] = useState<Lang>('en')
  const s = STYLES[style]
  const c = COPY[lang]
  const photo = (
    <div
      className="relative flex min-h-40 items-end overflow-hidden rounded-xl p-3 transition-[background] duration-500"
      style={{
        background: `radial-gradient(120% 90% at 20% 15%, ${s.soft}, transparent 60%), linear-gradient(160deg, ${s.accent}, ${s.ink})`,
      }}
    >
      <span className="rounded-full bg-black/25 px-2.5 py-1 text-[11px] text-white/90">{c.photo}</span>
    </div>
  )
  const text = (light = false) => (
    <div className={hero === 'centered' ? 'mx-auto max-w-md text-center' : ''}>
      <h3
        className="text-[26px] leading-tight sm:text-[34px]"
        style={{ fontFamily: s.font, color: light ? '#fff' : s.ink }}
      >
        {c.title}
      </h3>
      <p
        className="mt-2.5 text-[14px] leading-relaxed"
        style={{ color: light ? 'rgb(255 255 255 / 0.85)' : s.mute }}
      >
        {c.sub}
      </p>
      <span
        className="mt-5 inline-flex rounded-full px-4 py-2 text-[13px] font-medium"
        style={{ background: s.accent, color: style === 'midnight' ? '#1e2225' : '#fff' }}
      >
        {c.cta}
      </span>
    </div>
  )

  return (
    <div className="grid gap-8 lg:grid-cols-[17rem_1fr] lg:gap-12">
      <div className="space-y-6">
        <Choice label="Style" options={STYLE_OPTIONS} value={style} onChange={setStyle} />
        <Choice label="Hero design" options={HEROES} value={hero} onChange={setHero} />
        <Choice label="Language" options={{ en: 'English', ar: 'العربية' }} value={lang} onChange={setLang} />
        <p className="text-[14px] leading-relaxed text-[var(--ink-2)]">
          Thirteen of our 23 site styles and three of the 30 hero designs. Every section — treatments, team,
          offers, reviews — has its own set, and the studio picks and tunes each one for your spa.
        </p>
      </div>

      {/* C product frame (dark bezel); tilted back in 3D, straightens as it scrolls to the centre (MarketingMotion) */}
      <div className="mkt-stage min-w-0">
        <figure data-tilt className="mkt-tilt mkt-device" aria-label="Example spa website">
          <div className="mkt-dots">
            <span />
            <span />
            <span />
            <span className="mkt-url">alwahaspa.ae</span>
          </div>
          <div
            dir={lang === 'ar' ? 'rtl' : 'ltr'}
            lang={lang}
            className="mkt-screen transition-colors duration-500"
            style={{ background: s.bg, color: s.ink }}
          >
            <div className="flex items-center justify-between gap-4 px-5 py-4 sm:px-7">
              <span className="text-[17px]" style={{ fontFamily: s.font }}>
                {c.name}
              </span>
              <span className="hidden gap-5 text-[13px] sm:flex" style={{ color: s.mute }}>
                {c.nav.map((n) => (
                  <span key={n}>{n}</span>
                ))}
              </span>
            </div>
            <div key={`${hero}-${lang}`} className="mkt-rise px-5 pb-8 sm:px-7">
              {hero === 'photo' ? (
                <div
                  className="flex min-h-64 items-end rounded-xl p-6 sm:p-8"
                  style={{
                    background: `linear-gradient(to top, rgb(0 0 0 / 0.55), transparent 70%), radial-gradient(120% 90% at 75% 10%, ${s.soft}, transparent 55%), linear-gradient(160deg, ${s.accent}, ${s.ink})`,
                  }}
                >
                  {text(true)}
                </div>
              ) : hero === 'split' ? (
                <div className="grid items-center gap-6 sm:grid-cols-2">
                  {text()}
                  {photo}
                </div>
              ) : (
                <div className="py-6">{text()}</div>
              )}
            </div>
            <div className="px-5 pb-7 sm:px-7">
              <p className="text-[12px] tracking-[0.12em] uppercase" style={{ color: s.mute }}>
                {c.menu}
              </p>
              <ul className="mt-3 divide-y" style={{ borderColor: s.soft }}>
                {c.items.map(([name, time, price]) => (
                  <li
                    key={name}
                    className="flex items-baseline justify-between gap-4 py-3 text-[14px]"
                    style={{ borderColor: s.soft }}
                  >
                    <span style={{ fontFamily: s.font }} className="text-[15px]">
                      {name}
                    </span>
                    <span className="shrink-0 tabular-nums" style={{ color: s.mute }}>
                      {time} · <span style={{ color: s.ink }}>{price}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </figure>
      </div>
    </div>
  )
}

import { cn } from '@/lib/utils'
import { clock, price, ui } from '../i18n'
import type { Backdrop, Emblem } from '../theme'
import type { SiteMeta } from '../types'

/**
 * Hero art of the R5 design templates, drawn only with CSS/SVG from theme tokens and the spa's own name and
 * live data (no images, no JS). Ambient loops live in site-designs.css and stop in the editor (data-motion=none).
 */

/** "Lotus Spa & Wellness" → "LW"; a short single word stays whole ("Dune" → "Dune"). */
export function monogramOf(name: string) {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /\p{L}/u.test(w) && !/^(and|spa|the)$/i.test(w))
  if (words.length <= 1) {
    const w = words[0] ?? name.trim()
    return w.length <= 6 ? w : [...w][0]!.toUpperCase()
  }
  return words
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join('')
}

export function HeroBackdrop({ kind, meta }: { kind: Backdrop; meta: SiteMeta }) {
  if (kind === 'none') return null
  return (
    <div aria-hidden className="sb-bd" data-bd={kind}>
      <i />
      <i />
      <i />
      {kind === 'hairlines' && <span className="sb-bd-giant">{monogramOf(meta.data.tenant.name)}</span>}
    </div>
  )
}

function Seal({ meta, id, small }: { meta: SiteMeta; id: string; small?: boolean }) {
  const name = meta.data.tenant.name
  const ring = `${name} • ${ui('emblemCaption', meta.locale)} • ${ui('emblemPlace', meta.locale)} • `
  const pid = `seal-${id.replace(/[^\w-]/g, '')}`
  return (
    <div className={cn('sb-seal', small && 'sb-seal-sm')}>
      <svg viewBox="0 0 200 200" aria-hidden className="sb-seal-ring">
        <defs>
          <path id={pid} d="M100,100 m-82,0 a82,82 0 1,1 164,0 a82,82 0 1,1 -164,0" />
        </defs>
        <text>
          <textPath href={`#${pid}`} textLength="508">
            {meta.locale === 'ar' ? ring : ring.toUpperCase()}
          </textPath>
        </text>
      </svg>
      <span className="sb-emb-name">{monogramOf(name)}</span>
    </div>
  )
}

/** Today's opening window and the cheapest treatment — live from the dashboard, never stale. */
function liveFacts(meta: SiteMeta) {
  const today = meta.today ? meta.data.branch?.openingHours?.[meta.today as 'mon'] : undefined
  const first = today?.[0]
  const last = today?.[today.length - 1]
  const prices = meta.data.services
    .flatMap((s) => s.variants.map((v) => Number(v.priceAed)))
    .filter((n) => n > 0)
  return {
    hours: first && last ? `${clock(first.open, meta.locale)} – ${clock(last.close, meta.locale)}` : null,
    from: prices.length ? price(Math.min(...prices), meta.locale) : null,
    count: meta.data.services.length,
  }
}

function Bento({ meta, id }: { meta: SiteMeta; id: string }) {
  const f = liveFacts(meta)
  const L = meta.locale
  return (
    <div className="sb-bento">
      <div className="sb-bento-tile sb-bento-brand">
        <Seal meta={meta} id={id} small />
      </div>
      <div className="sb-bento-tile">
        <p className="sb-bento-k">{ui('openToday', L)}</p>
        <p className="sb-bento-v">{f.hours ?? ui('bookMinute', L)}</p>
        <span className="sb-bento-dots">
          <i />
          <i />
          <i />
        </span>
      </div>
      <div className="sb-bento-tile">
        <p className="sb-bento-k">{ui('treatments', L)}</p>
        <p className="sb-bento-v sb-bento-num">{f.count || '—'}</p>
      </div>
      <div className="sb-bento-tile">
        <p className="sb-bento-k">{ui('from', L)}</p>
        <p className="sb-bento-v">{f.from ?? '—'}</p>
        <svg viewBox="0 0 120 32" className="sb-bento-spark" aria-hidden>
          <path d="M2 28 C 22 26, 30 18, 46 20 S 74 10, 88 12 S 108 4, 118 3" />
        </svg>
      </div>
      <div className="sb-bento-tile sb-bento-wide">
        <p className="sb-bento-v sb-bento-lang">
          <span lang="ar">عربي</span>
          <span>·</span>
          <span lang="en">English</span>
        </p>
      </div>
    </div>
  )
}

export function HeroEmblem({ kind, meta, id }: { kind: Emblem; meta: SiteMeta; id: string }) {
  const name = meta.data.tenant.name
  const caption = ui('emblemCaption', meta.locale)
  if (kind === 'none') return null
  if (kind === 'seal' || kind === 'bento')
    return (
      <div aria-hidden className="sb-emblem" data-emblem={kind}>
        {kind === 'seal' ? <Seal meta={meta} id={id} /> : <Bento meta={meta} id={id} />}
      </div>
    )
  if (kind === 'flap') {
    const letters = [...name.toUpperCase().replace(/\s+/g, ' ').slice(0, 12)]
    return (
      <div aria-hidden className="sb-emblem" data-emblem="flap">
        <div className="sb-flap" dir="ltr">
          {letters.map((ch, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed letters of the name
            <span key={i} className="sb-flap-cell" style={{ '--i': i } as React.CSSProperties}>
              {ch === ' ' ? ' ' : ch}
            </span>
          ))}
        </div>
        <p className="sb-emb-cap">{caption}</p>
      </div>
    )
  }
  // numeral · tile · glass · arch · monogram: the name set large in the heading face, framed per kind.
  return (
    <div aria-hidden className="sb-emblem" data-emblem={kind}>
      <div className="sb-emb-frame">
        {kind === 'monogram' && <span className="sb-emb-est">EST</span>}
        <span className="sb-emb-name">{kind === 'numeral' ? name : monogramOf(name)}</span>
        <span className="sb-emb-cap">{caption}</span>
      </div>
    </div>
  )
}

/** Headline text with `*emphasis*` segments (theme `emphasis` token styles them: italic / muted / underline). */
export function Emphasis({ text }: { text: string }) {
  if (!text.includes('*')) return text
  return text.split(/(\*[^*]+\*)/g).map((part, i) =>
    part.startsWith('*') && part.endsWith('*') && part.length > 2 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
      <em key={i} className="sb-em">
        {part.slice(1, -1)}
      </em>
    ) : (
      part
    ),
  )
}

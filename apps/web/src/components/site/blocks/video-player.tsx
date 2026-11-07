'use client'
// F15 Video block, YouTube/Vimeo: a poster button until the visitor clicks play — nothing from the video host (no
// script, no cookie, no iframe) loads before that. Then the privacy-enhanced player replaces it and autoplays.
import { Play } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/utils'

export function VideoPlayer({
  embedSrc,
  poster,
  title,
  playLabel,
  notice,
  aspect,
  inert,
}: {
  embedSrc: string
  poster: string | null
  title: string
  playLabel: string
  /** "Plays from YouTube" — said before the click, so the visitor knows where it comes from. */
  notice: string
  aspect: string
  /** Editor canvas: show the poster only. */
  inert?: boolean
}) {
  const [playing, setPlaying] = useState(false)
  if (playing)
    return (
      <div className={cn('sb-card relative overflow-hidden bg-black', aspect)}>
        <iframe
          src={embedSrc}
          title={title}
          className="absolute inset-0 size-full border-0"
          allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      </div>
    )
  return (
    <button
      type="button"
      data-video-poster=""
      aria-label={`${playLabel}: ${title}`}
      disabled={inert}
      onClick={() => setPlaying(true)}
      className={cn(
        'sb-card group relative block w-full overflow-hidden bg-[var(--inverse-bg,#111)] text-start',
        aspect,
        inert && 'cursor-default',
      )}
    >
      {poster ? (
        // biome-ignore lint/performance/noImgElement: tenant-site markup, any poster URL
        <img src={poster} alt="" loading="lazy" className="absolute inset-0 size-full object-cover" />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,var(--accent-soft),transparent_60%),linear-gradient(135deg,var(--brand),var(--inverse-bg,#111))]"
        />
      )}
      <span aria-hidden className="absolute inset-0 bg-black/25 transition-colors group-hover:bg-black/35" />
      <span className="absolute inset-0 grid place-items-center">
        <span className="grid size-16 place-items-center rounded-full bg-white/90 text-black shadow-lg transition-transform duration-200 group-hover:scale-105 sm:size-20">
          <Play className="size-7 translate-x-0.5 fill-current sm:size-8" strokeWidth={1.5} />
        </span>
      </span>
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-4 pb-3 pt-8 text-xs text-white/90">
        {notice}
      </span>
    </button>
  )
}

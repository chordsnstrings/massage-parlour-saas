import type { PuckContext } from '@puckeditor/core'
import { MessageCircle, Phone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { tr } from '../i18n'
import { actionHref, type LinkAction, linkProps } from '../links'
import type { Bi, SiteMeta } from '../types'

export const metaOf = (puck: PuckContext) => puck.metadata as SiteMeta

export type ButtonItem = {
  label: Bi
  action: LinkAction
  target?: string
  style: 'primary' | 'secondary' | 'link'
}

/** Theme-styled call-to-action; hidden when its action isn't set up yet (e.g. no WhatsApp number). */
export function SiteButton({
  item,
  meta,
  size,
  className,
}: {
  item: ButtonItem
  meta: SiteMeta
  size?: 'md' | 'lg'
  className?: string
}) {
  const href = actionHref(meta, item.action, item.target)
  if (!href && !meta.editing) return null
  const Icon = item.action === 'whatsapp' ? MessageCircle : item.action === 'phone' ? Phone : null
  return (
    <a
      {...linkProps(meta, href)}
      className={cn(
        'sb-btn',
        item.style === 'secondary'
          ? 'sb-btn-secondary'
          : item.style === 'link'
            ? 'sb-btn-link'
            : 'sb-btn-primary',
        size === 'lg' && 'sb-btn-lg',
        className,
      )}
    >
      {Icon && <Icon strokeWidth={1.75} />}
      {tr(item.label, meta) || 'Button'}
    </a>
  )
}

/** Soft abstract artwork used when an image block has no picture yet (no external assets needed). */
export function ArtPlaceholder({ seed = 0, className }: { seed?: number; className?: string }) {
  const r = (n: number) => ((seed * 9301 + n * 49297) % 233280) / 233280
  return (
    <div
      aria-hidden
      className={cn('relative overflow-hidden bg-[var(--accent-soft)]', className)}
      style={{
        backgroundImage: `radial-gradient(circle at ${20 + r(1) * 60}% ${20 + r(2) * 50}%, color-mix(in srgb, var(--brand) 38%, transparent), transparent 55%), radial-gradient(circle at ${30 + r(3) * 50}% ${60 + r(4) * 30}%, color-mix(in srgb, var(--surface) 90%, transparent), transparent 50%), linear-gradient(160deg, var(--subtle), var(--accent-soft))`,
      }}
    >
      <svg
        viewBox="0 0 200 200"
        className="absolute -end-6 -bottom-8 w-2/3 opacity-30"
        fill="none"
        stroke="var(--brand)"
        strokeWidth="0.8"
      >
        <title>Decorative leaf</title>
        <path d="M30 170 C 60 60, 140 30, 180 20 C 170 90, 120 160, 30 170 Z" />
        <path d="M30 170 C 80 120, 120 80, 180 20" />
        <path d="M70 128 L 82 96 M100 106 L 118 74 M128 82 L 150 56" />
      </svg>
    </div>
  )
}

export const container = {
  narrow: 'mx-auto w-full max-w-3xl px-5 sm:px-8',
  contained: 'mx-auto w-full max-w-6xl px-5 sm:px-8',
  full: 'w-full px-5 sm:px-8 lg:px-12',
} as const

export function SectionTitle({
  title,
  intro,
  meta,
  center,
}: {
  title?: Bi
  intro?: Bi
  meta: SiteMeta
  center?: boolean
}) {
  const t = tr(title, meta)
  const i = tr(intro, meta)
  if (!t && !i) return null
  return (
    <div className={cn('mb-10 max-w-2xl space-y-3 sm:mb-14', center && 'mx-auto text-center')}>
      {t && <h2 className="sb-heading text-3xl sm:text-4xl">{t}</h2>}
      {i && <p className="sb-prose text-[17px] text-muted">{i}</p>}
    </div>
  )
}

import { cn, initials } from '@/lib/utils'

// Design avatar colours (crm-spec §1.1 extra literals). Picked from the name so a person keeps one colour.
const COLOURS = ['#3b6fe0', '#7a6ce0', '#3b9ee0', '#e0559e', '#5f6e7e', '#1fa865', '#f2603c']
const colourFor = (name: string) => {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return COLOURS[h % COLOURS.length]
}

/** Initials avatar (`.tav`); `src` shows a photo instead. Names are shown as typed (never translated). */
export function Avatar({
  name,
  src,
  size = 'md',
  className,
}: {
  name: string
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  return (
    <span
      className={cn('crm-tav', className)}
      data-size={size === 'md' ? undefined : size}
      style={{ background: colourFor(name) }}
      aria-hidden
    >
      {/* biome-ignore lint/performance/noImgElement: tiny avatars, any host */}
      {src ? <img src={src} alt="" /> : initials(name) || '·'}
    </span>
  )
}

/** Table name cell: avatar + name (+ muted sub line). */
export function TName({ name, sub, src }: { name: string; sub?: React.ReactNode; src?: string | null }) {
  return (
    <span className="crm-tname">
      <Avatar name={name} src={src} />
      <span className="min-w-0">
        <b className="block truncate">{name}</b>
        {sub && <span className="crm-muted block truncate text-[length:var(--crm-fs-sub)]">{sub}</span>}
      </span>
    </span>
  )
}

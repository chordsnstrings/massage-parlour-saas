import { MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Avatar } from './avatar'

/** Team member card (`.team-card`): avatar, name (as typed), `subtitle` (role line, e.g. roleName()), up to 3 stats. */
export function TeamCard({
  name,
  subtitle,
  src,
  stats,
  className,
  children,
}: {
  name: string
  subtitle?: React.ReactNode
  src?: string | null
  stats?: { label: React.ReactNode; value: React.ReactNode }[]
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div className={cn('crm-card crm-team-card', className)}>
      <Avatar name={name} src={src} size="lg" />
      <h4>{name}</h4>
      {subtitle && <div className="crm-role">{subtitle}</div>}
      {stats && stats.length > 0 && (
        <div className="crm-stats">
          {stats.map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static, order-stable list
            <div key={i}>
              <b>{s.value}</b>
              {s.label}
            </div>
          ))}
        </div>
      )}
      {children}
    </div>
  )
}

/** Chat bubble (`.bub`): `from="them"` (client) or `"us"` (spa/AI); `time` preformatted via fmt.time. */
export function Bubble({
  from,
  time,
  children,
}: {
  from: 'them' | 'us'
  time?: string
  children: React.ReactNode
}) {
  return (
    <div className="crm-bub" data-from={from}>
      {children}
      {time && <div className="crm-t">{time}</div>}
    </div>
  )
}

export function Chat({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('crm-chat', className)} role="log" aria-label={label}>
      {children}
    </div>
  )
}

/** WhatsApp queue item (`.q-item`): green tile, header (name, pills), message preview, actions (wa.me link, edit). */
export function QueueItem({
  header,
  message,
  actions,
  className,
}: {
  header: React.ReactNode
  message?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('crm-q-item', className)}>
      <span className="crm-qi" aria-hidden>
        <MessageCircle />
      </span>
      <div className="crm-qb">
        <div className="crm-hd">{header}</div>
        {message && <div className="crm-msg">{message}</div>}
        {actions && <div className="crm-qa">{actions}</div>}
      </div>
    </div>
  )
}

/** Gift-card visual (`.gift`): spa name (as typed) on top, value + code/expiry at the bottom. */
export function GiftCardVisual({
  top,
  value,
  bottom,
  className,
}: {
  top: React.ReactNode
  value: React.ReactNode
  bottom?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('crm-gift', className)}>
      <div className="text-[length:var(--crm-fs-note)] font-semibold">{top}</div>
      <div>
        <div className="crm-gv">{value}</div>
        {bottom && <div className="text-[length:var(--crm-fs-sub)] opacity-85">{bottom}</div>}
      </div>
    </div>
  )
}

/** Browser-frame preview of the spa website (`.wstudio`): url bar + any content (image, iframe, hero mock). */
export function SiteFrame({
  url,
  className,
  children,
}: {
  url: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('crm-wstudio', className)}>
      <div className="crm-wbar" aria-hidden>
        <span className="crm-wd" />
        <span className="crm-wd" />
        <span className="crm-wd" />
        <span className="crm-wurl">{url}</span>
      </div>
      <div className="crm-wprev">{children}</div>
    </div>
  )
}

/** Roadmap / "coming soon" row (`.coming`): icon tile, text, end pill. */
export function ComingItem({
  icon,
  pill,
  children,
}: {
  icon?: React.ReactNode
  pill?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="crm-coming">
      {icon && (
        <span className="crm-ci" aria-hidden>
          {icon}
        </span>
      )}
      <span className="min-w-0">{children}</span>
      {pill}
    </div>
  )
}

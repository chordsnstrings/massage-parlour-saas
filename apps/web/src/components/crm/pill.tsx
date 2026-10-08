import { cn } from '@/lib/utils'

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'acc'

/** Status/tag pill (crm-spec §3 `.pill`). `dot` adds the leading status dot. */
export function Pill({
  tone = 'neutral',
  dot,
  className,
  children,
  title,
}: {
  tone?: Tone
  dot?: boolean
  className?: string
  children: React.ReactNode
  title?: string
}) {
  return (
    <span
      className={cn('crm-pill', className)}
      data-tone={tone === 'neutral' ? undefined : tone}
      title={title}
    >
      {dot && <span className="crm-dotc" aria-hidden />}
      {children}
    </span>
  )
}

/** Booking/sale/etc. status → pill tone. Extend per screen; unknown statuses are neutral. */
export const STATUS_TONE: Record<string, Tone> = {
  pending: 'warn',
  confirmed: 'info',
  checked_in: 'acc',
  in_service: 'acc',
  completed: 'ok',
  no_show: 'bad',
  cancelled: 'neutral',
  open: 'warn',
  paid: 'ok',
  void: 'neutral',
  refunded: 'neutral',
  active: 'ok',
  draft: 'neutral',
  queued: 'info',
  scheduled: 'info',
  published: 'ok',
  pending_approval: 'warn',
  failed: 'bad',
  expired: 'neutral',
  past_due: 'warn',
  suspended: 'bad',
  trial: 'acc',
  trialing: 'acc',
}
export const statusTone = (status: string): Tone => STATUS_TONE[status] ?? 'neutral'

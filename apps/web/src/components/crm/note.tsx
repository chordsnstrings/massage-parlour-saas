import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Callout (`.note`): info (default), accent or warning tone; icon defaults to Info. */
export function Note({
  tone = 'info',
  icon,
  className,
  children,
}: {
  tone?: 'info' | 'acc' | 'warn'
  icon?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('crm-note', className)} data-tone={tone === 'info' ? undefined : tone}>
      {icon ?? <Info aria-hidden strokeWidth={1.8} />}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/** Uppercase accent micro-label with a leading rule (`.ey`). */
export function Eyebrow({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn('crm-ey', className)}>{children}</span>
}

export function Hairline({ className }: { className?: string }) {
  return <hr className={cn('crm-hairline', className)} />
}

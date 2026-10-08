import { cn } from '@/lib/utils'
import { Reveal } from './motion'

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  eyebrow?: React.ReactNode
}) {
  return (
    <div className="mb-[var(--ui-header-mb,2rem)] flex flex-col gap-4 sm:mb-[var(--ui-header-mb-sm,2.5rem)] sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1.5">
        {eyebrow && <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted">{eyebrow}</p>}
        <h1 className="text-[length:var(--ui-title-fs,1.5rem)] font-semibold tracking-tight sm:text-[length:var(--ui-title-fs-sm,28px)]">
          {title}
        </h1>
        {description && (
          <p className="max-w-2xl text-[length:var(--ui-desc-fs,15px)] text-muted">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:flex-nowrap">{actions}</div>
      )}
    </div>
  )
}

/** Page body: consistent vertical rhythm and entrance animation. */
export function PageBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Reveal
      className={cn('space-y-[var(--ui-stack,1.5rem)] sm:space-y-[var(--ui-stack-sm,2rem)]', className)}
    >
      {children}
    </Reveal>
  )
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && (
        <div className="grid size-11 place-items-center rounded-full bg-subtle text-muted">{icon}</div>
      )}
      <div className="space-y-1">
        <p className="text-[15px] font-medium">{title}</p>
        {description && <p className="max-w-sm text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-subtle', className)}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-surface/60 to-transparent" />
    </div>
  )
}

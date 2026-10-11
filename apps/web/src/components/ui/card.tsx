import { cn } from '@/lib/utils'

export function Card({ className, ...props }: React.ComponentProps<'section'>) {
  return (
    <section
      className={cn(
        'rounded-[var(--ui-card-radius,0.75rem)] border bg-surface shadow-[var(--ui-card-shadow,0_0_#0000)]',
        className,
      )}
      {...props}
    />
  )
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 px-[var(--ui-card-pad,1.25rem)] pt-[var(--ui-card-pad,1.25rem)] sm:px-[var(--ui-card-pad-sm,1.5rem)] sm:pt-[var(--ui-card-pad-sm,1.5rem)]',
        className,
      )}
    >
      <div className="min-w-0 space-y-1">
        <h2 className="text-[length:var(--ui-card-title-fs,15px)] font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-[length:var(--ui-card-desc-fs,0.875rem)] text-muted">{description}</p>
        )}
      </div>
      {action}
    </header>
  )
}

export function CardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'px-[var(--ui-card-pad,1.25rem)] py-[var(--ui-card-pad,1.25rem)] sm:px-[var(--ui-card-pad-sm,1.5rem)] sm:py-[var(--ui-card-pad-sm,1.5rem)]',
        className,
      )}
      {...props}
    />
  )
}

export function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-2 border-t bg-subtle/40 px-[var(--ui-card-pad,1.25rem)] py-3.5 sm:px-[var(--ui-card-pad-sm,1.5rem)]',
        className,
      )}
      {...props}
    />
  )
}

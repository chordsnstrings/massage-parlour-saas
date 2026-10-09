import { cn } from '@/lib/utils'

const control =
  'w-full rounded-[var(--ui-ctl-radius,0.5rem)] border border-[var(--ui-ctl-border,var(--border))] bg-[var(--ui-ctl-bg,var(--surface))] px-3 text-[length:var(--ui-ctl-fs,0.875rem)] text-fg placeholder:text-muted/70 transition-[border-color,box-shadow] duration-150 hover:border-[var(--ui-ctl-border-hover,color-mix(in_oklab,var(--fg)_20%,transparent))] focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-60 aria-[invalid=true]:border-danger'

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(control, 'h-[var(--ui-ctl-h,2.5rem)]', className)} {...props} />
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-24 py-2.5', className)} {...props} />
}

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        control,
        "h-[var(--ui-ctl-h,2.5rem)] appearance-none bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%236b6a66' stroke-width='1.5'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")] bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pe-9",
        className,
      )}
      {...props}
    />
  )
}

export function Checkbox({ className, ...props }: Omit<React.ComponentProps<'input'>, 'type'>) {
  return (
    <input type="checkbox" className={cn('size-4 rounded accent-[var(--accent)]', className)} {...props} />
  )
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is passed by callers
    <label
      className={cn(
        'text-[length:var(--ui-label-fs,13px)] font-medium text-[color:var(--ui-label-color,var(--fg))]',
        className,
      )}
      {...props}
    />
  )
}

import { cn } from '@/lib/utils'

const control =
  'w-full rounded-lg border bg-surface px-3 text-sm text-fg placeholder:text-muted/70 transition-[border-color,box-shadow] duration-150 hover:border-fg/20 focus:border-accent focus:outline-none focus:ring-4 focus:ring-accent/15 disabled:opacity-60 aria-[invalid=true]:border-danger'

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(control, 'h-10', className)} {...props} />
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-24 py-2.5', className)} {...props} />
}

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        control,
        "h-10 appearance-none bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%236b6a66' stroke-width='1.5'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")] bg-[length:16px] bg-[right_0.75rem_center] bg-no-repeat pe-9",
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
  // biome-ignore lint/a11y/noLabelWithoutControl: htmlFor is passed by callers
  return <label className={cn('text-[13px] font-medium text-fg', className)} {...props} />
}

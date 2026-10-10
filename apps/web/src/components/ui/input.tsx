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
  // List boxes (multiple / size > 1) are not dropdowns: no chevron, full width for the option text.
  const list = props.multiple || Number(props.size) > 1
  return (
    <select
      className={cn(
        control,
        'h-[var(--ui-ctl-h,2.5rem)]',
        // Chevron: no quotes or spaces in the class (Tailwind's scanner must see it); bg-[position:…] so
        // tailwind-merge doesn't read it as a colour and drop the control background.
        !list &&
          'appearance-none bg-[url(data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20width=%2716%27%20height=%2716%27%20fill=%27none%27%20stroke=%27%236b6a66%27%20stroke-width=%271.5%27%3E%3Cpath%20d=%27m4%206%204%204%204-4%27/%3E%3C/svg%3E)] bg-[length:16px] bg-[position:right_0.75rem_center] bg-no-repeat pe-9',
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

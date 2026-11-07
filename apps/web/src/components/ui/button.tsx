import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-[var(--ui-btn-radius,0.5rem)] text-[length:var(--ui-btn-fs,0.875rem)] [font-weight:var(--ui-btn-fw,500)] transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[var(--ease-calm)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-accent text-accent-fg hover:brightness-[1.06] shadow-[var(--ui-btn-shadow,0_1px_0_rgb(0_0_0/0.04))]',
        secondary: 'border bg-surface text-fg hover:bg-subtle',
        ghost: 'text-muted hover:bg-subtle hover:text-fg',
        danger: 'border border-danger/30 bg-danger-soft text-danger hover:border-danger/60',
      },
      size: {
        sm: 'h-[var(--ui-btn-h-sm,2rem)] px-[var(--ui-btn-px-sm,0.75rem)] text-[length:var(--ui-btn-fs-sm,0.875rem)]',
        md: 'h-[var(--ui-btn-h,2.5rem)] px-[var(--ui-btn-px,1rem)]',
        lg: 'h-[var(--ui-btn-h-lg,2.75rem)] px-[var(--ui-btn-px-lg,1.25rem)] text-[length:var(--ui-btn-fs-lg,15px)]',
        icon: 'size-[var(--ui-btn-h,2.5rem)]',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean; pending?: boolean }

export function Button({
  className,
  variant,
  size,
  asChild,
  pending,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || pending}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {pending && <Loader2 className="animate-spin" />}
          {children}
        </>
      )}
    </Comp>
  )
}

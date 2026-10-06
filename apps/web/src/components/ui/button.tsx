import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils'

export const buttonVariants = cva(
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 ease-[var(--ease-calm)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-accent-fg hover:brightness-[1.06] shadow-[0_1px_0_rgb(0_0_0/0.04)]',
        secondary: 'border bg-surface text-fg hover:bg-subtle',
        ghost: 'text-muted hover:bg-subtle hover:text-fg',
        danger: 'border border-danger/30 bg-danger-soft text-danger hover:border-danger/60',
      },
      size: { sm: 'h-8 px-3', md: 'h-10 px-4', lg: 'h-11 px-5 text-[15px]', icon: 'size-10' },
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

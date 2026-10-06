import { cn } from '@/lib/utils'

const tones = {
  neutral: 'bg-subtle text-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-accent-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
} as const

export function Badge({
  tone = 'neutral',
  className,
  ...props
}: React.ComponentProps<'span'> & { tone?: keyof typeof tones }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
      {...props}
    />
  )
}

export const statusTone = (status: string): keyof typeof tones =>
  (
    ({
      active: 'success',
      paid: 'success',
      trial: 'accent',
      trialing: 'accent',
      issued: 'accent',
      past_due: 'warning',
      read_only: 'warning',
      pending: 'warning',
      suspended: 'danger',
      cancelled: 'neutral',
      void: 'neutral',
      disabled: 'neutral',
    }) as Record<string, keyof typeof tones>
  )[status] ?? 'neutral'

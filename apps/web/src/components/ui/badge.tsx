import { cn } from '@/lib/utils'

const tones = {
  neutral: 'bg-subtle text-muted',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-[var(--success-soft,var(--accent-soft))] text-success',
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
        'inline-flex items-center gap-1 rounded-full px-[var(--ui-pill-px,0.625rem)] py-[var(--ui-pill-py,0.125rem)] text-[length:var(--ui-pill-fs,0.75rem)] [font-weight:var(--ui-pill-fw,500)] whitespace-nowrap',
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
      approved: 'success',
      rejected: 'danger',
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

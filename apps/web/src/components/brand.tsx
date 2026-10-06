import { cn } from '@/lib/utils'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden="true">
      <rect width="32" height="32" rx="9" className="fill-accent" />
      <path d="M16 8c3.5 3 5 6 5 9a5 5 0 0 1-10 0c0-3 1.5-6 5-9Z" className="fill-accent-fg" opacity=".95" />
      <path d="M16 13v11" className="stroke-accent" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight">
        spa<span className="text-muted">management</span>
      </span>
    </span>
  )
}

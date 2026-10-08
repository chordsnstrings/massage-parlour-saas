import Link from 'next/link'
import { cn } from '@/lib/utils'

export type SegItem = { value: string; label: React.ReactNode; href?: string; title?: string }

/**
 * Segmented control (`.seg`): links when items have `href` (server-safe; e.g. ?status= filters, Day/Week/Month),
 * otherwise buttons calling `onChange` (use from a client component). `label` = accessible group name.
 */
export function Seg({
  items,
  value,
  onChange,
  label,
  fill,
  className,
}: {
  items: SegItem[]
  value: string
  onChange?: (value: string) => void
  label: string
  fill?: boolean
  className?: string
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset would add legend chrome; this is a toolbar-like group
    <div
      role="group"
      aria-label={label}
      className={cn('crm-segctl', className)}
      data-fill={fill || undefined}
    >
      {items.map((item) =>
        item.href ? (
          <Link
            key={item.value}
            href={item.href}
            title={item.title}
            aria-current={item.value === value ? 'page' : undefined}
          >
            {item.label}
          </Link>
        ) : (
          <button
            key={item.value}
            type="button"
            title={item.title}
            aria-pressed={item.value === value}
            onClick={() => onChange?.(item.value)}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  )
}

/** Section tabs under a page title (same look as the shell's `.crm-tabs`), for in-page sub-navigation. */
export function SectionTabs({
  items,
  value,
  label,
  className,
}: {
  items: { value: string; label: React.ReactNode; href: string }[]
  value: string
  label: string
  className?: string
}) {
  return (
    <nav className={cn('crm-tabs', className)} aria-label={label}>
      {items.map((item) => (
        <Link
          key={item.value}
          href={item.href}
          className="crm-tab"
          aria-current={item.value === value ? 'page' : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  )
}

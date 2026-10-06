import Link from 'next/link'
import { cn } from '@/lib/utils'

const TABS = [
  { key: 'overview', label: 'Overview', path: '' },
  { key: 'expenses', label: 'Expenses', path: '/expenses' },
  { key: 'journal', label: 'Journal', path: '/journal' },
] as const

/** Section tabs shared by the accounting pages; the month carries over. */
export function AccountsTabs({
  base,
  month,
  active,
}: {
  base: string
  month: string
  active: (typeof TABS)[number]['key']
}) {
  return (
    <nav className="-mt-4 mb-8 flex gap-6 border-b text-sm sm:-mt-6" aria-label="Accounts">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={`${base}${t.path}?month=${month}`}
          aria-current={active === t.key ? 'page' : undefined}
          className={cn(
            '-mb-px border-b-2 pb-3 transition-colors',
            active === t.key
              ? 'border-fg font-medium text-fg'
              : 'border-transparent text-muted hover:text-fg',
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}

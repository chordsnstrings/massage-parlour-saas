import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { todayDubai } from '@/lib/utils'

/** `YYYY-MM` from a search param (defaults to the current Dubai month) with its first/last day. */
export function monthRange(param?: string) {
  const month = param && /^\d{4}-(0[1-9]|1[0-2])$/.test(param) ? param : todayDubai().slice(0, 7)
  const [y, m] = month.split('-').map(Number) as [number, number]
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const shift = (n: number) => new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7)
  const q = Math.floor((m - 1) / 3)
  return {
    month,
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, '0')}`,
    prev: shift(-1),
    next: shift(1),
    label: new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }),
    quarter: {
      label: `Q${q + 1} ${y}`,
      from: `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`,
      to: new Date(Date.UTC(y, q * 3 + 3, 0)).toISOString().slice(0, 10),
    },
  }
}

export function MonthNav({ base, range }: { base: string; range: ReturnType<typeof monthRange> }) {
  const current = todayDubai().slice(0, 7)
  const link =
    'grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-fg'
  return (
    <nav className="inline-flex items-center gap-1 rounded-full border bg-surface p-1" aria-label="Month">
      <Link href={`${base}?month=${range.prev}`} className={link} aria-label="Previous month">
        <ChevronLeft className="size-4" strokeWidth={1.5} />
      </Link>
      <span className="min-w-32 px-1 text-center text-sm font-medium tabular-nums">{range.label}</span>
      {range.month < current ? (
        <Link href={`${base}?month=${range.next}`} className={link} aria-label="Next month">
          <ChevronRight className="size-4" strokeWidth={1.5} />
        </Link>
      ) : (
        <span className={`${link} pointer-events-none opacity-30`} aria-hidden>
          <ChevronRight className="size-4" strokeWidth={1.5} />
        </span>
      )}
    </nav>
  )
}

import type { Format, Translator } from '@spa/core/i18n'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { getI18n } from '@/i18n/server'
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
    year: y,
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, '0')}`,
    prev: shift(-1),
    next: shift(1),
    shift,
    quarter: {
      n: q + 1,
      from: `${y}-${String(q * 3 + 1).padStart(2, '0')}-01`,
      to: new Date(Date.UTC(y, q * 3 + 3, 0)).toISOString().slice(0, 10),
    },
  }
}
export type MonthRange = ReturnType<typeof monthRange>

/** "October 2026" for a `YYYY-MM` month in the viewer's language (noon UTC keeps it inside the Dubai day). */
export const monthLabel = (fmt: Format, month: string) => fmt.monthYear(`${month}-01T12:00:00Z`)
/** "Q4 2026" · "ไตรมาส 4 2026". */
export const quarterLabel = (t: Translator, range: MonthRange) =>
  t('accounts.quarter', { q: range.quarter.n, year: range.year })

export async function MonthNav({ base, range }: { base: string; range: MonthRange }) {
  const { t, fmt } = await getI18n()
  const current = todayDubai().slice(0, 7)
  const link =
    'grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-subtle hover:text-fg'
  return (
    <nav
      className="inline-flex items-center gap-1 rounded-full border bg-surface p-1"
      aria-label={t('accounts.month.label')}
    >
      <Link href={`${base}?month=${range.prev}`} className={link} aria-label={t('accounts.month.prev')}>
        <ChevronLeft className="size-4 rtl:rotate-180" strokeWidth={1.5} />
      </Link>
      <span className="min-w-32 px-1 text-center text-sm font-medium tabular-nums">
        {monthLabel(fmt, range.month)}
      </span>
      {range.month < current ? (
        <Link href={`${base}?month=${range.next}`} className={link} aria-label={t('accounts.month.next')}>
          <ChevronRight className="size-4 rtl:rotate-180" strokeWidth={1.5} />
        </Link>
      ) : (
        <span className={`${link} pointer-events-none opacity-30`} aria-hidden>
          <ChevronRight className="size-4 rtl:rotate-180" strokeWidth={1.5} />
        </span>
      )}
    </nav>
  )
}

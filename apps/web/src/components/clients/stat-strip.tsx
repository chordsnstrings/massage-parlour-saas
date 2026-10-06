import { Card } from '@/components/ui/card'
import { NumberTicker } from '@/components/ui/motion'
import { cn } from '@/lib/utils'

type Stat = { label: string; value: number | string; format?: 'aed' | 'int' }

/** Compact KPI row: one hairline card split into cells (2×2 / 1×3 on phones, one row on wider screens). */
export function StatStrip({ stats }: { stats: Stat[] }) {
  return (
    <Card
      className={cn(
        'grid overflow-hidden',
        stats.length === 4 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3',
        '[&>*]:border-border sm:divide-x sm:divide-border',
      )}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          className={cn(
            'min-w-0 px-4 py-4 transition-colors hover:bg-subtle/40 sm:px-6 sm:py-5',
            stats.length === 4 ? (i % 2 ? 'border-s sm:border-s-0' : '') : i ? 'border-s sm:border-s-0' : '',
            stats.length === 4 && i < 2 ? 'border-b sm:border-b-0' : '',
          )}
        >
          <p className="text-[11px] font-medium uppercase leading-tight tracking-[0.06em] text-muted sm:text-xs">
            {s.label}
          </p>
          <p className="mt-2 truncate text-xl font-semibold tracking-tight tabular-nums sm:mt-3 sm:text-[26px]">
            {typeof s.value === 'number' ? <NumberTicker value={s.value} format={s.format} /> : s.value}
          </p>
        </div>
      ))}
    </Card>
  )
}

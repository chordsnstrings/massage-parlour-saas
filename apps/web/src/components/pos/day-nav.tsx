import { ChevronLeft, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

/** Previous / current / next business-day pager (sales list + daily close). `nextHref` null = today (no future). */
export function DayNav({
  label,
  prevHref,
  nextHref,
  prevLabel,
  nextLabel,
}: {
  label: string
  prevHref: string
  nextHref: string | null
  prevLabel: string
  nextLabel: string
}) {
  return (
    <div className="crm-card flex items-center gap-1 !p-1">
      <Button variant="ghost" size="icon" asChild>
        <Link href={prevHref} aria-label={prevLabel}>
          <ChevronLeft />
        </Link>
      </Button>
      <span className="min-w-36 px-1 text-center text-[length:var(--crm-fs-td)] font-semibold tabular-nums">
        {label}
      </span>
      {nextHref ? (
        <Button variant="ghost" size="icon" asChild>
          <Link href={nextHref} aria-label={nextLabel}>
            <ChevronRight />
          </Link>
        </Button>
      ) : (
        <span className="size-[var(--ui-btn-h,2.5rem)]" />
      )}
    </div>
  )
}

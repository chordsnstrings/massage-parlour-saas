import { ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export type Dir = 'up' | 'down' | 'flat'

/** Stat tile (crm-spec §3 `.stat`): label, big value (+ small unit), optional change line. */
export function Stat({
  label,
  value,
  unit,
  change,
  icon,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  unit?: React.ReactNode
  change?: { text: React.ReactNode; dir?: Dir }
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('crm-stat', className)}>
      <div className="crm-lab">
        {icon}
        {label}
      </div>
      <div className="crm-n">
        {value}
        {unit && <small> {unit}</small>}
      </div>
      {change && (
        <div className="crm-chg" data-dir={change.dir ?? 'flat'}>
          {change.text}
        </div>
      )}
    </div>
  )
}

/** Delta chip (+12% / −3% / 0%). `text` is preformatted by the caller (fmt.percent). */
export function Delta({ dir, children }: { dir: Dir; children: React.ReactNode }) {
  return (
    <span className="crm-delta" data-dir={dir}>
      {children}
    </span>
  )
}

/** KPI card (crm-spec §3 `.kpi`): icon + label, value + delta, sub line, optional "View details →" footer link. */
export function Kpi({
  label,
  value,
  icon,
  delta,
  sub,
  href,
  linkLabel,
  className,
}: {
  label: React.ReactNode
  value: React.ReactNode
  icon?: React.ReactNode
  delta?: { text: React.ReactNode; dir: Dir }
  sub?: React.ReactNode
  href?: string
  /** Footer link text (e.g. t('common.viewDetails')); shown when `href` is set. */
  linkLabel?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('crm-kpi', className)}>
      <div className="crm-top">
        {icon && <span className="crm-ic">{icon}</span>}
        {label}
      </div>
      <div className="crm-row1">
        <span className="crm-n">{value}</span>
        {delta && <Delta dir={delta.dir}>{delta.text}</Delta>}
      </div>
      {sub && <div className="crm-sub">{sub}</div>}
      {href && linkLabel && (
        <Link href={href} className="crm-vd">
          {linkLabel}
          <ArrowRight aria-hidden className="rtl:-scale-x-100" />
        </Link>
      )}
    </div>
  )
}

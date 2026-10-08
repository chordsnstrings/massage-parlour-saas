import { cn } from '@/lib/utils'

/** Card header: title + optional sub line on the start side, actions at the end (crm-spec §3 `.card-h`). */
export function CardHeader({
  title,
  sub,
  actions,
  as: H = 'h3',
  className,
}: {
  title: React.ReactNode
  sub?: React.ReactNode
  actions?: React.ReactNode
  as?: 'h2' | 'h3'
  className?: string
}) {
  return (
    <div className={cn('crm-card-h', className)}>
      <div className="min-w-0">
        <H>{title}</H>
        {sub && <p className="crm-sub">{sub}</p>}
      </div>
      {actions && <div className="crm-act">{actions}</div>}
    </div>
  )
}

/** Surface card. Pass `title` (+ `sub`, `actions`) for the standard header; `flush` drops body padding (tables). */
export function Card({
  title,
  sub,
  actions,
  headingAs,
  arch,
  flush,
  footer,
  as: Tag = 'section',
  className,
  children,
  ...rest
}: {
  title?: React.ReactNode
  sub?: React.ReactNode
  actions?: React.ReactNode
  headingAs?: 'h2' | 'h3'
  arch?: boolean
  flush?: boolean
  /** Footer bar under the body (hairline above; e.g. totals + a primary action). */
  footer?: React.ReactNode
  as?: 'section' | 'div' | 'article'
  className?: string
  children?: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLElement>, 'title'>) {
  return (
    <Tag
      className={cn('crm-card', className)}
      data-arch={arch || undefined}
      data-flush={flush || undefined}
      {...rest}
    >
      {title !== undefined && <CardHeader title={title} sub={sub} actions={actions} as={headingAs} />}
      {children}
      {footer && <div className="crm-card-f">{footer}</div>}
    </Tag>
  )
}

export type GridCols = 'g1' | 'g2' | 'g3' | 'g4' | 'col-2' | 'col-2b' | 'kgrid'

/** Responsive grid (crm-spec §1.7): g4/g3 → 2 cols ≤1080, col-2(b) → 1 col ≤1080, all → 1 col ≤680; kgrid 5/3/2/1. */
export function Grid({
  cols,
  as: Tag = 'div',
  className,
  children,
}: {
  cols?: GridCols
  as?: 'div' | 'section' | 'ul'
  className?: string
  children: React.ReactNode
}) {
  return <Tag className={cn('crm-grid', cols && `crm-${cols}`, className)}>{children}</Tag>
}

/** Vertical stack with the grid gap — the page body between grids/cards. */
export function Stack({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn('crm-stack', className)}>{children}</div>
}

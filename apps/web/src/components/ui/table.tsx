import { cn } from '@/lib/utils'

export type Column<T> = {
  key: string
  header: React.ReactNode
  cell: (row: T) => React.ReactNode
  className?: string
  /** Shown as the card title on phones. */
  primary?: boolean
  hideOnMobile?: boolean
}

/** Table on md+, stacked cards on phones (pure CSS, no JS). */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
}: {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  empty?: React.ReactNode
}) {
  if (rows.length === 0) return <>{empty}</>
  const primary = columns.find((c) => c.primary) ?? columns[0]!
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile)
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-[length:var(--ui-td-fs,0.875rem)]">
          <thead>
            <tr className="border-b text-left text-[length:var(--ui-th-fs,0.75rem)] font-medium uppercase tracking-[0.06em] text-muted">
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    'px-[var(--ui-cell-px,1.5rem)] py-[var(--ui-th-py,0.75rem)] font-medium',
                    c.className,
                  )}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b transition-colors last:border-0 hover:bg-[var(--ui-row-hover,color-mix(in_oklab,var(--subtle)_50%,transparent))]"
              >
                {columns.map((c) => (
                  <td
                    key={c.key}
                    className={cn(
                      'px-[var(--ui-cell-px,1.5rem)] py-[var(--ui-cell-py,0.875rem)] align-middle',
                      c.className,
                    )}
                  >
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="divide-y md:hidden">
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className="space-y-2 px-[var(--ui-mcard-px,1.25rem)] py-[var(--ui-mcard-py,1rem)]"
          >
            <div className="text-[length:var(--ui-mcard-title-fs,15px)] font-medium">{primary.cell(row)}</div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[length:var(--ui-mcard-fs,0.875rem)]">
              {rest.map((c) => (
                <div key={c.key} className="contents">
                  <dt className="text-muted">{c.header}</dt>
                  <dd className="text-end">{c.cell(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}
